import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import { serializeJobAnalysisRevision, parseJobAnalysisRevision } from "../src/job/analysis-revisions.js";

const source = [
  "Backend Engineer / Kỹ sư Backend",
  "Requirements / Yêu cầu:",
  "- At least 3 years of Node.js experience.",
  "- Experience with TypeScript and PostgreSQL.",
  "- English communication is preferred.",
].join("\n");

function hash(value: string | Buffer): string {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function locator(quote: string) {
  const start = source.indexOf(quote);
  assert.notEqual(start, -1, `fixture quote is missing: ${quote}`);
  return { start, end: start + quote.length, quote };
}

function revision(overrides: Record<string, unknown> = {}) {
  const requirements = [
    {
      category: "experience",
      statement: "At least 3 years of Node.js experience.",
      priority: "required",
      minimumYears: 3,
      id: "req-years",
      source: locator("At least 3 years of Node.js experience."),
    },
    {
      category: "skill",
      statement: "Experience with TypeScript and PostgreSQL.",
      priority: "required",
      id: "req-typescript",
      source: locator("Experience with TypeScript and PostgreSQL."),
    },
    {
      category: "language",
      statement: "English communication is preferred.",
      priority: "preferred",
      languageLevel: "English communication",
      id: "req-english",
      source: locator("English communication is preferred."),
    },
  ];

  const base = {
    schemaVersion: 1,
    id: "analysis-1",
    createdAt: "2026-09-12T05:00:00.000Z",
    createdBy: {
      kind: "agent",
      role: "job-analyst",
      skillVersion: "analyze-job@1",
      model: "local-test-model",
      promptHash: hash("analyze-job-prompt-v1"),
    },
    contentHash: "",
    jobId: "job-1",
    capture: {
      id: "job-1",
      manifestHash: hash("source-manifest"),
      sourceHash: hash(Buffer.from(source, "utf8")),
    },
    analysis: {
      title: "Backend Engineer",
      company: "Công ty Ví dụ",
      seniority: "Mid-level",
      requirements,
      responsibilities: ["Build backend services."],
      employment: { workArrangement: "hybrid", locations: [{ raw: "Hồ Chí Minh" }] },
      compensation: { salaryStatus: "not-stated" },
    },
    ...overrides,
  };

  const withoutHash = { ...base, contentHash: undefined };
  return { ...base, contentHash: hash(JSON.stringify(withoutHash)) };
}

function withRevisionHash(value: Record<string, unknown>) {
  const { contentHash: _ignored, ...withoutHash } = value;
  return { ...value, contentHash: hash(JSON.stringify(withoutHash)) };
}

test("parses a source-bound Vietnamese/English analysis and verifies its envelope", () => {
  const parsed = parseJobAnalysisRevision(revision(), source);

  assert.equal(parsed.schemaVersion, 1);
  assert.match(parsed.id, /^[a-z0-9-]+$/);
  assert.match(parsed.jobId, /^[a-z0-9-]+$/);
  assert.match(parsed.createdAt, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/);
  assert.equal(parsed.createdBy.kind, "agent");
  assert.equal(parsed.createdBy.role, "job-analyst");
  assert.equal(parsed.createdBy.model, "local-test-model");
  assert.match(parsed.createdBy.promptHash, /^sha256:[a-f0-9]{64}$/);
  assert.match(parsed.contentHash, /^sha256:[a-f0-9]{64}$/);
  assert.match(parsed.capture.manifestHash, /^sha256:[a-f0-9]{64}$/);
  assert.equal(parsed.capture.sourceHash, hash(Buffer.from(source, "utf8")));

  const ids = parsed.analysis.requirements.map((requirement) => requirement.id);
  assert.equal(new Set(ids).size, ids.length);
  for (const requirement of parsed.analysis.requirements) {
    assert.ok(["required", "preferred", "unknown", undefined].includes(requirement.priority));
    assert.ok(requirement.source.quote.trim());
    assert.ok(requirement.source.start >= 0);
    assert.ok(requirement.source.end <= source.length);
    assert.equal(source.slice(requirement.source.start, requirement.source.end), requirement.source.quote);
  }
  assert.equal(parsed.analysis.requirements[0]?.source.quote, "At least 3 years of Node.js experience.");
  assert.equal(JSON.parse(serializeJobAnalysisRevision(parsed)).contentHash, parsed.contentHash);
});

test("rejects forbidden scores and duplicate requirement IDs", () => {
  const scored = revision({ analysis: { ...revision().analysis, score: 0.8 } });
  assert.throws(() => parseJobAnalysisRevision(scored, source), /score/);

  const duplicateRequirements = revision();
  duplicateRequirements.analysis.requirements[1].id = duplicateRequirements.analysis.requirements[0].id;
  assert.throws(() => parseJobAnalysisRevision(withRevisionHash(duplicateRequirements), source), /duplicate requirement id/);
});

test("rejects invented quotes and out-of-range locators", () => {
  const invented = revision();
  invented.analysis.requirements[0].source = { start: 0, end: 8, quote: "Not in the job description" };
  assert.throws(() => parseJobAnalysisRevision(withRevisionHash(invented), source), /source locator/);

  const outOfRange = revision();
  outOfRange.analysis.requirements[0].source = { start: 0, end: source.length + 1, quote: source };
  assert.throws(() => parseJobAnalysisRevision(withRevisionHash(outOfRange), source), /source locator/);
});

test("rejects mismatched capture binding and malformed IDs or timestamps", () => {
  const wrongCaptureId = revision({ capture: { ...revision().capture, id: "job-2" } });
  assert.throws(() => parseJobAnalysisRevision(wrongCaptureId, source), /capture.id/);

  const wrongSourceHash = revision({ capture: { ...revision().capture, sourceHash: hash("different source") } });
  assert.throws(() => parseJobAnalysisRevision(wrongSourceHash, source), /sourceHash/);

  assert.throws(() => parseJobAnalysisRevision(revision({ id: "../unsafe" }), source), /id/);
  assert.throws(() => parseJobAnalysisRevision(revision({ createdAt: "2026-09-12T05:00:00.000+07:00" }), source), /createdAt/);
  assert.throws(() => parseJobAnalysisRevision(revision({ analysis: { ...revision().analysis, requirements: [{ ...revision().analysis.requirements[0], priority: "mandatory" }] } }), source), /priority/);
});

test("requires truthful model and prompt metadata", () => {
  const missingModel = revision({ createdBy: { ...revision().createdBy, model: "" } });
  assert.throws(() => parseJobAnalysisRevision(missingModel, source), /createdBy.model/);

  const missingPromptHash = revision({ createdBy: { ...revision().createdBy, promptHash: "" } });
  assert.throws(() => parseJobAnalysisRevision(missingPromptHash, source), /promptHash/);
});
