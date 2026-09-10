import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";

import { createLocalJob } from "../src/workspace/storage.js";
import { ConflictError } from "../src/workspace/artifacts.js";
import { readOpportunitySnapshot, saveOpportunityDecision, OpportunityRepairError } from "../src/workspace/opportunities.js";

test("persists a candidate decision as an immutable revision and derives groups", async () => {
  const root = await mkdtemp(join(tmpdir(), "career-opportunity-"));
  const first = await createLocalJob(root, { content: "First role", sourceKind: "pasted-text" });
  const second = await createLocalJob(root, { content: "Same role", sourceKind: "pasted-text" });

  const saved = await saveOpportunityDecision(root, { leftId: first.id, rightId: second.id, relation: "same", expectedHash: null, confirmed: true });
  assert.equal(saved.revision?.decisions[0]?.relation, "same");
  assert.equal(saved.pointerHash?.startsWith("sha256:"), true);
  const revisionFiles = await readdir(join(root, "data", "opportunities", "revisions"));
  assert.equal(revisionFiles.length, 1);
  const before = await readFile(join(root, "data", "opportunities", "revisions", revisionFiles[0]!), "utf8");

  const updated = await saveOpportunityDecision(root, { leftId: first.id, rightId: second.id, relation: "clear", expectedHash: saved.pointerHash!, confirmed: true });
  assert.equal(updated.revision?.decisions.length, 0);
  assert.equal(await readFile(join(root, "data", "opportunities", "revisions", revisionFiles[0]!), "utf8"), before);
});

test("rejects stale writes, missing confirmations and dangling or contradictory decisions", async () => {
  const root = await mkdtemp(join(tmpdir(), "career-opportunity-"));
  const first = await createLocalJob(root, { content: "First role", sourceKind: "pasted-text" });
  const second = await createLocalJob(root, { content: "Second role", sourceKind: "pasted-text" });
  await assert.rejects(() => saveOpportunityDecision(root, { leftId: first.id, rightId: second.id, relation: "same", expectedHash: null, confirmed: false }));
  await assert.rejects(() => saveOpportunityDecision(root, { leftId: first.id, rightId: "job-missing", relation: "same", expectedHash: null, confirmed: true }));
  const saved = await saveOpportunityDecision(root, { leftId: first.id, rightId: second.id, relation: "same", expectedHash: null, confirmed: true });
  const third = await createLocalJob(root, { content: "Third role", sourceKind: "pasted-text" });
  const linked = await saveOpportunityDecision(root, { leftId: second.id, rightId: third.id, relation: "same", expectedHash: saved.pointerHash!, confirmed: true });
  await assert.rejects(() => saveOpportunityDecision(root, { leftId: first.id, rightId: third.id, relation: "different", expectedHash: linked.pointerHash!, confirmed: true }), /contradiction|different/i);
  await assert.rejects(() => saveOpportunityDecision(root, { leftId: first.id, rightId: second.id, relation: "defer", expectedHash: null, confirmed: true }), ConflictError);
});

test("one of two initial concurrent saves wins and an incomplete pointer is repairable", async () => {
  const root = await mkdtemp(join(tmpdir(), "career-opportunity-"));
  const first = await createLocalJob(root, { content: "First role", sourceKind: "pasted-text" });
  const second = await createLocalJob(root, { content: "Second role", sourceKind: "pasted-text" });
  const results = await Promise.allSettled([
    saveOpportunityDecision(root, { leftId: first.id, rightId: second.id, relation: "same", expectedHash: null, confirmed: true }),
    saveOpportunityDecision(root, { leftId: first.id, rightId: second.id, relation: "defer", expectedHash: null, confirmed: true }),
  ]);
  assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
  assert.equal(results.filter((result) => result.status === "rejected" && result.reason instanceof ConflictError).length, 1);

  const pointerPath = join(root, "data", "opportunities", "current.json");
  const pointer = JSON.parse(await readFile(pointerPath, "utf8"));
  await (await import("node:fs/promises")).writeFile(pointerPath, JSON.stringify({ ...pointer, revisionHash: "sha256:" + "0".repeat(64) }), "utf8");
  await assert.rejects(() => readOpportunitySnapshot(root), OpportunityRepairError);
});
