import type { RequirementPriority } from "../job/schema.js";

export const MATCH_POLICY_VERSION = "m4-v1" as const;
export const POLICY_VERSION = MATCH_POLICY_VERSION;
export const policyVersion = MATCH_POLICY_VERSION;

export const REQUIREMENT_VERDICTS = [
  "supported",
  "partially-supported",
  "not-evidenced",
  "unknown",
  "conflicting",
  "not-applicable",
] as const;

export const PREFERENCE_VERDICTS = ["compatible", "conflicting", "unknown"] as const;
export const RECOMMENDATIONS = ["consider", "clarify", "not-ready"] as const;
export const CONFIDENCE_LEVELS = ["high", "medium", "low"] as const;
export const RESERVED_MATCH_IDS = ["current"] as const;

type RequirementVerdict = (typeof REQUIREMENT_VERDICTS)[number];
type PreferenceVerdict = (typeof PREFERENCE_VERDICTS)[number];

export function isRequirementEvidenceRequired(verdict: RequirementVerdict): boolean {
  return verdict === "supported" || verdict === "partially-supported" || verdict === "conflicting";
}

export function isPreferenceEvidenceRequired(verdict: PreferenceVerdict): boolean {
  return verdict === "compatible" || verdict === "conflicting";
}

export function isSafeMatchId(value: unknown): value is string {
  return typeof value === "string"
    && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value.trim())
    && !RESERVED_MATCH_IDS.includes(value.trim() as (typeof RESERVED_MATCH_IDS)[number]);
}

/** Profile evidence keeps its existing mixed-case, dot, underscore and hyphen namespace. */
export function isSafeEvidenceId(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const id = value.trim();
  return /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(id) && !id.includes("..");
}

export function isSha256(value: unknown): value is string {
  return typeof value === "string" && /^sha256:[a-f0-9]{64}$/.test(value.trim());
}

/** RFC3339 UTC with a calendar-valid date, not merely a Date.parse-able string. */
export function isStrictUtcTimestamp(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const timestamp = value.trim();
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?Z$/.exec(timestamp);
  if (match === null || !Number.isFinite(Date.parse(timestamp))) return false;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const second = Number(match[6]);
  const date = new Date(0);
  date.setUTCFullYear(year, month - 1, day);
  date.setUTCHours(hour, minute, second, 0);
  return date.getUTCFullYear() === year
    && date.getUTCMonth() === month - 1
    && date.getUTCDate() === day
    && date.getUTCHours() === hour
    && date.getUTCMinutes() === minute
    && date.getUTCSeconds() === second;
}

/**
 * Check the only semantic binding the schema can know without reading a job:
 * each source requirement appears exactly once and keeps its original modality.
 */
export function assertRequirementCoverage(
  assessments: ReadonlyArray<{ requirementId: string; modality: RequirementPriority }>,
  requirements: ReadonlyArray<{ id: string; priority?: RequirementPriority }>,
): void {
  const expected = new Map<string, RequirementPriority>();
  for (const requirement of requirements) {
    const id = requirement.id.trim();
    if (expected.has(id)) throw new Error(`duplicate source requirement id: ${id}`);
    expected.set(id, requirement.priority ?? "unknown");
  }

  const seen = new Set<string>();
  for (const assessment of assessments) {
    if (seen.has(assessment.requirementId)) {
      throw new Error(`duplicate requirement assessment: ${assessment.requirementId}`);
    }
    seen.add(assessment.requirementId);
    const source = expected.get(assessment.requirementId);
    if (source === undefined) throw new Error(`requirement assessment is not in the source analysis: ${assessment.requirementId}`);
    if (source !== assessment.modality) {
      throw new Error(`requirement modality does not match source analysis: ${assessment.requirementId}`);
    }
  }

  for (const id of expected.keys()) {
    if (!seen.has(id)) throw new Error(`missing requirement assessment: ${id}`);
  }
}

export const validateRequirementCoverage = assertRequirementCoverage;
