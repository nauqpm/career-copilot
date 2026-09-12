import assert from "node:assert/strict";
import { mkdtemp, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { contentHash, readArtifact } from "../src/workspace/artifacts.js";
import { createLocalJob } from "../src/workspace/storage.js";
import { publishAnalysisRevision } from "../src/job/analysis-storage.js";
import { publishProfileRevision } from "../src/profile/storage.js";
import { readMatchContext } from "../src/match/context.js";

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
  return { root, job, directory, analysis, publishedProfile, sourceArtifact, manifestArtifact };
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
