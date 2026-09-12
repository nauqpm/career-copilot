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
  assert.match(html, /job-a với job-peer/);
  assert.match(html, /Khác cơ hội/);
  assert.match(html, /Quyết định đã lưu/);
  assert.match(html, /Để sau/);
  assert.match(html, /value="job-peer" selected/);
  assert.match(html, /value="different" selected/);
  assert.match(html, /name="confirmed"[^>]*checked/);
  assert.match(html, /job-%3Cpeer%3E/);
  assert.doesNotMatch(html, /<img|<peer>/);
});

test("separates normal opportunity decisions from the confirmed clear action", () => {
  const html = renderJobDetail(
    { id: "job-a", title: "Role", sourcePreview: "Role", updatedAt: "2026-09-11T00:00:00.000Z", raw: { content: "Role", source: { value: "Local" } }, artifactStatus: { source: true, analysis: false, decision: false, cvDraft: false }, hasAnalysis: false, hasCvDraft: false },
    "",
    { health: "healthy", snapshot: { pointerHash: "sha256:" + "1".repeat(64), revision: { decisions: [{ leftId: "job-a", rightId: "job-b", relation: "same" }] } }, groups: [{ key: "job-a", jobIds: ["job-a", "job-b"] }], jobIds: ["job-a", "job-b"] },
    {},
  );

  const normalForm = html.match(/<form id="opportunity-form"[\s\S]*?<\/form>/)?.[0] ?? "";
  const clearForm = html.match(/<form id="opportunity-clear-form"[\s\S]*?<\/form>/)?.[0] ?? "";
  assert.match(normalForm, /class="opportunity-confirmation"/);
  assert.match(normalForm, /<input[^>]*name="confirmed"[^>]*>\s*<span>Tôi đã xem đúng hai JD/);
  assert.doesNotMatch(normalForm, /value="clear"|Gỡ quyết định cặp này/);
  assert.match(clearForm, /Gỡ quyết định đã lưu/);
  assert.match(clearForm, /Chỉ gỡ liên kết giữa hai JD; nguồn JD vẫn được giữ nguyên/);
  assert.match(clearForm, /name="peerId" value="job-b"/);
  assert.match(clearForm, /name="confirmed"/);
  assert.match(clearForm, /value="clear"/);
});

test("does not offer a repair peer as an editable opportunity choice", () => {
  const html = renderJobDetail(
    { id: "job-a", title: "Role", sourcePreview: "Role", updatedAt: "2026-09-11T00:00:00.000Z", raw: { content: "Role", source: { value: "Local" } }, artifactStatus: { source: true, analysis: false, decision: false, cvDraft: false }, hasAnalysis: false, hasCvDraft: false, captureStatus: "verified" },
    "",
    { health: "healthy", snapshot: { pointerHash: "sha256:" + "1".repeat(64), revision: null }, groups: [{ key: "job-a", jobIds: ["job-a"] }, { key: "job-bad", jobIds: ["job-bad"] }], jobIds: ["job-a", "job-bad"], repairJobIds: ["job-bad"] },
  );

  assert.doesNotMatch(html, /value="job-bad"/);
  assert.match(html, /khôi phục|repair/i);
});

test("makes a current repair job read-only", () => {
  const html = renderJobDetail(
    { id: "job-bad", title: "Role", sourcePreview: "Role", updatedAt: "2026-09-11T00:00:00.000Z", raw: { content: "Role", source: { value: "Local" } }, artifactStatus: { source: false, analysis: false, decision: false, cvDraft: false }, hasAnalysis: false, hasCvDraft: false, captureStatus: "invalid", invalidSourceData: "repair" },
    "",
    { health: "healthy", snapshot: { pointerHash: "sha256:" + "1".repeat(64), revision: null }, groups: [{ key: "job-bad", jobIds: ["job-bad"] }, { key: "job-good", jobIds: ["job-good"] }], jobIds: ["job-bad", "job-good"], repairJobIds: ["job-bad"] },
  );

  assert.match(html, /chỉ đọc|read-only/i);
  assert.doesNotMatch(html, /id="opportunity-form"/);
});

function assessmentDetail() {
  return {
    id: "job-a",
    title: "Backend role",
    company: "Example Co",
    sourcePreview: "Backend role",
    updatedAt: "2026-09-11T00:00:00.000Z",
    raw: { content: "Build APIs", source: { value: "Local" } },
    artifactStatus: { source: true, analysis: true, decision: true, cvDraft: false },
    hasAnalysis: true,
    hasCvDraft: false,
    analysis: {
      title: "Backend role",
      company: "Example Co",
      requirements: [
        { id: "req-supported", statement: "Kỹ năng <script>", priority: "required", source: { quote: "Kỹ năng <script>" } },
        { id: "req-partial", statement: "Docker", priority: "preferred", source: { quote: "Docker" } },
        { id: "req-not-evidenced", statement: "Kubernetes", priority: "unknown", source: { quote: "Kubernetes" } },
        { id: "req-unknown", statement: "English", priority: "required", source: { quote: "English" } },
        { id: "req-conflicting", statement: "On-call", priority: "preferred", source: { quote: "On-call" } },
        { id: "req-na", statement: "Degree", priority: "unknown", source: { quote: "Degree" } },
      ],
      responsibilities: [],
      compensation: { salaryStatus: "not-stated" },
    },
    profileEvidence: [{ id: "Evidence_1", claimPath: "skills[0]" }],
  };
}

function assessmentState(overrides = {}) {
  return {
    status: "current",
    assessment: {
      id: "assessment-1",
      createdAt: "2026-09-12T07:00:00.000Z",
      jobRef: { analysisId: "analysis-1", captureId: "job-a" },
      profileRef: { revisionId: "profile-1" },
      recommendation: "consider",
      confidence: "high",
      summary: "The exact source and selected profile were reviewed.",
      requirementAssessments: [
        { requirementId: "req-supported", modality: "required", verdict: "supported", explanation: "Exact evidence.", evidenceIds: ["Evidence_1"] },
        { requirementId: "req-partial", modality: "preferred", verdict: "partially-supported", explanation: "Adjacent evidence only.", evidenceIds: ["Evidence_1"] },
        { requirementId: "req-not-evidenced", modality: "unknown", verdict: "not-evidenced", explanation: "No selected evidence.", evidenceIds: [] },
        { requirementId: "req-unknown", modality: "required", verdict: "unknown", explanation: "The source and profile are unclear.", evidenceIds: [], question: "Confirm language use." },
        { requirementId: "req-conflicting", modality: "preferred", verdict: "conflicting", explanation: "Evidence conflicts with this condition.", evidenceIds: ["Evidence_1"] },
        { requirementId: "req-na", modality: "unknown", verdict: "not-applicable", explanation: "Not applicable to this profile.", evidenceIds: [] },
      ],
      preferenceChecks: [{ claimPath: "preferences.workArrangements", jobFact: "Hybrid", candidatePreference: "Remote", verdict: "conflicting", explanation: "Arrangement needs review.", evidenceIds: ["Evidence_1"] }],
      blockers: [{ code: "schedule", message: "Confirm the on-call schedule.", requirementId: "req-conflicting", evidenceIds: ["Evidence_1"] }],
      anomalies: [{ code: "prompt-text", message: "The JD contains instruction-like text.", evidenceIds: [] }],
      questions: [{ for: "employer", text: "Which days are on call?", requirementId: "req-conflicting" }],
    },
    freshness: { stale: false, reasons: [] },
    ...overrides,
  };
}

test("assessment detail renders the snapshot, all verdict modalities and evidence paths without score or apply action", () => {
  const html = renderJobDetail(assessmentDetail(), "", undefined, {}, undefined, assessmentState());
  for (const label of [
    "Đánh giá phiên bản", "analysis-1", "profile-1", "2026-09-12", "Hiện tại", "Có thể cân nhắc", "Độ tin cậy",
    "Bắt buộc", "Ưu tiên", "Chưa xác định mức yêu cầu", "Được chứng minh", "Được đáp ứng một phần", "Chưa có bằng chứng",
    "Chưa rõ", "Mâu thuẫn", "Không áp dụng", "Kỹ năng &lt;script&gt;", "Evidence_1", "skills[0]",
    "Kiểm tra điều kiện ưu tiên", "Trở ngại", "Cảnh báo dữ liệu", "Câu hỏi cần làm rõ", "employer", "Chạy lại đánh giá",
  ]) assert.ok(html.includes(label), `missing rendered label: ${label}`);
  assert.ok(html.indexOf("Có thể cân nhắc") < html.indexOf("Kỹ năng &lt;script&gt;"));
  assert.ok(html.indexOf("Kỹ năng &lt;script&gt;") < html.indexOf("Kiểm tra điều kiện ưu tiên"));
  assert.ok(html.indexOf("Kiểm tra điều kiện ưu tiên") < html.indexOf("Trở ngại"));
  assert.ok(html.indexOf("Trở ngại") < html.indexOf("Chạy lại đánh giá"));
  assert.doesNotMatch(html, /\b\d+%|\bApply\b|Ứng tuyển ngay/);
  assert.doesNotMatch(html, /<script>/);
});

test("assessment detail exposes stale reasons and blocked remediation without leaking raw error text", () => {
  const stale = renderJobDetail(assessmentDetail(), "", undefined, {}, undefined, assessmentState({ status: "stale", freshness: { stale: true, reasons: ["profile revision changed", "job capture or source bytes changed"] } }));
  assert.match(stale, /Cũ|stale/);
  assert.match(stale, /profile revision changed/);
  assert.match(stale, /job capture or source bytes changed/);

  const blocked = renderJobDetail(assessmentDetail(), "", undefined, {}, undefined, {
    status: "blocked",
    remediation: [{ code: "profile-unpublished", message: "Publish a candidate profile revision before matching." }],
  });
  assert.match(blocked, /Cần chuẩn bị dữ liệu đánh giá|blocked/i);
  assert.match(blocked, /profile-unpublished/);
  assert.match(blocked, /Publish a candidate profile revision/);
  assert.match(blocked, /Mở Codex workflow|Chạy lại đánh giá/);
});

test("stale assessments do not borrow quotes or claim paths from a changed current context", () => {
  const base = assessmentState().assessment;
  const detail = { ...assessmentDetail(), analysis: { ...assessmentDetail().analysis, requirements: [] } };
  const html = renderJobDetail(detail, "", undefined, {}, undefined, {
    status: "stale",
    assessment: {
      ...base,
      jobRef: { ...base.jobRef, analysisId: "analysis-old", analysisHash: "sha256:old-analysis" },
      profileRef: { revisionId: "profile-old", revisionHash: "sha256:old-profile" },
      requirementAssessments: [{ requirementId: "req-old", modality: "required", verdict: "supported", explanation: "Old evidence remains readable.", evidenceIds: ["Evidence_1"] }],
    },
    freshness: { stale: true, reasons: ["analysis changed"] },
    context: {
      status: "ready",
      analysisHash: "sha256:new-analysis",
      profileRevisionHash: "sha256:new-profile",
      job: { id: "analysis-new", analysis: { requirements: [{ id: "req-old", statement: "New current statement", priority: "required", source: { quote: "NEW CURRENT QUOTE" } }] } },
      profile: { id: "profile-new", claimEvidence: [{ claimPath: "skills[changed]", evidenceIds: ["Evidence_1"] }] },
      evidence: [{ id: "Evidence_1", claim: "Changed context evidence" }],
    },
  });

  assert.match(html, /req-old/);
  assert.match(html, /Evidence_1/);
  assert.match(html, /Trích dẫn không khả dụng/);
  assert.match(html, /Đường dẫn claim không khả dụng/);
  assert.doesNotMatch(html, /NEW CURRENT QUOTE|skills\[changed\]|skills\[0\]/);
});

test("legacy decision is labelled only when no current assessment exists", () => {
  const detail = { ...assessmentDetail(), decision: { status: "consider", summary: "Legacy summary", matches: [], gaps: [], blockers: [], questions: [], cvDraftRecommendation: "hold" } };
  const legacy = renderJobDetail(detail);
  assert.match(legacy, /Đánh giá cũ — chưa khóa phiên bản/);

  const current = renderJobDetail(detail, "", undefined, {}, undefined, assessmentState());
  assert.doesNotMatch(current, /Đánh giá cũ — chưa khóa phiên bản/);
});

test("assessment repair keeps the legacy decision label until a readable assessment exists", () => {
  const detail = { ...assessmentDetail(), decision: { status: "consider", summary: "Legacy summary", matches: [], gaps: [], blockers: [], questions: [], cvDraftRecommendation: "hold" } };
  const html = renderJobDetail(detail, "", undefined, {}, undefined, {
    status: "needs-repair",
    remediation: [{ code: "assessment-needs-repair", message: "Repair local assessment artifacts." }],
  });
  assert.match(html, /Đánh giá cần khôi phục/);
  assert.match(html, /Đánh giá cũ — chưa khóa phiên bản/);
});

test("missing assessment explains local recovery and escapes untrusted assessment text", () => {
  const attack = '"><img src=x onerror="alert(1)">';
  const html = renderJobDetail({ ...assessmentDetail(), raw: { content: attack, source: { value: attack } } }, "", undefined, {}, undefined, {
    status: "missing",
    message: attack,
  });
  assert.match(html, /Chưa có đánh giá phiên bản/);
  assert.match(html, /skills\/assess-job\/SKILL\.md/);
  assert.doesNotMatch(html, /<img\s|<script\s|href="javascript:/);
  assert.doesNotMatch(html, /\bApply\b|\b\d+%/);
});

test("assessment evidence matrix is a keyboard-scrollable labelled region", () => {
  const html = renderJobDetail(assessmentDetail(), "", undefined, {}, undefined, assessmentState());
  assert.match(html, /class="assessment-table-wrap"[^>]*tabindex="0"[^>]*role="region"[^>]*aria-label="[^"]*bằng chứng[^"]*"/i);
});
