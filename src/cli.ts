#!/usr/bin/env node

import { readFile, stat } from "node:fs/promises";
import { basename, extname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { TextDecoder } from "node:util";

import { type JobBatchResolution, resolveJobInput, resolveJobInputsInDirectory } from "./job/resolve-input.js";
import { parseJobAnalysis } from "./job/schema.js";
import { parseCandidateProfile } from "./profile/schema.js";
import { publishProfileRevision } from "./profile/storage.js";
import { parseJobDecision } from "./decision/schema.js";
import { readAnalysisContext, publishAnalysisRevision } from "./job/analysis-storage.js";
import { readMatchContext } from "./match/context.js";
import { parseMatchAssessment } from "./match/schema.js";
import { saveMatchAssessment } from "./match/storage.js";
import { writeArtifact } from "./workspace/artifacts.js";
import { artifactPrivacyWarnings } from "./workspace/privacy.js";
import { createLocalJob } from "./workspace/storage.js";

export type CliIo = {
  writeStdout: (chunk: string) => void;
  writeStderr: (chunk: string) => void;
  readStdin: () => Promise<string>;
};

const defaultIo: CliIo = {
  writeStdout(chunk) {
    process.stdout.write(chunk);
  },
  writeStderr(chunk) {
    process.stderr.write(chunk);
  },
  readStdin: readStdin,
};

const usage = [
  "Usage:",
  "  career job analyze <file|directory|url> [--out path]",
  "  career job analyze <text> --text [--out path]",
  "  career job analyze --stdin [--out path]",
  "  career job import <file.txt|file.md> --root <workspace>",
  "  career job validate-analysis <analysis.json> [--out path]",
  "  career job analysis-context <job-id> --root <workspace>",
  "  career job publish-analysis <job-id> <analysis.json> --root <workspace> --expected-hash <token>",
  "  career match context <job-id> --root <workspace> [--profile-revision <id>]",
  "  career match validate <assessment.json> (structure only; live references are checked by publish)",
  "  career match publish <job-id> <assessment.json> --root <workspace> --expected-hash <token>",
  "  career profile validate <profile.json> [--out path]",
  "  career profile publish <profile.json> --root <workspace> --confirm --expected-hash sha256:<current-hash>",
  "  career decision validate <decision.json> [--out path]",
  "Output is create-only. Single-file replacement: --expected-hash sha256:<current-file-hash>",
].join("\n");

if (isDirectExecution(import.meta.url, process.argv[1])) {
  process.exitCode = await runCli(process.argv.slice(2));
}

export function isDirectExecution(moduleUrl: string, executedPath: string | undefined): boolean {
  return executedPath !== undefined && moduleUrl === pathToFileURL(resolve(executedPath)).href;
}

export async function runCli(args: string[], io: CliIo = defaultIo): Promise<number> {
  const [group, command, input, ...options] = args;

  if (!command) {
    io.writeStderr(`${usage}\n`);
    return 1;
  }

  try {
    if (group === "job") {
      if (command === "import") return await importJob(input, options, io);
      if (command === "analyze" || command === "prepare") return await analyze(input, options, io);
      if (command === "validate-analysis") return await validateAnalysis(input, options, io);
      if (command === "analysis-context") return await analysisContext(input, options, io);
      if (command === "publish-analysis") return await publishAnalysis(input, options, io);
    }
    if (group === "match") {
      if (command === "context") return await matchContext(input, options, io);
      if (command === "validate") return await validateMatch(input, io);
      if (command === "publish") return await publishMatch(input, options, io);
    }
    if (group === "profile" && command === "validate") return await validateProfile(input, options, io);
    if (group === "profile" && command === "publish") return await publishProfile(input, options, io);
    if (group === "decision" && command === "validate") return await validateDecision(input, options, io);

    io.writeStderr(`${usage}\n`);
    return 1;
  } catch (error) {
    io.writeStderr(`${error instanceof Error ? error.message : "Unexpected error"}\n`);
    return 1;
  }
}

async function importJob(path: string | undefined, options: string[], io: CliIo): Promise<number> {
  if (!path) throw new Error("Job file path is required");
  const root = optionValue(options, "--root");
  if (!root) throw new Error("--root is required to import a job");
  const extension = extname(path).toLowerCase();
  if (extension !== ".txt" && extension !== ".md") throw new Error("Job import supports only .txt and .md files");
  const filePath = resolve(path);
  const info = await stat(filePath);
  if (!info.isFile()) throw new Error("Job import requires a single file");
  const bytes = await readFile(filePath);
  const content = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
  const job = await createLocalJob(resolve(root), { content, sourceKind: "local-file", sourceFileName: basename(filePath) });
  io.writeStdout(serializeJson(job));
  return 0;
}

async function analyze(argument: string | undefined, options: string[], io: CliIo) {
  const output = optionValue(options, "--out");
  const expectedHash = expectedOutputHash(options, output);
  const resolvedInput = await resolveArgument(argument, options, io);

  if (isBatchResolution(resolvedInput)) {
    if (expectedHash !== null) throw new Error("--expected-hash only supports a single output file");
    if (output) return outputBatchJson(resolvedInput, output, io);
    await outputJson(resolvedInput, undefined, io);
    return resolvedInput.jobs.length === 0 ? 1 : 0;
  }

  await outputJson(resolvedInput, output, io, expectedHash);
  return 0;
}

async function validateAnalysis(path: string | undefined, options: string[], io: CliIo) {
  if (!path) throw new Error("Analysis JSON path is required");
  const output = optionValue(options, "--out");
  const parsed = parseJobAnalysis(JSON.parse(await readFile(resolve(path), "utf8")) as unknown);
  await outputJson(parsed, output, io, expectedOutputHash(options, output));
  return 0;
}

async function analysisContext(jobId: string | undefined, options: string[], io: CliIo): Promise<number> {
  if (!jobId) throw new Error("Job ID is required");
  const root = optionValue(options, "--root");
  if (!root) throw new Error("--root is required to read analysis context");
  io.writeStdout(serializeJson(await readAnalysisContext(resolve(root), jobId)));
  return 0;
}

async function publishAnalysis(jobId: string | undefined, options: string[], io: CliIo): Promise<number> {
  if (!jobId) throw new Error("Job ID is required");
  const path = options[0];
  if (!path || path.startsWith("--")) throw new Error("Analysis JSON path is required");
  const root = optionValue(options, "--root");
  if (!root) throw new Error("--root is required to publish an analysis");
  const expectedOption = optionValue(options, "--expected-hash");
  if (expectedOption === undefined || (expectedOption !== "missing" && !/^sha256:[a-f0-9]{64}$/.test(expectedOption))) {
    throw new Error("--expected-hash missing or sha256:<64 lowercase hex digits> is required to publish an analysis");
  }
  const draft = JSON.parse(await readFile(resolve(path), "utf8")) as unknown;
  const result = await publishAnalysisRevision(resolve(root), jobId, draft, expectedOption === "missing" ? null : expectedOption);
  io.writeStdout(serializeJson({ revisionId: result.revision.id, revisionHash: result.revisionHash }));
  return 0;
}

async function matchContext(jobId: string | undefined, options: string[], io: CliIo): Promise<number> {
  if (!jobId) throw new Error("Job ID is required");
  const root = optionValue(options, "--root");
  if (!root) throw new Error("--root is required to read match context");
  const profileRevision = optionValue(options, "--profile-revision");
  io.writeStdout(serializeJson(await readMatchContext(resolve(root), jobId, profileRevision)));
  return 0;
}

async function validateMatch(path: string | undefined, io: CliIo): Promise<number> {
  if (!path) throw new Error("Assessment JSON path is required");
  const parsed = parseMatchAssessment(JSON.parse(await readFile(resolve(path), "utf8")) as unknown);
  io.writeStdout(serializeJson(parsed));
  io.writeStderr("Validated assessment structure only; live references are checked by publish.\n");
  return 0;
}

async function publishMatch(jobId: string | undefined, options: string[], io: CliIo): Promise<number> {
  if (!jobId) throw new Error("Job ID is required");
  const path = options[0];
  if (!path || path.startsWith("--")) throw new Error("Assessment JSON path is required");
  const root = optionValue(options, "--root");
  if (!root) throw new Error("--root is required to publish an assessment");
  const expectedOption = optionValue(options, "--expected-hash");
  if (expectedOption === undefined || (expectedOption !== "missing" && !/^sha256:[a-f0-9]{64}$/.test(expectedOption))) {
    throw new Error("--expected-hash missing or sha256:<64 lowercase hex digits> is required to publish an assessment");
  }
  const draft = JSON.parse(await readFile(resolve(path), "utf8")) as unknown;
  const result = await saveMatchAssessment(resolve(root), jobId, draft, expectedOption === "missing" ? null : expectedOption);
  io.writeStdout(serializeJson({ assessmentId: result.assessment.id, assessmentHash: result.assessmentHash, pointerHash: result.pointerHash }));
  return 0;
}

async function validateProfile(path: string | undefined, options: string[], io: CliIo) {
  if (!path) throw new Error("Profile JSON path is required");
  const output = optionValue(options, "--out");
  const parsed = parseCandidateProfile(JSON.parse(await readFile(resolve(path), "utf8")) as unknown);
  await outputJson(parsed, output, io, expectedOutputHash(options, output));
  return 0;
}

async function publishProfile(path: string | undefined, options: string[], io: CliIo): Promise<number> {
  if (!path) throw new Error("Profile JSON path is required");
  if (!options.includes("--confirm")) throw new Error("--confirm is required to publish a profile");
  const root = optionValue(options, "--root");
  if (!root) throw new Error("--root is required to publish a profile");
  const expectedOption = optionValue(options, "--expected-hash");
  if (expectedOption === undefined || !/^sha256:[a-f0-9]{64}$/.test(expectedOption)) {
    throw new Error("--expected-hash sha256:<64 lowercase hex digits> is required to publish a profile");
  }
  const profile = parseCandidateProfile(JSON.parse(await readFile(resolve(path), "utf8")) as unknown);
  const result = await publishProfileRevision(resolve(root), profile, expectedOption, { confirmed: true });
  io.writeStdout(serializeJson({ profile: result.profile, revision: result.revision, unresolvedCount: result.unresolvedCount }));
  return 0;
}

async function validateDecision(path: string | undefined, options: string[], io: CliIo) {
  if (!path) throw new Error("Decision JSON path is required");
  const output = optionValue(options, "--out");
  const parsed = parseJobDecision(JSON.parse(await readFile(resolve(path), "utf8")) as unknown);
  await outputJson(parsed, output, io, expectedOutputHash(options, output));
  return 0;
}

async function resolveArgument(argument: string | undefined, options: string[], io: CliIo) {
  if (options.includes("--stdin")) {
    return resolveJobInput({ type: "text", content: await io.readStdin() });
  }
  if (options.includes("--text")) {
    if (!argument) throw new Error("Text input is required after --text");
    return resolveJobInput({ type: "text", content: argument });
  }
  if (!argument) throw new Error("Job input is required");
  if (/^https?:\/\//i.test(argument)) return resolveJobInput({ type: "url", url: argument });

  try {
    return await resolveJobInputsInDirectory(argument);
  } catch (error) {
    if (!(error instanceof Error) || !error.message.startsWith("Job input is not a directory")) {
      if (!(error instanceof Error) || !error.message.startsWith("Job directory does not exist")) throw error;
    }
  }
  return resolveJobInput({ type: "file", path: argument });
}

async function outputJson(value: unknown, path: string | undefined, io: CliIo, expectedHash: string | null = null) {
  const json = serializeJson(value);
  if (!path) {
    io.writeStdout(json);
    return;
  }

  const target = resolve(path);
  for (const warning of await artifactPrivacyWarnings(target)) io.writeStderr(`Privacy warning: ${warning}\n`);
  await writeArtifact(target, json, expectedHash);
  io.writeStderr(`Wrote ${target}\n`);
}

async function outputBatchJson(batch: JobBatchResolution, path: string, io: CliIo) {
  if (extname(path).toLowerCase() === ".json") {
    throw new Error("Batch analyze --out must point to a directory, not a .json file");
  }

  const targetDirectory = resolve(path);
  const total = batch.jobs.length + batch.failures.length;
  const usedFileNames = new Map<string, number>();
  io.writeStderr(`Analyzing ${total} jobs...\n`);
  let succeeded = 0;
  let failed = batch.failures.length;

  for (const job of batch.jobs) {
    const fileName = nextBatchFileName(job.source.value, usedFileNames);
    try {
      for (const warning of await artifactPrivacyWarnings(resolve(targetDirectory, fileName))) io.writeStderr(`Privacy warning: ${warning}\n`);
      await writeArtifact(resolve(targetDirectory, fileName), serializeJson(job));
      succeeded += 1;
      io.writeStderr(`✓ ${basename(job.source.value, extname(job.source.value))}\n`);
    } catch (error) {
      failed += 1;
      io.writeStderr(`✗ ${fileName} - ${error instanceof Error ? error.message : "Unable to write output"}\n`);
    }
  }

  for (const failure of batch.failures) {
    io.writeStderr(`✗ ${basename(failure.path, extname(failure.path))} - ${failure.message}\n`);
  }

  io.writeStderr(`${succeeded} succeeded\n`);
  if (failed > 0) io.writeStderr(`${failed} failed\n`);

  return failed > 0 || succeeded === 0 ? 1 : 0;
}

function expectedOutputHash(options: string[], output: string | undefined): string | null {
  const hash = optionValue(options, "--expected-hash");
  if (hash === undefined) return null;
  if (!output || !/^sha256:[a-f0-9]{64}$/.test(hash)) throw new Error("--expected-hash requires --out and a sha256:<64 lowercase hex digits> token");
  return hash;
}

function isBatchResolution(value: unknown): value is JobBatchResolution {
  return typeof value === "object" && value !== null && "jobs" in value && "failures" in value;
}

function serializeJson(value: unknown) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function nextBatchFileName(path: string, usedFileNames: Map<string, number>) {
  const stem = basename(path, extname(path));
  const nextIndex = (usedFileNames.get(stem) ?? 0) + 1;
  usedFileNames.set(stem, nextIndex);
  return nextIndex === 1 ? `${stem}.json` : `${stem}-${nextIndex}.json`;
}

function optionValue(options: string[], name: string): string | undefined {
  const index = options.indexOf(name);
  if (index === -1) return undefined;
  const value = options[index + 1];
  if (!value || value.startsWith("--")) throw new Error(`${name} needs a file path`);
  return value;
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks).toString("utf8");
}
