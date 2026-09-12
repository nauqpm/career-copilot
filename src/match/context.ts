import { join, resolve } from "node:path";

import { captureRawSource, parseJobCapture, type JobCapture } from "../job/capture.js";
import { parseJobAnalysisRevision, type JobAnalysisRevision } from "../job/analysis-revisions.js";
import { readCurrentAnalysis } from "../job/analysis-storage.js";
import { parseEvidenceItem, type EvidenceItem } from "../profile/evidence.js";
import { parseProfileRevision, type ProfileRevision } from "../profile/versions.js";
import { readProfileSnapshot, validateProfileRevisionEvidence } from "../profile/storage.js";
import { assertSafePath, readArtifact } from "../workspace/artifacts.js";
import { MATCH_POLICY_VERSION } from "./policy.js";
import type { EvidenceBinding } from "./schema.js";

export type MatchBlocked = {
  status: "blocked";
  remediation: Array<{ code: string; message: string }>;
};

export type MatchContext = {
  status: "ready";
  job: JobAnalysisRevision;
  analysisHash: string;
  profile: ProfileRevision;
  profileRevisionHash: string;
  evidence: EvidenceItem[];
  evidenceBindings: EvidenceBinding[];
  policyVersion: typeof MATCH_POLICY_VERSION;
};

export type VerifiedMatchCapture = {
  directory: string;
  capture: JobCapture;
  source: { content: string; hash: string };
  manifest: { content: string; hash: string };
};

export type ExactMatchAnalysis = {
  revision: JobAnalysisRevision;
  revisionHash: string;
  capture: VerifiedMatchCapture;
};

export type ExactMatchProfile = {
  revision: ProfileRevision;
  revisionHash: string;
};

const safeJobIdPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const safeAnalysisIdPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const safeProfileIdPattern = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const safeEvidenceIdPattern = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

class ProfileRevisionUnavailableError extends Error {}
class AnalysisRevisionUnavailableError extends Error {}

export function isSafeMatchJobId(value: unknown): value is string {
  return typeof value === "string" && safeJobIdPattern.test(value);
}

export function isSafeMatchProfileRevisionId(value: unknown): value is string {
  return typeof value === "string"
    && value === value.trim()
    && safeProfileIdPattern.test(value)
    && !value.includes("..");
}

/**
 * Load a capture only when source.md, source.json and raw.json still agree.
 * The returned hashes are hashes of the exact bytes on disk.
 */
export async function readVerifiedMatchCapture(root: string, jobId: string): Promise<VerifiedMatchCapture> {
  if (!isSafeMatchJobId(jobId)) throw new Error("job id is invalid");

  const directory = resolve(root, "data", "jobs", jobId);
  await assertSafePath(directory);
  const source = await readArtifact(join(directory, "source.md"));
  const manifest = await readArtifact(join(directory, "source.json"));
  const raw = await readArtifact(join(directory, "raw.json"));
  if (source === undefined) throw new Error("Job source.md is missing; source capture needs repair");
  if (manifest === undefined) throw new Error("Job source manifest is missing; legacy jobs cannot be matched");
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
  return { directory, capture, source, manifest };
}

export async function readExactMatchAnalysis(root: string, jobId: string, analysisId: string): Promise<ExactMatchAnalysis> {
  if (!safeAnalysisIdPattern.test(analysisId) || analysisId === "current") throw new Error("analysis revision ID is invalid");
  const capture = await readVerifiedMatchCapture(root, jobId);
  const path = join(capture.directory, "analyses", `${analysisId}.json`);
  const artifact = await readArtifact(path);
  if (artifact === undefined) throw new AnalysisRevisionUnavailableError("Analysis revision is missing");

  let value: unknown;
  try {
    value = JSON.parse(artifact.content) as unknown;
  } catch {
    throw new Error("Analysis revision is invalid");
  }
  const revision = parseJobAnalysisRevision(value, capture.source.content);
  if (
    revision.id !== analysisId
    || revision.jobId !== jobId
    || revision.capture.id !== jobId
    || revision.capture.manifestHash !== capture.manifest.hash
    || revision.capture.sourceHash !== capture.source.hash
  ) {
    throw new Error("Analysis revision is not bound to the verified capture");
  }
  return { revision, revisionHash: artifact.hash, capture };
}

export async function readExactMatchProfile(root: string, revisionId: string): Promise<ExactMatchProfile> {
  if (!isSafeMatchProfileRevisionId(revisionId)) throw new Error("profile revision ID is invalid");
  const normalizedId = revisionId;
  const path = join(resolve(root, "data", "profile", "revisions"), `${normalizedId}.json`);
  const artifact = await readArtifact(path);
  if (artifact === undefined) throw new ProfileRevisionUnavailableError("Profile revision is missing");

  let value: unknown;
  try {
    value = JSON.parse(artifact.content) as unknown;
  } catch {
    throw new Error("Profile revision is invalid");
  }
  const revision = parseProfileRevision(value);
  if (revision.id !== normalizedId) throw new Error("Profile revision filename does not match its ID");
  await validateProfileRevisionEvidence(root, revision);
  return { revision, revisionHash: artifact.hash };
}

export async function readMatchContext(
  root: string,
  jobId: string,
  profileRevisionId?: string,
  analysisRevisionId?: string,
): Promise<MatchContext | MatchBlocked> {
  if (!isSafeMatchJobId(jobId)) throw new Error("job id is invalid");
  if (profileRevisionId !== undefined && !isSafeMatchProfileRevisionId(profileRevisionId)) {
    throw new Error("profile revision ID is invalid");
  }
  if (analysisRevisionId !== undefined && (!safeAnalysisIdPattern.test(analysisRevisionId) || analysisRevisionId === "current")) {
    throw new Error("analysis revision ID is invalid");
  }

  let analysis: ExactMatchAnalysis | Awaited<ReturnType<typeof readCurrentAnalysis>>;
  try {
    analysis = analysisRevisionId === undefined
      ? await readCurrentAnalysis(root, jobId)
      : await readExactMatchAnalysis(root, jobId, analysisRevisionId);
  } catch (error) {
    const unavailable = error instanceof AnalysisRevisionUnavailableError;
    return blocked(
      analysisRevisionId === undefined
        ? "capture-or-analysis-needs-repair"
        : unavailable ? "analysis-revision-unavailable" : "analysis-revision-needs-repair",
      analysisRevisionId === undefined
        ? "The verified job capture or current source-bound analysis is missing or corrupt. Repair source.md, source.json, raw.json, or publish a valid analysis revision."
        : unavailable
          ? "The requested analysis revision is unavailable; choose an existing source-bound revision explicitly."
          : "The requested analysis revision or its source capture needs repair before matching.",
    );
  }
  if (analysis === undefined) {
    return blocked("analysis-unpublished", "Publish a valid source-bound analysis revision before matching this job.");
  }

  let profile: ExactMatchProfile;
  try {
    profile = profileRevisionId === undefined
      ? await readCurrentPublishedProfile(root)
      : await readExactMatchProfile(root, profileRevisionId);
  } catch (error) {
    const unavailable = error instanceof ProfileRevisionUnavailableError;
    return blocked(
      profileRevisionId === undefined
        ? unavailable ? "profile-unpublished" : "profile-needs-repair"
        : unavailable ? "profile-revision-unavailable" : "profile-revision-needs-repair",
      profileRevisionId === undefined
        ? unavailable
          ? "Publish a valid candidate profile revision before matching this job."
          : "The current candidate profile revision or its evidence needs repair before matching this job."
        : unavailable
          ? "The requested profile revision is unavailable; choose an existing published revision explicitly."
          : "The requested profile revision or its evidence needs repair before matching this job.",
    );
  }

  try {
    const evidence = await readProfileEvidenceWithHashes(root, profile.revision);
    return {
      status: "ready",
      job: analysis.revision,
      analysisHash: analysis.revisionHash,
      profile: profile.revision,
      profileRevisionHash: profile.revisionHash,
      evidence: evidence.items,
      evidenceBindings: evidence.bindings,
      policyVersion: MATCH_POLICY_VERSION,
    };
  } catch {
    return blocked("profile-evidence-needs-repair", "The selected profile revision references missing or corrupt evidence. Repair the profile revision and its evidence artifacts before matching.");
  }
}

export async function readCurrentPublishedProfile(root: string): Promise<ExactMatchProfile> {
  const snapshot = await readProfileSnapshot(root);
  if (snapshot.legacy || snapshot.revision === undefined || snapshot.hash === null) {
    throw new ProfileRevisionUnavailableError("A published profile revision is required");
  }
  return { revision: snapshot.revision, revisionHash: snapshot.hash };
}

export async function readProfileEvidence(root: string, revision: ProfileRevision): Promise<EvidenceItem[]> {
  return (await readProfileEvidenceWithHashes(root, revision)).items;
}

export async function readProfileEvidenceWithHashes(root: string, revision: ProfileRevision): Promise<{ items: EvidenceItem[]; bindings: EvidenceBinding[] }> {
  const ids = [...new Set(revision.claimEvidence.flatMap((claim) => claim.evidenceIds))].sort();
  const evidence: EvidenceItem[] = [];
  const bindings: EvidenceBinding[] = [];
  for (const id of ids) {
    if (!safeEvidenceIdPattern.test(id) || id.includes("..")) throw new Error("Profile evidence ID is invalid");
    const artifact = await readArtifact(join(resolve(root, "data", "profile", "evidence"), `${id}.json`));
    if (artifact === undefined) throw new Error("Profile evidence is missing");
    let value: unknown;
    try {
      value = JSON.parse(artifact.content) as unknown;
    } catch {
      throw new Error("Profile evidence is invalid");
    }
    const item = parseEvidenceItem(value);
    if (item.id !== id) throw new Error("Profile evidence ID does not match its filename");
    evidence.push(item);
    bindings.push({ id, hash: artifact.hash });
  }
  return { items: evidence, bindings };
}

function blocked(code: string, message: string): MatchBlocked {
  return { status: "blocked", remediation: [{ code, message }] };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
