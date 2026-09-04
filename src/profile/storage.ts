import { randomUUID } from "node:crypto";
import { readdir } from "node:fs/promises";
import { join, resolve } from "node:path";

import { readArtifact, writeArtifact, contentHash, ConflictError } from "../workspace/artifacts.js";
import { type CandidateProfile, parseCandidateProfile } from "./schema.js";
import { parseEvidenceDraft, parseEvidenceItem, type EvidenceDraft, type EvidenceItem } from "./evidence.js";
import { parseProfileRevision, profileClaimPaths, type ProfileCurrentPointer, type ProfileRevision } from "./versions.js";

export type ProfileSnapshot = { profile?: CandidateProfile; hash: string | null; revision?: ProfileRevision; pointerHash?: string; legacy: boolean };

export async function readCandidateProfile(root: string): Promise<CandidateProfile | undefined> {
  const snapshot = await readProfileSnapshot(root);
  return snapshot.profile;
}

export async function readProfileSnapshot(root: string): Promise<ProfileSnapshot> {
  const pointerArtifact = await readArtifact(currentPath(root));
  if (pointerArtifact) {
    const pointer = parsePointer(JSON.parse(pointerArtifact.content) as unknown);
    const revisionArtifact = await readArtifact(revisionPath(root, pointer.revisionId));
    if (!revisionArtifact || revisionArtifact.hash !== pointer.revisionHash) throw new Error("Profile current pointer references a missing or changed revision");
    const revision = parseProfileRevision(JSON.parse(revisionArtifact.content) as unknown);
    return { profile: revision.profile, hash: revisionArtifact.hash, revision, pointerHash: pointerArtifact.hash, legacy: false };
  }
  const artifact = await readArtifact(candidateProfilePath(root));
  return artifact ? { profile: parseCandidateProfile(JSON.parse(artifact.content) as unknown), hash: artifact.hash, legacy: true } : { hash: null, legacy: true };
}

export async function readProfileHistory(root: string): Promise<{ current?: { revisionId: string; revisionHash: string }; revisions: Array<{ id: string; createdAt: string; supersedes?: string; revisionHash: string; evidenceCount: number; unresolvedCount: number; active: boolean }> }> {
  const pointerArtifact = await readArtifact(currentPath(root));
  let current: ProfileCurrentPointer | undefined;
  if (pointerArtifact) {
    try { current = parsePointer(JSON.parse(pointerArtifact.content) as unknown); } catch { current = undefined; }
  }
  const revisions: Array<{ id: string; createdAt: string; supersedes?: string; revisionHash: string; evidenceCount: number; unresolvedCount: number; active: boolean }> = [];
  let entries: string[] = [];
  try { entries = await readdir(revisionsDirectory(root)); } catch (error) { if (!isCode(error, "ENOENT")) throw error; }
  for (const entry of entries.filter((name) => name.endsWith(".json"))) {
    try {
      const artifact = await readArtifact(join(revisionsDirectory(root), entry));
      if (!artifact) continue;
      const revision = parseProfileRevision(JSON.parse(artifact.content) as unknown);
      revisions.push({ id: revision.id, createdAt: revision.createdAt, ...(revision.supersedes ? { supersedes: revision.supersedes } : {}), revisionHash: artifact.hash, evidenceCount: revision.claimEvidence.reduce((total, claim) => total + claim.evidenceIds.length, 0), unresolvedCount: revision.claimEvidence.filter((claim) => claim.status === "needs-confirmation").length, active: current?.revisionId === revision.id && current.revisionHash === artifact.hash });
    } catch { /* malformed orphan is isolated from history */ }
  }
  revisions.sort((left, right) => left.createdAt.localeCompare(right.createdAt));
  return { ...(current ? { current: { revisionId: current.revisionId, revisionHash: current.revisionHash } } : {}), revisions };
}

export async function publishProfileRevision(root: string, profile: CandidateProfile, expectedHash: string | null, options: { confirmed: boolean; evidence?: EvidenceDraft[]; roleTracks?: string[] }): Promise<{ profile: CandidateProfile; revision: ProfileRevision; revisionHash: string; unresolvedCount: number }> {
  if (!options.confirmed) throw new Error("Profile publication requires candidate confirmation");
  const validated = parseCandidateProfile(profile);
  const snapshot = await readProfileSnapshot(root);
  if (snapshot.hash !== expectedHash) throw new ConflictError();
  const effectiveProfile = parseCandidateProfile({ ...validated, ...(options.roleTracks ? { roleTracks: options.roleTracks } : {}) });
  const claims = profileClaimPaths(effectiveProfile);
  const drafts = (options.evidence ?? []).map((draft) => parseEvidenceDraft(draft));
  const byPath = new Map<string, EvidenceDraft>();
  for (const draft of drafts) {
    const locator = draft.source.locator.trim();
    if (!claims.includes(locator)) throw new Error(`Evidence locator does not reference a profile claim: ${locator}`);
    if (byPath.has(locator)) throw new Error(`Duplicate evidence locator: ${locator}`);
    byPath.set(locator, draft);
  }
  const now = new Date().toISOString();
  const evidenceItems: EvidenceItem[] = claims.map((claimPath) => {
    const draft = byPath.get(claimPath);
    const value = getAtPath(effectiveProfile, claimPath);
    const base = draft
      ? normalizeDraftEvidence(draft, claimPath, value)
      : {
          createdBy: { kind: "candidate" as const },
          claim: value,
          claimType: inferClaimType(claimPath),
          source: { kind: "profile-source" as const, artifactId: "candidate-profile", locator: claimPath },
          quote: value,
          verification: "candidate-confirmed" as const,
        };
    return makeEvidence(base, now);
  });
  for (const item of evidenceItems) await writeArtifact(evidencePath(root, item.id), `${JSON.stringify(item, null, 2)}\n`, null);
  const revisionBase = { schemaVersion: 1 as const, id: randomUUID(), createdAt: now, createdBy: { kind: "candidate" as const }, contentHash: "", ...(snapshot.revision ? { supersedes: snapshot.revision.id } : {}), profile: effectiveProfile, claimEvidence: evidenceItems.map((item, index) => ({ claimPath: claims[index], evidenceIds: [item.id], status: evidenceStatus(item.verification) })), ...(effectiveProfile.roleTracks ? { roleTracks: effectiveProfile.roleTracks } : {}) };
  const revision = parseProfileRevision({ ...revisionBase, profile: effectiveProfile, contentHash: envelopeHash(revisionBase) });
  const revisionHash = await writeArtifact(revisionPath(root, revision.id), `${JSON.stringify(revision, null, 2)}\n`, null);
  if (!snapshot.revision && ((await readArtifact(candidateProfilePath(root)))?.hash ?? null) !== expectedHash) throw new ConflictError();
  const pointer: ProfileCurrentPointer = { schemaVersion: 1, revisionId: revision.id, revisionHash };
  await writeArtifact(currentPath(root), `${JSON.stringify(pointer, null, 2)}\n`, snapshot.pointerHash ?? null);
  return { profile: effectiveProfile, revision, revisionHash, unresolvedCount: revision.claimEvidence.filter((claim) => claim.status === "needs-confirmation").length };
}

export async function saveCandidateProfile(root: string, profile: CandidateProfile, expectedHash: string | null = null): Promise<void> {
  const validated = parseCandidateProfile(profile);
  await writeArtifact(candidateProfilePath(root), `${JSON.stringify(validated, null, 2)}\n`, expectedHash);
}

export async function saveProfileSource(root: string, source: string, expectedHash: string | null = null): Promise<void> {
  if (!source.trim()) throw new Error("Profile source must not be empty");
  await writeArtifact(profileSourcePath(root), source.endsWith("\n") ? source : `${source}\n`, expectedHash);
}

function makeEvidence(draft: EvidenceDraft, now: string): EvidenceItem {
  if (draft.id !== undefined && !isSafeId(draft.id)) throw new Error("Evidence id is invalid");
  const base = { schemaVersion: 1 as const, id: draft.id?.trim() || randomUUID(), createdAt: draft.createdAt?.trim() || now, createdBy: draft.createdBy, contentHash: "", claim: draft.claim, claimType: draft.claimType, source: draft.source, quote: draft.quote, verification: draft.verification, ...(draft.limitations ? { limitations: draft.limitations } : {}), ...(draft.language ? { language: draft.language } : {}) };
  return parseEvidenceItem({ ...base, contentHash: envelopeHash(base) });
}
function normalizeDraftEvidence(draft: EvidenceDraft, claimPath: string, value: string): EvidenceDraft {
  return {
    ...draft,
    source: { ...draft.source, locator: claimPath },
    claim: draft.verification === "candidate-confirmed" ? value : draft.claim,
    quote: draft.verification === "candidate-confirmed" ? value : draft.quote.trim(),
  };
}
function envelopeHash(value: Record<string, unknown>): string { const { contentHash: _ignored, ...rest } = value; return contentHash(JSON.stringify(rest)); }
function getAtPath(value: unknown, path: string): string { const match = path.match(/^(.*?)((?:\[\d+\])*)$/); if (!match) throw new Error("Invalid profile claim path"); let current: any = value; for (const segment of path.split(/\.|\[|\]/).filter(Boolean)) current = current?.[segment]; if (typeof current !== "string" || !current.trim()) throw new Error(`Profile claim is empty: ${path}`); return current.trim(); }
function inferClaimType(path: string): EvidenceItem["claimType"] { if (path.includes("experience")) return "experience"; if (path.includes("skills")) return "technical-capability"; if (path.includes("education")) return "education"; if (path.includes("languages")) return "language"; if (path.includes("certifications")) return "certification"; if (path.includes("preferences")) return "preference"; return "other"; }
function evidenceStatus(verification: EvidenceItem["verification"]): "user-asserted" | "supported" | "needs-confirmation" { if (verification === "candidate-confirmed") return "user-asserted"; if (verification === "source-excerpt" || verification === "document-excerpt" || verification === "public-link") return "supported"; return "needs-confirmation"; }
function parsePointer(value: unknown): ProfileCurrentPointer { if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Profile current pointer is invalid"); const pointer = value as Record<string, unknown>; if (pointer.schemaVersion !== 1 || typeof pointer.revisionId !== "string" || !isSafeId(pointer.revisionId) || typeof pointer.revisionHash !== "string" || !/^sha256:[0-9a-f]{64}$/.test(pointer.revisionHash)) throw new Error("Profile current pointer is invalid"); return { schemaVersion: 1, revisionId: pointer.revisionId.trim(), revisionHash: pointer.revisionHash };
}
function isSafeId(value: string): boolean { return /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(value.trim()) && !value.includes("..") ; }
function candidateProfilePath(root: string): string { return join(profileDirectory(root), "candidate-profile.json"); }
function profileSourcePath(root: string): string { return join(profileDirectory(root), "source.md"); }
function currentPath(root: string): string { return join(profileDirectory(root), "current.json"); }
function revisionsDirectory(root: string): string { return join(profileDirectory(root), "revisions"); }
function revisionPath(root: string, id: string): string { return join(revisionsDirectory(root), `${id}.json`); }
function evidencePath(root: string, id: string): string { return join(profileDirectory(root), "evidence", `${id}.json`); }
function profileDirectory(root: string): string { return resolve(root, "data", "profile"); }
function isCode(error: unknown, code: string): boolean { return typeof error === "object" && error !== null && "code" in error && error.code === code; }

