import { contentHash } from "../workspace/artifacts.js";

export const maxCaptureBytes = 1024 * 1024;

export type JobCapture = {
  schemaVersion: 1;
  id: string;
  createdAt: string;
  createdBy: { kind: "candidate" };
  sourceKind: "pasted-text" | "local-file";
  sourceReference?: string;
  sourceFileName?: string;
  contentFile: "source.md";
  rawContentHash: string;
  normalisation: { normaliserVersion: 1; rawFile: "raw.json" };
  contentHash: string;
};

export type LocalJobInput = {
  content: string;
  sourceKind: JobCapture["sourceKind"];
  sourceReference?: string;
  sourceFileName?: string;
};

export function createJobCapture(id: string, input: LocalJobInput, createdAt = new Date().toISOString()): JobCapture {
  if (!/^[a-z0-9-]+$/.test(id)) throw new Error("job id is invalid");
  if (input.sourceKind !== "pasted-text" && input.sourceKind !== "local-file") throw new Error("source kind is invalid");
  if (typeof input.content !== "string" || !input.content.trim()) throw new Error("Job content must not be empty");
  if (Buffer.byteLength(input.content, "utf8") > maxCaptureBytes) throw new Error("Job content exceeds the 1 MiB limit");
  if (!Number.isFinite(Date.parse(createdAt))) throw new Error("capture timestamp is invalid");
  const sourceReference = optionalText(input.sourceReference);
  const sourceFileName = optionalFileName(input.sourceFileName);
  const capture = {
    schemaVersion: 1 as const,
    id,
    createdAt: new Date(createdAt).toISOString(),
    createdBy: { kind: "candidate" as const },
    sourceKind: input.sourceKind,
    ...(sourceReference === undefined ? {} : { sourceReference }),
    ...(sourceFileName === undefined ? {} : { sourceFileName }),
    contentFile: "source.md" as const,
    rawContentHash: contentHash(Buffer.from(input.content, "utf8")),
    normalisation: { normaliserVersion: 1 as const, rawFile: "raw.json" as const },
  };
  return { ...capture, contentHash: hashManifest(capture) };
}

export function captureRawSource(capture: JobCapture): { type: "text" | "file"; value: string } {
  if (capture.sourceKind === "local-file") {
    return { type: "file", value: capture.sourceReference ?? capture.sourceFileName ?? "Imported local file" };
  }
  return { type: "text", value: capture.sourceReference ?? "Pasted in Career Copilot" };
}

export function parseJobCapture(value: unknown): JobCapture {
  if (!isRecord(value) || value.schemaVersion !== 1 || !isSafeId(value.id) || typeof value.createdAt !== "string" || !Number.isFinite(Date.parse(value.createdAt))) {
    throw new Error("Job capture manifest is invalid");
  }
  if (!isRecord(value.createdBy) || value.createdBy.kind !== "candidate") throw new Error("Job capture manifest is invalid");
  if (value.sourceKind !== "pasted-text" && value.sourceKind !== "local-file") throw new Error("Job capture manifest is invalid");
  if (value.sourceReference !== undefined && !isNonEmptyString(value.sourceReference)) throw new Error("Job capture manifest is invalid");
  if (value.sourceFileName !== undefined && optionalFileName(value.sourceFileName) !== value.sourceFileName) throw new Error("Job capture manifest is invalid");
  if (value.contentFile !== "source.md" || !/^sha256:[a-f0-9]{64}$/.test(String(value.rawContentHash)) || !/^sha256:[a-f0-9]{64}$/.test(String(value.contentHash))) throw new Error("Job capture manifest is invalid");
  if (!isRecord(value.normalisation) || value.normalisation.normaliserVersion !== 1 || value.normalisation.rawFile !== "raw.json") throw new Error("Job capture manifest is invalid");
  const parsed = {
    schemaVersion: 1 as const,
    id: value.id,
    createdAt: new Date(value.createdAt).toISOString(),
    createdBy: { kind: "candidate" as const },
    sourceKind: value.sourceKind,
    ...(value.sourceReference === undefined ? {} : { sourceReference: value.sourceReference }),
    ...(value.sourceFileName === undefined ? {} : { sourceFileName: value.sourceFileName }),
    contentFile: "source.md" as const,
    rawContentHash: value.rawContentHash,
    normalisation: { normaliserVersion: 1 as const, rawFile: "raw.json" as const },
    contentHash: value.contentHash,
  } satisfies JobCapture;
  if (hashManifest({ ...parsed, contentHash: undefined }) !== parsed.contentHash) throw new Error("Job capture manifest hash is invalid");
  return parsed;
}

export function serializeJobCapture(capture: JobCapture): string {
  return `${JSON.stringify(capture, null, 2)}\n`;
}

function hashManifest(value: Omit<JobCapture, "contentHash"> & { contentHash?: undefined }): string {
  return contentHash(JSON.stringify(value));
}

function optionalText(value: unknown): string | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  if (!isNonEmptyString(value)) throw new Error("capture reference is invalid");
  return value.trim();
}

function optionalFileName(value: unknown): string | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  if (!isNonEmptyString(value) || /[\\/\0]/.test(value) || value === "." || value === "..") throw new Error("capture filename is invalid");
  return value.trim();
}

function isRecord(value: unknown): value is Record<string, any> { return typeof value === "object" && value !== null && !Array.isArray(value); }
function isSafeId(value: unknown): value is string { return typeof value === "string" && /^[a-z0-9-]+$/.test(value); }
function isNonEmptyString(value: unknown): value is string { return typeof value === "string" && value.trim().length > 0; }
