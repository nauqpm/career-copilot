import { contentHash } from "../workspace/artifacts.js";
import { parseJobAnalysis, type JobAnalysis, type JobRequirement, type RequirementPriority } from "./schema.js";

export type SourceLocator = { start: number; end: number; quote: string };

export type SourceBoundRequirement = JobRequirement & {
  id: string;
  source: SourceLocator;
};

export type JobAnalysisRevision = {
  schemaVersion: 1;
  id: string;
  createdAt: string;
  createdBy: {
    kind: "agent";
    role: "job-analyst";
    skillVersion: string;
    model: string;
    promptHash: string;
  };
  contentHash: string;
  jobId: string;
  capture: {
    id: string;
    manifestHash: string;
    sourceHash: string;
  };
  analysis: Omit<JobAnalysis, "requirements"> & {
    requirements: SourceBoundRequirement[];
  };
};

/**
 * Parse and verify an immutable analysis against the exact source.md text.
 * Locators deliberately use JavaScript string offsets; no byte-offset lookup
 * or fuzzy quote matching is performed here.
 */
export function parseJobAnalysisRevision(value: unknown, source: string): JobAnalysisRevision {
  if (typeof source !== "string") throw new Error("source must be a string");
  if (!isRecord(value)) throw new Error("Job analysis revision must be a JSON object");
  rejectScore(value);

  if (value.schemaVersion !== 1) throw new Error("schemaVersion must be 1");
  const id = safeId(value.id, "id");
  const createdAt = utcTimestamp(value.createdAt, "createdAt");
  const createdBy = parseCreator(value.createdBy);
  const contentHashValue = sha256(value.contentHash, "contentHash");
  const jobId = safeId(value.jobId, "jobId");
  const capture = parseCapture(value.capture);
  if (capture.id !== jobId) throw new Error("capture.id must match jobId");

  const expectedSourceHash = contentHash(Buffer.from(source, "utf8"));
  if (capture.sourceHash !== expectedSourceHash) throw new Error("capture.sourceHash does not match source");

  if (!isRecord(value.analysis)) throw new Error("analysis must be an object");
  const rawRequirements = value.analysis.requirements;
  if (!Array.isArray(rawRequirements)) throw new Error("analysis.requirements must be an array");

  const semanticRequirements = rawRequirements.map((requirement, index) => {
    if (!isRecord(requirement)) throw new Error(`analysis.requirements[${index}] must be an object`);
    if (!Object.prototype.hasOwnProperty.call(requirement, "id")) {
      throw new Error(`analysis.requirements[${index}].id must be a safe identifier`);
    }
    if (!Object.prototype.hasOwnProperty.call(requirement, "source")) {
      throw new Error(`analysis.requirements[${index}].source locator is required`);
    }
    const { id: _id, source: _source, ...semantic } = requirement;
    return semantic;
  });

  const parsedAnalysis = parseJobAnalysis({ ...value.analysis, requirements: semanticRequirements });
  const requirementIds = new Set<string>();
  const requirements = rawRequirements.map((requirement, index) => {
    if (!isRecord(requirement)) throw new Error(`analysis.requirements[${index}] must be an object`);
    const requirementId = safeId(requirement.id, `analysis.requirements[${index}].id`);
    if (requirementIds.has(requirementId)) throw new Error(`duplicate requirement id: ${requirementId}`);
    requirementIds.add(requirementId);

    const locator = parseSourceLocator(requirement.source, source, `analysis.requirements[${index}].source`);
    return { ...parsedAnalysis.requirements[index]!, id: requirementId, source: locator };
  });

  const revision: JobAnalysisRevision = {
    schemaVersion: 1,
    id,
    createdAt,
    createdBy,
    contentHash: contentHashValue,
    jobId,
    capture,
    analysis: { ...parsedAnalysis, requirements },
  };

  if (hashWithoutContent(revision) !== contentHashValue) {
    throw new Error("contentHash does not match revision");
  }
  return revision;
}

/** Serialize a parsed revision without adding metadata or changing source locators. */
export function serializeJobAnalysisRevision(revision: JobAnalysisRevision): string {
  return JSON.stringify(revision);
}

/** Return the revision hash for a validated envelope without its contentHash field. */
export function hashJobAnalysisRevision(revision: Omit<JobAnalysisRevision, "contentHash">): string {
  return contentHash(JSON.stringify(revision));
}

function parseCreator(value: unknown): JobAnalysisRevision["createdBy"] {
  if (!isRecord(value) || value.kind !== "agent" || value.role !== "job-analyst") {
    throw new Error("createdBy must identify the job-analyst agent");
  }
  const skillVersion = nonEmptyText(value.skillVersion, "createdBy.skillVersion");
  const model = nonEmptyText(value.model, "createdBy.model");
  const promptHash = sha256(value.promptHash, "createdBy.promptHash");
  return { kind: "agent", role: "job-analyst", skillVersion, model, promptHash };
}

function parseCapture(value: unknown): JobAnalysisRevision["capture"] {
  if (!isRecord(value)) throw new Error("capture must be an object");
  return {
    id: safeId(value.id, "capture.id"),
    manifestHash: sha256(value.manifestHash, "capture.manifestHash"),
    sourceHash: sha256(value.sourceHash, "capture.sourceHash"),
  };
}

function parseSourceLocator(value: unknown, source: string, field: string): SourceLocator {
  if (!isRecord(value)) throw new Error(`${field} locator is invalid`);
  const start = value.start;
  const end = value.end;
  const quote = value.quote;
  if (typeof start !== "number" || typeof end !== "number" || !Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end <= start || end > source.length) {
    throw new Error(`${field} locator is out of range`);
  }
  if (typeof quote !== "string" || !quote.trim() || source.slice(start, end) !== quote) {
    throw new Error(`${field} locator quote does not match source`);
  }
  return { start, end, quote };
}

function hashWithoutContent(value: JobAnalysisRevision): string {
  const { contentHash: _ignored, ...withoutContentHash } = value;
  return contentHash(JSON.stringify(withoutContentHash));
}

function safeId(value: unknown, field: string): string {
  if (typeof value !== "string" || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value.trim())) {
    throw new Error(`${field} must be a safe identifier`);
  }
  return value.trim();
}

function sha256(value: unknown, field: string): string {
  if (typeof value !== "string" || !/^sha256:[a-f0-9]{64}$/.test(value.trim())) {
    throw new Error(`${field} must be a lowercase SHA-256 value`);
  }
  return value.trim();
}

function utcTimestamp(value: unknown, field: string): string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/.test(value.trim()) || !Number.isFinite(Date.parse(value))) {
    throw new Error(`${field} must be an RFC3339 UTC timestamp`);
  }
  return value.trim();
}

function nonEmptyText(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${field} must be a non-empty string`);
  return value.trim();
}

function rejectScore(value: unknown, seen = new Set<object>()): void {
  if (Array.isArray(value)) {
    for (const entry of value) rejectScore(entry, seen);
    return;
  }
  if (!isRecord(value) || seen.has(value)) return;
  seen.add(value);
  for (const [key, entry] of Object.entries(value)) {
    if (key === "score") throw new Error("score is not permitted in a source-bound analysis");
    rejectScore(entry, seen);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export type { RequirementPriority };
