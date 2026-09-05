import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import { parseEvidenceDraft, parseEvidenceItem } from "../src/profile/evidence.js";
import { parseProfileRevision, serializeProfileRevision } from "../src/profile/versions.js";

const profile = { experience: [], skills: ["TypeScript"], education: [], languages: [], roleTracks: ["Backend"] } as const;

function hash(value: unknown): string {
  return `sha256:${createHash("sha256").update(JSON.stringify(value)).digest("hex")}`;
}

function evidence(overrides: Record<string, unknown> = {}) {
  const base = {
    schemaVersion: 1, id: "evidence-1", createdAt: "2026-09-04T05:00:00.000Z",
    createdBy: { kind: "candidate" }, contentHash: "", claim: "Có kinh nghiệm TypeScript",
    claimType: "technical-capability", source: { kind: "profile-source", artifactId: "source-1", locator: "skills[0]" },
    quote: "TypeScript", verification: "candidate-confirmed", language: "vi",
  };
  const withoutHash = { ...base, ...overrides };
  const contentHash = hash(Object.fromEntries(Object.entries(withoutHash).filter(([key]) => key !== "contentHash")));
  return { ...withoutHash, contentHash };
}

test("parses evidence and rejects a mismatched content hash", () => {
  const parsed = parseEvidenceItem(evidence());
  assert.equal(parsed.quote, "TypeScript");
  assert.equal(parsed.language, "vi");
  assert.throws(() => parseEvidenceItem({ ...evidence(), contentHash: "sha256:" + "0".repeat(64) }), /contentHash/);
});

test("parses an evidence draft without an envelope hash", () => {
  const draft = parseEvidenceDraft({
    createdBy: { kind: "candidate" },
    claim: " Có kinh nghiệm TypeScript ", claimType: "technical-capability",
    source: { kind: "profile-source", artifactId: "source-1", locator: "skills[0]" },
    quote: " TypeScript ", verification: "candidate-confirmed", language: "vi",
  });
  assert.equal(draft.claim, "Có kinh nghiệm TypeScript");
  assert.equal(draft.quote, "TypeScript");
  assert.equal(draft.id, undefined);
});

test("accepts draft JSON independently of top-level and nested property order", () => {
  const expected = {
    createdBy: { kind: "agent", role: "profile-review", skillVersion: "1" },
    claim: "Có kinh nghiệm TypeScript", claimType: "technical-capability",
    source: { kind: "cv", artifactId: "cv-1", locator: "skills[0]" },
    quote: "TypeScript", verification: "source-excerpt",
    limitations: ["Candidate supplied"], language: "vi",
  };
  const reordered = {
    language: " vi ", limitations: [" Candidate supplied "],
    verification: "source-excerpt", quote: " TypeScript ",
    source: { locator: " skills[0] ", artifactId: " cv-1 ", kind: "cv" },
    claimType: "technical-capability", claim: " Có kinh nghiệm TypeScript ",
    createdBy: { skillVersion: " 1 ", role: " profile-review ", kind: "agent" },
  };
  assert.deepEqual(parseEvidenceDraft(JSON.parse(JSON.stringify(reordered))), expected);
  assert.deepEqual(parseEvidenceDraft(expected), expected);
});

test("accepts optional language before limitations in a draft", () => {
  const draft = {
    createdBy: { kind: "candidate" }, claim: "TypeScript", claimType: "technical-capability",
    source: { kind: "cv", artifactId: "cv-1", locator: "skills[0]" },
    quote: "TypeScript", verification: "source-excerpt", language: "vi", limitations: ["Self reported"],
  };
  assert.deepEqual(parseEvidenceDraft(draft), draft);
});

test("still validates draft fields before accepting evidence", () => {
  const draft = {
    createdBy: { kind: "candidate" }, claim: "TypeScript", claimType: "technical-capability",
    source: { kind: "cv", artifactId: "cv-1", locator: "skills[0]" },
    quote: "TypeScript", verification: "source-excerpt",
  };
  for (const [overrides, error] of [
    [{ claim: " " }, /claim/],
    [{ quote: " " }, /quote/],
    [{ createdBy: { kind: "unknown" } }, /createdBy/],
    [{ source: { kind: "cv", artifactId: "", locator: "skills[0]" } }, /source.artifactId/],
    [{ limitations: [""] }, /limitations/],
    [{ language: " " }, /language/],
    [{ createdAt: "not-a-timestamp" }, /createdAt/],
  ] as const) {
    assert.throws(() => parseEvidenceDraft({ ...draft, ...overrides }), error);
  }
});

test("rejects non-UTC or malformed evidence timestamps", () => {
  assert.throws(() => parseEvidenceItem(evidence({ createdAt: "2026-09-04T05:00:00+07:00" })), /createdAt/);
  assert.throws(() => parseEvidenceItem(evidence({ createdAt: "not-a-timestamp" })), /createdAt/);
});

test("rejects unknown evidence verification and source values", () => {
  assert.throws(() => parseEvidenceItem(evidence({ verification: "guessed" })), /verification/);
  assert.throws(() => parseEvidenceItem(evidence({ source: { kind: "unknown", artifactId: "source-1", locator: "skills[0]" } })), /source.kind/);
});

test("parses and serializes a profile revision with claim statuses", () => {
  const withoutHash = {
    schemaVersion: 1, id: "revision-1", createdAt: "2026-09-04T05:10:00.000Z", createdBy: { kind: "candidate" },
    contentHash: "", profile, claimEvidence: [{ claimPath: "skills[0]", evidenceIds: ["evidence-1"], status: "supported" }],
    roleTracks: ["Backend"],
  };
  const revision = { ...withoutHash, contentHash: hash(Object.fromEntries(Object.entries(withoutHash).filter(([key]) => key !== "contentHash"))) };
  assert.deepEqual(parseProfileRevision(JSON.parse(serializeProfileRevision(revision))), revision);
  assert.throws(() => parseProfileRevision({ ...revision, claimEvidence: [{ claimPath: "skills[0]", evidenceIds: [], status: "unknown" }] }), /status/);
  assert.throws(() => parseProfileRevision({ ...revision, claimEvidence: [{ claimPath: "skills[99]", evidenceIds: ["evidence-1"], status: "supported" }] }), /claimPath/);
  assert.throws(() => parseProfileRevision({ ...revision, createdAt: "2026-09-04T05:10:00+07:00" }), /createdAt/);
});
