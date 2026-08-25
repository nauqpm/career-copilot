#!/usr/bin/env node

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, dirname, extname, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { type JobBatchResolution, resolveJobInput, resolveJobInputsInDirectory } from "./job/resolve-input.js";
import { parseJobAnalysis } from "./job/schema.js";
import { parseCandidateProfile } from "./profile/schema.js";
import { parseJobDecision } from "./decision/schema.js";

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
  "  career job validate-analysis <analysis.json> [--out path]",
  "  career profile validate <profile.json> [--out path]",
  "  career decision validate <decision.json> [--out path]",
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
      if (command === "analyze" || command === "prepare") return await analyze(input, options, io);
      if (command === "validate-analysis") return await validateAnalysis(input, options, io);
    }
    if (group === "profile" && command === "validate") return await validateProfile(input, options, io);
    if (group === "decision" && command === "validate") return await validateDecision(input, options, io);

    io.writeStderr(`${usage}\n`);
    return 1;
  } catch (error) {
    io.writeStderr(`${error instanceof Error ? error.message : "Unexpected error"}\n`);
    return 1;
  }
}

async function analyze(argument: string | undefined, options: string[], io: CliIo) {
  const output = optionValue(options, "--out");
  const resolvedInput = await resolveArgument(argument, options, io);

  if (isBatchResolution(resolvedInput)) {
    if (output) return outputBatchJson(resolvedInput, output, io);
    await outputJson(resolvedInput, undefined, io);
    return resolvedInput.jobs.length === 0 ? 1 : 0;
  }

  await outputJson(resolvedInput, output, io);
  return 0;
}

async function validateAnalysis(path: string | undefined, options: string[], io: CliIo) {
  if (!path) throw new Error("Analysis JSON path is required");
  const output = optionValue(options, "--out");
  const parsed = parseJobAnalysis(JSON.parse(await readFile(resolve(path), "utf8")) as unknown);
  await outputJson(parsed, output, io);
  return 0;
}

async function validateProfile(path: string | undefined, options: string[], io: CliIo) {
  if (!path) throw new Error("Profile JSON path is required");
  const output = optionValue(options, "--out");
  const parsed = parseCandidateProfile(JSON.parse(await readFile(resolve(path), "utf8")) as unknown);
  await outputJson(parsed, output, io);
  return 0;
}

async function validateDecision(path: string | undefined, options: string[], io: CliIo) {
  if (!path) throw new Error("Decision JSON path is required");
  const output = optionValue(options, "--out");
  const parsed = parseJobDecision(JSON.parse(await readFile(resolve(path), "utf8")) as unknown);
  await outputJson(parsed, output, io);
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

async function outputJson(value: unknown, path: string | undefined, io: CliIo) {
  const json = serializeJson(value);
  if (!path) {
    io.writeStdout(json);
    return;
  }

  const target = resolve(path);
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, json, "utf8");
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
  await mkdir(targetDirectory, { recursive: true });

  for (const job of batch.jobs) {
    const fileName = nextBatchFileName(job.source.value, usedFileNames);
    await writeFile(resolve(targetDirectory, fileName), serializeJson(job), "utf8");
    io.writeStderr(`✓ ${basename(job.source.value, extname(job.source.value))}\n`);
  }

  for (const failure of batch.failures) {
    io.writeStderr(`✗ ${basename(failure.path, extname(failure.path))} - ${failure.message}\n`);
  }

  io.writeStderr(`${batch.jobs.length} succeeded\n`);
  if (batch.failures.length > 0) io.writeStderr(`${batch.failures.length} failed\n`);

  return batch.jobs.length === 0 ? 1 : 0;
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
