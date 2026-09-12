import { contentHash } from "../workspace/artifacts.js";
import type { RequirementPriority } from "../job/schema.js";
import {
  CONFIDENCE_LEVELS,
  isPreferenceEvidenceRequired,
  isRequirementEvidenceRequired,
  isSafeMatchId,
  isSha256,
  isStrictUtcTimestamp,
  MATCH_POLICY_VERSION,
  PREFERENCE_VERDICTS,
  RECOMMENDATIONS,
  REQUIREMENT_VERDICTS,
} from "./policy.js";

export type RequirementVerdict = (typeof REQUIREMENT_VERDICTS)[number];

export type RequirementAssessment = {
  requirementId: string;
  modality: RequirementPriority;
  verdict: RequirementVerdict;
  explanation: string;
  evidenceIds: string[];
  question?: string;
};

export type PreferenceCheck = {
  claimPath: string;
  jobFact: string;
  candidatePreference: string;
  verdict: (typeof PREFERENCE_VERDICTS)[number];
  explanation: string;
  evidenceIds: string[];
};

export type Finding = {
  code: string;
  message: string;
  requirementId?: string;
  evidenceIds: string[];
};

export type Question = {
  for: "candidate" | "employer";
  text: string;
  requirementId?: string;
};

export type MatchAssessment = {
  schemaVersion: 1;
  id: string;
  createdAt: string;
  createdBy: {
    kind: "agent";
    role: "match-analyst";
    skillVersion: string;
    model: string;
    promptHash: string;
  };
  contentHash: string;
  jobRef: {
    jobId: string;
    captureId: string;
    captureHash: string;
    sourceHash: string;
    analysisId: string;
    analysisHash: string;
  };
  profileRef: {
    revisionId: string;
    revisionHash: string;
  };
  policyVersion: typeof MATCH_POLICY_VERSION;
  recommendation: (typeof RECOMMENDATIONS)[number];
  confidence: (typeof CONFIDENCE_LEVELS)[number];
  summary: string;
  requirementAssessments: RequirementAssessment[];
  preferenceChecks: PreferenceCheck[];
  blockers: Finding[];
  questions: Question[];
  anomalies: Finding[];
};

const requirementPriorities = new Set<RequirementPriority>(["required", "preferred", "unknown"]);
const requirementVerdicts = new Set<string>(REQUIREMENT_VERDICTS);
const preferenceVerdicts = new Set<string>(PREFERENCE_VERDICTS);
const recommendations = new Set<string>(RECOMMENDATIONS);
const confidenceLevels = new Set<string>(CONFIDENCE_LEVELS);

export function parseMatchAssessment(value: unknown): MatchAssessment {
  rejectScore(value);
  if (!isRecord(value)) throw new Error("Match assessment must be a JSON object");
  assertKnownKeys(value, [
    "schemaVersion", "id", "createdAt", "createdBy", "contentHash", "jobRef", "profileRef", "policyVersion",
    "recommendation", "confidence", "summary", "requirementAssessments", "preferenceChecks", "blockers", "questions", "anomalies",
  ], "assessment");

  if (value.schemaVersion !== 1) throw new Error("schemaVersion must be 1");
  const id = safeId(value.id, "id");
  const createdAt = strictTimestamp(value.createdAt, "createdAt");
  const createdBy = parseCreator(value.createdBy);
  const providedHash = sha256(value.contentHash, "contentHash");
  const jobRef = parseJobRef(value.jobRef);
  const profileRef = parseProfileRef(value.profileRef);
  if (value.policyVersion !== MATCH_POLICY_VERSION) throw new Error("policyVersion must be m4-v1");
  if (!recommendations.has(value.recommendation as string)) throw new Error("recommendation is invalid");
  if (!confidenceLevels.has(value.confidence as string)) throw new Error("confidence is invalid");
  const summary = nonEmptyText(value.summary, "summary");
  const requirementAssessments = parseRequirementAssessments(value.requirementAssessments);
  const preferenceChecks = parsePreferenceChecks(value.preferenceChecks);
  const blockers = parseFindings(value.blockers, "blockers", true);
  const questions = parseQuestions(value.questions);
  const anomalies = parseFindings(value.anomalies, "anomalies", false);

  const parsed: MatchAssessment = {
    schemaVersion: 1,
    id,
    createdAt,
    createdBy,
    contentHash: providedHash,
    jobRef,
    profileRef,
    policyVersion: MATCH_POLICY_VERSION,
    recommendation: value.recommendation as MatchAssessment["recommendation"],
    confidence: value.confidence as MatchAssessment["confidence"],
    summary,
    requirementAssessments,
    preferenceChecks,
    blockers,
    questions,
    anomalies,
  };
  if (hashWithoutContent(parsed) !== providedHash) throw new Error("contentHash does not match assessment");
  return parsed;
}

export function serializeMatchAssessment(value: MatchAssessment): string {
  return JSON.stringify(parseMatchAssessment(value));
}

export function hashMatchAssessment(value: Omit<MatchAssessment, "contentHash">): string {
  return contentHash(JSON.stringify(value));
}

function parseCreator(value: unknown): MatchAssessment["createdBy"] {
  if (!isRecord(value)) throw new Error("createdBy must be an object");
  assertKnownKeys(value, ["kind", "role", "skillVersion", "model", "promptHash"], "createdBy");
  if (value.kind !== "agent") throw new Error("createdBy.kind must be agent");
  if (value.role !== "match-analyst") throw new Error("createdBy.role must be match-analyst");
  return {
    kind: "agent",
    role: "match-analyst",
    skillVersion: nonEmptyText(value.skillVersion, "createdBy.skillVersion"),
    model: nonEmptyText(value.model, "createdBy.model"),
    promptHash: sha256(value.promptHash, "createdBy.promptHash"),
  };
}

function parseJobRef(value: unknown): MatchAssessment["jobRef"] {
  if (!isRecord(value)) throw new Error("jobRef must be an object");
  assertKnownKeys(value, ["jobId", "captureId", "captureHash", "sourceHash", "analysisId", "analysisHash"], "jobRef");
  return {
    jobId: safeId(value.jobId, "jobRef.jobId"),
    captureId: safeId(value.captureId, "jobRef.captureId"),
    captureHash: sha256(value.captureHash, "jobRef.captureHash"),
    sourceHash: sha256(value.sourceHash, "jobRef.sourceHash"),
    analysisId: safeId(value.analysisId, "jobRef.analysisId"),
    analysisHash: sha256(value.analysisHash, "jobRef.analysisHash"),
  };
}

function parseProfileRef(value: unknown): MatchAssessment["profileRef"] {
  if (!isRecord(value)) throw new Error("profileRef must be an object");
  assertKnownKeys(value, ["revisionId", "revisionHash"], "profileRef");
  return {
    revisionId: safeId(value.revisionId, "profileRef.revisionId"),
    revisionHash: sha256(value.revisionHash, "profileRef.revisionHash"),
  };
}

function parseRequirementAssessments(value: unknown): RequirementAssessment[] {
  if (!Array.isArray(value)) throw new Error("requirementAssessments must be an array");
  const seen = new Set<string>();
  return value.map((entry, index) => {
    if (!isRecord(entry)) throw new Error(`requirementAssessments[${index}] must be an object`);
    assertKnownKeys(entry, ["requirementId", "modality", "verdict", "explanation", "evidenceIds", "question"], `requirementAssessments[${index}]`);
    const requirementId = safeId(entry.requirementId, `requirementAssessments[${index}].requirementId`);
    if (seen.has(requirementId)) throw new Error(`duplicate requirement assessment: ${requirementId}`);
    seen.add(requirementId);
    if (!requirementPriorities.has(entry.modality as RequirementPriority)) throw new Error(`requirementAssessments[${index}].modality is invalid`);
    if (!requirementVerdicts.has(entry.verdict as string)) throw new Error(`requirementAssessments[${index}].verdict is invalid`);
    const verdict = entry.verdict as RequirementVerdict;
    const evidenceIds = parseEvidenceIds(entry.evidenceIds, `requirementAssessments[${index}].evidenceIds`);
    if (isRequirementEvidenceRequired(verdict) && evidenceIds.length === 0) {
      throw new Error(`requirementAssessments[${index}] requires evidence`);
    }
    if (!isRequirementEvidenceRequired(verdict) && evidenceIds.length > 0) {
      throw new Error(`requirementAssessments[${index}] cannot cite evidence for ${verdict}`);
    }
    return {
      requirementId,
      modality: entry.modality as RequirementPriority,
      verdict,
      explanation: nonEmptyText(entry.explanation, `requirementAssessments[${index}].explanation`),
      evidenceIds,
      ...optionalText(entry.question, `requirementAssessments[${index}].question`),
    };
  });
}

function parsePreferenceChecks(value: unknown): PreferenceCheck[] {
  if (!Array.isArray(value)) throw new Error("preferenceChecks must be an array");
  const seen = new Set<string>();
  return value.map((entry, index) => {
    if (!isRecord(entry)) throw new Error(`preferenceChecks[${index}] must be an object`);
    assertKnownKeys(entry, ["claimPath", "jobFact", "candidatePreference", "verdict", "explanation", "evidenceIds"], `preferenceChecks[${index}]`);
    const claimPath = nonEmptyText(entry.claimPath, `preferenceChecks[${index}].claimPath`);
    if (seen.has(claimPath)) throw new Error(`duplicate preference claim path: ${claimPath}`);
    seen.add(claimPath);
    if (!preferenceVerdicts.has(entry.verdict as string)) throw new Error(`preferenceChecks[${index}].verdict is invalid`);
    const verdict = entry.verdict as PreferenceCheck["verdict"];
    const evidenceIds = parseEvidenceIds(entry.evidenceIds, `preferenceChecks[${index}].evidenceIds`);
    if (isPreferenceEvidenceRequired(verdict) && evidenceIds.length === 0) {
      throw new Error(`preferenceChecks[${index}] requires evidence`);
    }
    if (!isPreferenceEvidenceRequired(verdict) && evidenceIds.length > 0) {
      throw new Error(`preferenceChecks[${index}] cannot cite evidence for unknown`);
    }
    return {
      claimPath,
      jobFact: nonEmptyText(entry.jobFact, `preferenceChecks[${index}].jobFact`),
      candidatePreference: nonEmptyText(entry.candidatePreference, `preferenceChecks[${index}].candidatePreference`),
      verdict,
      explanation: nonEmptyText(entry.explanation, `preferenceChecks[${index}].explanation`),
      evidenceIds,
    };
  });
}

function parseFindings(value: unknown, field: string, requireEvidence: boolean): Finding[] {
  if (!Array.isArray(value)) throw new Error(`${field} must be an array`);
  return value.map((entry, index) => {
    if (!isRecord(entry)) throw new Error(`${field}[${index}] must be an object`);
    assertKnownKeys(entry, ["code", "message", "requirementId", "evidenceIds"], `${field}[${index}]`);
    const evidenceIds = parseEvidenceIds(entry.evidenceIds, `${field}[${index}].evidenceIds`);
    if (requireEvidence && evidenceIds.length === 0) throw new Error(`${field}[${index}] requires evidence`);
    return {
      code: safeCode(entry.code, `${field}[${index}].code`),
      message: nonEmptyText(entry.message, `${field}[${index}].message`),
      ...optionalSafeId(entry.requirementId, `${field}[${index}].requirementId`),
      evidenceIds,
    };
  });
}

function parseQuestions(value: unknown): Question[] {
  if (!Array.isArray(value)) throw new Error("questions must be an array");
  return value.map((entry, index) => {
    if (!isRecord(entry)) throw new Error(`questions[${index}] must be an object`);
    assertKnownKeys(entry, ["for", "text", "requirementId"], `questions[${index}]`);
    if (entry.for !== "candidate" && entry.for !== "employer") throw new Error(`questions[${index}].for must be candidate or employer`);
    return {
      for: entry.for,
      text: nonEmptyText(entry.text, `questions[${index}].text`),
      ...optionalSafeId(entry.requirementId, `questions[${index}].requirementId`),
    };
  });
}

function parseEvidenceIds(value: unknown, field: string): string[] {
  if (!Array.isArray(value)) throw new Error(`${field} must be an array`);
  const ids = value.map((entry, index) => safeId(entry, `${field}[${index}]`));
  if (new Set(ids).size !== ids.length) throw new Error(`${field} must not contain duplicate IDs`);
  return ids;
}

function safeId(value: unknown, field: string): string {
  if (!isSafeMatchId(value)) throw new Error(`${field} must be a safe identifier`);
  return value.trim();
}

function safeCode(value: unknown, field: string): string {
  return safeId(value, field);
}

function optionalSafeId(value: unknown, field: string): Partial<{ requirementId: string }> {
  if (value === undefined) return {};
  return { requirementId: safeId(value, field) };
}

function optionalText(value: unknown, field: string): Partial<{ question: string }> {
  if (value === undefined) return {};
  return { question: nonEmptyText(value, field) };
}

function nonEmptyText(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${field} must be a non-empty string`);
  return value.trim();
}

function strictTimestamp(value: unknown, field: string): string {
  if (!isStrictUtcTimestamp(value)) throw new Error(`${field} must be an RFC3339 UTC timestamp`);
  return value.trim();
}

function sha256(value: unknown, field: string): string {
  if (!isSha256(value)) throw new Error(`${field} must be a lowercase SHA-256 value`);
  return value.trim();
}

function hashWithoutContent(value: MatchAssessment): string {
  const { contentHash: _ignored, ...withoutContentHash } = value;
  return contentHash(JSON.stringify(withoutContentHash));
}

function rejectScore(value: unknown, seen = new Set<object>()): void {
  if (Array.isArray(value)) {
    for (const entry of value) rejectScore(entry, seen);
    return;
  }
  if (!isRecord(value) || seen.has(value)) return;
  seen.add(value);
  for (const [key, entry] of Object.entries(value)) {
    if (key === "score") throw new Error("score is not permitted in a match assessment");
    rejectScore(entry, seen);
  }
}

function assertKnownKeys(value: Record<string, unknown>, keys: readonly string[], field: string): void {
  const allowed = new Set(keys);
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) throw new Error(`${field}.${key} is not permitted`);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
