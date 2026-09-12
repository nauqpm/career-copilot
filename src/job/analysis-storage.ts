import { readdir } from "node:fs/promises";
import { join, resolve } from "node:path";

import { parseJobCapture, captureRawSource, type JobCapture } from "./capture.js";
import { parseJobAnalysisRevision, type JobAnalysisRevision } from "./analysis-revisions.js";
import { assertSafePath, readArtifact, writeArtifact } from "../workspace/artifacts.js";

export type AnalysisCurrentPointer = {
  schemaVersion: 1;
  revisionId: string;
  revisionHash: string;
};

export type AnalysisSnapshot = {
  revision: JobAnalysisRevision;
  revisionHash: string;
  pointerHash: string;
};

export type AnalysisHistory = {
  current?: { revisionId: string; revisionHash: string };
  revisions: Array<{
    id: string;
    createdAt: string;
    revisionHash: string;
    active: boolean;
  }>;
};

export type AnalysisContext = {
  jobId: string;
  capture: {
    id: string;
    manifestHash: string;
    sourceHash: string;
  };
  source: {
    content: string;
    hash: string;
  };
};

const safeIdPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const hashPattern = /^sha256:[a-f0-9]{64}$/;
const reservedRevisionId = "current";

class InvalidHistoryRevisionError extends Error {
  constructor(cause: unknown) {
    super("Analysis history revision is malformed or source-mismatched", { cause });
    this.name = "InvalidHistoryRevisionError";
  }
}

export async function readCurrentAnalysis(root: string, jobId: string): Promise<AnalysisSnapshot | undefined> {
  const capture = await readVerifiedCapture(root, jobId);
  const pointerArtifact = await readArtifact(currentPath(capture.directory));
  if (pointerArtifact === undefined) return undefined;

  const pointer = parsePointer(readJson(pointerArtifact.content, "Analysis current pointer"));
  const revisionArtifact = await readArtifact(revisionPath(capture.directory, pointer.revisionId));
  if (revisionArtifact === undefined || revisionArtifact.hash !== pointer.revisionHash) {
    throw new Error("Analysis current pointer references a missing or changed revision");
  }

  const revision = parseRevision(readJson(revisionArtifact.content, "Analysis revision"), capture, jobId);
  if (revision.id !== pointer.revisionId) throw new Error("Analysis current pointer revision ID does not match the revision");
  return { revision, revisionHash: revisionArtifact.hash, pointerHash: pointerArtifact.hash };
}

export async function readAnalysisHistory(root: string, jobId: string): Promise<AnalysisHistory> {
  const capture = await readVerifiedCapture(root, jobId);
  const pointerArtifact = await readArtifact(currentPath(capture.directory));
  let current: AnalysisCurrentPointer | undefined;
  if (pointerArtifact !== undefined) {
    try {
      current = parsePointer(readJson(pointerArtifact.content, "Analysis current pointer"));
    } catch {
      current = undefined;
    }
  }

  await assertSafePath(analysesDirectory(capture.directory));
  let entries: string[] = [];
  try {
    entries = (await readdir(analysesDirectory(capture.directory), { withFileTypes: true }))
      .filter((entry) => entry.name.endsWith(".json") && entry.name !== "current.json")
      .map((entry) => entry.name);
  } catch (error) {
    if (!isCode(error, "ENOENT")) throw error;
  }

  const revisions: AnalysisHistory["revisions"] = [];
  for (const entry of entries) {
    const artifact = await readArtifact(join(analysesDirectory(capture.directory), entry));
    if (artifact === undefined) continue;
    try {
      const revision = parseHistoryRevision(artifact.content, capture, jobId);
      const filenameStem = entry.slice(0, -".json".length);
      if (filenameStem !== revision.id) continue;
      revisions.push({
        id: revision.id,
        createdAt: revision.createdAt,
        revisionHash: artifact.hash,
        active: current?.revisionId === revision.id && current.revisionHash === artifact.hash,
      });
    } catch (error) {
      if (!(error instanceof InvalidHistoryRevisionError)) throw error;
      // Malformed and source-mismatched orphan files remain available for repair, but
      // cannot be presented as part of validated history.
    }
  }

  revisions.sort((left, right) => left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id));
  return {
    ...(current === undefined ? {} : { current: { revisionId: current.revisionId, revisionHash: current.revisionHash } }),
    revisions,
  };
}

export async function publishAnalysisRevision(
  root: string,
  jobId: string,
  draft: unknown,
  expectedPointerHash: string | null,
): Promise<AnalysisSnapshot> {
  if (expectedPointerHash !== null && !hashPattern.test(expectedPointerHash)) {
    throw new Error("Analysis pointer hash is invalid");
  }

  const capture = await readVerifiedCapture(root, jobId);
  const revision = parseRevision(draft, capture, jobId);
  if (revision.id === reservedRevisionId) throw new Error("Analysis revision ID 'current' is reserved");
  const serialized = `${JSON.stringify(revision, null, 2)}\n`;
  const revisionHash = await writeArtifact(revisionPath(capture.directory, revision.id), serialized, null);
  const pointer: AnalysisCurrentPointer = { schemaVersion: 1, revisionId: revision.id, revisionHash };
  const pointerHash = await writeArtifact(currentPath(capture.directory), `${JSON.stringify(pointer, null, 2)}\n`, expectedPointerHash);
  return { revision, revisionHash, pointerHash };
}

export async function readAnalysisContext(root: string, jobId: string): Promise<AnalysisContext> {
  const capture = await readVerifiedCapture(root, jobId);
  return {
    jobId,
    capture: {
      id: capture.capture.id,
      manifestHash: capture.manifest.hash,
      sourceHash: capture.source.hash,
    },
    source: { content: capture.source.content, hash: capture.source.hash },
  };
}

type VerifiedCapture = {
  directory: string;
  source: { content: string; hash: string };
  manifest: { content: string; hash: string };
  capture: JobCapture;
};

async function readVerifiedCapture(root: string, jobId: string): Promise<VerifiedCapture> {
  if (!safeIdPattern.test(jobId)) throw new Error("job id is invalid");
  const directory = jobDirectory(root, jobId);
  await assertSafePath(directory);

  const source = await readArtifact(join(directory, "source.md"));
  const manifest = await readArtifact(join(directory, "source.json"));
  const raw = await readArtifact(join(directory, "raw.json"));
  if (source === undefined) throw new Error("Job source.md is missing; source capture needs repair");
  if (manifest === undefined) throw new Error("Job source manifest is missing; legacy jobs cannot publish source-bound analyses");
  if (raw === undefined) throw new Error("Job raw.json is missing; source capture needs repair");

  let capture: JobCapture;
  try {
    capture = parseJobCapture(JSON.parse(manifest.content) as unknown);
  } catch {
    throw new Error("Job source manifest is invalid; source capture needs repair");
  }

  if (capture.id !== jobId) throw new Error("Job source manifest ID does not match the selected job");
  if (capture.rawContentHash !== source.hash) throw new Error("Job source bytes do not match the source manifest");

  let parsedRaw: unknown;
  try {
    parsedRaw = JSON.parse(raw.content) as unknown;
  } catch {
    throw new Error("Job raw.json is invalid; source capture needs repair");
  }
  if (!isRecord(parsedRaw) || typeof parsedRaw.content !== "string" || !isRecord(parsedRaw.source) || !isRecord(parsedRaw.capture)) {
    throw new Error("Job raw.json capture binding is invalid");
  }
  if (
    parsedRaw.content !== source.content.trim()
    || parsedRaw.capture.id !== jobId
    || parsedRaw.capture.manifestHash !== manifest.hash
  ) {
    throw new Error("Job raw.json does not match the source capture");
  }

  const expectedSource = captureRawSource(capture);
  if (parsedRaw.source.type !== expectedSource.type || parsedRaw.source.value !== expectedSource.value) {
    throw new Error("Job raw.json source metadata does not match the source manifest");
  }
  return { directory, source, manifest, capture };
}

function parseRevision(value: unknown, capture: VerifiedCapture, jobId: string): JobAnalysisRevision {
  const revision = parseJobAnalysisRevision(value, capture.source.content);
  if (revision.jobId !== jobId || revision.capture.id !== jobId) {
    throw new Error("Analysis revision job binding does not match the selected job");
  }
  if (revision.capture.manifestHash !== capture.manifest.hash) {
    throw new Error("Analysis revision manifest hash does not match source.json");
  }
  if (revision.capture.sourceHash !== capture.source.hash) {
    throw new Error("Analysis revision source hash does not match source.md");
  }
  return revision;
}

function parseHistoryRevision(content: string, capture: VerifiedCapture, jobId: string): JobAnalysisRevision {
  try {
    return parseRevision(readJson(content, "Analysis revision"), capture, jobId);
  } catch (error) {
    throw new InvalidHistoryRevisionError(error);
  }
}

function parsePointer(value: unknown): AnalysisCurrentPointer {
  if (!isRecord(value) || value.schemaVersion !== 1 || typeof value.revisionId !== "string" || !safeIdPattern.test(value.revisionId) || value.revisionId === reservedRevisionId || typeof value.revisionHash !== "string" || !hashPattern.test(value.revisionHash)) {
    throw new Error("Analysis current pointer is invalid");
  }
  return { schemaVersion: 1, revisionId: value.revisionId, revisionHash: value.revisionHash };
}

function readJson(content: string, label: string): unknown {
  try {
    return JSON.parse(content) as unknown;
  } catch {
    throw new Error(`${label} is invalid`);
  }
}

function jobDirectory(root: string, jobId: string): string {
  return resolve(root, "data", "jobs", jobId);
}

function analysesDirectory(directory: string): string {
  return join(directory, "analyses");
}

function currentPath(directory: string): string {
  return join(analysesDirectory(directory), "current.json");
}

function revisionPath(directory: string, revisionId: string): string {
  return join(analysesDirectory(directory), `${revisionId}.json`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isCode(error: unknown, code: string): error is NodeJS.ErrnoException {
  return typeof error === "object" && error !== null && "code" in error && error.code === code;
}
