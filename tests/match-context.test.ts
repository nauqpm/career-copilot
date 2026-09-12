import assert from "node:assert/strict";
import { mkdtemp, readFile, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { contentHash, readArtifact } from "../src/workspace/artifacts.js";
import { createLocalJob } from "../src/workspace/storage.js";
import { publishAnalysisRevision } from "../src/job/analysis-storage.js";
import { publishProfileRevision } from "../src/profile/storage.js";
import { readExactMatchAnalysis, readMatchContext, readProfileEvidence, readProfileEvidenceWithHashes, readVerifiedMatchCapture } from "../src/match/context.js";
import { hashMatchAssessment, type MatchAssessment } from "../src/match/schema.js";
import { saveMatchAssessment } from "../src/match/storage.js";

const source = [
  "Backend Engineer / Kỹ sư Backend",
  "Requirements / Yêu cầu:",
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
  const root = await mkdtemp(join(tmpdir(), "career-match-context-"));
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
  const evidence = await readProfileEvidenceWithHashes(root, publishedProfile.revision);
  return { root, job, directory, analysis, publishedProfile, sourceArtifact, manifestArtifact, evidenceBindings: evidence.bindings };
}

test("returns a ready context from the verified capture, current analysis, and published profile", async () => {
  const state = await fixture();

  const context = await readMatchContext(state.root, state.job.id);

  assert.equal(context.status, "ready");
  if (context.status !== "ready") return;
  assert.equal(context.policyVersion, "m4-v1");
  assert.equal(context.job.id, state.analysis.revision.id);
  assert.equal(context.profile.id, state.publishedProfile.revision.id);
  assert.ok(context.evidence.length > 0);
  assert.equal(new Set(context.evidence.map((item) => item.id)).size, context.evidence.length);
});

test("binds a context-built assessment to the exact analysis and profile artifacts", async () => {
  const state = await fixture();
  const context = await readMatchContext(state.root, state.job.id);

  assert.equal(context.status, "ready");
  if (context.status !== "ready") return;

  const base: Omit<MatchAssessment, "contentHash"> = {
    schemaVersion: 2,
    id: "assessment-from-context",
    createdAt: "2026-09-12T07:00:00.000Z",
    createdBy: {
      kind: "agent",
      role: "match-analyst",
      skillVersion: "assess-job@1",
      model: "local-test-model",
      promptHash: hash("assessment-prompt"),
    },
    jobRef: {
      jobId: context.job.jobId,
      captureId: context.job.capture.id,
      captureHash: context.job.capture.manifestHash,
      sourceHash: context.job.capture.sourceHash,
      analysisId: context.job.id,
      analysisHash: context.analysisHash,
    },
    profileRef: { revisionId: context.profile.id, revisionHash: context.profileRevisionHash, evidence: context.evidenceBindings },
    policyVersion: "m4-v1",
    recommendation: "consider",
    confidence: "high",
    summary: "The exact context artifacts have been reviewed.",
    requirementAssessments: context.job.analysis.requirements.map((requirement) => ({
      requirementId: requirement.id,
      modality: requirement.priority ?? "unknown",
      verdict: "unknown" as const,
      explanation: "The selected context does not establish this requirement.",
      evidenceIds: [],
    })),
    preferenceChecks: [],
    blockers: [],
    questions: [],
    anomalies: [],
  };
  const assessment: MatchAssessment = { ...base, contentHash: hashMatchAssessment(base) };

  const saved = await saveMatchAssessment(state.root, state.job.id, assessment, null);

  assert.equal(saved.assessment.jobRef.analysisHash, context.analysisHash);
  assert.equal(saved.assessment.profileRef.revisionHash, context.profileRevisionHash);
});

test("does not fall back when an explicit profile revision is unknown", async () => {
  const state = await fixture();

  const context = await readMatchContext(state.root, state.job.id, "profile-missing");

  assert.equal(context.status, "blocked");
  if (context.status !== "blocked") return;
  assert.ok(context.remediation.some((item) => /profile.*revision/i.test(`${item.code} ${item.message}`)));
});

test("blocks legacy-only profiles and analyses instead of selecting compatibility artifacts", async () => {
  const state = await fixture();
  await unlink(join(state.directory, "analyses", "current.json"));

  const context = await readMatchContext(state.root, state.job.id);

  assert.equal(context.status, "blocked");
  if (context.status !== "blocked") return;
  assert.ok(context.remediation.some((item) => /analysis/i.test(`${item.code} ${item.message}`)));

  const profileRoot = await mkdtemp(join(tmpdir(), "career-match-context-legacy-"));
  const legacyJob = await createLocalJob(profileRoot, { content: source, sourceKind: "pasted-text" });
  const legacyContext = await readMatchContext(profileRoot, legacyJob.id);
  assert.equal(legacyContext.status, "blocked");
  if (legacyContext.status === "blocked") assert.ok(legacyContext.remediation.some((item) => /analysis|profile/i.test(`${item.code} ${item.message}`)));
});

test("blocks corrupt captures and corrupt referenced evidence with actionable remediation", async () => {
  const state = await fixture();
  await writeFile(join(state.directory, "source.md"), `${source} changed`, "utf8");

  const corruptCapture = await readMatchContext(state.root, state.job.id);
  assert.equal(corruptCapture.status, "blocked");
  if (corruptCapture.status === "blocked") assert.ok(corruptCapture.remediation.some((item) => /capture|source/i.test(`${item.code} ${item.message}`)));

  const healthy = await fixture();
  const evidenceId = healthy.publishedProfile.revision.claimEvidence[0]!.evidenceIds[0]!;
  await writeFile(join(healthy.root, "data", "profile", "evidence", `${evidenceId}.json`), "{broken", "utf8");
  const corruptEvidence = await readMatchContext(healthy.root, healthy.job.id);
  assert.equal(corruptEvidence.status, "blocked");
  if (corruptEvidence.status === "blocked") assert.ok(corruptEvidence.remediation.some((item) => /evidence|profile/i.test(`${item.code} ${item.message}`)));
});

test("fails closed for direct capture, analysis and evidence binding errors", async () => {
  const invalidRaw = await fixture();
  await writeFile(join(invalidRaw.directory, "raw.json"), "{}\n", "utf8");
  await assert.rejects(readVerifiedMatchCapture(invalidRaw.root, invalidRaw.job.id), /capture binding/i);

  const mismatchedRaw = await fixture();
  const mismatchedRawPath = join(mismatchedRaw.directory, "raw.json");
  const raw = JSON.parse(await readFile(mismatchedRawPath, "utf8")) as { capture: { id: string } };
  raw.capture.id = "other-job";
  await writeFile(mismatchedRawPath, `${JSON.stringify(raw)}\n`, "utf8");
  await assert.rejects(readVerifiedMatchCapture(mismatchedRaw.root, mismatchedRaw.job.id), /capture/i);

  const wrongSourceMetadata = await fixture();
  const wrongSourcePath = join(wrongSourceMetadata.directory, "raw.json");
  const wrongSourceRaw = JSON.parse(await readFile(wrongSourcePath, "utf8")) as { source: { value: string } };
  wrongSourceRaw.source.value = "different source metadata";
  await writeFile(wrongSourcePath, `${JSON.stringify(wrongSourceRaw)}\n`, "utf8");
  await assert.rejects(readVerifiedMatchCapture(wrongSourceMetadata.root, wrongSourceMetadata.job.id), /source metadata/i);

  const invalidAnalysis = await fixture();
  await writeFile(join(invalidAnalysis.directory, "analyses", "analysis-one.json"), "{broken", "utf8");
  await assert.rejects(readExactMatchAnalysis(invalidAnalysis.root, invalidAnalysis.job.id, "analysis-one"), /analysis revision/i);

  const mismatchedAnalysis = await fixture();
  const analysisPath = join(mismatchedAnalysis.directory, "analyses", "analysis-one.json");
  const analysisValue = JSON.parse(await readFile(analysisPath, "utf8")) as Record<string, unknown>;
  analysisValue.capture = { ...(analysisValue.capture as Record<string, unknown>), manifestHash: hash("different manifest") };
  const { contentHash: _ignored, ...analysisWithoutHash } = analysisValue;
  analysisValue.contentHash = hash(JSON.stringify(analysisWithoutHash));
  await writeFile(analysisPath, `${JSON.stringify(analysisValue)}\n`, "utf8");
  await assert.rejects(readExactMatchAnalysis(mismatchedAnalysis.root, mismatchedAnalysis.job.id, "analysis-one"), /capture|manifest/i);

  const invalidProfileId = await fixture();
  await assert.rejects(readMatchContext(invalidProfileId.root, invalidProfileId.job.id, "../outside"), /profile revision ID/i);

  const wrongEvidence = await fixture();
  const evidenceId = wrongEvidence.publishedProfile.revision.claimEvidence[0]!.evidenceIds[0]!;
  const evidencePath = join(wrongEvidence.root, "data", "profile", "evidence", `${evidenceId}.json`);
  const evidenceValue = JSON.parse(await readFile(evidencePath, "utf8")) as Record<string, unknown>;
  evidenceValue.id = "different-evidence";
  const { contentHash: _ignoredEvidenceHash, ...evidenceWithoutHash } = evidenceValue;
  evidenceValue.contentHash = hash(JSON.stringify(evidenceWithoutHash));
  await writeFile(evidencePath, `${JSON.stringify(evidenceValue)}\n`, "utf8");
  await assert.rejects(readProfileEvidence(wrongEvidence.root, wrongEvidence.publishedProfile.revision), /evidence.*ID|filename/i);
});
