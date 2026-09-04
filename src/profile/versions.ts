import { createHash } from "node:crypto";
import { parseCandidateProfile, type CandidateProfile } from "./schema.js";
import { type EvidenceItem } from "./evidence.js";

export type ProfileRevision = { schemaVersion: 1; id: string; createdAt: string; createdBy: { kind: "candidate" }; contentHash: string; supersedes?: string; profile: CandidateProfile; claimEvidence: Array<{ claimPath: string; evidenceIds: string[]; status: "user-asserted" | "supported" | "needs-confirmation" }>; roleTracks?: string[] };
export type ProfileCurrentPointer = { schemaVersion: 1; revisionId: string; revisionHash: string };
const statuses = new Set(["user-asserted", "supported", "needs-confirmation"]);

export function profileClaimPaths(profile: CandidateProfile): string[] {
  const paths: string[] = [];
  const visit = (value: unknown, path: string) => { if (typeof value === "string" && value.trim()) paths.push(path); else if (Array.isArray(value)) value.forEach((entry, index) => visit(entry, `${path}[${index}]`)); else if (value && typeof value === "object") Object.entries(value).forEach(([key, entry]) => visit(entry, path ? `${path}.${key}` : key)); };
  visit(profile, ""); return paths;
}

export function parseProfileRevision(value: unknown): ProfileRevision {
  if (!record(value)) throw new Error("Profile revision must be a JSON object");
  if (value.schemaVersion !== 1) throw new Error("schemaVersion must be 1");
  for (const field of ["id", "createdAt", "contentHash"]) required(value[field], field);
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/.test(value.createdAt) || !Number.isFinite(Date.parse(value.createdAt))) throw new Error("createdAt must be an RFC3339 UTC timestamp");
  if (!record(value.createdBy) || value.createdBy.kind !== "candidate") throw new Error("createdBy is invalid");
  const profile = parseCandidateProfile(value.profile);
  if (!Array.isArray(value.claimEvidence)) throw new Error("claimEvidence must be an array");
  const claimEvidence = value.claimEvidence.map((entry: any, index: number) => {
    if (!record(entry)) throw new Error(`claimEvidence[${index}] is invalid`);
    if (!statuses.has(entry.status)) throw new Error(`claimEvidence[${index}].status is invalid`);
    if (typeof entry.claimPath !== "string" || !entry.claimPath.trim() || !Array.isArray(entry.evidenceIds) || entry.evidenceIds.length === 0 || !entry.evidenceIds.every((id: unknown) => typeof id === "string" && id.trim())) throw new Error(`claimEvidence[${index}] is invalid`);
    if (!profileClaimPaths(profile).includes(entry.claimPath.trim())) throw new Error(`claimEvidence[${index}].claimPath is invalid`);
    return { claimPath: entry.claimPath.trim(), evidenceIds: entry.evidenceIds.map((id: string) => id.trim()), status: entry.status };
  });
  const revision = { schemaVersion: 1 as const, id: value.id.trim(), createdAt: value.createdAt.trim(), createdBy: { kind: "candidate" as const }, contentHash: value.contentHash.trim(), ...optionalText(value.supersedes, "supersedes"), profile, claimEvidence, ...optionalRoleTracks(value.roleTracks) };
  if (!/^sha256:[0-9a-f]{64}$/.test(revision.contentHash)) throw new Error("contentHash is invalid");
  if (hashRevision(revision) !== revision.contentHash) throw new Error("contentHash does not match revision");
  return revision;
}
export function serializeProfileRevision(revision: ProfileRevision): string { return JSON.stringify(parseProfileRevision(revision)); }
function hashRevision(value: Record<string, unknown>): string { const { contentHash: _ignored, ...rest } = value; return `sha256:${createHash("sha256").update(JSON.stringify(rest)).digest("hex")}`; }
function record(value: unknown): value is Record<string, any> { return typeof value === "object" && value !== null && !Array.isArray(value); }
function required(value: unknown, field: string): asserts value is string { if (typeof value !== "string" || !value.trim()) throw new Error(`${field} must be a non-empty string`); }
function optionalText(value: unknown, field: string): Record<string, string> { if (value === undefined) return {}; required(value, field); return { [field]: value.trim() }; }
function optionalRoleTracks(value: unknown): Record<string, string[]> { if (value === undefined) return {}; if (!Array.isArray(value) || !value.every((entry) => typeof entry === "string" && entry.trim())) throw new Error("roleTracks must contain non-empty strings"); return { roleTracks: value.map((entry) => entry.trim()) }; }
