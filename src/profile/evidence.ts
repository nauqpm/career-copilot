import { createHash } from "node:crypto";

export type EvidenceClaimType =
  | "identity" | "experience" | "technical-capability" | "project"
  | "education" | "certification" | "language" | "preference" | "other";
export type EvidenceSourceKind =
  | "profile-source" | "cv" | "portfolio" | "github-export" | "certificate"
  | "manual-answer" | "manual-note" | "candidate-note" | "public-link" | "local-file" | "source-document" | "other";
export type EvidenceVerification = "candidate-confirmed" | "source-excerpt" | "public-link" | "document-excerpt" | "unverified";
export type EvidenceCreator = { kind: "candidate" | "agent"; role?: string; skillVersion?: string };
export type EvidenceItem = {
  schemaVersion: 1; id: string; createdAt: string; createdBy: EvidenceCreator; contentHash: string;
  claim: string; claimType: EvidenceClaimType;
  source: { kind: EvidenceSourceKind; artifactId: string; locator: string };
  quote: string; verification: EvidenceVerification; limitations?: string[]; language?: string;
};
export type EvidenceDraft = Omit<EvidenceItem, "schemaVersion" | "id" | "createdAt" | "contentHash"> &
  Partial<Pick<EvidenceItem, "id" | "createdAt">>;

const claimTypes = new Set<EvidenceClaimType>(["identity", "experience", "technical-capability", "project", "education", "certification", "language", "preference", "other"]);
const sourceKinds = new Set<EvidenceSourceKind>(["profile-source", "cv", "portfolio", "github-export", "certificate", "manual-answer", "manual-note", "candidate-note", "public-link", "local-file", "source-document", "other"]);
const verifications = new Set<EvidenceVerification>(["candidate-confirmed", "source-excerpt", "public-link", "document-excerpt", "unverified"]);

export function parseEvidenceItem(value: unknown): EvidenceItem {
  const item = normalizeEvidenceItem(value);
  if (!/^sha256:[0-9a-f]{64}$/.test(item.contentHash)) throw new Error("contentHash is invalid");
  if (hashWithoutContent(item) !== item.contentHash) throw new Error("contentHash does not match evidence");
  return item;
}

function normalizeEvidenceItem(value: unknown): EvidenceItem {
  if (!record(value)) throw new Error("Evidence item must be a JSON object");
  if (value.schemaVersion !== 1) throw new Error("schemaVersion must be 1");
  required(value.id, "id"); required(value.createdAt, "createdAt"); required(value.claim, "claim"); required(value.quote, "quote"); required(value.contentHash, "contentHash");
  if (!isUtcTimestamp(value.createdAt)) throw new Error("createdAt must be an RFC3339 UTC timestamp");
  if (!claimTypes.has(value.claimType as EvidenceClaimType)) throw new Error("claimType is invalid");
  if (!verifications.has(value.verification as EvidenceVerification)) throw new Error("verification is invalid");
  if (!record(value.createdBy) || (value.createdBy.kind !== "candidate" && value.createdBy.kind !== "agent")) throw new Error("createdBy is invalid");
  const createdBy = { kind: value.createdBy.kind as EvidenceCreator["kind"], ...textOptional(value.createdBy, ["role", "skillVersion"]) };
  if (!record(value.source)) throw new Error("source is invalid");
  if (!sourceKinds.has(value.source.kind as EvidenceSourceKind)) throw new Error("source.kind is invalid");
  required(value.source.artifactId, "source.artifactId"); required(value.source.locator, "source.locator");
  const item = { schemaVersion: 1 as const, id: value.id.trim(), createdAt: value.createdAt.trim(), createdBy, contentHash: value.contentHash.trim(), claim: value.claim.trim(), claimType: value.claimType as EvidenceClaimType,
    source: { kind: value.source.kind as EvidenceSourceKind, artifactId: value.source.artifactId.trim(), locator: value.source.locator.trim() }, quote: value.quote.trim(), verification: value.verification as EvidenceVerification,
    ...optionalList(value.limitations, "limitations"), ...textOptional(value, ["language"]) };
  return item;
}

export function parseEvidenceDraft(value: unknown): EvidenceDraft {
  if (!record(value)) throw new Error("Evidence draft must be a JSON object");
  // Drafts share stored-item validation and normalization, but have no hash to verify.
  const envelope = normalizeEvidenceItem({ schemaVersion: 1, id: "draft", createdAt: "1970-01-01T00:00:00.000Z", ...value, contentHash: "draft" });
  const { schemaVersion: _schemaVersion, id, createdAt, contentHash: _contentHash, ...draft } = envelope;
  return { ...draft, ...(value.id === undefined ? {} : { id }), ...(value.createdAt === undefined ? {} : { createdAt }) };
}

function hashWithoutContent(value: Record<string, unknown>): string { const { contentHash: _ignored, ...rest } = value; return `sha256:${createHash("sha256").update(JSON.stringify(rest)).digest("hex")}`; }
function isUtcTimestamp(value: unknown): value is string { return typeof value === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/.test(value) && Number.isFinite(Date.parse(value)); }
function required(value: unknown, field: string): asserts value is string { if (typeof value !== "string" || !value.trim()) throw new Error(`${field} must be a non-empty string`); }
function record(value: unknown): value is Record<string, any> { return typeof value === "object" && value !== null && !Array.isArray(value); }
function textOptional(value: Record<string, any>, fields: string[]): Record<string, string> { return Object.fromEntries(fields.flatMap((field) => value[field] === undefined ? [] : (required(value[field], field), [[field, value[field].trim()]]))); }
function optionalList(value: unknown, field: string): Record<string, string[]> { return value === undefined ? {} : { [field]: Array.isArray(value) && value.every((entry) => typeof entry === "string" && entry.trim()) ? value.map((entry) => entry.trim()) : (() => { throw new Error(`${field} must contain non-empty strings`); })() }; }
