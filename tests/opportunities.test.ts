import assert from "node:assert/strict";
import test from "node:test";

import { applyPairDecision, deriveOpportunityGroups, parseOpportunityRevision, type PairDecision } from "../src/job/opportunities.js";

test("derives stable groups from same decisions and keeps singletons", () => {
  const decisions: PairDecision[] = [{ leftId: "job-a", rightId: "job-b", relation: "same" }];
  assert.deepEqual(deriveOpportunityGroups(["job-b", "job-c", "job-a"], decisions), [
    { key: "job-a", jobIds: ["job-a", "job-b"] },
    { key: "job-c", jobIds: ["job-c"] },
  ]);
  assert.deepEqual(decisions, [{ leftId: "job-a", rightId: "job-b", relation: "same" }]);
});

test("rejects unknown endpoints and transitive different contradictions", () => {
  assert.throws(() => deriveOpportunityGroups(["job-a"], [{ leftId: "job-a", rightId: "job-b", relation: "defer" }]), /unknown|job/i);
  assert.throws(() => deriveOpportunityGroups(["job-a", "job-b", "job-c"], [
    { leftId: "job-a", rightId: "job-b", relation: "same" },
    { leftId: "job-b", rightId: "job-c", relation: "same" },
    { leftId: "job-a", rightId: "job-c", relation: "different" },
  ]), /different|contradiction/i);
});

test("defer does not connect groups and clear only removes the named pair", () => {
  const decisions: PairDecision[] = [
    { leftId: "job-a", rightId: "job-b", relation: "same" },
    { leftId: "job-b", rightId: "job-c", relation: "defer" },
  ];
  const next = applyPairDecision(decisions, { leftId: "job-a", rightId: "job-b", relation: "clear" });
  assert.deepEqual(next, [{ leftId: "job-b", rightId: "job-c", relation: "defer" }]);
  assert.deepEqual(decisions, [
    { leftId: "job-a", rightId: "job-b", relation: "same" },
    { leftId: "job-b", rightId: "job-c", relation: "defer" },
  ]);
});

test("parses only a valid candidate-created revision", () => {
  const revision = parseOpportunityRevision({
    schemaVersion: 1,
    id: "rev-1",
    createdAt: "2026-09-11T00:00:00.000Z",
    createdBy: { kind: "candidate" },
    previous: null,
    decisions: [{ leftId: "job-b", rightId: "job-a", relation: "same" }],
  });
  assert.deepEqual(revision.decisions, [{ leftId: "job-a", rightId: "job-b", relation: "same" }]);
  assert.throws(() => parseOpportunityRevision({ ...revision, createdBy: { kind: "agent" } }), /invalid/i);
  assert.throws(() => parseOpportunityRevision({ ...revision, decisions: [{ leftId: "job-a", rightId: "job-a", relation: "same" }] }), /invalid/i);
});
