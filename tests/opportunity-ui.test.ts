import assert from "node:assert/strict";
import test from "node:test";

import { renderJobDetail, selectOpportunityReview } from "../public/render.js";

test("opportunity review keeps grouped sources separate and hides already-linked suggestions", () => {
  const state = {
    health: "healthy",
    snapshot: { pointerHash: "sha256:" + "1".repeat(64), revision: { decisions: [{ leftId: "job-a", rightId: "job-b", relation: "same" }] } },
    groups: [{ key: "job-a", jobIds: ["job-a", "job-b"] }, { key: "job-c", jobIds: ["job-c"] }],
    jobIds: ["job-a", "job-b", "job-c"],
  };
  const review = selectOpportunityReview("job-a", [{ jobId: "job-b", reasons: ["exact-content"] }, { jobId: "job-c", reasons: ["same-url"] }], state);
  assert.deepEqual(review.memberIds, ["job-b"]);
  assert.deepEqual(review.suggestions.map((hint) => hint.jobId), ["job-c"]);
  assert.equal(review.canEdit, true);
});

test("detail renders repair warning and escaped opportunity IDs without external actions", () => {
  const detail = {
    id: "job-a", title: "Role", company: "Company", sourcePreview: "Role", updatedAt: "2026-09-11T00:00:00.000Z",
    raw: { content: "Role", source: { value: "Local" } }, artifactStatus: { source: true, analysis: false, decision: false, cvDraft: false }, hasAnalysis: false, hasCvDraft: false,
    captureStatus: "verified", duplicateHints: [{ jobId: "job-b", reasons: ["same-url"] }],
  };
  const html = renderJobDetail(detail, "", { health: "needs-repair", snapshot: null, groups: [], jobIds: [] });
  assert.match(html, /Nhóm cơ hội cần khôi phục/);
  assert.match(html, /Không thể ghi quyết định nhóm cơ hội/);
  assert.doesNotMatch(html, /fetch\(|https?:\/\/jobs/);
});

test("detail previews the exact pair, preserves saved decisions and escapes peer text", () => {
  const html = renderJobDetail(
    { id: "job-a", title: "Role", sourcePreview: "Role", updatedAt: "2026-09-11T00:00:00.000Z", raw: { content: "Role", source: { value: "Local" } }, artifactStatus: { source: true, analysis: false, decision: false, cvDraft: false }, hasAnalysis: false, hasCvDraft: false, duplicateHints: [{ jobId: "job-<peer>", reasons: ["same-url"] }] },
    "",
    { health: "healthy", snapshot: { pointerHash: "sha256:" + "1".repeat(64), revision: { decisions: [{ leftId: "job-a", rightId: "job-peer", relation: "defer" }] } }, groups: [{ key: "job-a", jobIds: ["job-a"] }, { key: "job-peer", jobIds: ["job-peer"] }], jobIds: ["job-a", "job-peer"] },
    { peerId: "job-peer", relation: "different", confirmed: "true" },
    "exact-confirmation",
  );
  assert.match(html, /job-a và job-peer/);
  assert.match(html, /Khác cơ hội/);
  assert.match(html, /Quyết định đã lưu/);
  assert.match(html, /Để sau/);
  assert.match(html, /value="job-peer" selected/);
  assert.match(html, /value="different" selected/);
  assert.match(html, /name="confirmed"[^>]*checked/);
  assert.match(html, /job-%3Cpeer%3E/);
  assert.doesNotMatch(html, /<img|<peer>/);
});
