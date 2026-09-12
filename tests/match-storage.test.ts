import assert from "node:assert/strict";
import { mkdtemp, readFile, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { contentHash, ConflictError, readArtifact, writeArtifact } from "../src/workspace/artifacts.js";
import { createLocalJob } from "../src/workspace/storage.js";
import { publishAnalysisRevision } from "../src/job/analysis-storage.js";
import { publishProfileRevision } from "../src/profile/storage.js";
import { hashMatchAssessment, type MatchAssessment } from "../src/match/schema.js";
import { readProfileEvidenceWithHashes } from "../src/match/context.js";
import {
  assessmentFreshness,
  readCurrentMatch,
  readMatchHistory,
  saveMatchAssessment,
} from "../src/match/storage.js";

const source = [
  "Backend Engineer",
  "Requirements:",
  "- Build Node.js services.",
  "- English communication is preferred.",
].join("\r\n");

const profile = {
  experience: [{ title: "Backend developer", highlights: ["Built APIs"] }],
  skills: ["Node.js"],
  education: [],
  languages: [],
  preferences: { workArrangements: ["hybrid"] as const },
};

function locator(quote: string) {
  const start = source.indexOf(quote);
  assert.notEqual(start, -1, `fixture quote is missing: ${quote}`);
  return { start, end: start + quote.length, quote };
}

function hash(value: string | Buffer): string {
  return contentHash(value);
}

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "career-match-storage-"));
  const job = await createLocalJob(root, { content: source, sourceKind: "pasted-text", sourceReference: "Synthetic fixture" });
  const directory = join(root, "data", "jobs", job.id);
  const sourceArtifact = (await readArtifact(join(directory, "source.md")))!;
  const manifestArtifact = (await readArtifact(join(directory, "source.json")))!;
  const analysisBase = {
    schemaVersion: 1 as const,
    id: "analysis-one",
    createdAt: "2026-09-12T06:00:00.000Z",
    createdBy: {
      kind: "agent" as const,
      role: "job-analyst" as const,
      skillVersion: "analyze-job@1",
      model: "local-test-model",
      promptHash: hash("analysis-prompt"),
    },
    contentHash: "",
    jobId: job.id,
    capture: { id: job.id, manifestHash: manifestArtifact.hash, sourceHash: sourceArtifact.hash },
    analysis: {
      title: "Backend Engineer",
      requirements: [
        { category: "skill" as const, statement: "Build Node.js services.", priority: "required" as const, id: "req-node", source: locator("Build Node.js services.") },
        { category: "language" as const, statement: "English communication is preferred.", priority: "preferred" as const, id: "req-english", source: locator("English communication is preferred.") },
      ],
      responsibilities: ["Build backend services."],
      compensation: { salaryStatus: "not-stated" as const },
    },
  };
  const { contentHash: _ignored, ...withoutHash } = analysisBase;
  const analysis = await publishAnalysisRevision(root, job.id, { ...analysisBase, contentHash: hash(JSON.stringify(withoutHash)) }, null);
  const publishedProfile = await publishProfileRevision(root, profile, null, { confirmed: true });
  const evidenceId = publishedProfile.revision.claimEvidence.find((claim) => claim.claimPath === "skills[0]")!.evidenceIds[0]!;
  const evidence = await readProfileEvidenceWithHashes(root, publishedProfile.revision);
  return { root, job, directory, analysis, publishedProfile, sourceArtifact, manifestArtifact, evidenceId, evidenceBindings: evidence.bindings };
}

function assessmentFor(state: Awaited<ReturnType<typeof fixture>>, id = "assessment-one"): MatchAssessment {
  const base: Omit<MatchAssessment, "contentHash"> = {
    schemaVersion: 2,
    id,
    createdAt: "2026-09-12T07:00:00.000Z",
    createdBy: {
      kind: "agent",
      role: "match-analyst",
      skillVersion: "assess-job@1",
      model: "local-test-model",
      promptHash: hash("assessment-prompt"),
    },
    jobRef: {
      jobId: state.job.id,
      captureId: state.job.id,
      captureHash: state.manifestArtifact.hash,
      sourceHash: state.sourceArtifact.hash,
      analysisId: state.analysis.revision.id,
      analysisHash: state.analysis.revisionHash,
    },
    profileRef: { revisionId: state.publishedProfile.revision.id, revisionHash: state.publishedProfile.revisionHash, evidence: state.evidenceBindings },
    policyVersion: "m4-v1",
    recommendation: "consider",
    confidence: "high",
    summary: "The exact source and selected profile have been reviewed.",
    requirementAssessments: [
      { requirementId: "req-node", modality: "required", verdict: "supported", explanation: "The selected profile has the exact Node.js evidence item.", evidenceIds: [state.evidenceId] },
      { requirementId: "req-english", modality: "preferred", verdict: "unknown", explanation: "The selected profile does not establish the requested communication context.", evidenceIds: [] },
    ],
    preferenceChecks: [
      { claimPath: "preferences.workArrangements[0]", jobFact: "not stated", candidatePreference: "hybrid", verdict: "unknown", explanation: "The job does not state an arrangement.", evidenceIds: [] },
    ],
    blockers: [],
    questions: [],
    anomalies: [],
  };
  return { ...base, contentHash: hashMatchAssessment(base) };
}

function withChangedHash(assessment: MatchAssessment, changes: Partial<MatchAssessment>): MatchAssessment {
  const next = { ...assessment, ...changes } as Omit<MatchAssessment, "contentHash">;
  const { contentHash: _ignored, ...withoutHash } = next as MatchAssessment;
  return { ...next, contentHash: hashMatchAssessment(withoutHash) };
}

test("saves an immutable assessment and exposes the active pointer and history", async () => {
  const state = await fixture();
  const first = await saveMatchAssessment(state.root, state.job.id, assessmentFor(state), null);
  const firstBytes = await readFile(join(state.directory, "assessments", "assessment-one.json"), "utf8");

  assert.equal(first.assessment.id, "assessment-one");
  assert.equal((await readCurrentMatch(state.root, state.job.id))?.assessment.id, "assessment-one");

  const secondAssessment = withChangedHash(assessmentFor(state, "assessment-two"), { summary: "A newer local assessment." });
  const second = await saveMatchAssessment(state.root, state.job.id, secondAssessment, first.pointerHash);
  assert.equal(await readFile(join(state.directory, "assessments", "assessment-one.json"), "utf8"), firstBytes);
  assert.equal((await readCurrentMatch(state.root, state.job.id))?.assessment.id, "assessment-two");

  const history = await readMatchHistory(state.root, state.job.id);
  assert.deepEqual(history.assessments.map((entry) => entry.id), ["assessment-one", "assessment-two"]);
  assert.equal(history.assessments.find((entry) => entry.id === "assessment-one")?.active, false);
  assert.equal(history.assessments.find((entry) => entry.id === "assessment-two")?.active, true);
  assert.equal(history.current?.assessmentId, "assessment-two");
  assert.match(second.pointerHash, /^sha256:[a-f0-9]{64}$/);
});

test("leaves a valid orphan when the expected current pointer is stale", async () => {
  const state = await fixture();
  const first = await saveMatchAssessment(state.root, state.job.id, assessmentFor(state), null);
  const pointerBytes = await readFile(join(state.directory, "assessments", "current.json"), "utf8");

  await assert.rejects(
    saveMatchAssessment(state.root, state.job.id, assessmentFor(state, "assessment-stale"), contentHash("wrong-pointer")),
    ConflictError,
  );
  assert.equal(await readFile(join(state.directory, "assessments", "current.json"), "utf8"), pointerBytes);
  assert.equal((await readCurrentMatch(state.root, state.job.id))?.assessment.id, first.assessment.id);
  assert.ok(await readArtifact(join(state.directory, "assessments", "assessment-stale.json")));
});

test("rejects the reserved current assessment ID before writing an artifact", async () => {
  const state = await fixture();
  await assert.rejects(saveMatchAssessment(state.root, state.job.id, { ...assessmentFor(state), id: "current" }, null), /reserved|current/i);
  assert.equal(await readArtifact(join(state.directory, "assessments", "current.json")), undefined);
});

test("rejects references that do not match the exact analysis, evidence, profile, or live capture", async () => {
  const state = await fixture();
  const assessment = assessmentFor(state);

  const extraRequirement = withChangedHash(assessment, {
    requirementAssessments: [
      ...assessment.requirementAssessments,
      { requirementId: "req-extra", modality: "unknown", verdict: "unknown", explanation: "Not in source.", evidenceIds: [] },
    ],
  });
  await assert.rejects(saveMatchAssessment(state.root, state.job.id, extraRequirement, null), /requirement|analysis/i);

  const missingEvidence = withChangedHash(assessment, {
    requirementAssessments: [{ ...assessment.requirementAssessments[0]!, evidenceIds: ["evidence-missing"] }, assessment.requirementAssessments[1]!],
  });
  await assert.rejects(saveMatchAssessment(state.root, state.job.id, missingEvidence, null), /evidence/i);

  const badPreference = withChangedHash(assessment, {
    preferenceChecks: [{ ...assessment.preferenceChecks[0]!, claimPath: "preferences.unknown" }],
  });
  await assert.rejects(saveMatchAssessment(state.root, state.job.id, badPreference, null), /preference|claim/i);

  const badHash = withChangedHash(assessment, { jobRef: { ...assessment.jobRef, sourceHash: hash("changed-source") } });
  await assert.rejects(saveMatchAssessment(state.root, state.job.id, badHash, null), /source|hash|capture/i);
  assert.equal(await readArtifact(join(state.directory, "assessments", "current.json")), undefined);
});

test("isolates malformed or renamed orphan files and fails closed for a dangling current pointer", async () => {
  const state = await fixture();
  await saveMatchAssessment(state.root, state.job.id, assessmentFor(state), null);
  await writeArtifact(join(state.directory, "assessments", "bad.json"), "{broken", null);
  await writeArtifact(join(state.directory, "assessments", "wrong-name.json"), JSON.stringify(assessmentFor(state, "assessment-renamed")) + "\n", null);
  await writeFile(join(state.directory, "assessments", "current.json"), JSON.stringify({ schemaVersion: 1, assessmentId: "assessment-missing", assessmentHash: hash("missing") }) + "\n", "utf8");

  await assert.rejects(readCurrentMatch(state.root, state.job.id), /missing|changed|assessment|pointer/i);
  const history = await readMatchHistory(state.root, state.job.id);
  assert.deepEqual(history.assessments.map((entry) => entry.id), ["assessment-one"]);
  assert.equal(history.current, undefined);
});

test("propagates safe-path errors from assessment history entries", async () => {
  const state = await fixture();
  await saveMatchAssessment(state.root, state.job.id, assessmentFor(state), null);
  const outside = join(state.root, "outside-assessment.json");
  await writeFile(outside, "{broken", "utf8");
  await symlink(outside, join(state.directory, "assessments", "linked.json"));

  await assert.rejects(readMatchHistory(state.root, state.job.id), /symbolic link|unsafe/i);
});

test("marks prior snapshots stale when profile, analysis, policy, or source changes without rewriting them", async () => {
  const state = await fixture();
  const assessment = assessmentFor(state);
  const saved = await saveMatchAssessment(state.root, state.job.id, assessment, null);
  const assessmentBytes = await readFile(join(state.directory, "assessments", "assessment-one.json"), "utf8");

  assert.deepEqual(await assessmentFreshness(state.root, assessment), { status: "current", reasons: [] });

  await publishProfileRevision(state.root, { ...profile, headline: "Platform engineer" }, state.publishedProfile.revisionHash, { confirmed: true });
  const profileStale = await assessmentFreshness(state.root, assessment);
  assert.equal(profileStale.status, "stale");
  assert.ok(profileStale.reasons.some((reason) => /profile/i.test(reason)));

  const analysisBase = {
    schemaVersion: 1 as const,
    id: "analysis-two",
    createdAt: "2026-09-12T08:00:00.000Z",
    createdBy: { kind: "agent" as const, role: "job-analyst" as const, skillVersion: "analyze-job@1", model: "local-test-model", promptHash: hash("analysis-prompt-two") },
    contentHash: "",
    jobId: state.job.id,
    capture: { id: state.job.id, manifestHash: state.manifestArtifact.hash, sourceHash: state.sourceArtifact.hash },
    analysis: {
      title: "Backend Engineer v2",
      requirements: [
        { category: "skill" as const, statement: "Build Node.js services.", priority: "required" as const, id: "req-node", source: locator("Build Node.js services.") },
        { category: "language" as const, statement: "English communication is preferred.", priority: "preferred" as const, id: "req-english", source: locator("English communication is preferred.") },
      ],
      responsibilities: ["Build backend services."],
      compensation: { salaryStatus: "not-stated" as const },
    },
  };
  const { contentHash: _ignored, ...analysisWithoutHash } = analysisBase;
  await publishAnalysisRevision(state.root, state.job.id, { ...analysisBase, contentHash: hash(JSON.stringify(analysisWithoutHash)) }, state.analysis.pointerHash);
  const analysisStale = await assessmentFreshness(state.root, assessment);
  assert.equal(analysisStale.status, "stale");
  assert.ok(analysisStale.reasons.some((reason) => /analysis/i.test(reason)));

  const priorPolicy = { ...assessment, policyVersion: "prior-policy" as never } as MatchAssessment;
  const policyStale = await assessmentFreshness(state.root, priorPolicy);
  assert.equal(policyStale.status, "stale");
  assert.ok(policyStale.reasons.some((reason) => /policy/i.test(reason)));

  await writeFile(join(state.directory, "source.md"), `${source} changed`, "utf8");
  const captureStale = await assessmentFreshness(state.root, assessment);
  assert.equal(captureStale.status, "needs-repair");
  assert.ok(captureStale.reasons.some((reason) => /repair|capture|source/i.test(reason)));
  assert.equal(await readFile(join(state.directory, "assessments", "assessment-one.json"), "utf8"), assessmentBytes);
  assert.match(saved.assessmentHash, /^sha256:/);
});
