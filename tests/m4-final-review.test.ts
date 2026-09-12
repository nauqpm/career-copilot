import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, unlink, writeFile } from "node:fs/promises";
import { once } from "node:events";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { createWorkspaceServer } from "../src/web/server.js";
import { publishAnalysisRevision } from "../src/job/analysis-storage.js";
import { publishProfileRevision } from "../src/profile/storage.js";
import { readMatchContext } from "../src/match/context.js";
import { hashMatchAssessment, type MatchAssessment } from "../src/match/schema.js";
import { assessmentFreshness, readCurrentMatch, readMatchHistory, saveMatchAssessment } from "../src/match/storage.js";
import { createLocalJob } from "../src/workspace/storage.js";
import { contentHash, readArtifact } from "../src/workspace/artifacts.js";
import { renderJobDetail } from "../public/render.js";

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
  const root = await mkdtemp(join(tmpdir(), "career-m4-final-review-"));
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
  const { contentHash: _ignored, ...analysisWithoutHash } = analysisBase;
  const analysis = await publishAnalysisRevision(root, job.id, { ...analysisBase, contentHash: hash(JSON.stringify(analysisWithoutHash)) }, null);
  const publishedProfile = await publishProfileRevision(root, profile, null, { confirmed: true });
  const evidence = [];
  for (const id of [...new Set(publishedProfile.revision.claimEvidence.flatMap((claim) => claim.evidenceIds))].sort()) {
    evidence.push({ id, hash: (await readArtifact(join(root, "data", "profile", "evidence", `${id}.json`)))!.hash });
  }
  return { root, job, directory, analysis, publishedProfile, sourceArtifact, manifestArtifact, evidence };
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
    profileRef: {
      revisionId: state.publishedProfile.revision.id,
      revisionHash: state.publishedProfile.revisionHash,
      evidence: state.evidence,
    },
    policyVersion: "m4-v1",
    recommendation: "consider",
    confidence: "high",
    summary: "The exact source and selected profile have been reviewed.",
    requirementAssessments: [
      { requirementId: "req-node", modality: "required", verdict: "supported", explanation: "The selected profile has the exact Node.js evidence item.", evidenceIds: [state.evidence.find((entry) => entry.id.includes("skills"))?.id ?? state.evidence[0]!.id] },
      { requirementId: "req-english", modality: "preferred", verdict: "unknown", explanation: "The selected profile does not establish the requested communication context.", evidenceIds: [] },
    ],
    preferenceChecks: [],
    blockers: [],
    questions: [],
    anomalies: [],
  };
  return { ...base, contentHash: hashMatchAssessment(base) };
}

function withChangedHash(value: MatchAssessment, changes: Partial<MatchAssessment>): MatchAssessment {
  const next = { ...value, ...changes } as Omit<MatchAssessment, "contentHash">;
  const { contentHash: _ignored, ...withoutHash } = next as MatchAssessment;
  return { ...next, contentHash: hashMatchAssessment(withoutHash) };
}

function legacyAssessmentFor(state: Awaited<ReturnType<typeof fixture>>, id = "assessment-v1") {
  const current = assessmentFor(state, id);
  const { evidence: _evidence, ...legacyProfileRef } = current.profileRef;
  const { contentHash: _ignored, ...withoutHash } = {
    ...current,
    schemaVersion: 1,
    profileRef: legacyProfileRef,
  };
  return { ...withoutHash, contentHash: hash(JSON.stringify(withoutHash)) };
}

async function startTestServer(root: string) {
  const server = createWorkspaceServer({ root, port: 0 });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address() as { port: number };
  return { url: `http://127.0.0.1:${address.port}`, close: () => new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())) };
}

test("ready context exposes sorted exact evidence artifact bindings beside content", async () => {
  const state = await fixture();
  const context = await readMatchContext(state.root, state.job.id);

  assert.equal(context.status, "ready");
  if (context.status !== "ready") return;
  assert.deepEqual(context.evidenceBindings, state.evidence);
  assert.deepEqual(context.evidence.map((item) => item.id).sort(), context.evidenceBindings.map((item) => item.id));
});

test("assessment publication rejects a valid replacement artifact with the same evidence ID", async () => {
  const state = await fixture();
  const assessment = assessmentFor(state);
  const first = await saveMatchAssessment(state.root, state.job.id, assessment, null);
  const evidenceId = state.evidence[0]!.id;
  const evidencePath = join(state.root, "data", "profile", "evidence", `${evidenceId}.json`);
  const evidence = JSON.parse(await readFile(evidencePath, "utf8")) as Record<string, unknown>;
  const replacement = { ...evidence, quote: `${String(evidence.quote)} changed` };
  const { contentHash: _ignored, ...withoutHash } = replacement;
  replacement.contentHash = hash(JSON.stringify(withoutHash));
  await writeFile(evidencePath, `${JSON.stringify(replacement)}\n`, "utf8");

  await assert.rejects(saveMatchAssessment(state.root, state.job.id, withChangedHash(assessment, { id: "assessment-two" }), first.pointerHash), /evidence|hash|binding/i);
});

test("freshness distinguishes current, stale and needs-repair without exposing a recommendation for repair", async () => {
  const state = await fixture();
  const assessment = assessmentFor(state);
  await saveMatchAssessment(state.root, state.job.id, assessment, null);
  assert.deepEqual(await assessmentFreshness(state.root, assessment), { status: "current", reasons: [] });

  const evidenceId = state.evidence[0]!.id;
  const evidencePath = join(state.root, "data", "profile", "evidence", `${evidenceId}.json`);
  const evidence = JSON.parse(await readFile(evidencePath, "utf8")) as Record<string, unknown>;
  const replacement = { ...evidence, quote: `${String(evidence.quote)} changed` };
  const { contentHash: _ignored, ...withoutHash } = replacement;
  replacement.contentHash = hash(JSON.stringify(withoutHash));
  await writeFile(evidencePath, `${JSON.stringify(replacement)}\n`, "utf8");
  assert.equal((await assessmentFreshness(state.root, assessment)).status, "stale");

  await writeFile(evidencePath, "{broken\n", "utf8");
  const repaired = await assessmentFreshness(state.root, assessment);
  assert.equal(repaired.status, "needs-repair");
  assert.equal("recommendation" in repaired, false);
});

test("freshness treats a corrupt current profile pointer as needs-repair", async () => {
  const state = await fixture();
  const assessment = assessmentFor(state);
  await saveMatchAssessment(state.root, state.job.id, assessment, null);
  await writeFile(join(state.root, "data", "profile", "current.json"), "{broken pointer\n", "utf8");

  assert.equal((await assessmentFreshness(state.root, assessment)).status, "needs-repair");
});

test("historical context loads exact analysis and profile revisions instead of current fallbacks", async () => {
  const state = await fixture();
  const oldAnalysisId = state.analysis.revision.id;
  const oldProfileId = state.publishedProfile.revision.id;
  await publishProfileRevision(state.root, { ...profile, headline: "New profile" }, state.publishedProfile.revisionHash, { confirmed: true });
  const nextAnalysis = {
    ...state.analysis.revision,
    id: "analysis-two",
    createdAt: "2026-09-12T08:00:00.000Z",
    analysis: { ...state.analysis.revision.analysis, title: "New title" },
  };
  const { contentHash: _ignored, ...nextWithoutHash } = nextAnalysis;
  await publishAnalysisRevision(state.root, state.job.id, { ...nextAnalysis, contentHash: hash(JSON.stringify(nextWithoutHash)) }, state.analysis.pointerHash);

  const context = await readMatchContext(state.root, state.job.id, oldProfileId, oldAnalysisId);
  assert.equal(context.status, "ready");
  if (context.status !== "ready") return;
  assert.equal(context.job.id, oldAnalysisId);
  assert.equal(context.profile.id, oldProfileId);
});

test("match-context responses are private and repair responses never return the assessment", async () => {
  const state = await fixture();
  await saveMatchAssessment(state.root, state.job.id, assessmentFor(state), null);
  const app = await startTestServer(state.root);
  try {
    const query = `profileRevision=${encodeURIComponent(state.publishedProfile.revision.id)}&analysisRevision=${encodeURIComponent(state.analysis.revision.id)}`;
    const ready = await fetch(`${app.url}/api/jobs/${state.job.id}/match-context?${query}`);
    assert.equal(ready.status, 200);
    assert.equal(ready.headers.get("cache-control"), "no-store");
    assert.match(ready.headers.get("etag") ?? "", /^"sha256:[a-f0-9]{64}"$/);

    await unlink(join(state.root, "data", "profile", "current.json"));
    const blocked = await fetch(`${app.url}/api/jobs/${state.job.id}/match-context`);
    assert.equal(blocked.status, 200);
    assert.equal(blocked.headers.get("cache-control"), "no-store");
    assert.equal((await blocked.json() as { status: string }).status, "blocked");

    await writeFile(join(state.directory, "source.md"), "{broken source\n", "utf8");
    const repair = await fetch(`${app.url}/api/jobs/${state.job.id}/assessments/current`);
    assert.equal(repair.status, 409);
    assert.equal(repair.headers.get("cache-control"), "no-store");
    assert.deepEqual(await repair.json(), { error: "Assessment data needs repair before it can be read." });
  } finally {
    await app.close();
  }
});

test("job detail renders local assessment history with status and safe inspection links", () => {
  const html = renderJobDetail({
    id: "job-one",
    sourcePreview: "Backend Engineer",
    raw: { content: "JD", source: { type: "text", value: "local" } },
    matchAssessmentHistory: [
      { id: "assessment-one", createdAt: "2026-09-12T07:00:00.000Z", recommendation: "consider", status: "current", assessmentHash: hash("one"), active: true },
      { id: "assessment-two", createdAt: "2026-09-12T08:00:00.000Z", recommendation: "clarify", status: "stale", assessmentHash: hash("two"), active: false },
    ],
  }, "");
  assert.match(html, /Lịch sử đánh giá/);
  assert.match(html, /assessment-one/);
  assert.match(html, /Cần làm rõ/);
  assert.match(html, /status-stale/);
  assert.match(html, /\/api\/jobs\/job-one\/assessments\/assessment-two/);
});

test("preserves an old unbound v1 assessment in repair history without trusting it as current", async () => {
  const state = await fixture();
  const legacy = legacyAssessmentFor(state);
  const assessmentDirectory = join(state.directory, "assessments");
  await mkdir(assessmentDirectory, { recursive: true });
  const serialized = `${JSON.stringify(legacy, null, 2)}\n`;
  const assessmentHash = hash(serialized);
  await writeFile(join(assessmentDirectory, "assessment-v1.json"), serialized, "utf8");
  await writeFile(join(assessmentDirectory, "assessment-v1-invalid.json"), `${JSON.stringify({ ...legacy, id: "assessment-v1-invalid", contentHash: hash("not-the-legacy-object") }, null, 2)}\n`, "utf8");
  await writeFile(join(assessmentDirectory, "current.json"), `${JSON.stringify({ schemaVersion: 1, assessmentId: "assessment-v1", assessmentHash })}\n`, "utf8");

  const history = await readMatchHistory(state.root, state.job.id);
  assert.deepEqual(history.assessments.map((entry) => entry.id), ["assessment-v1"]);
  assert.deepEqual(history.assessments, [{
    id: "assessment-v1",
    createdAt: legacy.createdAt,
    assessmentHash,
    recommendation: "consider",
    status: "needs-repair",
    active: true,
  }]);
  await assert.rejects(readCurrentMatch(state.root, state.job.id), /schema|repair|version/i);

  const app = await startTestServer(state.root);
  try {
    const currentResponse = await fetch(`${app.url}/api/jobs/${state.job.id}/assessments/current`);
    assert.equal(currentResponse.status, 409);
    assert.deepEqual(await currentResponse.json(), { error: "Assessment data needs repair before it can be read." });
    const historyResponse = await fetch(`${app.url}/api/jobs/${state.job.id}/assessments`);
    assert.equal(historyResponse.status, 200);
    assert.equal((await historyResponse.json() as { assessments: Array<{ id: string; status: string }> }).assessments[0]?.status, "needs-repair");
  } finally {
    await app.close();
  }
});

test("new publication rejects a v1 assessment without evidence bindings", async () => {
  const state = await fixture();
  await assert.rejects(saveMatchAssessment(state.root, state.job.id, legacyAssessmentFor(state), null), /schema|evidence|version/i);
});

test("read surfaces revalidate v2 requirement, evidence and claim references", async () => {
  const cases: Array<{ label: string; change: (assessment: MatchAssessment) => MatchAssessment }> = [
    {
      label: "requirement",
      change: (assessment) => withChangedHash(assessment, {
        requirementAssessments: [{ ...assessment.requirementAssessments[0]!, requirementId: "req-forged" }, assessment.requirementAssessments[1]!],
      }),
    },
    {
      label: "evidence",
      change: (assessment) => withChangedHash(assessment, {
        requirementAssessments: [{ ...assessment.requirementAssessments[0]!, evidenceIds: ["evidence-forged"] }, assessment.requirementAssessments[1]!],
      }),
    },
    {
      label: "claim path",
      change: (assessment) => withChangedHash(assessment, {
        preferenceChecks: [{
          claimPath: "preferences.forged",
          jobFact: "Hybrid work",
          candidatePreference: "Hybrid",
          verdict: "unknown",
          explanation: "The stored claim path is not part of the selected profile.",
          evidenceIds: [],
        }],
      }),
    },
  ];

  for (const testCase of cases) {
    const state = await fixture();
    const saved = await saveMatchAssessment(state.root, state.job.id, assessmentFor(state), null);
    const forged = testCase.change(saved.assessment);
    const serialized = `${JSON.stringify(forged, null, 2)}\n`;
    await writeFile(join(state.directory, "assessments", "assessment-one.json"), serialized, "utf8");
    await writeFile(
      join(state.directory, "assessments", "current.json"),
      `${JSON.stringify({ schemaVersion: 1, assessmentId: "assessment-one", assessmentHash: hash(serialized) })}\n`,
      "utf8",
    );

    await assert.rejects(readCurrentMatch(state.root, state.job.id), /assessment|requirement|evidence|claim/i, testCase.label);
    const history = await readMatchHistory(state.root, state.job.id);
    assert.equal(history.assessments[0]?.status, "needs-repair", testCase.label);

    const app = await startTestServer(state.root);
    try {
      const current = await fetch(`${app.url}/api/jobs/${state.job.id}/assessments/current`);
      assert.equal(current.status, 409, testCase.label);
      assert.deepEqual(await current.json(), { error: "Assessment data needs repair before it can be read." });

      const detail = await fetch(`${app.url}/api/jobs/${state.job.id}/assessments/assessment-one`);
      assert.equal(detail.status, 409, testCase.label);
      assert.deepEqual(await detail.json(), { error: "Assessment data needs repair before it can be read." });

      const listed = await fetch(`${app.url}/api/jobs/${state.job.id}/assessments`);
      assert.equal(listed.status, 200, testCase.label);
      assert.equal((await listed.json() as { assessments: Array<{ status: string }> }).assessments[0]?.status, "needs-repair", testCase.label);
    } finally {
      await app.close();
    }
  }
});

test("assessment-bearing workspace responses are private", async () => {
  const state = await fixture();
  await saveMatchAssessment(state.root, state.job.id, assessmentFor(state), null);
  const app = await startTestServer(state.root);
  try {
    for (const path of ["/api/summary", "/api/jobs", `/api/jobs/${state.job.id}`]) {
      const response = await fetch(`${app.url}${path}`);
      assert.equal(response.status, 200, path);
      assert.equal(response.headers.get("cache-control"), "no-store", path);
    }
  } finally {
    await app.close();
  }
});
