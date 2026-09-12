import { readdir } from "node:fs/promises";
import { join, resolve } from "node:path";

import { readCurrentAnalysis } from "../job/analysis-storage.js";
import { profileClaimPaths, type ProfileRevision } from "../profile/versions.js";
import { assertRequirementCoverage, MATCH_POLICY_VERSION, isSafeEvidenceId, isSafeMatchId } from "./policy.js";
import { parseMatchAssessment, parseStoredMatchAssessment, type EvidenceBinding, type MatchAssessment } from "./schema.js";
import {
  readCurrentPublishedProfile,
  readExactMatchAnalysis,
  readExactMatchProfile,
  readProfileEvidenceWithHashes,
  readVerifiedMatchCapture,
} from "./context.js";
import { assertSafePath, readArtifact, writeArtifact } from "../workspace/artifacts.js";

export type MatchCurrentPointer = {
  schemaVersion: 1;
  assessmentId: string;
  assessmentHash: string;
};

export type MatchSnapshot = {
  assessment: MatchAssessment;
  assessmentHash: string;
  pointerHash: string;
};

export type MatchHistory = {
  current?: { assessmentId: string; assessmentHash: string };
  assessments: Array<{
    id: string;
    createdAt: string;
    assessmentHash: string;
    recommendation: MatchAssessment["recommendation"];
    status: MatchFreshnessStatus;
    active: boolean;
  }>;
};

export type MatchFreshnessStatus = "current" | "stale" | "needs-repair";
export type MatchFreshness = { status: MatchFreshnessStatus; reasons: string[] };
type StoredMatchAssessment = ReturnType<typeof parseStoredMatchAssessment>;

const hashPattern = /^sha256:[a-f0-9]{64}$/;
const safeJobIdPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export async function readCurrentMatch(root: string, jobId: string): Promise<MatchSnapshot | undefined> {
  assertJobId(jobId);
  const pointerArtifact = await readArtifact(currentPath(root, jobId));
  if (pointerArtifact === undefined) return undefined;

  const pointer = parsePointer(readJson(pointerArtifact.content, "Assessment current pointer"));
  const artifact = await readArtifact(assessmentPath(root, jobId, pointer.assessmentId));
  if (artifact === undefined || artifact.hash !== pointer.assessmentHash) {
    throw new Error("Assessment current pointer references a missing or changed assessment");
  }
  const assessment = parseStoredAssessment(artifact.content, jobId, pointer.assessmentId);
  if (assessment.schemaVersion !== 2) throw new Error("Assessment schema version needs repair before it can be read");
  await validateStoredReferences(root, assessment);
  return { assessment, assessmentHash: artifact.hash, pointerHash: pointerArtifact.hash };
}

export async function readMatchHistory(root: string, jobId: string): Promise<MatchHistory> {
  assertJobId(jobId);
  const directory = assessmentsDirectory(root, jobId);
  await assertSafePath(directory);

  let current: MatchCurrentPointer | undefined;
  const pointerArtifact = await readArtifact(currentPath(root, jobId));
  if (pointerArtifact !== undefined) {
    let candidate: MatchCurrentPointer | undefined;
    try {
      candidate = parsePointer(readJson(pointerArtifact.content, "Assessment current pointer"));
    } catch {
      candidate = undefined;
    }
    if (candidate !== undefined) {
      const artifact = await readArtifact(assessmentPath(root, jobId, candidate.assessmentId));
      if (artifact !== undefined && artifact.hash === candidate.assessmentHash) {
        try {
          parseStoredAssessment(artifact.content, jobId, candidate.assessmentId);
          current = candidate;
        } catch {
          current = undefined;
        }
      }
    }
  }

  let entries: string[] = [];
  try {
    entries = (await readdir(directory, { withFileTypes: true }))
      .filter((entry) => entry.name.endsWith(".json") && entry.name !== "current.json")
      .map((entry) => entry.name);
  } catch (error) {
    if (!isCode(error, "ENOENT")) throw error;
  }

  const assessments: MatchHistory["assessments"] = [];
  for (const entry of entries) {
    const artifact = await readArtifact(join(directory, entry));
    if (artifact === undefined) continue;
    try {
      const filenameId = entry.slice(0, -".json".length);
      const assessment = parseStoredAssessment(artifact.content, jobId, filenameId);
      const freshness = await assessmentFreshness(root, assessment);
      assessments.push({
        id: assessment.id,
        createdAt: assessment.createdAt,
        assessmentHash: artifact.hash,
        recommendation: assessment.recommendation,
        status: freshness.status,
        active: current?.assessmentId === assessment.id && current?.assessmentHash === artifact.hash,
      });
    } catch {
      // Malformed, mismatched and source-stale orphan bytes remain on disk for repair,
      // but cannot be presented as validated assessment history.
    }
  }
  assessments.sort((left, right) => left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id));
  return {
    ...(current === undefined ? {} : { current: { assessmentId: current.assessmentId, assessmentHash: current.assessmentHash } }),
    assessments,
  };
}

export async function saveMatchAssessment(
  root: string,
  jobId: string,
  value: unknown,
  expectedPointerHash: string | null,
): Promise<MatchSnapshot> {
  assertJobId(jobId);
  if (expectedPointerHash !== null && !hashPattern.test(expectedPointerHash)) {
    throw new Error("Assessment pointer hash is invalid");
  }
  if (isRecord(value) && typeof value.id === "string" && value.id.trim() === "current") {
    throw new Error("Assessment ID 'current' is reserved");
  }

  const assessment = parseMatchAssessment(value);
  await validateLiveReferences(root, jobId, assessment);

  const serialized = `${JSON.stringify(assessment, null, 2)}\n`;
  const assessmentHash = await writeArtifact(assessmentPath(root, jobId, assessment.id), serialized, null);
  const pointer: MatchCurrentPointer = { schemaVersion: 1, assessmentId: assessment.id, assessmentHash };
  const pointerHash = await writeArtifact(currentPath(root, jobId), `${JSON.stringify(pointer, null, 2)}\n`, expectedPointerHash);
  return { assessment, assessmentHash, pointerHash };
}

export async function assessmentFreshness(root: string, assessment: StoredMatchAssessment): Promise<MatchFreshness> {
  if (assessment.schemaVersion === 1) {
    return { status: "needs-repair", reasons: ["assessment schema version 1 has no evidence bindings"] };
  }
  const staleReasons: string[] = [];
  const repairReasons: string[] = [];
  if (assessment.policyVersion !== MATCH_POLICY_VERSION) staleReasons.push("matcher policy version changed");

  try {
    await validateStoredReferences(root, assessment);
  } catch {
    repairReasons.push("assessment requirement, evidence or claim references need repair");
  }

  try {
    const capture = await readVerifiedMatchCapture(root, assessment.jobRef.jobId);
    if (capture.manifest.hash !== assessment.jobRef.captureHash || capture.source.hash !== assessment.jobRef.sourceHash) {
      staleReasons.push("job capture or source bytes changed");
    }
  } catch {
    repairReasons.push("job capture/source needs repair");
  }

  try {
    const boundAnalysis = await readExactMatchAnalysis(root, assessment.jobRef.jobId, assessment.jobRef.analysisId);
    if (
      boundAnalysis.revisionHash !== assessment.jobRef.analysisHash
      || boundAnalysis.revision.capture.id !== assessment.jobRef.captureId
      || boundAnalysis.revision.capture.manifestHash !== assessment.jobRef.captureHash
      || boundAnalysis.revision.capture.sourceHash !== assessment.jobRef.sourceHash
    ) {
      repairReasons.push("bound analysis revision changed or is inconsistent");
    }
  } catch {
    repairReasons.push("bound analysis revision needs repair");
  }

  try {
    const currentAnalysis = await readCurrentAnalysis(root, assessment.jobRef.jobId);
    if (currentAnalysis === undefined) {
      repairReasons.push("current analysis pointer is missing");
    } else if (
      currentAnalysis.revision.id !== assessment.jobRef.analysisId
      || currentAnalysis.revisionHash !== assessment.jobRef.analysisHash
      || currentAnalysis.revision.capture.id !== assessment.jobRef.captureId
    ) {
      staleReasons.push("analysis revision changed");
    }
  } catch {
    repairReasons.push("current analysis needs repair");
  }

  try {
    const boundProfile = await readExactMatchProfile(root, assessment.profileRef.revisionId);
    if (boundProfile.revisionHash !== assessment.profileRef.revisionHash) {
      repairReasons.push("bound profile revision changed or is inconsistent");
    }
    const selectedEvidence = await readProfileEvidenceWithHashes(root, boundProfile.revision);
    if (!sameEvidenceBindings(selectedEvidence.bindings, assessment.profileRef.evidence)) {
      staleReasons.push("profile evidence artifact set or bytes changed");
    }
  } catch {
    repairReasons.push("bound profile revision/evidence needs repair");
  }

  try {
    const currentProfile = await readCurrentPublishedProfile(root);
    if (
      currentProfile.revision.id !== assessment.profileRef.revisionId
      || currentProfile.revisionHash !== assessment.profileRef.revisionHash
    ) {
      staleReasons.push("profile revision changed");
    }
  } catch {
    repairReasons.push("current profile revision/evidence needs repair");
  }

  const reasons = [...new Set([...repairReasons, ...staleReasons])];
  return {
    status: repairReasons.length > 0 ? "needs-repair" : staleReasons.length > 0 ? "stale" : "current",
    reasons,
  };
}

async function validateLiveReferences(root: string, jobId: string, assessment: MatchAssessment): Promise<void> {
  if (assessment.jobRef.jobId !== jobId) throw new Error("Assessment job ID does not match the selected job");

  const analysis = await readExactMatchAnalysis(root, jobId, assessment.jobRef.analysisId);
  if (assessment.jobRef.captureId !== analysis.revision.capture.id) {
    throw new Error("Assessment capture ID does not match the analysis revision");
  }
  if (assessment.jobRef.captureHash !== analysis.capture.manifest.hash) {
    throw new Error("Assessment capture hash does not match source.json");
  }
  if (assessment.jobRef.sourceHash !== analysis.capture.source.hash) {
    throw new Error("Assessment source hash does not match source.md");
  }
  if (assessment.jobRef.analysisHash !== analysis.revisionHash) {
    throw new Error("Assessment analysis hash does not match the selected revision");
  }

  const profile = await readExactMatchProfile(root, assessment.profileRef.revisionId);
  if (assessment.profileRef.revisionHash !== profile.revisionHash) {
    throw new Error("Assessment profile hash does not match the selected revision");
  }
  await assertAssessmentReferences(root, assessment, analysis.revision.analysis.requirements, profile.revision);
}

async function validateStoredReferences(root: string, assessment: MatchAssessment): Promise<void> {
  const analysis = await readExactMatchAnalysis(root, assessment.jobRef.jobId, assessment.jobRef.analysisId);
  if (
    assessment.jobRef.captureId !== analysis.revision.capture.id
    || assessment.jobRef.captureHash !== analysis.capture.manifest.hash
    || assessment.jobRef.sourceHash !== analysis.capture.source.hash
    || assessment.jobRef.analysisHash !== analysis.revisionHash
  ) {
    throw new Error("Assessment references a changed analysis or capture");
  }

  const profile = await readExactMatchProfile(root, assessment.profileRef.revisionId);
  if (assessment.profileRef.revisionHash !== profile.revisionHash) {
    throw new Error("Assessment references a changed profile revision");
  }
  await assertAssessmentReferences(root, assessment, analysis.revision.analysis.requirements, profile.revision, false);
}

async function assertAssessmentReferences(
  root: string,
  assessment: MatchAssessment,
  requirements: ReadonlyArray<{ id: string; priority?: "required" | "preferred" | "unknown" }>,
  profile: ProfileRevision,
  verifyEvidenceBindings = true,
): Promise<void> {
  assertRequirementCoverage(assessment.requirementAssessments, requirements);
  const requirementIds = new Set(requirements.map((requirement) => requirement.id));
  for (const finding of [...assessment.blockers, ...assessment.anomalies]) {
    if (finding.requirementId !== undefined && !requirementIds.has(finding.requirementId)) {
      throw new Error(`Finding references an unknown requirement: ${finding.requirementId}`);
    }
  }
  for (const question of assessment.questions) {
    if (question.requirementId !== undefined && !requirementIds.has(question.requirementId)) {
      throw new Error(`Question references an unknown requirement: ${question.requirementId}`);
    }
  }

  const evidenceById = new Map<string, string>();
  for (const claim of profile.claimEvidence) {
    for (const evidenceId of claim.evidenceIds) {
      if (!isSafeEvidenceId(evidenceId)) throw new Error("Profile evidence ID is invalid");
      evidenceById.set(evidenceId, claim.claimPath);
    }
  }
  const evidenceIds = [
    ...assessment.requirementAssessments.flatMap((entry) => entry.evidenceIds),
    ...assessment.preferenceChecks.flatMap((entry) => entry.evidenceIds),
    ...assessment.blockers.flatMap((entry) => entry.evidenceIds),
    ...assessment.anomalies.flatMap((entry) => entry.evidenceIds),
  ];
  for (const evidenceId of evidenceIds) {
    if (!evidenceById.has(evidenceId)) throw new Error(`Assessment references evidence outside the selected profile revision: ${evidenceId}`);
  }
  const claimPaths = new Set(profileClaimPaths(profile.profile));
  for (const preference of assessment.preferenceChecks) {
    if (!claimPaths.has(preference.claimPath)) {
      throw new Error(`Preference claim path is not in the selected profile revision: ${preference.claimPath}`);
    }
  }

  // readExactMatchProfile validates every mapping and every evidence artifact. The
  // selected evidence set must also be copied as exact artifact-byte bindings.
  const selectedEvidence = await readProfileEvidenceWithHashes(root, profile);
  if (verifyEvidenceBindings && !sameEvidenceBindings(selectedEvidence.bindings, assessment.profileRef.evidence)) {
    throw new Error("Assessment evidence bindings do not match the selected profile revision");
  }
}

function sameEvidenceBindings(left: ReadonlyArray<EvidenceBinding>, right: ReadonlyArray<EvidenceBinding>): boolean {
  return left.length === right.length && left.every((binding, index) => {
    const candidate = right[index];
    return candidate?.id === binding.id && candidate.hash === binding.hash;
  });
}

function parseStoredAssessment(content: string, jobId: string, filenameId: string): StoredMatchAssessment {
  const assessment = parseStoredMatchAssessment(readJson(content, "Assessment"));
  if (assessment.id !== filenameId) throw new Error("Assessment filename does not match its ID");
  if (assessment.jobRef.jobId !== jobId) throw new Error("Assessment job ID does not match its directory");
  return assessment;
}

function parsePointer(value: unknown): MatchCurrentPointer {
  if (
    !isRecord(value)
    || value.schemaVersion !== 1
    || typeof value.assessmentId !== "string"
    || !isSafeMatchId(value.assessmentId)
    || typeof value.assessmentHash !== "string"
    || !hashPattern.test(value.assessmentHash)
  ) {
    throw new Error("Assessment current pointer is invalid");
  }
  return { schemaVersion: 1, assessmentId: value.assessmentId.trim(), assessmentHash: value.assessmentHash.trim() };
}

function readJson(content: string, label: string): unknown {
  try {
    return JSON.parse(content) as unknown;
  } catch {
    throw new Error(`${label} is invalid`);
  }
}

function assertJobId(jobId: string): void {
  if (!safeJobIdPattern.test(jobId)) throw new Error("job id is invalid");
}

function assessmentsDirectory(root: string, jobId: string): string {
  return resolve(root, "data", "jobs", jobId, "assessments");
}

function assessmentPath(root: string, jobId: string, assessmentId: string): string {
  return join(assessmentsDirectory(root, jobId), `${assessmentId}.json`);
}

function currentPath(root: string, jobId: string): string {
  return join(assessmentsDirectory(root, jobId), "current.json");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isCode(error: unknown, code: string): error is NodeJS.ErrnoException {
  return typeof error === "object" && error !== null && "code" in error && error.code === code;
}
