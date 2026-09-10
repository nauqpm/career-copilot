import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, unlink, writeFile } from "node:fs/promises";
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

test("candidate-confirmed draft evidence is forced to the exact profile leaf value", async () => {
  const root = await mkdtemp(join(tmpdir(), "career-profile-m2-"));
  const result = await publishProfileRevision(root, node, null, {
    confirmed: true,
    evidence: [{
      createdBy: { kind: "candidate" },
      claim: "invented claim",
      claimType: "technical-capability",
      source: { kind: "manual-note", artifactId: "note-1", locator: "skills[0]" },
      quote: "invented quote",
      verification: "candidate-confirmed",
    }],
  });
  const artifact = await readArtifact(join(root, "data", "profile", "evidence", `${result.revision.claimEvidence[2]!.evidenceIds[0]}.json`));
  const evidence = JSON.parse(artifact!.content) as { claim: string; quote: string; verification: string };
  assert.equal(evidence.verification, "candidate-confirmed");
  assert.equal(evidence.claim, "TypeScript");
  assert.equal(evidence.quote, "TypeScript");
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

test("rejects traversal evidence ids before writing outside evidence", async () => {
  const root = await mkdtemp(join(tmpdir(), "career-profile-m2-"));
  await assert.rejects(publishProfileRevision(root, node, null, { confirmed: true, evidence: [{ id: "..\\current", createdBy: { kind: "candidate" }, claim: "x", claimType: "other", source: { kind: "manual-note", artifactId: "n", locator: "skills[0]" }, quote: "TypeScript", verification: "unverified" }] }), /Evidence id is invalid/);
  assert.equal(await readArtifact(join(root, "data", "profile", "current.json")), undefined);
});

test("fails closed for malformed current pointers and preserves the prior pointer on lock conflict", async () => {
  const root = await mkdtemp(join(tmpdir(), "career-profile-m2-"));
  await writeArtifact(join(root, "data", "profile", "current.json"), JSON.stringify({ schemaVersion: 1, revisionId: "..\\candidate-profile", revisionHash: "sha256:" + "0".repeat(64) }) + "\n", null);
  await assert.rejects(readProfileSnapshot(root), /current pointer is invalid/);

  await unlink(join(root, "data", "profile", "current.json"));
  const first = await publishProfileRevision(root, node, null, { confirmed: true });
  const pointerPath = join(root, "data", "profile", "current.json");
  const pointerBefore = await readFile(pointerPath, "utf8");
  await writeFile(`${pointerPath}.lock`, "held", "utf8");
  try { await assert.rejects(publishProfileRevision(root, { ...node, skills: ["Go"] }, first.revisionHash, { confirmed: true }), ConflictError); }
  finally { await unlink(`${pointerPath}.lock`); }
  assert.equal(await readFile(pointerPath, "utf8"), pointerBefore);
  assert.equal((await readProfileSnapshot(root)).revision?.id, first.revision.id);
});

test("propagates held evidence lock and does not replace an active pointer", async () => {
  const root = await mkdtemp(join(tmpdir(), "career-profile-m2-"));
  const first = await publishProfileRevision(root, node, null, { confirmed: true });
  const evidenceId = "11111111-1111-4111-8111-111111111111";
  const evidencePath = join(root, "data", "profile", "evidence", `${evidenceId}.json`);
  await writeFile(`${evidencePath}.lock`, "held", "utf8");
  try {
    await assert.rejects(publishProfileRevision(root, { ...node, skills: ["Go"] }, first.revisionHash, { confirmed: true, evidence: [{ id: evidenceId, createdBy: { kind: "candidate" }, claim: "Go", claimType: "technical-capability", source: { kind: "manual-note", artifactId: "n", locator: "skills[0]" }, quote: "Go", verification: "unverified" }] }), ConflictError);
  } finally { await unlink(`${evidencePath}.lock`); }
  assert.equal((await readProfileSnapshot(root)).revision?.id, first.revision.id);
});

test("hashes and returns an explicit role-track override", async () => {
  const root = await mkdtemp(join(tmpdir(), "career-profile-m2-"));
  const result = await publishProfileRevision(root, node, null, { confirmed: true, roleTracks: ["Platform engineering"] });
  assert.deepEqual(result.profile.roleTracks, ["Platform engineering"]);
  assert.deepEqual(result.revision.profile.roleTracks, ["Platform engineering"]);
  assert.equal((await readProfileSnapshot(root)).revision?.profile.roleTracks?.[0], "Platform engineering");
});

test("maps verified source evidence to supported without marking it unresolved", async () => {
  const root = await mkdtemp(join(tmpdir(), "career-profile-m2-"));
  const result = await publishProfileRevision(root, node, null, { confirmed: true, evidence: [{ createdBy: { kind: "candidate" }, claim: "TypeScript source", claimType: "technical-capability", source: { kind: "source-document", artifactId: "cv", locator: "skills[0]" }, quote: "TypeScript", verification: "document-excerpt" }] });
  assert.equal(result.unresolvedCount, 0);
  assert.equal(result.revision.claimEvidence.find((claim) => claim.claimPath === "skills[0]")?.status, "supported");
  assert.equal((await readProfileHistory(root)).revisions[0].unresolvedCount, 0);
});

for (const verification of ["document-excerpt", "unverified"] as const) {
  test(`retains unchanged ${verification} evidence when another profile section changes`, async () => {
    const root = await mkdtemp(join(tmpdir(), "career-profile-m2-"));
    const first = await publishProfileRevision(root, node, null, { confirmed: true, evidence: [{
      createdBy: { kind: "candidate" }, claim: "TypeScript", claimType: "technical-capability",
      source: { kind: "source-document", artifactId: "cv-1", locator: "skills[0]" },
      quote: "Built TypeScript APIs", verification,
    }] });
    const original = first.revision.claimEvidence.find((claim) => claim.claimPath === "skills[0]")!;
    const path = join(root, "data", "profile", "evidence", `${original.evidenceIds[0]}.json`);
    const bytes = await readFile(path, "utf8");
    const second = await publishProfileRevision(root, { ...node, headline: "Backend engineer" }, first.revisionHash, { confirmed: true });
    assert.deepEqual(second.revision.claimEvidence.find((claim) => claim.claimPath === "skills[0]"), original);
    assert.equal(await readFile(path, "utf8"), bytes);
    assert.equal(second.unresolvedCount, verification === "unverified" ? 1 : 0);
    const third = await publishProfileRevision(root, { ...node, skills: ["Go"] }, second.revisionHash, { confirmed: true });
    assert.notDeepEqual(third.revision.claimEvidence.find((claim) => claim.claimPath === "skills[0]")?.evidenceIds, original.evidenceIds);
  });
}

test("does not reuse fluency evidence after changing the language at the same path", async () => {
  const root = await mkdtemp(join(tmpdir(), "career-profile-m2-"));
  const english = { ...node, languages: [{ language: "English", level: "Fluent" }] };
  const first = await publishProfileRevision(root, english, null, { confirmed: true, evidence: [{
    createdBy: { kind: "candidate" }, claim: "Fluent English", claimType: "language",
    source: { kind: "source-document", artifactId: "cv-1", locator: "languages[0].level" },
    quote: "Fluent English", verification: "document-excerpt",
  }] });
  const second = await publishProfileRevision(root, { ...english, languages: [{ language: "Japanese", level: "Fluent" }] }, first.revisionHash, { confirmed: true });
  const original = first.revision.claimEvidence.find((claim) => claim.claimPath === "languages[0].level")!;
  const updated = second.revision.claimEvidence.find((claim) => claim.claimPath === "languages[0].level")!;
  assert.notDeepEqual(updated.evidenceIds, original.evidenceIds);
  assert.equal(updated.status, "user-asserted");
});

for (const damage of ["missing", "malformed", "changed-hash", "wrong-id", "wrong-locator"] as const) {
  test(`rejects ${damage} referenced evidence and isolates the damaged revision in history`, async () => {
    const root = await mkdtemp(join(tmpdir(), "career-profile-m2-"));
    const first = await publishProfileRevision(root, node, null, { confirmed: true });
    const second = await publishProfileRevision(root, { ...node, skills: ["Go"] }, first.revisionHash, { confirmed: true });
    const id = second.revision.claimEvidence.find((claim) => claim.claimPath === "skills[0]")!.evidenceIds[0];
    const path = join(root, "data", "profile", "evidence", `${id}.json`);
    const original = await readFile(path, "utf8");
    if (damage === "missing") await unlink(path);
    else if (damage === "malformed") await writeFile(path, "{broken");
    else {
      const item = JSON.parse(original);
      if (damage === "changed-hash") await writeFile(path, JSON.stringify({ ...item, quote: "Altered" }));
      else {
        const changed = damage === "wrong-id" ? { ...item, id: "different-id" } : { ...item, source: { ...item.source, locator: "skills[99]" } };
        const { contentHash: _hash, ...rest } = changed;
        await writeFile(path, JSON.stringify({ ...rest, contentHash: contentHash(JSON.stringify(rest)) }));
      }
    }
    const pointer = await readFile(join(root, "data", "profile", "current.json"), "utf8");
    await assert.rejects(readProfileSnapshot(root));
    await assert.rejects(publishProfileRevision(root, node, second.revisionHash, { confirmed: true }));
    assert.equal(await readFile(join(root, "data", "profile", "current.json"), "utf8"), pointer);
    assert.deepEqual((await readProfileHistory(root)).revisions.map((revision) => revision.id), [first.revision.id]);
    await writeFile(path, original);
    assert.equal((await readProfileSnapshot(root)).revision?.id, second.revision.id);
  });
}
