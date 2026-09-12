import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, stat, unlink, writeFile } from "node:fs/promises";
import { once } from "node:events";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { runCli, type CliIo } from "../src/cli.js";
import { createWorkspaceServer } from "../src/web/server.js";
import { publishAnalysisRevision } from "../src/job/analysis-storage.js";
import { publishProfileRevision } from "../src/profile/storage.js";
import { hashMatchAssessment, type MatchAssessment } from "../src/match/schema.js";
import { readCurrentMatch, saveMatchAssessment } from "../src/match/storage.js";
import { createLocalJob } from "../src/workspace/storage.js";
import { contentHash, readArtifact } from "../src/workspace/artifacts.js";

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

function hash(value: string | Buffer): string {
  return contentHash(value);
}

function locator(quote: string) {
  const start = source.indexOf(quote);
  assert.notEqual(start, -1, `fixture quote is missing: ${quote}`);
  return { start, end: start + quote.length, quote };
}

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "career-m4-flow-"));
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
  return { root, job, directory, analysis, publishedProfile, sourceArtifact, manifestArtifact, evidenceId };
}

function assessmentFor(state: Awaited<ReturnType<typeof fixture>>, id = "assessment-one"): MatchAssessment {
  const base: Omit<MatchAssessment, "contentHash"> = {
    schemaVersion: 1,
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
    profileRef: { revisionId: state.publishedProfile.revision.id, revisionHash: state.publishedProfile.revisionHash },
    policyVersion: "m4-v1",
    recommendation: "consider",
    confidence: "high",
    summary: "The exact source and selected profile have been reviewed.",
    requirementAssessments: [
      { requirementId: "req-node", modality: "required", verdict: "supported", explanation: "The selected profile has the exact Node.js evidence item.", evidenceIds: [state.evidenceId] },
      { requirementId: "req-english", modality: "preferred", verdict: "unknown", explanation: "The selected profile does not establish the requested communication context.", evidenceIds: [] },
    ],
    preferenceChecks: [],
    blockers: [],
    questions: [],
    anomalies: [],
  };
  return { ...base, contentHash: hashMatchAssessment(base) };
}

function changedAssessment(assessment: MatchAssessment, id: string): MatchAssessment {
  const { contentHash: _ignored, ...withoutHash } = { ...assessment, id };
  return { ...withoutHash, contentHash: hashMatchAssessment(withoutHash) };
}

function io(): { value: CliIo; stdout: string[]; stderr: string[] } {
  const stdout: string[] = [];
  const stderr: string[] = [];
  return { value: { writeStdout: (chunk) => stdout.push(chunk), writeStderr: (chunk) => stderr.push(chunk), readStdin: async () => "" }, stdout, stderr };
}

async function startTestServer(root: string) {
  const server = createWorkspaceServer({ root, port: 0 });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address() as { port: number };
  return { url: `http://127.0.0.1:${address.port}`, close: () => new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())) };
}

test("match context CLI emits the selected profile and exact artifact hashes", async () => {
  const state = await fixture();
  const capture = io();

  const code = await runCli(["match", "context", state.job.id, "--root", state.root, "--profile-revision", state.publishedProfile.revision.id], capture.value);

  assert.equal(code, 0);
  const context = JSON.parse(capture.stdout.join("")) as { status: string; profile: { id: string }; analysisHash: string; profileRevisionHash: string };
  assert.equal(context.status, "ready");
  assert.equal(context.profile.id, state.publishedProfile.revision.id);
  assert.equal(context.analysisHash, state.analysis.revisionHash);
  assert.equal(context.profileRevisionHash, state.publishedProfile.revisionHash);
});

test("match context CLI returns a blocked remediation without falling back", async () => {
  const root = await mkdtemp(join(tmpdir(), "career-m4-blocked-"));
  const job = await createLocalJob(root, { content: source, sourceKind: "pasted-text" });
  const capture = io();

  const code = await runCli(["match", "context", job.id, "--root", root], capture.value);

  assert.equal(code, 0);
  const context = JSON.parse(capture.stdout.join("")) as { status: string; remediation: unknown[] };
  assert.equal(context.status, "blocked");
  assert.ok(context.remediation.length > 0);
});

test("match validate parses structure only and does not write an assessment", async () => {
  const state = await fixture();
  const assessmentPath = join(state.root, "assessment.json");
  await writeFile(assessmentPath, `${JSON.stringify(assessmentFor(state), null, 2)}\n`, "utf8");
  const capture = io();

  const code = await runCli(["match", "validate", assessmentPath], capture.value);

  assert.equal(code, 0);
  assert.equal((JSON.parse(capture.stdout.join("")) as MatchAssessment).id, "assessment-one");
  await assert.rejects(stat(join(state.directory, "assessments")));
  assert.match(capture.stderr.join(""), /live|publish/i);
});

test("match publish preserves the active pointer when its expected hash conflicts", async () => {
  const state = await fixture();
  const firstPath = join(state.root, "assessment-one.json");
  await writeFile(firstPath, `${JSON.stringify(assessmentFor(state), null, 2)}\n`, "utf8");
  const firstIo = io();
  assert.equal(await runCli(["match", "publish", state.job.id, firstPath, "--root", state.root, "--expected-hash", "missing"], firstIo.value), 0);
  const before = await readCurrentMatch(state.root, state.job.id);
  assert.ok(before);
  const pointerBytes = await readFile(join(state.directory, "assessments", "current.json"), "utf8");

  const secondPath = join(state.root, "assessment-two.json");
  await writeFile(secondPath, `${JSON.stringify(changedAssessment(assessmentFor(state), "assessment-two"), null, 2)}\n`, "utf8");
  const secondIo = io();
  const code = await runCli(["match", "publish", state.job.id, secondPath, "--root", state.root, "--expected-hash", hash("stale")], secondIo.value);

  assert.equal(code, 1);
  assert.equal(await readFile(join(state.directory, "assessments", "current.json"), "utf8"), pointerBytes);
  assert.equal((await readCurrentMatch(state.root, state.job.id))?.assessment.id, before.assessment.id);
  assert.doesNotMatch(secondIo.stderr.join(""), new RegExp(state.root.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
});

test("assessment read APIs expose quoted pointer/artifact ETags and freshness", async () => {
  const state = await fixture();
  const saved = await saveMatchAssessment(state.root, state.job.id, assessmentFor(state), null);
  const app = await startTestServer(state.root);

  try {
    const contextResponse = await fetch(`${app.url}/api/jobs/${encodeURIComponent(state.job.id)}/match-context?profileRevision=${encodeURIComponent(state.publishedProfile.revision.id)}`);
    assert.equal(contextResponse.status, 200);
    assert.equal((await contextResponse.json() as { profile: { id: string } }).profile.id, state.publishedProfile.revision.id);

    const historyResponse = await fetch(`${app.url}/api/jobs/${encodeURIComponent(state.job.id)}/assessments`);
    assert.equal(historyResponse.status, 200);
    assert.equal(historyResponse.headers.get("etag"), `"${saved.pointerHash}"`);
    assert.deepEqual((await historyResponse.json() as { assessments: Array<{ id: string }> }).assessments.map((entry) => entry.id), ["assessment-one"]);

    const currentResponse = await fetch(`${app.url}/api/jobs/${state.job.id}/assessments/current`);
    assert.equal(currentResponse.status, 200);
    assert.equal(currentResponse.headers.get("etag"), `"${saved.pointerHash}"`);
    const current = await currentResponse.json() as { assessment: { id: string }; freshness: { stale: boolean } };
    assert.equal(current.assessment.id, "assessment-one");
    assert.deepEqual(current.freshness, { stale: false, reasons: [] });

    const detailResponse = await fetch(`${app.url}/api/jobs/${state.job.id}/assessments/assessment-one`);
    assert.equal(detailResponse.status, 200);
    assert.equal(detailResponse.headers.get("etag"), `"${saved.assessmentHash}"`);
    assert.equal((await detailResponse.json() as { assessment: { id: string } }).assessment.id, "assessment-one");

    const jobResponse = await fetch(`${app.url}/api/jobs/${state.job.id}`);
    assert.equal(jobResponse.status, 200);
    const job = await jobResponse.json() as { matchAssessment?: { status: string; id?: string }; matchAssessmentHistory?: Array<{ id: string }> };
    assert.equal(job.matchAssessment?.status, "current");
    assert.equal(job.matchAssessment?.id, "assessment-one");
    assert.deepEqual(job.matchAssessmentHistory?.map((entry) => entry.id), ["assessment-one"]);
  } finally {
    await app.close();
  }
});

test("read APIs use repair/absence statuses and generic non-leaking errors", async () => {
  const state = await fixture();
  const app = await startTestServer(state.root);

  try {
    const missing = await fetch(`${app.url}/api/jobs/${state.job.id}/assessments/current`);
    assert.equal(missing.status, 404);
    assert.deepEqual(await missing.json(), { error: "Not found" });

    const invalidQuery = await fetch(`${app.url}/api/jobs/${state.job.id}/match-context?profileRevision=../profile`);
    assert.equal(invalidQuery.status, 400);
    const invalidBody = await invalidQuery.json() as { error: string };
    assert.deepEqual(invalidBody, { error: "The supplied local data is invalid." });

    const missingDetail = await fetch(`${app.url}/api/jobs/${state.job.id}/assessments/missing`);
    assert.equal(missingDetail.status, 404);
    assert.deepEqual(await missingDetail.json(), { error: "Not found" });

    await mkdir(join(state.directory, "assessments"), { recursive: true });
    await writeFile(join(state.directory, "assessments", "current.json"), `${JSON.stringify({ schemaVersion: 1, assessmentId: "missing", assessmentHash: hash("missing") })}\n`, "utf8");
    const repair = await fetch(`${app.url}/api/jobs/${state.job.id}/assessments/current`);
    assert.equal(repair.status, 409);
    const repairBody = await repair.json() as { error: string };
    assert.deepEqual(repairBody, { error: "Assessment data needs repair before it can be read." });
    assert.doesNotMatch(JSON.stringify(repairBody), /career-m4-flow|profile|source\.md/i);
  } finally {
    await app.close();
  }
});

test("match-context keeps an ordinary unpublished preflight block as a readable state", async () => {
  const root = await mkdtemp(join(tmpdir(), "career-m4-blocked-api-"));
  const job = await createLocalJob(root, { content: source, sourceKind: "pasted-text" });
  const app = await startTestServer(root);

  try {
    const response = await fetch(`${app.url}/api/jobs/${encodeURIComponent(job.id)}/match-context`);
    assert.equal(response.status, 200);
    const body = await response.json() as { status: string; remediation: unknown[] };
    assert.equal(body.status, "blocked");
    assert.ok(body.remediation.length > 0);
  } finally {
    await app.close();
  }
});

test("match-context maps corrupt current and explicit profile data to generic repair", async () => {
  const state = await fixture();
  const profilePath = join(state.root, "data", "profile", "revisions", `${state.publishedProfile.revision.id}.json`);
  const currentPath = join(state.root, "data", "profile", "current.json");
  const profileBytes = await readFile(profilePath, "utf8");
  const app = await startTestServer(state.root);

  try {
    const unavailable = await fetch(`${app.url}/api/jobs/${state.job.id}/match-context?profileRevision=profile-missing`);
    assert.equal(unavailable.status, 200);
    const unavailableBody = await unavailable.json() as { status: string; remediation: Array<{ code: string }> };
    assert.equal(unavailableBody.status, "blocked");
    assert.ok(unavailableBody.remediation.some((item) => item.code === "profile-revision-unavailable"));

    await writeFile(profilePath, "{broken profile\n", "utf8");
    const explicit = await fetch(`${app.url}/api/jobs/${state.job.id}/match-context?profileRevision=${encodeURIComponent(state.publishedProfile.revision.id)}`);
    assert.equal(explicit.status, 409);
    assert.deepEqual(await explicit.json(), { error: "Assessment data needs repair before it can be read." });

    await writeFile(profilePath, profileBytes, "utf8");
    await writeFile(currentPath, "{broken pointer\n", "utf8");
    const current = await fetch(`${app.url}/api/jobs/${state.job.id}/match-context`);
    assert.equal(current.status, 409);
    const currentBody = await current.json() as { error: string };
    assert.deepEqual(currentBody, { error: "Assessment data needs repair before it can be read." });
    assert.doesNotMatch(JSON.stringify(currentBody), /career-m4-flow|profile|source\.md/i);
  } finally {
    await app.close();
  }
});

test("match routes classify an existing partial job as repair and a missing job as absent", async () => {
  const state = await fixture();
  await unlink(join(state.directory, "raw.json"));
  const app = await startTestServer(state.root);

  try {
    const paths = [
      `/api/jobs/${state.job.id}/match-context`,
      `/api/jobs/${state.job.id}/assessments`,
      `/api/jobs/${state.job.id}/assessments/current`,
      `/api/jobs/${state.job.id}/assessments/assessment-one`,
    ];
    for (const path of paths) {
      const response = await fetch(`${app.url}${path}`);
      assert.equal(response.status, 409, path);
      assert.deepEqual(await response.json(), { error: "Assessment data needs repair before it can be read." }, path);
    }

    const missing = await fetch(`${app.url}/api/jobs/${state.job.id}-missing/assessments/current`);
    assert.equal(missing.status, 404);
    assert.deepEqual(await missing.json(), { error: "Not found" });
  } finally {
    await app.close();
  }
});

test("match context CLI rejects unsafe job and profile revision IDs", async () => {
  const state = await fixture();
  const unsafeJob = io();
  const unsafeJobCode = await runCli(["match", "context", "../outside", "--root", state.root], unsafeJob.value);
  assert.equal(unsafeJobCode, 1);
  assert.equal(unsafeJob.stdout.join(""), "");
  assert.match(unsafeJob.stderr.join(""), /invalid/i);

  const unsafeProfile = io();
  const unsafeProfileCode = await runCli(
    ["match", "context", state.job.id, "--root", state.root, "--profile-revision", "../outside"],
    unsafeProfile.value,
  );
  assert.equal(unsafeProfileCode, 1);
  assert.equal(unsafeProfile.stdout.join(""), "");
  assert.match(unsafeProfile.stderr.join(""), /invalid/i);
});
