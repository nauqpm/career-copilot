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
