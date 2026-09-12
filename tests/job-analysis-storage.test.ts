import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rename, symlink, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { ConflictError, contentHash, readArtifact, writeArtifact } from "../src/workspace/artifacts.js";
import { createLocalJob } from "../src/workspace/storage.js";
import { runCli, type CliIo } from "../src/cli.js";
import {
  publishAnalysisRevision,
  readAnalysisHistory,
  readCurrentAnalysis,
  type AnalysisContext,
} from "../src/job/analysis-storage.js";

const source = [
  "Backend Engineer / Kỹ sư Backend",
  "Requirements / Yêu cầu:",
  "- At least 3 years of Node.js experience.",
  "- English communication is preferred.",
].join("\r\n");

function hash(value: string | Buffer): string {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function locator(quote: string) {
  const start = source.indexOf(quote);
  assert.notEqual(start, -1, `fixture quote is missing: ${quote}`);
  return { start, end: start + quote.length, quote };
}

function makeDraft(input: {
  jobId: string;
  manifestHash: string;
  sourceHash: string;
  id: string;
  title?: string;
  createdAt?: string;
}) {
  const base = {
    schemaVersion: 1 as const,
    id: input.id,
    createdAt: input.createdAt ?? "2026-09-12T06:00:00.000Z",
    createdBy: {
      kind: "agent" as const,
      role: "job-analyst" as const,
      skillVersion: "analyze-job@1",
      model: "local-test-model",
      promptHash: hash("analyze-job-prompt-v1"),
    },
    contentHash: "",
    jobId: input.jobId,
    capture: { id: input.jobId, manifestHash: input.manifestHash, sourceHash: input.sourceHash },
    analysis: {
      ...(input.title === undefined ? {} : { title: input.title }),
      requirements: [
        {
          category: "experience" as const,
          statement: "At least 3 years of Node.js experience.",
          priority: "required" as const,
          minimumYears: 3,
          id: "req-years",
          source: locator("At least 3 years of Node.js experience."),
        },
        {
          category: "language" as const,
          statement: "English communication is preferred.",
          priority: "preferred" as const,
          id: "req-english",
          source: locator("English communication is preferred."),
        },
      ],
      responsibilities: ["Build backend services."],
      compensation: { salaryStatus: "not-stated" as const },
    },
  };
  const { contentHash: _ignored, ...withoutHash } = base;
  return { ...base, contentHash: hash(JSON.stringify(withoutHash)) };
}

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "career-analysis-storage-"));
  const job = await createLocalJob(root, { content: source, sourceKind: "pasted-text", sourceReference: "Synthetic fixture" });
  const directory = join(root, "data", "jobs", job.id);
  const sourceArtifact = (await readArtifact(join(directory, "source.md")))!;
  const manifestArtifact = (await readArtifact(join(directory, "source.json")))!;
  return {
    root,
    job,
    directory,
    sourceArtifact,
    manifestArtifact,
    draft: (id: string, title?: string) => makeDraft({ jobId: job.id, manifestHash: manifestArtifact.hash, sourceHash: sourceArtifact.hash, id, title }),
  };
}

test("publishes a verified capture as a create-only current analysis", async () => {
  const state = await fixture();
  const draft = state.draft("analysis-one", "Backend Engineer");
  const snapshot = await publishAnalysisRevision(state.root, state.job.id, draft, null);

  assert.equal(snapshot.revision.id, "analysis-one");
  assert.equal(snapshot.revisionHash, (await readArtifact(join(state.directory, "analyses", "analysis-one.json")))!.hash);
  assert.match(snapshot.pointerHash, /^sha256:[a-f0-9]{64}$/);
  assert.equal((await readArtifact(join(state.directory, "analysis.json"))), undefined);
  assert.equal((await readCurrentAnalysis(state.root, state.job.id))?.revision.id, "analysis-one");
  assert.deepEqual(JSON.parse((await readArtifact(join(state.directory, "analyses", "analysis-one.json")))!.content), draft);
});

test("rejects the reserved current revision ID before writing any analysis artifact", async () => {
  const state = await fixture();
  await assert.rejects(
    publishAnalysisRevision(state.root, state.job.id, state.draft("current"), null),
    /reserved|current/i,
  );
  assert.equal(await readArtifact(join(state.directory, "analyses", "current.json")), undefined);
});

test("compares the current pointer, preserves old bytes, and exposes history", async () => {
  const state = await fixture();
  const first = await publishAnalysisRevision(state.root, state.job.id, state.draft("analysis-one", "First title"), null);
  const oldBytes = await readFile(join(state.directory, "analyses", "analysis-one.json"), "utf8");

  const second = await publishAnalysisRevision(state.root, state.job.id, state.draft("analysis-two", "Second title"), first.pointerHash);
  assert.equal(await readFile(join(state.directory, "analyses", "analysis-one.json"), "utf8"), oldBytes);
  assert.equal((await readCurrentAnalysis(state.root, state.job.id))?.revision.id, "analysis-two");
  assert.equal((await readCurrentAnalysis(state.root, state.job.id))?.pointerHash, second.pointerHash);

  const history = await readAnalysisHistory(state.root, state.job.id);
  assert.deepEqual(history.revisions.map((revision) => revision.id), ["analysis-one", "analysis-two"]);
  assert.equal(history.revisions.find((revision) => revision.id === "analysis-one")?.active, false);
  assert.equal(history.revisions.find((revision) => revision.id === "analysis-two")?.active, true);
  assert.equal(history.current?.revisionId, "analysis-two");
});

test("ignores a revision whose filename stem was renamed", async () => {
  const state = await fixture();
  await publishAnalysisRevision(state.root, state.job.id, state.draft("analysis-one"), null);
  await rename(
    join(state.directory, "analyses", "analysis-one.json"),
    join(state.directory, "analyses", "renamed.json"),
  );

  const history = await readAnalysisHistory(state.root, state.job.id);
  assert.deepEqual(history.revisions, []);
});

test("rejects a stale pointer after leaving the valid revision orphaned", async () => {
  const state = await fixture();
  const first = await publishAnalysisRevision(state.root, state.job.id, state.draft("analysis-one"), null);
  const pointerBytes = await readFile(join(state.directory, "analyses", "current.json"), "utf8");

  await assert.rejects(
    publishAnalysisRevision(state.root, state.job.id, state.draft("analysis-stale"), contentHash("wrong-pointer")),
    ConflictError,
  );
  assert.equal(await readFile(join(state.directory, "analyses", "current.json"), "utf8"), pointerBytes);
  assert.equal((await readCurrentAnalysis(state.root, state.job.id))?.revision.id, first.revision.id);
  assert.equal((await readArtifact(join(state.directory, "analyses", "analysis-stale.json"))) !== undefined, true);
});

test("fails closed for corrupted and dangling current pointers", async () => {
  const state = await fixture();
  await publishAnalysisRevision(state.root, state.job.id, state.draft("analysis-one"), null);
  const pointerPath = join(state.directory, "analyses", "current.json");

  await writeFile(pointerPath, "{broken", "utf8");
  await assert.rejects(readCurrentAnalysis(state.root, state.job.id), /pointer/i);

  await writeFile(pointerPath, JSON.stringify({ schemaVersion: 1, revisionId: "analysis-missing", revisionHash: hash("missing") }) + "\n", "utf8");
  await assert.rejects(readCurrentAnalysis(state.root, state.job.id), /missing|changed|revision/i);
});

test("isolates malformed orphan analysis files from valid history", async () => {
  const state = await fixture();
  const first = await publishAnalysisRevision(state.root, state.job.id, state.draft("analysis-one"), null);
  await writeArtifact(join(state.directory, "analyses", "bad.json"), "{broken", null);
  await writeArtifact(join(state.directory, "analyses", "wrong.json"), JSON.stringify({ ...state.draft("analysis-wrong"), capture: { ...state.draft("analysis-wrong").capture, sourceHash: hash("different") } }) + "\n", null);

  const history = await readAnalysisHistory(state.root, state.job.id);
  assert.deepEqual(history.revisions.map((revision) => revision.id), [first.revision.id]);
});

test("propagates path-safety errors from JSON history entries", async () => {
  const state = await fixture();
  await publishAnalysisRevision(state.root, state.job.id, state.draft("analysis-one"), null);
  const target = join(state.root, "outside-analysis.json");
  await writeFile(target, "{broken", "utf8");
  await symlink(target, join(state.directory, "analyses", "linked.json"));

  await assert.rejects(readAnalysisHistory(state.root, state.job.id), /symbolic link|unsafe/i);
});

test("refuses legacy, missing-manifest, and changed-source jobs", async () => {
  const legacyRoot = await mkdtemp(join(tmpdir(), "career-analysis-legacy-"));
  const legacyDirectory = join(legacyRoot, "data", "jobs", "job-legacy");
  await writeArtifact(join(legacyDirectory, "source.md"), "Legacy role", null);
  await writeArtifact(join(legacyDirectory, "raw.json"), JSON.stringify({ content: "Legacy role", source: { type: "text", value: "legacy" } }) + "\n", null);
  await assert.rejects(
    publishAnalysisRevision(legacyRoot, "job-legacy", {}, null),
    /legacy|manifest|capture/i,
  );

  const missingManifest = await fixture();
  await unlink(join(missingManifest.directory, "source.json"));
  await assert.rejects(publishAnalysisRevision(missingManifest.root, missingManifest.job.id, missingManifest.draft("analysis-missing-manifest"), null), /manifest|capture/i);

  const changedSource = await fixture();
  await writeFile(join(changedSource.directory, "source.md"), `${source} changed`, "utf8");
  await assert.rejects(publishAnalysisRevision(changedSource.root, changedSource.job.id, changedSource.draft("analysis-changed-source"), null), /source|capture/i);
});

test("refuses a changed source manifest and a tampered raw capture binding", async () => {
  const changedManifest = await fixture();
  const manifestPath = join(changedManifest.directory, "source.json");
  const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as Record<string, unknown>;
  manifest.sourceReference = "Tampered source";
  const { contentHash: _ignored, ...withoutHash } = manifest;
  manifest.contentHash = hash(JSON.stringify(withoutHash));
  await writeFile(manifestPath, `${JSON.stringify(manifest)}\n`, "utf8");
  const changedManifestArtifact = (await readArtifact(manifestPath))!;
  const rawPath = join(changedManifest.directory, "raw.json");
  const raw = JSON.parse(await readFile(rawPath, "utf8")) as { source: { value: string }; capture: { manifestHash: string } };
  raw.source.value = "Tampered source";
  raw.capture.manifestHash = changedManifestArtifact.hash;
  await writeFile(rawPath, `${JSON.stringify(raw)}\n`, "utf8");
  await assert.rejects(
    publishAnalysisRevision(changedManifest.root, changedManifest.job.id, changedManifest.draft("analysis-changed-manifest"), null),
    /manifest hash|source\.json/i,
  );

  const tamperedRaw = await fixture();
  const tamperedRawPath = join(tamperedRaw.directory, "raw.json");
  const tampered = JSON.parse(await readFile(tamperedRawPath, "utf8")) as { capture: { manifestHash: string } };
  tampered.capture.manifestHash = hash("wrong-manifest");
  await writeFile(tamperedRawPath, `${JSON.stringify(tampered)}\n`, "utf8");
  await assert.rejects(
    publishAnalysisRevision(tamperedRaw.root, tamperedRaw.job.id, tamperedRaw.draft("analysis-tampered-raw"), null),
    /raw\.json|capture/i,
  );
});

test("CLI emits only source-bound context and publishes without model execution", async () => {
  const state = await fixture();
  const contextIo = captureIo();
  assert.equal(await runCli(["job", "analysis-context", state.job.id, "--root", state.root], contextIo), 0);
  const context = JSON.parse(contextIo.stdout()) as AnalysisContext;
  assert.deepEqual(Object.keys(context).sort(), ["capture", "jobId", "source"]);
  assert.equal(context.jobId, state.job.id);
  assert.equal(context.capture.manifestHash, state.manifestArtifact.hash);
  assert.equal(context.capture.sourceHash, state.sourceArtifact.hash);
  assert.equal(context.source.content, source);
  assert.equal(context.source.hash, state.sourceArtifact.hash);

  const draftPath = join(state.root, "analysis-draft.json");
  await writeFile(draftPath, `${JSON.stringify(state.draft("analysis-cli"))}\n`, "utf8");
  const publishIo = captureIo();
  assert.equal(await runCli(["job", "publish-analysis", state.job.id, draftPath, "--root", state.root, "--expected-hash", "missing"], publishIo), 0);
  assert.deepEqual(JSON.parse(publishIo.stdout()), {
    revisionId: "analysis-cli",
    revisionHash: (await readCurrentAnalysis(state.root, state.job.id))!.revisionHash,
  });
});

function captureIo(): CliIo & { stdout: () => string; stderr: () => string } {
  let out = "";
  let err = "";
  return {
    writeStdout: (value) => { out += value; },
    writeStderr: (value) => { err += value; },
    readStdin: async () => "",
    stdout: () => out,
    stderr: () => err,
  };
}
