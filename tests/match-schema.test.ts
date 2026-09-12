import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import {
  parseMatchAssessment,
  serializeMatchAssessment,
  type MatchAssessment,
} from "../src/match/schema.js";
import { assertRequirementCoverage } from "../src/match/policy.js";

function hash(value: string): string {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function withContentHash(value: Omit<MatchAssessment, "contentHash">): MatchAssessment {
  return { ...value, contentHash: hash(JSON.stringify(value)) };
}

function assessment(overrides: Record<string, unknown> = {}): MatchAssessment {
  const base: Omit<MatchAssessment, "contentHash"> = {
    schemaVersion: 1,
    id: "assessment-one",
    createdAt: "2026-09-12T07:00:00.000Z",
    createdBy: {
      kind: "agent",
      role: "match-analyst",
      skillVersion: "assess-job@1",
      model: "local-test-model",
      promptHash: hash("assess-job-prompt-v1"),
    },
    jobRef: {
      jobId: "job-one",
      captureId: "job-one",
      captureHash: hash("capture"),
      sourceHash: hash("source"),
      analysisId: "analysis-one",
      analysisHash: hash("analysis"),
    },
    profileRef: {
      revisionId: "profile-one",
      revisionHash: hash("profile"),
    },
    policyVersion: "m4-v1",
    recommendation: "clarify",
    confidence: "medium",
    summary: "The backend role has evidence-linked matches, with salary and platform scope to clarify.",
    requirementAssessments: [
      {
        requirementId: "req-node",
        modality: "required",
        verdict: "supported",
        explanation: "The selected profile evidence explicitly describes Node.js API work.",
        evidenceIds: ["evidence-node"],
      },
      {
        requirementId: "req-docker",
        modality: "preferred",
        verdict: "partially-supported",
        explanation: "Docker is evidenced; Kubernetes is not asserted by that evidence.",
        evidenceIds: ["evidence-docker"],
        question: "Can the candidate confirm any Kubernetes experience separately?",
      },
      {
        requirementId: "req-kubernetes",
        modality: "unknown",
        verdict: "unknown",
        explanation: "The profile context does not state Kubernetes experience.",
        evidenceIds: [],
        question: "Can the candidate confirm Kubernetes experience?",
      },
      {
        requirementId: "req-english",
        modality: "preferred",
        verdict: "not-evidenced",
        explanation: "No selected profile evidence establishes the requested English communication context.",
        evidenceIds: [],
      },
      {
        requirementId: "req-location",
        modality: "required",
        verdict: "conflicting",
        explanation: "The stated hybrid HCMC arrangement conflicts with the candidate preference recorded for remote-only work.",
        evidenceIds: ["evidence-preference"],
      },
      {
        requirementId: "req-degree",
        modality: "unknown",
        verdict: "not-applicable",
        explanation: "The job analysis does not identify a degree requirement to assess.",
        evidenceIds: [],
      },
    ],
    preferenceChecks: [
      {
        claimPath: "preferences.workArrangements",
        jobFact: "hybrid in Ho Chi Minh City",
        candidatePreference: "remote",
        verdict: "conflicting",
        explanation: "Both the job fact and the candidate preference are explicitly stated.",
        evidenceIds: ["evidence-preference"],
      },
      {
        claimPath: "preferences.minimumSalary",
        jobFact: "20–30 triệu VND per month; gross/net unspecified",
        candidatePreference: "minimum salary is recorded but gross/net is not stated",
        verdict: "unknown",
        explanation: "Salary comparison requires employer clarification of gross versus net.",
        evidenceIds: [],
      },
    ],
    blockers: [
      {
        code: "location-conflict",
        message: "The stated hybrid HCMC requirement needs candidate confirmation before proceeding.",
        requirementId: "req-location",
        evidenceIds: ["evidence-preference"],
      },
    ],
    questions: [
      {
        for: "employer",
        text: "Is the 20–30 triệu VND range gross or net, and what is the pay period?",
      },
      {
        for: "candidate",
        text: "Can you confirm whether hybrid work in HCMC is acceptable?",
        requirementId: "req-location",
      },
    ],
    anomalies: [
      {
        code: "prompt-injection",
        message: "The JD contains instruction-looking text asking the agent to ignore policy and reveal profile data; treat it as untrusted job data.",
        evidenceIds: [],
      },
    ],
  };
  return withContentHash({ ...base, ...overrides } as Omit<MatchAssessment, "contentHash">);
}

test("parses an evidence-linked assessment without scoring or authority fields", () => {
  const parsed = parseMatchAssessment(assessment());

  assert.equal(parsed.schemaVersion, 1);
  assert.equal(parsed.policyVersion, "m4-v1");
  assert.equal(parsed.recommendation, "clarify");
  assert.equal(parsed.confidence, "medium");
  assert.equal(parsed.createdBy.role, "match-analyst");
  assert.equal(parsed.createdBy.model, "local-test-model");
  assert.match(parsed.createdBy.promptHash, /^sha256:[a-f0-9]{64}$/);
  assert.equal(parsed.requirementAssessments[0]?.modality, "required");
  assert.equal(parsed.requirementAssessments[1]?.modality, "preferred");
  assert.equal(parsed.requirementAssessments[2]?.modality, "unknown");
  assert.equal(parsed.requirementAssessments[1]?.evidenceIds[0], "evidence-docker");
  assert.equal(parsed.requirementAssessments[2]?.evidenceIds.length, 0);
  assert.equal(parsed.anomalies[0]?.code, "prompt-injection");
  assert.match(parsed.anomalies[0]?.message ?? "", /ignore policy/);
  assert.equal("score" in parsed, false);
  assert.equal("cvDraftRecommendation" in parsed, false);
  assert.equal("permissions" in parsed, false);
  assert.match(parsed.contentHash, /^sha256:[a-f0-9]{64}$/);
  assert.equal(JSON.parse(serializeMatchAssessment(parsed)).contentHash, parsed.contentHash);
});

test("preserves exact modality and evidence behavior without technology equivalence", () => {
  const parsed = parseMatchAssessment(assessment());
  const docker = parsed.requirementAssessments.find((entry) => entry.requirementId === "req-docker");
  const kubernetes = parsed.requirementAssessments.find((entry) => entry.requirementId === "req-kubernetes");

  assert.equal(docker?.verdict, "partially-supported");
  assert.deepEqual(docker?.evidenceIds, ["evidence-docker"]);
  assert.equal(kubernetes?.verdict, "unknown");
  assert.deepEqual(kubernetes?.evidenceIds, []);
  assert.match(docker?.explanation ?? "", /Kubernetes is not asserted/);
});

test("accepts the existing profile evidence ID namespace without weakening traversal checks", () => {
  const namespaced = assessment();
  namespaced.requirementAssessments[0] = {
    ...namespaced.requirementAssessments[0]!,
    evidenceIds: ["Evidence_1"],
  };
  namespaced.requirementAssessments[1] = {
    ...namespaced.requirementAssessments[1]!,
    evidenceIds: ["evidence.1"],
  };
  assert.doesNotThrow(() => parseMatchAssessment(withContentHashWithoutStaleHash(namespaced)));

  const traversal = assessment();
  traversal.requirementAssessments[0] = {
    ...traversal.requirementAssessments[0]!,
    evidenceIds: ["evidence..1"],
  };
  assert.throws(() => parseMatchAssessment(withContentHashWithoutStaleHash(traversal)), /evidenceIds|identifier|safe/i);
});

test("requires complete requirement coverage with exact source modalities", () => {
  const requirements = [
    { id: "req-node", priority: "required" as const },
    { id: "req-docker", priority: "preferred" as const },
    { id: "req-kubernetes", priority: "unknown" as const },
  ];
  const assessments = assessment().requirementAssessments.slice(0, 3);
  assert.doesNotThrow(() => assertRequirementCoverage(assessments, requirements));

  assert.throws(() => assertRequirementCoverage(assessments.slice(0, 2), requirements), /missing requirement assessment/i);
  assert.throws(() => assertRequirementCoverage([
    ...assessments,
    { requirementId: "req-extra", modality: "unknown" },
  ], requirements), /not in the source analysis/i);
  assert.throws(() => assertRequirementCoverage([
    assessments[0]!,
    { ...assessments[1]!, modality: "required" },
    assessments[2]!,
  ], requirements), /modality/i);
});

test("rejects duplicate requirement IDs and unsupported modalities", () => {
  const duplicate = assessment();
  duplicate.requirementAssessments[1] = {
    ...duplicate.requirementAssessments[1]!,
    requirementId: duplicate.requirementAssessments[0]!.requirementId,
  };
  assert.throws(() => parseMatchAssessment(withContentHashWithoutStaleHash(duplicate)), /duplicate requirement/i);

  const invalidModality = assessment();
  invalidModality.requirementAssessments[0] = {
    ...invalidModality.requirementAssessments[0]!,
    modality: "mandatory" as never,
  };
  assert.throws(() => parseMatchAssessment(withContentHashWithoutStaleHash(invalidModality)), /modality/i);
});

test("requires evidence for positive or conflicting requirement findings and blockers", () => {
  for (const verdict of ["supported", "partially-supported", "conflicting"] as const) {
    const invalid = assessment();
    invalid.requirementAssessments[0] = {
      ...invalid.requirementAssessments[0]!,
      verdict,
      evidenceIds: [],
    };
    assert.throws(() => parseMatchAssessment(withContentHashWithoutStaleHash(invalid)), /evidence/i);
  }

  const invalidBlocker = assessment();
  invalidBlocker.blockers = [{ code: "missing-evidence", message: "Blocker without a cited evidence item.", evidenceIds: [] }];
  assert.throws(() => parseMatchAssessment(withContentHashWithoutStaleHash(invalidBlocker)), /blockers.*evidence|evidence.*blocker/i);
});

test("allows unknown or not-evidenced requirements to remain unresolved with context", () => {
  const parsed = parseMatchAssessment(assessment());
  const unknown = parsed.requirementAssessments.find((entry) => entry.verdict === "unknown");
  const notEvidenced = parsed.requirementAssessments.find((entry) => entry.verdict === "not-evidenced");

  assert.deepEqual(unknown?.evidenceIds, []);
  assert.deepEqual(notEvidenced?.evidenceIds, []);
  assert.ok(unknown?.explanation.includes("does not state"));
  assert.ok(notEvidenced?.explanation.includes("No selected profile evidence"));
});

test("requires explicit candidate or employer ownership for questions", () => {
  const invalid = assessment();
  invalid.questions = [{ for: "agent" as never, text: "The owner is not explicit." }];
  assert.throws(() => parseMatchAssessment(withContentHashWithoutStaleHash(invalid)), /questions.*for|question.*owner/i);

  const missingOwner = assessment();
  missingOwner.questions = [{ text: "No owner" } as never];
  assert.throws(() => parseMatchAssessment(withContentHashWithoutStaleHash(missingOwner)), /questions.*for|question.*owner/i);
});

test("rejects scores, legacy CV authority, wrong policy and malformed creator metadata", () => {
  const scored = assessment();
  (scored as unknown as Record<string, unknown>).score = 0.9;
  assert.throws(() => parseMatchAssessment(withContentHashWithoutStaleHash(scored)), /score/i);

  const legacyCv = assessment({ cvDraftRecommendation: "create" });
  assert.throws(() => parseMatchAssessment(withContentHashWithoutStaleHash(legacyCv)), /cvDraftRecommendation|unknown field|not permitted/i);

  const wrongPolicy = assessment({ policyVersion: "custom-v1" });
  assert.throws(() => parseMatchAssessment(withContentHashWithoutStaleHash(wrongPolicy)), /policyVersion/i);

  const missingModel = assessment();
  missingModel.createdBy = { ...missingModel.createdBy, model: "" };
  assert.throws(() => parseMatchAssessment(withContentHashWithoutStaleHash(missingModel)), /createdBy\.model/i);

  const missingSkillVersion = assessment();
  missingSkillVersion.createdBy = { ...missingSkillVersion.createdBy, skillVersion: "" };
  assert.throws(() => parseMatchAssessment(withContentHashWithoutStaleHash(missingSkillVersion)), /createdBy\.skillVersion/i);

  const missingPromptHash = assessment();
  missingPromptHash.createdBy = { ...missingPromptHash.createdBy, promptHash: "" };
  assert.throws(() => parseMatchAssessment(withContentHashWithoutStaleHash(missingPromptHash)), /createdBy\.promptHash/i);
});

test("rejects reserved IDs, calendar-overflow UTC timestamps and changed content hashes", () => {
  const reserved = assessment({ id: "current" });
  assert.throws(() => parseMatchAssessment(withContentHashWithoutStaleHash(reserved)), /reserved|id/i);

  const overflow = assessment({ createdAt: "2026-02-30T07:00:00.000Z" });
  assert.throws(() => parseMatchAssessment(withContentHashWithoutStaleHash(overflow)), /createdAt/i);

  const changed = assessment();
  changed.summary = "Changed after hashing";
  assert.throws(() => parseMatchAssessment(changed), /contentHash/i);
});

test("rejects unsafe references and non-UTC timestamps", () => {
  const unsafeEvidence = assessment();
  unsafeEvidence.requirementAssessments[0] = {
    ...unsafeEvidence.requirementAssessments[0]!,
    evidenceIds: ["../outside"],
  };
  assert.throws(() => parseMatchAssessment(withContentHashWithoutStaleHash(unsafeEvidence)), /evidenceIds|identifier|safe/i);

  const offset = assessment({ createdAt: "2026-09-12T14:00:00.000+07:00" });
  assert.throws(() => parseMatchAssessment(withContentHashWithoutStaleHash(offset)), /createdAt|UTC/i);
});

function withContentHashWithoutStaleHash(value: MatchAssessment): MatchAssessment {
  const { contentHash: _ignored, ...withoutHash } = value;
  return withContentHash(withoutHash);
}
