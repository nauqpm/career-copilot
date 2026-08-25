export type DecisionStatus = "consider" | "clarify" | "not-ready";
export type CvDraftRecommendation = "create" | "hold";

export type DecisionEvidence = {
  topic: string;
  finding: string;
  jobEvidence?: string;
  profileEvidence?: string;
};

export type JobDecision = {
  status: DecisionStatus;
  summary: string;
  matches: DecisionEvidence[];
  gaps: DecisionEvidence[];
  blockers: DecisionEvidence[];
  questions: string[];
  cvDraftRecommendation: CvDraftRecommendation;
};

const statuses = new Set<DecisionStatus>(["consider", "clarify", "not-ready"]);
const recommendations = new Set<CvDraftRecommendation>(["create", "hold"]);

export function parseJobDecision(value: unknown): JobDecision {
  if (!isRecord(value)) throw new Error("Job decision must be a JSON object");
  if ("score" in value) throw new Error("Job decision must not include a score");
  if (!statuses.has(value.status as DecisionStatus)) throw new Error("status is invalid");
  if (!isNonEmptyString(value.summary)) throw new Error("summary must be a non-empty string");
  if (!recommendations.has(value.cvDraftRecommendation as CvDraftRecommendation)) {
    throw new Error("cvDraftRecommendation is invalid");
  }

  return {
    status: value.status as DecisionStatus,
    summary: value.summary.trim(),
    matches: parseEvidenceList(value.matches, "matches", true),
    gaps: parseEvidenceList(value.gaps, "gaps", false),
    blockers: parseEvidenceList(value.blockers, "blockers", false),
    questions: parseTextList(value.questions, "questions"),
    cvDraftRecommendation: value.cvDraftRecommendation as CvDraftRecommendation,
  };
}

function parseEvidenceList(value: unknown, field: string, requireEvidence: boolean): DecisionEvidence[] {
  if (!Array.isArray(value)) throw new Error(`${field} must be an array`);

  return value.map((entry, index) => {
    if (!isRecord(entry)) throw new Error(`${field}[${index}] must be an object`);
    if (!isNonEmptyString(entry.topic)) throw new Error(`${field}[${index}].topic must be a non-empty string`);
    if (!isNonEmptyString(entry.finding)) throw new Error(`${field}[${index}].finding must be a non-empty string`);

    const evidence = {
      ...optionalText(entry, "jobEvidence"),
      ...optionalText(entry, "profileEvidence"),
    };
    if (requireEvidence && Object.keys(evidence).length === 0) {
      throw new Error(`${field}[${index}] must include job or profile evidence`);
    }

    return { topic: entry.topic.trim(), finding: entry.finding.trim(), ...evidence };
  });
}

function parseTextList(value: unknown, field: string): string[] {
  if (!Array.isArray(value)) throw new Error(`${field} must be an array`);
  if (!value.every(isNonEmptyString)) throw new Error(`${field} must contain non-empty strings`);
  return value.map((item) => item.trim());
}

function optionalText(value: Record<string, unknown>, field: string): Partial<Record<string, string>> {
  const candidate = value[field];
  if (candidate === undefined) return {};
  if (!isNonEmptyString(candidate)) throw new Error(`${field} must be a non-empty string`);
  return { [field]: candidate.trim() };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}
