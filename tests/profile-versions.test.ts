import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { ConflictError, contentHash, readArtifact, writeArtifact } from "../src/workspace/artifacts.js";
import { readCandidateProfile, readProfileHistory, readProfileSnapshot, publishProfileRevision, saveCandidateProfile } from "../src/profile/storage.js";

const node = { experience: [{ title: "Backend developer", highlights: ["Built APIs"] }], skills: ["TypeScript"], education: [], languages: [], preferences: { workArrangements: ["hybrid"] as const } };

test("publishes a legacy profile into an immutable revision with exact leaf evidence", async () => {
  const root = await mkdtemp(join(tmpdir(), "career-profile-m2-"));
  await saveCandidateProfile(root, node);
  const legacy = await readArtifact(join(root, "data", "profile", "candidate-profile.json"));
  const result = await publishProfileRevision(root, node, legacy!.hash, { confirmed: true });
  assert.equal(result.unresolvedCount, 0);
  assert.equal((await readCandidateProfile(root))?.headline, undefined);
  assert.equal((await readCandidateProfile(root))?.skills[0], "TypeScript");
  const snapshot = await readProfileSnapshot(root);
  assert.equal(snapshot.legacy, false);
  assert.equal(snapshot.revision?.id, result.revision.id);
  assert.equal(snapshot.hash, result.revisionHash);
  assert.equal(snapshot.pointerHash, (await readArtifact(join(root, "data", "profile", "current.json")))!.hash);
  assert.equal((await readdir(join(root, "data", "profile", "evidence"))).length, 4);
  const evidenceContent = await readFile(join(root, "data", "profile", "evidence", result.revision.claimEvidence[0].evidenceIds[0] + ".json"), "utf8");
  assert.match(evidenceContent, /candidate-confirmed/);
});

test("keeps unverified draft evidence unresolved and preserves old revisions", async () => {
  const root = await mkdtemp(join(tmpdir(), "career-profile-m2-"));
  const first = await publishProfileRevision(root, node, null, { confirmed: true });
  const before = await readFile(join(root, "data", "profile", "revisions", `${first.revision.id}.json`), "utf8");
  const secondProfile = { ...node, skills: ["TypeScript", "Node.js"] };
  const second = await publishProfileRevision(root, secondProfile, first.revisionHash, { confirmed: true, evidence: [{ createdBy: { kind: "candidate" }, claim: "maybe Node", claimType: "technical-capability", source: { kind: "manual-note", artifactId: "note-1", locator: "skills[1]" }, quote: "Node.js", verification: "unverified" }] });
  assert.equal(second.unresolvedCount, 1);
  assert.equal(second.revision.supersedes, first.revision.id);
  assert.equal(await readFile(join(root, "data", "profile", "revisions", `${first.revision.id}.json`), "utf8"), before);
  const history = await readProfileHistory(root);
  assert.equal(history.revisions.length, 2);
  assert.equal(history.revisions.find((entry) => entry.id === first.revision.id)?.active, false);
  assert.equal(history.revisions.find((entry) => entry.id === second.revision.id)?.active, true);
});

test("rejects stale publication without changing active pointer", async () => {
  const root = await mkdtemp(join(tmpdir(), "career-profile-m2-"));
  const first = await publishProfileRevision(root, node, null, { confirmed: true });
  const pointerBefore = await readFile(join(root, "data", "profile", "current.json"), "utf8");
  await assert.rejects(publishProfileRevision(root, { ...node, headline: "stale" }, contentHash("wrong"), { confirmed: true }), ConflictError);
  assert.equal(await readFile(join(root, "data", "profile", "current.json"), "utf8"), pointerBefore);
  assert.equal((await readProfileSnapshot(root)).revision?.id, first.revision.id);
});

test("history ignores malformed orphan revisions", async () => {
  const root = await mkdtemp(join(tmpdir(), "career-profile-m2-"));
  await writeArtifact(join(root, "data", "profile", "revisions", "bad.json"), "{broken", null);
  const history = await readProfileHistory(root);
  assert.deepEqual(history.revisions, []);
});

