import assert from "node:assert/strict";
import test from "node:test";

import { renderApplication, renderCvLibrary, renderJobDetail, renderJobs, renderNewJob, renderOverview, renderProfile } from "../public/render.js";
import { parseRoute } from "../public/routes.js";
import { initializeBrowserApp } from "../public/app.js";

test("profile editing keeps its loaded base and token after refresh, including conflict retry", async () => {
  const browser = browserFixture("#profile");
  await initializeBrowserApp(browser.environment);
  await browser.editProfile("identity");
  await browser.type("profile-form", { name: "My unsaved name" });
  browser.setProfile({ ...profileFixture(), skills: ["External skill"] }, "profile-external");
  await browser.refresh();
  browser.failNext(409);
  await browser.submit("profile-form");
  let writes = browser.requests.filter((request) => request.options.method === "POST" && request.path === "/api/profile/publish");
  assert.equal(writes[0]?.options.headers?.["If-Match"], '"profile-original"');
  assert.deepEqual(JSON.parse(writes[0]?.options.body ?? "null").profile.skills, ["Research"]);
  assert.match(browser.notice.textContent, /mở lại|tải lại/i);
  assert.match(browser.html(), /My unsaved name/);
  await browser.submit("profile-form");
  writes = browser.requests.filter((request) => request.options.method === "POST" && request.path === "/api/profile/publish");
  assert.equal(writes[1]?.options.headers?.["If-Match"], '"profile-original"');
});

test("note drafts retain the loaded token across refresh and conflict", async () => {
  const browser = browserFixture("#jobs/job-example");
  await initializeBrowserApp(browser.environment);
  await browser.type("note-form", { content: "Unsaved note" });
  browser.setNote("External note", "note-external");
  await browser.refresh();
  browser.failNext(409);
  await browser.submit("note-form", { content: "Unsaved note" });
  assert.equal(browser.requests.find((request) => request.options.method === "PUT")?.options.headers?.["If-Match"], '"note-original"');
  assert.match(browser.notice.textContent, /mở lại|tải lại/i);
  assert.match(browser.html(), /Unsaved note/);
});

test("a delayed note conflict remains visible after refresh replaces the form", async () => {
  const browser = browserFixture("#jobs/job-example");
  await initializeBrowserApp(browser.environment);
  let release!: () => void;
  const pending = new Promise<void>((resolve) => { release = resolve; });
  browser.beforeRequest((_path, options) => options.method === "PUT" ? pending : Promise.resolve());
  const saving = browser.submit("note-form", { content: "Preserved conflict draft" });
  await browser.refresh();
  browser.failNext(409);
  release();
  await saving;
  assert.match(browser.notice.textContent, /Dữ liệu đã thay đổi/);
  assert.match(browser.html(), /Preserved conflict draft/);
});

test("source upload sends the loaded absence token", async () => {
  const browser = browserFixture("#profile");
  await initializeBrowserApp(browser.environment);
  await browser.submit("profile-source-form", { source: new File(["Source"], "cv.md") });
  assert.equal(browser.requests.find((request) => request.options.method === "POST")?.options.headers?.["If-Match"], '"missing"');
});

test("source selection keeps its base across refresh and only advances after a successful save", async () => {
  const browser = browserFixture("#profile");
  await initializeBrowserApp(browser.environment);
  await browser.selectSource();
  browser.setSourceHash("external-source");
  await browser.refresh();
  browser.failNext(409);
  await browser.submit("profile-source-form", { source: new File(["Source"], "cv.md") });
  await browser.submit("profile-source-form", { source: new File(["Source"], "cv.md") });
  await browser.submit("profile-source-form", { source: new File(["New source"], "cv.md") });
  const writes = browser.requests.filter((request) => request.options.method === "POST");
  assert.deepEqual(writes.map((request) => request.options.headers?.["If-Match"]), ['"missing"', '"missing"', '"source-saved"']);
});

test("missing profile version fails closed without sending a mutation", async () => {
  const browser = browserFixture("#profile");
  browser.setProfile(profileFixture(), undefined);
  await initializeBrowserApp(browser.environment);
  await browser.editProfile("identity");
  await browser.submit("profile-form", { name: "Keep my draft" });
  assert.equal(browser.requests.filter((request) => request.options.method === "PUT").length, 0);
  assert.match(browser.notice.textContent, /phiên bản dữ liệu/);
});

test("corrupt profile prevents editing while other jobs and escaped warnings remain visible", async () => {
  const browser = browserFixture("#jobs");
  browser.setProfileError("Invalid <profile>");
  await initializeBrowserApp(browser.environment);
  assert.match(browser.html(), /Backend Developer/);
  assert.match(browser.html(), /Invalid &lt;profile&gt;/);
  await browser.navigate("#profile");
  await browser.editProfile("identity");
  assert.doesNotMatch(browser.html(), /id="profile-form"/);
  assert.doesNotMatch(browser.html(), /Chưa có hồ sơ cá nhân/);
  const html = renderJobs({ jobs: [jobSummary({ invalidSourceData: "Invalid <raw>" })] });
  assert.match(html, /Invalid &lt;raw&gt;/);
});

test("browser controller loads the initial job hash with its source and note", async () => {
  const browser = browserFixture("#jobs/job-example");
  await initializeBrowserApp(browser.environment);

  assert.match(browser.html(), /<h1[^>]*>Backend Developer<\/h1>/);
  assert.match(browser.html(), /Build reliable APIs\./);
  assert.match(browser.html(), />Initial local note<\/textarea>/);
  assert.deepEqual(browser.requests.map((request) => request.path), ["/api/summary", "/api/jobs/job-example", "/api/jobs/job-example/note", "/api/opportunities"]);
});

test("opportunity controller requires an exact confirmation before saving", async () => {
  const browser = browserFixture("#jobs/job-example");
  await initializeBrowserApp(browser.environment);
  await browser.submit("opportunity-form", { peerId: "job-other", relation: "same", confirmed: "true" });
  assert.equal(browser.requests.filter((request) => request.options.method === "POST" && request.path === "/api/opportunities/decisions").length, 0);
  assert.match(browser.notice.textContent, /xác nhận quyết định hiện tại/i);
  await browser.confirmOpportunity({ peerId: "job-other", relation: "same" });
  await browser.submit("opportunity-form", { peerId: "job-other", relation: "same", confirmed: "true" });
  const write = browser.requests.find((request) => request.options.method === "POST" && request.path === "/api/opportunities/decisions");
  assert.equal(write?.options.headers?.["If-Match"], '"opportunity-original"', JSON.stringify(browser.requests));
  assert.deepEqual(JSON.parse(write?.options.body ?? "null"), { leftId: "job-example", rightId: "job-other", relation: "same", confirmed: true });
});

test("opportunity confirmation is invalidated when the relation changes and duplicate submits are ignored", async () => {
  const browser = browserFixture("#jobs/job-example");
  await initializeBrowserApp(browser.environment);
  await browser.confirmOpportunity({ peerId: "job-other", relation: "same" });
  await browser.submit("opportunity-form", { peerId: "job-other", relation: "different", confirmed: "true" });
  assert.equal(browser.requests.filter((request) => request.options.method === "POST" && request.path === "/api/opportunities/decisions").length, 0);
  await browser.confirmOpportunity({ peerId: "job-other", relation: "different" });
  let release!: () => void;
  const pending = new Promise<void>((resolve) => { release = resolve; });
  browser.beforeRequest((_path, options) => options.method === "POST" ? pending : Promise.resolve());
  const first = browser.submit("opportunity-form", { peerId: "job-other", relation: "different", confirmed: "true" });
  const second = browser.submit("opportunity-form", { peerId: "job-other", relation: "different", confirmed: "true" });
  release();
  await Promise.all([first, second]);
  assert.equal(browser.requests.filter((request) => request.options.method === "POST" && request.path === "/api/opportunities/decisions").length, 1);
});

test("unchanged opportunity polling preserves a checked confirmation", async () => {
  const browser = browserFixture("#jobs/job-example");
  await initializeBrowserApp(browser.environment);
  await browser.confirmOpportunity({ peerId: "job-other", relation: "same" });
  browser.environment.document.activeElement = undefined;
  await browser.poll();
  await browser.submit("opportunity-form", { peerId: "job-other", relation: "same", confirmed: "true" });

  assert.equal(browser.requests.filter((request) => request.options.method === "POST" && request.path === "/api/opportunities/decisions").length, 1);
});

test("opportunity input changes clear the live confirmation while preserving the draft", async () => {
  const browser = browserFixture("#jobs/job-example");
  await initializeBrowserApp(browser.environment);
  await browser.confirmOpportunity({ peerId: "job-other", relation: "same" });
  assert.equal(browser.opportunityConfirmationChecked(), true);

  await browser.changeOpportunity("relation", "different");
  assert.equal(browser.opportunityConfirmationChecked(), false);

  await browser.refresh();
  assert.match(browser.html(), /value="job-other" selected/);
  assert.match(browser.html(), /value="different" selected/);
  assert.doesNotMatch(browser.html(), /name="confirmed"[^>]*checked/);
});

test("failed opportunity writes clear the live confirmation while preserving the draft", async () => {
  const browser = browserFixture("#jobs/job-example");
  await initializeBrowserApp(browser.environment);
  await browser.confirmOpportunity({ peerId: "job-other", relation: "same" });

  browser.failNext(409);
  await browser.submit("opportunity-form", { peerId: "job-other", relation: "same", confirmed: "true" });
  assert.equal(browser.opportunityConfirmationChecked(), false);

  await browser.confirmOpportunity({ peerId: "job-other", relation: "same" });
  browser.beforeRequest((path, options) => options.method === "POST" ? Promise.reject(new Error("offline")) : Promise.resolve());
  await browser.submit("opportunity-form", { peerId: "job-other", relation: "same", confirmed: "true" });
  assert.equal(browser.opportunityConfirmationChecked(), false);

  browser.beforeRequest(undefined);
  await browser.refresh();
  assert.match(browser.html(), /value="job-other" selected/);
  assert.match(browser.html(), /value="same" selected/);
  assert.doesNotMatch(browser.html(), /name="confirmed"[^>]*checked/);
});

test("a delayed opportunity save cannot overwrite another job's pointer", async () => {
  const browser = browserFixture("#jobs/job-example");
  browser.setJobDetails({ "job-other": { ...populatedFixture(), id: "job-other", title: "Other role", sourcePreview: "Other role" } });
  await initializeBrowserApp(browser.environment);
  await browser.confirmOpportunity({ peerId: "job-other", relation: "same" });

  let releaseSave!: () => void;
  const saveGate = new Promise<void>((resolve) => { releaseSave = resolve; });
  browser.beforeRequest((_path, options) => options.method === "POST" ? saveGate : Promise.resolve());
  const saving = browser.submit("opportunity-form", { peerId: "job-other", relation: "same", confirmed: "true" });
  await browser.navigate("#jobs/job-other");
  releaseSave();
  await saving;

  await browser.confirmOpportunity({ peerId: "job-example", relation: "same" });
  await browser.submit("opportunity-form", { peerId: "job-example", relation: "same", confirmed: "true" });
  const writes = browser.requests.filter((request) => request.options.method === "POST" && request.path === "/api/opportunities/decisions");
  assert.equal(writes.length, 2);
  assert.equal(writes[1]?.options.headers?.["If-Match"], '"opportunity-original"');
});

test("a failed opportunity save cannot clear another job's confirmation", async () => {
  const browser = browserFixture("#jobs/job-example");
  browser.setJobDetails({ "job-other": { ...populatedFixture(), id: "job-other", title: "Other role", sourcePreview: "Other role" } });
  await initializeBrowserApp(browser.environment);
  await browser.confirmOpportunity({ peerId: "job-other", relation: "same" });

  let releaseSave!: () => void;
  const saveGate = new Promise<void>((resolve) => { releaseSave = resolve; });
  browser.beforeRequest((_path, options) => options.method === "POST" ? saveGate : Promise.resolve());
  const saving = browser.submit("opportunity-form", { peerId: "job-other", relation: "same", confirmed: "true" });
  await browser.navigate("#jobs/job-other");
  await browser.confirmOpportunity({ peerId: "job-example", relation: "same" });
  assert.equal(browser.opportunityConfirmationChecked(), true);

  browser.failNext(409);
  releaseSave();
  await saving;
  assert.equal(browser.opportunityConfirmationChecked(), true);
  await browser.submit("opportunity-form", { peerId: "job-example", relation: "same", confirmed: "true" });
  const writes = browser.requests.filter((request) => request.options.method === "POST" && request.path === "/api/opportunities/decisions");
  assert.equal(writes.length, 2);
  assert.equal(writes[1]?.options.headers?.["If-Match"], '"opportunity-original"');
});

test("a failed opportunity save cannot overwrite a replacement route notice", async () => {
  const browser = browserFixture("#jobs/job-example");
  browser.setJobDetails({ "job-other": { ...populatedFixture(), id: "job-other", title: "Other role", sourcePreview: "Other role" } });
  await initializeBrowserApp(browser.environment);
  await browser.confirmOpportunity({ peerId: "job-other", relation: "same" });

  let releaseSave!: () => void;
  const saveGate = new Promise<void>((resolve) => { releaseSave = resolve; });
  browser.beforeRequest((_path, options) => {
    if (options.method !== "POST") return Promise.resolve();
    return JSON.parse(options.body ?? "{}").leftId === "job-example" ? saveGate : Promise.resolve();
  });
  const saving = browser.submit("opportunity-form", { peerId: "job-other", relation: "same", confirmed: "true" });
  await browser.navigate("#jobs/job-other");
  browser.notice.textContent = "Thông báo hiện tại của job B";
  browser.failNext(409);
  releaseSave();
  await saving;

  assert.equal(browser.notice.textContent, "Thông báo hiện tại của job B");
});

test("a replacement opportunity form can submit while an earlier save is pending", async () => {
  const browser = browserFixture("#jobs/job-example");
  browser.setJobDetails({ "job-other": { ...populatedFixture(), id: "job-other", title: "Other role", sourcePreview: "Other role" } });
  await initializeBrowserApp(browser.environment);
  await browser.confirmOpportunity({ peerId: "job-other", relation: "same" });

  let releaseSave!: () => void;
  const saveGate = new Promise<void>((resolve) => { releaseSave = resolve; });
  browser.beforeRequest((_path, options) => {
    if (options.method !== "POST") return Promise.resolve();
    return JSON.parse(options.body ?? "{}").leftId === "job-example" ? saveGate : Promise.resolve();
  });
  const saving = browser.submit("opportunity-form", { peerId: "job-other", relation: "same", confirmed: "true" });
  await browser.navigate("#jobs/job-other");
  await browser.confirmOpportunity({ peerId: "job-example", relation: "same" });
  await browser.submit("opportunity-form", { peerId: "job-example", relation: "same", confirmed: "true" });

  const writesBeforeRelease = browser.requests.filter((request) => request.options.method === "POST" && request.path === "/api/opportunities/decisions");
  releaseSave();
  await saving;
  assert.equal(writesBeforeRelease.length, 2);
  assert.equal(JSON.parse(writesBeforeRelease[1]?.options.body ?? "null").leftId, "job-other");
});

test("browser controller follows hashchange navigation and focuses the new page", async () => {
  const browser = browserFixture("#jobs/job-example");
  await initializeBrowserApp(browser.environment);
  await browser.navigate("#profile");

  assert.match(browser.html(), /<h1[^>]*>Hồ sơ cá nhân<\/h1>/);
  assert.match(browser.html(), /href="#profile"[^>]*aria-current="page"/);
  assert.doesNotMatch(browser.html(), /<h1[^>]*>Backend Developer<\/h1>/);
  assert.equal(browser.focusCount(), 1);

  await browser.navigate("#jobs/job-example");
  assert.match(browser.html(), /<h1[^>]*>Backend Developer<\/h1>/);
  assert.match(browser.html(), />Initial local note<\/textarea>/);
  assert.equal(browser.focusCount(), 2);
});

test("browser controller keeps creation confirmation on the new detail route only", async () => {
  const browser = browserFixture("#new-job");
  await initializeBrowserApp(browser.environment);
  await browser.submitJob({ content: "Original pasted JD", sourceReference: "Local source" });

  assert.equal(browser.environment.window.location.hash, "#jobs/job-created");
  assert.match(browser.html(), /<h1[^>]*>JD chưa có tiêu đề<\/h1>/);
  assert.match(browser.html(), /Original pasted JD/);
  assert.match(browser.html(), /role="status"[^>]*>Đã lưu JD trên máy\.</);
  const saved = browser.requests.find((request) => request.options.method === "POST");
  assert.equal(saved?.path, "/api/jobs");
  assert.deepEqual(JSON.parse(saved?.options.body ?? "null"), { content: "Original pasted JD", sourceReference: "Local source" });

  await browser.navigate("#jobs");
  assert.doesNotMatch(browser.html(), /Đã lưu JD trên máy\./);
});

for (const replacement of ["refresh", "navigation"]) {
  test(`a delayed JD save after ${replacement} consumes the saved draft and opens its detail`, async () => {
    const browser = browserFixture("#new-job");
    await initializeBrowserApp(browser.environment);
    let releaseSave!: () => void;
    const gate = new Promise<void>((resolve) => { releaseSave = resolve; });
    browser.beforeRequest((_path, options) => options.method === "POST" ? gate : Promise.resolve());
    const saving = browser.submitJob({ content: "Saved original JD", sourceReference: "Saved source" });
    const submittedForm = browser.form();
    assert.equal(submittedForm.isConnected, true);

    if (replacement === "refresh") await browser.refresh();
    else await browser.navigate("#jobs");
    assert.equal(submittedForm.isConnected, false, "rendering replaces and disconnects the submitted form");
    releaseSave();
    await saving;

    assert.equal(browser.environment.window.location.hash, "#jobs/job-created");
    assert.match(browser.html(), /Saved original JD/);
    assert.match(browser.html(), /role="status"[^>]*>Đã lưu JD trên máy\.</);
    await browser.navigate("#new-job");
    assert.deepEqual(browser.form().fields, { content: "", sourceReference: "" });
    await browser.submit("job-form");
    assert.equal(browser.requests.filter((request) => request.options.method === "POST").length, 1, "the saved draft cannot be submitted again");
  });
}

for (const replaceForm of [false, true]) {
  test(`a delayed JD save preserves newer edits in the ${replaceForm ? "replacement" : "original"} form`, async () => {
    const browser = browserFixture("#new-job");
    await initializeBrowserApp(browser.environment);
    let releaseSave!: () => void;
    const gate = new Promise<void>((resolve) => { releaseSave = resolve; });
    browser.beforeRequest((_path, options) => options.method === "POST" ? gate : Promise.resolve());
    const saving = browser.submitJob({ content: "Saved original JD", sourceReference: "Saved source" });
    const submittedForm = browser.form();
    if (replaceForm) await browser.refresh();
    const newerDraft = { content: "Newer unsaved JD", sourceReference: "Newer source" };
    await browser.type("job-form", newerDraft);
    assert.equal(submittedForm.isConnected, !replaceForm);
    releaseSave();
    await saving;

    assert.equal(browser.environment.window.location.hash, "#jobs/job-created");
    assert.match(browser.html(), /Saved original JD/);
    assert.doesNotMatch(browser.html(), /Newer unsaved JD/);
    assert.match(browser.html(), /role="status"[^>]*>Đã lưu JD trên máy\.</);
    await browser.navigate("#new-job");
    assert.deepEqual(browser.form().fields, newerDraft);
    assert.equal(browser.requests.filter((request) => request.options.method === "POST").length, 1);
  });
}

test("a delayed JD save refreshes success when its detail hash is already selected", async () => {
  const browser = browserFixture("#new-job");
  await initializeBrowserApp(browser.environment);
  let releaseSave!: () => void;
  const gate = new Promise<void>((resolve) => { releaseSave = resolve; });
  browser.beforeRequest((_path, options) => options.method === "POST" ? gate : Promise.resolve());
  const saving = browser.submitJob({ content: "Saved original JD", sourceReference: "Saved source" });
  const submittedForm = browser.form();
  await browser.navigate("#jobs/job-created");
  assert.equal(submittedForm.isConnected, false);
  releaseSave();
  await saving;

  assert.equal(browser.environment.window.location.hash, "#jobs/job-created");
  assert.match(browser.html(), /Saved original JD/);
  assert.match(browser.html(), /role="status"[^>]*>Đã lưu JD trên máy\.</);
  await browser.navigate("#new-job");
  assert.deepEqual(browser.form().fields, { content: "", sourceReference: "" });
  assert.equal(browser.requests.filter((request) => request.options.method === "POST").length, 1);
});

test("hash routes select all six screens and preserve decoded valid job IDs", () => {
  const routes = [
    ["#overview", { page: "overview" }], ["#jobs", { page: "jobs" }],
    ["#jobs/backend-01", { page: "job", jobId: "backend-01" }],
    ["#jobs/backend%2D01", { page: "job", jobId: "backend-01" }],
    ["#profile", { page: "profile" }], ["#cvs", { page: "cvs" }], ["#new-job", { page: "new-job" }],
  ] as const;
  for (const [hash, expected] of routes) assert.deepEqual(parseRoute(hash), expected);
});

test("unknown or unsafe hashes fall back without normalizing invalid IDs into valid ones", () => {
  for (const hash of [undefined, "", "#", "#not-a-page", "jobs", "#jobs/", "#jobs/UPPER", "#jobs/a_b", "#jobs/a/b", "#jobs/%2e%2e", "#jobs/a%2fb", "#jobs/a%5cb", "#jobs/%", "#jobs/%E0%A4%A", "#jobs/%252e", "#jobs/a?x=1", "#jobs/a%00", "#profile/extra"]) {
    assert.deepEqual(parseRoute(hash), { page: "overview" }, String(hash));
  }
});

test("shell labels all destinations and marks the jobs library active on a detail page", () => {
  const html = renderApplication({ route: { page: "job", jobId: "job-example" }, detail: populatedFixture(), summary: { jobs: [] } });
  for (const [hash, label] of [["overview", "Tổng quan"], ["jobs", "Job descriptions"], ["profile", "Hồ sơ cá nhân"], ["cvs", "CV theo vị trí"], ["new-job", "Thêm JD mới"]]) {
    assert.match(html, new RegExp(`href="#${hash}"[^>]*>[^<]*${label}`));
  }
  assert.match(html, /href="#jobs"[^>]*class="[^"]*active[^>]*aria-current="page"/);
  assert.equal((html.match(/aria-current="page"/g) ?? []).length, 1);
  assert.match(html, /<button[^>]*aria-controls="workspace-navigation"[^>]*aria-expanded="true"[^>]*>Menu/);
  assert.match(html, /Chỉ lưu trên máy này/);
});

test("application dispatches every page without browser globals or serialized objects", () => {
  const headings = [["overview", "Tổng quan"], ["jobs", "Job descriptions"], ["job", "Backend Developer"], ["profile", "Hồ sơ cá nhân"], ["cvs", "CV theo vị trí"], ["new-job", "Thêm JD mới"]];
  for (const [page, heading] of headings) {
    const html = renderApplication({ route: { page, jobId: "job-example" }, summary: { jobs: [jobSummary()] }, detail: populatedFixture(), profile: profileFixture(), note: "My local note" });
    assert.match(html, new RegExp(`<h1[^>]*>${heading}</h1>`));
    assert.doesNotMatch(html, /\[object Object\]|"requirements"\s*:|"contact"\s*:|"artifactStatus"\s*:/);
  }
});

test("empty overview points to intake and profile without invented activity", () => {
  const html = renderOverview({ jobs: [] });
  assert.match(html, /Chưa có JD/);
  assert.match(html, /href="#new-job"[^>]*>Thêm JD mới/);
  assert.match(html, /Chưa có hồ sơ cá nhân/);
  assert.doesNotMatch(html, /class="priority-job"/);
});

test("application shows a success notice when error is cleared and prioritizes a real error", () => {
  const success = renderApplication({ notice: "Đã lưu ghi chú trên máy.", error: "" });
  assert.match(success, /role="status"[^>]*>Đã lưu ghi chú trên máy\.</);
  const failure = renderApplication({ notice: "Old success", error: "Không lưu được ghi chú." });
  assert.match(failure, /role="alert"[^>]*>Không lưu được ghi chú\.</);
  assert.doesNotMatch(failure, /Old success/);
});

test("overview counts actual jobs and prioritizes the newest clarify before pending analysis", () => {
  const jobs = [
    jobSummary({ id: "clarify-old", decisionStatus: "clarify", updatedAt: "2026-08-01T10:00:00Z" }),
    jobSummary({ id: "new-source", hasAnalysis: false, decisionStatus: undefined, artifactStatus: { source: true, analysis: false, decision: false, cvDraft: false }, updatedAt: "2026-08-04T10:00:00Z" }),
    jobSummary({ id: "clarify-new", decisionStatus: "clarify", updatedAt: "2026-08-03T10:00:00Z" }),
  ];
  const html = renderOverview({ jobs, profile: profileFixture() });
  assert.equal(priorityHref(html), "#jobs/clarify-new");
  assert.match(html, /<dt>JD đã lưu<\/dt><dd>3<\/dd>/);
  assert.match(html, /<dt>Cần làm rõ<\/dt><dd>2<\/dd>/);
  assert.match(html, /<dt>Bản nháp CV<\/dt><dd>2<\/dd>/);
  assert.match(html, /1 kỹ năng · 1 vai trò · 1 ngôn ngữ/);
  assert.match(html, /skills\/assess-job\/SKILL\.md/);
  assert.match(html, /data\/jobs\/clarify-new/);
  assert.match(html, /không tự chạy Codex/);
});

test("overview priority falls back to newest unanalyzed job then newest local update", () => {
  const newer = jobSummary({ id: "newer", updatedAt: "2026-08-04T10:00:00Z" });
  const older = jobSummary({ id: "older", updatedAt: "2026-08-01T10:00:00Z" });
  const pending = jobSummary({ id: "pending", hasAnalysis: false, decisionStatus: undefined, updatedAt: "2026-08-02T10:00:00Z" });
  assert.equal(priorityHref(renderOverview({ jobs: [older, newer, pending] })), "#jobs/pending");
  assert.equal(priorityHref(renderOverview({ jobs: [older, newer] })), "#jobs/newer");
});

test("overview caps recent jobs at five while jobs library keeps every row in newest-first order", () => {
  const jobs = Array.from({ length: 7 }, (_, index) => jobSummary({ id: `job-${index}`, updatedAt: `2026-08-0${index + 1}T10:00:00Z` }));
  const original = structuredClone(jobs);
  const recent = renderOverview({ jobs }).match(/<section[^>]*aria-labelledby="recent-heading"[\s\S]*?<\/section>/)?.[0] ?? "";
  assert.equal((recent.match(/class="job-row"/g) ?? []).length, 5);
  assert.ok(recent.indexOf('href="#jobs/job-6"') < recent.indexOf('href="#jobs/job-5"'));
  assert.doesNotMatch(recent, /href="#jobs\/job-[01]"/);
  const library = renderJobs({ jobs });
  assert.equal((library.match(/class="job-row"/g) ?? []).length, 7);
  assert.ok(library.indexOf('href="#jobs/job-6"') < library.indexOf('href="#jobs/job-0"'));
  assert.deepEqual(jobs, original);
});

test("jobs library renders fallback labels, actual artifacts, status and update time", () => {
  assert.match(renderJobs({ jobs: [] }), /Chưa có JD/);
  assert.match(renderJobs({ jobs: [] }), /Thêm JD mới/);
  const html = renderJobs({ jobs: [jobSummary({ title: undefined, company: "Example Co", workArrangement: "hybrid", locationPreview: "Hà Nội" })] });
  for (const label of ["Example Co", "Có thể cân nhắc", "Hà Nội · Kết hợp", "Nguồn JD", "Phân tích", "Quyết định", "Bản nháp CV"]) assert.match(html, new RegExp(label));
  assert.match(html, /datetime="2026-08-02T10:00:00Z"/);
  const legacy = renderJobs({ jobs: [{ id: "old-job", sourcePreview: "Original text", hasAnalysis: false, hasCvDraft: false }] });
  assert.match(legacy, /JD chưa có tiêu đề/);
  assert.match(legacy, /Chưa có thời gian cập nhật/);
});

test("detail shows readable evidence, original source, private note and a local Markdown download", () => {
  const html = renderJobDetail(populatedFixture(), "Ask about working hours.");
  for (const label of ["Có thể cân nhắc", "Bằng chứng cho quyết định", "Relevant experience", "Build APIs", "30–40M VND", "Yêu cầu", "Kinh nghiệm", "Trình độ", "Ngôn ngữ", "Điều kiện làm việc", "Làm thêm giờ", "Lịch tuyển dụng", "Cơ hội", "Nội dung JD gốc", "Company site"]) assert.match(html, new RegExp(label));
  assert.match(html, /<details class="source-jd">[\s\S]*<pre>Build reliable APIs\.<\/pre>/);
  assert.match(html, /<label for="job-note">Ghi chú cá nhân<\/label>/);
  assert.match(html, /<textarea[^>]*id="job-note"[^>]*>Ask about working hours\.<\/textarea>/);
  assert.match(html, /không tự gửi cho Codex/);
  assert.match(html, /href="\/api\/jobs\/job-example\/cv-draft" download/);
  assert.match(html, /Tải bản nháp Markdown/);
  assert.doesNotMatch(html, /"requirements"\s*:/);
});

test("detail renders verified capture provenance and non-destructive duplicate hints", () => {
  const html = renderJobDetail({ ...populatedFixture(), captureStatus: "verified", capture: { sourceKind: "pasted-text", sourceReference: "https://jobs.example.test/role", createdAt: "2026-09-11T00:00:00.000Z" }, duplicateHints: [{ jobId: "job-other", reasons: ["exact-content", "same-url"] }] });
  assert.match(html, /Thời điểm nhập/);
  assert.match(html, /Nội dung giống hệt/);
  assert.match(html, /Cùng URL nguồn/);
  assert.match(html, /hệ thống không tự gộp hay xóa JD/);
});

test("detail handles missing and malformed artifacts without invented facts or downloads", () => {
  const pending = { id: "pending-job", sourcePreview: "Source", raw: { content: "Only stated facts.", source: { value: "A source" } }, hasAnalysis: false, hasCvDraft: false };
  const html = renderJobDetail(pending);
  for (const label of ["Chưa có phân tích", "Chưa có quyết định", "Chưa có bản nháp CV", "skills/analyze-job/SKILL.md"]) assert.ok(html.includes(label));
  assert.doesNotMatch(html, / download|Mức lương|Toàn thời gian/);
  const invalid = renderJobDetail({ ...pending, invalidDerivedData: "analysis.json is invalid" });
  assert.match(invalid, /analysis\.json is invalid/);
  assert.match(invalid, /kiểm tra/);
  assert.match(renderJobDetail(undefined), /Không tìm thấy JD/);
});

test("profile groups saved facts into the four agreed folders with bounded save affordances", () => {
  for (const profile of [undefined, profileFixture()]) {
    const html = renderProfile(profile);
    for (const label of ["Liên hệ &amp; giới thiệu", "Vai trò &amp; thành tựu", "Kỹ năng &amp; ngôn ngữ", "Điều kiện tìm việc", "Lưu mục này"]) assert.ok(html.includes(label));
    assert.match(html, /<label for="profile-source">/);
    assert.doesNotMatch(html, /"contact"\s*:|\[object Object\]/);
  }
  assert.match(renderProfile(undefined), /Chưa có hồ sơ cá nhân/);
  const html = renderProfile(profileFixture());
  for (const label of ["Nguyễn An", "Designer", "Service design", "Vietnamese", "University", "Certificate", "Flexible hours", "0900000000"]) assert.match(html, new RegExp(label));
});

test("CV library uses actual draft artifact availability and the draft file timestamp", () => {
  assert.match(renderCvLibrary({ jobs: [] }), /Chưa có bản nháp CV/);
  const jobs = [
    jobSummary({ id: "available", cvDraftUpdatedAt: "2026-08-01T10:00:00Z" }),
    jobSummary({ id: "absent", hasCvDraft: true, artifactStatus: { source: true, analysis: true, decision: true, cvDraft: false } }),
    { id: "legacy", title: "Legacy", hasCvDraft: true },
  ];
  const html = renderCvLibrary({ jobs });
  assert.match(html, /href="#jobs\/available"/);
  assert.match(html, /href="\/api\/jobs\/available\/cv-draft" download/);
  assert.match(html, /datetime="2026-08-01T10:00:00Z"/);
  assert.doesNotMatch(html, /#jobs\/(absent|legacy)|\/api\/jobs\/(absent|legacy)/);
});

test("new JD form labels both inputs and preserves submitted source as literal text", () => {
  const empty = renderNewJob();
  assert.match(empty, /<label for="job-content">Nội dung JD gốc<\/label>/);
  assert.match(empty, /<label for="source-reference">/);
  assert.match(empty, /name="content"[^>]*required/);
  assert.match(empty, /chỉ lưu trên máy/);
  assert.match(empty, /không tự phân tích/);
  const html = renderNewJob({ content: "Original\nsource", sourceReference: "Company site" });
  assert.match(html, />Original\nsource<\/textarea>/);
  assert.match(html, /value="Company site"/);
});

test("page feedback keeps failed profile edits visible and explains that the draft is preserved", () => {
  const html = renderApplication({ route: { page: "profile" }, profile: profileFixture(), profileEditor: { section: "identity", draft: { name: "Chưa lưu" } }, error: "Không lưu được hồ sơ." });
  assert.match(html, /role="alert"/);
  assert.match(html, /Không lưu được hồ sơ/);
  assert.match(html, /Nội dung đang nhập được giữ nguyên/);
  assert.match(html, />Chưa lưu<\/textarea>/);
});

test("application carries the unsaved JD draft into its labelled intake form", () => {
  const html = renderApplication({ route: { page: "new-job" }, jobDraft: { content: "Bản đang nhập", sourceReference: "Nguồn riêng" } });
  assert.match(html, /<label for="job-content">Nội dung JD gốc/);
  assert.match(html, /<label for="source-reference">/);
  assert.match(html, />Bản đang nhập<\/textarea>/);
  assert.match(html, /value="Nguồn riêng"/);
});

test("CV library never labels a draft held from decision status alone", () => {
  const html = renderCvLibrary({ jobs: [jobSummary({ decisionStatus: "not-ready" })] });
  assert.match(html, /Đã có bản nháp/);
  assert.doesNotMatch(html, /Đang giữ/);
  assert.match(renderCvLibrary({ jobs: [jobSummary({ cvDraftRecommendation: "hold" })] }), /Đang giữ/);
  assert.doesNotMatch(renderCvLibrary({ jobs: [jobSummary({ artifactStatus: { cvDraft: false } })] }), / download/);
});

test("detail labels a CV draft as held only for an explicit hold recommendation", () => {
  const held = renderJobDetail({ ...populatedFixture(), decision: { ...populatedFixture().decision, cvDraftRecommendation: "hold" } });
  assert.match(held, /Bản nháp CV: đang giữ\./);
  for (const recommendation of [undefined, "unexpected"]) {
    const html = renderJobDetail({ ...populatedFixture(), decision: { ...populatedFixture().decision, cvDraftRecommendation: recommendation } });
    assert.match(html, /Bản nháp CV: chưa có khuyến nghị hợp lệ\./);
    assert.doesNotMatch(html, /Bản nháp CV: đang giữ\./);
  }
});

test("local note save confirms success, rejects blanks and preserves entered text on errors", async () => {
  const browser = browserFixture("#jobs/job-example");
  await initializeBrowserApp(browser.environment);
  await browser.submit("note-form", { content: "Ghi chú riêng" });
  assert.match(browser.notice.textContent, /Đã lưu ghi chú/);
  assert.equal(browser.notice.role, "status");
  await browser.navigate("#jobs");
  await browser.navigate("#jobs/job-example");
  assert.match(browser.html(), />Ghi chú riêng<\/textarea>/);
  const writes = () => browser.requests.filter((request) => request.options.method === "PUT");
  const count = writes().length;
  await browser.submit("note-form", { content: "   " });
  assert.equal(writes().length, count, "blank notes must not be sent");
  assert.match(browser.notice.textContent, /không.*rỗng|nhập.*ghi chú/i);
  browser.failNext(500);
  await browser.submit("note-form", { content: "Giữ lại khi lỗi" });
  assert.equal(browser.notice.role, "alert");
  await browser.refresh();
  assert.match(browser.html(), />Giữ lại khi lỗi<\/textarea>/);
});

test("manual refresh and navigation preserve JD and per-job note drafts", async () => {
  const browser = browserFixture("#new-job");
  await initializeBrowserApp(browser.environment);
  await browser.type("job-form", { content: "Chưa lưu JD", sourceReference: "Nguồn chưa lưu" });
  await browser.refresh();
  assert.match(browser.html(), />Chưa lưu JD<\/textarea>/);
  await browser.navigate("#jobs/job-example");
  await browser.type("note-form", { content: "Ghi chú chưa lưu" });
  await browser.refresh();
  assert.match(browser.html(), />Ghi chú chưa lưu<\/textarea>/);
  await browser.navigate("#new-job");
  assert.match(browser.html(), />Chưa lưu JD<\/textarea>/);
  await browser.submitJob({ content: "Một JD khác", sourceReference: "Nguồn thứ hai" });
  assert.doesNotMatch(browser.html(), /Ghi chú chưa lưu/);
  await browser.navigate("#jobs/job-example");
  assert.match(browser.html(), />Ghi chú chưa lưu<\/textarea>/);
});

test("refresh hydrates real CV recommendations and polls only useful visible routes", async () => {
  const browser = browserFixture("#cvs");
  browser.setDetail({ ...populatedFixture(), decision: { ...populatedFixture().decision, cvDraftRecommendation: "hold" } });
  await initializeBrowserApp(browser.environment);
  assert.match(browser.html(), /Đang giữ/);
  const count = browser.requests.length;
  await browser.poll();
  assert.ok(browser.requests.length > count);
  await browser.navigate("#new-job");
  const intakeCount = browser.requests.length;
  await browser.poll();
  assert.equal(browser.requests.length, intakeCount);
  await browser.navigate("#jobs/job-example");
  browser.setDetail({ ...populatedFixture(), title: "Cập nhật từ máy", analysis: { ...populatedFixture().analysis, title: "Cập nhật từ máy" } });
  await browser.poll();
  assert.match(browser.html(), /<h1[^>]*>Cập nhật từ máy<\/h1>/);
  browser.environment.document.hidden = true;
  const hiddenCount = browser.requests.length;
  await browser.poll();
  assert.equal(browser.requests.length, hiddenCount);
});

test("overview hydrates recommendations for the same newest CV drafts it displays", async () => {
  const browser = browserFixture("#overview");
  browser.setSummary([
    jobSummary({ id: "oldest", title: "Oldest", updatedAt: "2026-08-01T10:00:00Z" }),
    jobSummary({ id: "middle", title: "Middle", updatedAt: "2026-08-02T10:00:00Z" }),
    jobSummary({ id: "newer", title: "Newer", updatedAt: "2026-08-03T10:00:00Z" }),
    jobSummary({ id: "newest", title: "Newest", updatedAt: "2026-08-04T10:00:00Z" }),
  ]);
  browser.setJobDetails({
    middle: { ...populatedFixture(), id: "middle", decision: { ...populatedFixture().decision, cvDraftRecommendation: "create" } },
    newer: { ...populatedFixture(), id: "newer", decision: { ...populatedFixture().decision, cvDraftRecommendation: "hold" } },
    newest: { ...populatedFixture(), id: "newest", decision: { ...populatedFixture().decision, cvDraftRecommendation: "hold" } },
  });

  await initializeBrowserApp(browser.environment);

  const snapshot = browser.html().match(/<section class="card cv-snapshot"[\s\S]*?<\/section>/)?.[0] ?? "";
  assert.ok(snapshot.indexOf("Newest") < snapshot.indexOf("Newer") && snapshot.indexOf("Newer") < snapshot.indexOf("Middle"));
  assert.equal((snapshot.match(/Đang giữ/g) ?? []).length, 2);
  assert.doesNotMatch(snapshot, /Oldest/);
});

test("polling defers DOM replacement during typing and applies the new artifacts afterwards", async () => {
  const browser = browserFixture("#jobs/job-example");
  await initializeBrowserApp(browser.environment);
  await browser.type("note-form", { content: "Đang ghi lại câu hỏi" });
  browser.environment.document.activeElement = { closest: () => ({ id: "job-note" }) };
  browser.setDetail({ ...populatedFixture(), analysis: { ...populatedFixture().analysis, title: "Tài liệu vừa cập nhật" } });
  await browser.poll();
  assert.doesNotMatch(browser.html(), /<h1[^>]*>Tài liệu vừa cập nhật/);
  browser.environment.document.activeElement = undefined;
  await browser.poll();
  assert.match(browser.html(), /<h1[^>]*>Tài liệu vừa cập nhật/);
  assert.match(browser.html(), />Đang ghi lại câu hỏi<\/textarea>/);
});

test("a note save finishing during return navigation cannot cancel the new detail load", async () => {
  const browser = browserFixture("#jobs/job-example");
  await initializeBrowserApp(browser.environment);
  let releaseSave!: () => void;
  let releaseRead!: () => void;
  const saveGate = new Promise<void>((resolve) => { releaseSave = resolve; });
  const readGate = new Promise<void>((resolve) => { releaseRead = resolve; });
  browser.beforeRequest((path, options) => path.endsWith("/note") ? options.method === "PUT" ? saveGate : readGate : Promise.resolve());
  const saving = browser.submit("note-form", { content: "Lưu trong khi chuyển trang" });
  await browser.navigate("#jobs");
  const returning = browser.navigate("#jobs/job-example");
  await new Promise<void>((resolve) => setImmediate(resolve));
  releaseSave();
  await new Promise<void>((resolve) => setImmediate(resolve));
  releaseRead();
  await Promise.all([saving, returning]);
  assert.match(browser.html(), /<h1[^>]*>Backend Developer<\/h1>/);
  assert.match(browser.html(), />Lưu trong khi chuyển trang<\/textarea>/);
  assert.doesNotMatch(browser.html(), /aria-busy="true"/);
});

test("profile source import keeps text local and rejects unsupported or oversized files", async () => {
  const browser = browserFixture("#profile");
  await initializeBrowserApp(browser.environment);
  const source = "# Nguồn CV\r\nVăn bản nguyên gốc\n";
  await browser.submit("profile-source-form", { source: new File([source], "cv.md") });
  const written = browser.requests.filter((request) => request.options.method === "POST");
  assert.equal(written.length, 1);
  assert.equal(written[0]?.path, "/api/profile/source");
  assert.deepEqual(JSON.parse(written[0]?.options.body ?? "null"), { content: source });
  assert.match(browser.notice.textContent, /Đã lưu tệp nguồn/);
  for (const file of [new File(["text"], "cv.pdf"), new File(["x".repeat(1024 * 1024 + 1)], "cv.txt")]) {
    await browser.submit("profile-source-form", { source: file });
    assert.equal(browser.notice.role, "alert");
  }
  assert.equal(browser.requests.filter((request) => request.options.method === "POST").length, 1);
});

test("mobile navigation exposes links on open and returns focus to its button on Escape", async () => {
  const browser = browserFixture("#overview", true);
  await initializeBrowserApp(browser.environment);
  assert.match(browser.html(), /aria-expanded="false"/);
  assert.match(browser.html(), /<nav[^>]* hidden>/);
  await browser.toggleMenu();
  assert.equal(browser.menu.expanded, "true");
  assert.equal(browser.navigation.hidden, false);
  await browser.escapeMenu();
  assert.equal(browser.menu.expanded, "false");
  assert.equal(browser.navigation.hidden, true);
  assert.equal(browser.menu.focused, true);
});

test("renderers escape source, note, profile, status and error text", () => {
  const attack = '\"><img src=x onerror="alert(1)"> & \' </textarea>';
  const detail = populatedFixture();
  const html = [
    renderJobs({ jobs: [jobSummary({ title: attack, company: attack, decisionStatus: attack, sourcePreview: attack, locationPreview: attack })] }),
    renderJobDetail({ ...detail, raw: { content: attack, source: { value: attack } }, analysis: { ...detail.analysis, title: attack, requirements: [{ statement: attack, priority: attack, minimumYears: attack }] }, decision: { ...detail.decision, summary: attack, matches: [{ topic: attack, finding: attack, jobEvidence: attack, profileEvidence: attack }] }, cvDraft: attack }, attack),
    renderProfile({ ...profileFixture(), contact: { name: attack, links: [attack] }, summary: attack, skills: [attack], preferences: { notes: attack } }),
    renderNewJob({ content: attack, sourceReference: attack }),
    renderApplication({ route: { page: "overview" }, summary: { jobs: [] }, error: attack }),
  ].join("");
  assert.doesNotMatch(html, /<img|class="[^"]*<|href="javascript:|\[object Object\]/);
  for (const escaped of ["&lt;img", "&quot;", "&#39;", "&amp;", "&lt;/textarea&gt;"]) assert.ok(html.includes(escaped));
});

function jobSummary(overrides: Record<string, unknown> = {}) {
  return { id: "job-example", sourcePreview: "Backend developer role", title: "Backend Developer", company: "Example Co", decisionStatus: "consider", hasAnalysis: true, hasCvDraft: true, artifactStatus: { source: true, analysis: true, decision: true, cvDraft: true }, updatedAt: "2026-08-02T10:00:00Z", ...overrides };
}

function priorityHref(html: string) {
  return html.match(/class="priority-job"[\s\S]*?<a href="([^"]+)"/)?.[1];
}

function browserFixture(initialHash: string, narrow = false) {
  type Handler = (event?: any) => unknown;
  const pageEvents = new Map<string, Handler>();
  const windowEvents = new Map<string, Handler>();
  const requests: { path: string; options: { method?: string; body?: string; headers?: Record<string, string> } }[] = [];
  let currentForm: any;
  let renderedHtml = "";
  const app = {
    get innerHTML() { return renderedHtml; },
    set innerHTML(html: string) {
      renderedHtml = html;
      currentForm = undefined;
      if (html.includes('id="job-form"')) {
        currentForm = makeForm("job-form", {
          content: decodeHtml(html.match(/<textarea[^>]*id="job-content"[^>]*>([\s\S]*?)<\/textarea>/)?.[1] ?? ""),
          sourceReference: decodeHtml(html.match(/<input[^>]*id="source-reference"[^>]*value="([^"]*)"/)?.[1] ?? ""),
        });
      }
      if (html.includes('id="profile-form"')) {
        const fields = Object.fromEntries([...html.matchAll(/<textarea[^>]*name="([^"]+)"[^>]*>([\s\S]*?)<\/textarea>/g)].map((match) => [match[1], decodeHtml(match[2])]));
        currentForm = makeForm("profile-form", fields);
      }
      if (html.includes('id="opportunity-form"')) {
        const opportunityForm = makeForm("opportunity-form", {
          peerId: decodeHtml(html.match(/<select[^>]*id="opportunity-peer"[^>]*>[\s\S]*?<option value="([^"]+)"/)?.[1] ?? ""),
          relation: decodeHtml(html.match(/<select[^>]*id="opportunity-relation"[^>]*>[\s\S]*?<option value="([^"]+)"/)?.[1] ?? "same"),
        });
        opportunityForm.confirmation.checked = /name="confirmed"[^>]*checked/.test(html);
        currentForm = opportunityForm;
      }
    },
    addEventListener: (name: string, handler: Handler) => pageEvents.set(name, handler),
  };
  let hash = initialHash;
  let navigation: Promise<unknown> = Promise.resolve();
  let focused = 0;
  let created: Record<string, any> | undefined;
  let detail: Record<string, any> = populatedFixture();
  let summaryJobs: Record<string, any>[] | undefined;
  let jobDetails: Record<string, Record<string, any>> = {};
  let note = "Initial local note";
  let profile = profileFixture();
  let profileHash: string | undefined = "profile-original";
  let sourceHash: string | null = null;
  let profileError: string | undefined;
  let noteHash = "note-original";
  let failure: number | undefined;
  let requestHook: ((path: string, options: { method?: string }) => Promise<void>) | undefined;
  let interval: Handler | undefined;
  const notice = { textContent: "", className: "", role: "status", setAttribute(name: string, value: string) { if (name === "role") this.role = value; } };
  const navigationElement = { hidden: narrow };
  const menu = { id: "menu-toggle", expanded: String(!narrow), focused: false, setAttribute(name: string, value: string) { if (name === "aria-expanded") this.expanded = value; }, focus() { this.focused = true; } };
  const window = {
    location: {
      get hash() { return hash; },
      set hash(value: string) {
        if (value === hash) return;
        hash = value;
        navigation = Promise.resolve().then(() => windowEvents.get("hashchange")?.());
      },
    },
    addEventListener: (name: string, handler: Handler) => windowEvents.set(name, handler),
    setInterval(handler: Handler) { interval = handler; return 1; },
    matchMedia: () => ({ matches: narrow }),
  };
  const environment = {
    window,
    document: {
      hidden: false,
      activeElement: undefined as { closest: (selector: string) => unknown } | undefined,
      querySelector(selector: string) {
        if (selector === "#app") return app;
        if (selector === "#page-heading") return { focus: () => { focused += 1; } };
        if (selector === ".skip-link") return { addEventListener() {} };
        if (selector === "#notice") return notice;
        if (selector === "#workspace-navigation") return navigationElement;
        if (selector === "#menu-toggle") return menu;
        if (selector === `#${currentForm?.id}`) return currentForm;
        return null;
      },
    },
    FormData: class {
      fields: Record<string, string | File>;
      constructor(form: { id?: string; fields: Record<string, string | File>; confirmation?: { checked: boolean } }) {
        this.fields = { ...form.fields };
        if (form.id === "opportunity-form") {
          if (form.confirmation?.checked) this.fields.confirmed = "true";
          else delete this.fields.confirmed;
        }
      }
      get(name: string) { return this.fields[name] ?? null; }
      entries() { return Object.entries(this.fields)[Symbol.iterator](); }
    },
    File,
    async fetch(path: string, options: { method?: string; body?: string; headers?: Record<string, string> } = {}) {
      requests.push({ path, options });
      const noteAtRequestStart = note;
      const noteHashAtRequestStart = noteHash;
      await requestHook?.(path, options);
      if (failure) { const status = failure; failure = undefined; return Response.json({ error: "Failure" }, { status }); }
      if (options.method === "POST" && path === "/api/profile/source") return new Response(null, { status: 204, headers: { ETag: '"source-saved"' } });
      if (options.method === "POST" && path === "/api/profile/publish") {
        profile = JSON.parse(options.body ?? "null").profile;
        profileHash = "profile-saved";
        return Response.json({ profile, revision: { id: "revision-saved", createdAt: "2026-09-04T00:00:00.000Z", claimEvidence: [] }, unresolvedCount: 0 }, { headers: { ETag: `"${profileHash}"` } });
      }
      if (options.method === "PUT" && path === "/api/jobs/job-example/note") {
        note = JSON.parse(options.body ?? "null").content;
        noteHash = "note-saved";
        return Response.json({ content: note }, { headers: { ETag: `"${noteHash}"` } });
      }
      const matchedNote = path.match(/^\/api\/jobs\/([^/]+)\/note$/);
      if (matchedNote && options.method !== "PUT") return Response.json({ content: noteAtRequestStart }, { headers: { ETag: `"${noteHashAtRequestStart}"` } });
      if (options.method === "POST" && path === "/api/jobs") {
        const input = JSON.parse(options.body ?? "null");
        created = { ...jobSummary({ id: "job-created", title: undefined, company: undefined, hasAnalysis: false, decisionStatus: undefined, hasCvDraft: false, artifactStatus: { source: true, analysis: false, decision: false, cvDraft: false } }), raw: { content: input.content, source: { value: input.sourceReference } } };
        return Response.json(created, { status: 201 });
      }
      if (path === "/api/opportunities") return Response.json({ health: "healthy", snapshot: { pointerHash: "opportunity-original", revision: null }, groups: [{ key: "job-example", jobIds: ["job-example"] }, { key: "job-other", jobIds: ["job-other"] }], jobIds: ["job-example", "job-other"], repairJobIds: [] });
      if (options.method === "POST" && path === "/api/opportunities/decisions") return Response.json({ health: "healthy", snapshot: { pointerHash: "opportunity-saved", revision: { decisions: [{ leftId: "job-example", rightId: "job-other", relation: JSON.parse(options.body ?? "{}").relation }] } }, groups: [{ key: "job-example", jobIds: ["job-example", "job-other"] }], jobIds: ["job-example", "job-other"], repairJobIds: [] }, { status: 201, headers: { ETag: '"opportunity-saved"' } });
      if (path === "/api/summary") return Response.json({ jobs: summaryJobs ?? [jobSummary(), ...(created ? [created] : [])], profile, profileHash, profileSourceHash: sourceHash, profileError, profileRevision: undefined, profileHistory: { revisions: [] }, unresolvedClaims: [] });
      if (path === "/api/jobs/job-example") return Response.json(detail);
      const matchedJob = path.match(/^\/api\/jobs\/([^/]+)$/);
      if (matchedJob && jobDetails[decodeURIComponent(matchedJob[1])]) return Response.json(jobDetails[decodeURIComponent(matchedJob[1])]);
      if (path === "/api/jobs/job-example/note") return Response.json({ content: noteAtRequestStart }, { headers: { ETag: `"${noteHashAtRequestStart}"` } });
      if (path === "/api/jobs/job-created" && created) return Response.json(created);
      if (path === "/api/jobs/job-created/note" && created) return Response.json({ content: null });
      throw new Error(`Unexpected request: ${options.method ?? "GET"} ${path}`);
    },
  };
  function makeForm(id: string, fields: Record<string, string | File>) {
    const form: any = {
      id,
      fields,
      confirmation: { checked: id === "opportunity-form" && fields.confirmed === "true" },
      get isConnected() { return currentForm === form; },
      querySelector(selector: string) {
        if (id === "opportunity-form" && selector === 'input[name="confirmed"]') return form.confirmation;
        return { disabled: false };
      },
    };
    return form;
  }
  function updateForm(id: string, fields?: Record<string, string | File>) {
    if (currentForm?.id !== id) currentForm = makeForm(id, fields ?? {});
    else if (fields) {
      currentForm.fields = { ...fields };
      if (id === "opportunity-form" && Object.hasOwn(fields, "confirmed")) currentForm.confirmation.checked = fields.confirmed === "true";
    }
    return currentForm;
  }
  async function submit(id: string, fields?: Record<string, string | File>) {
    const form = updateForm(id, id === "profile-form" ? { confirmed: "true", ...fields } : fields);
    await pageEvents.get("submit")?.({ target: form, preventDefault() {} });
    await navigation;
  }
  return {
    environment, requests, notice, menu, navigation: navigationElement,
    form: () => currentForm,
    async editProfile(section: string) { await pageEvents.get("click")?.({ target: { closest: () => ({ dataset: { editProfile: section } }) } }); },
    setProfile(value: typeof profile, hash: string | undefined) { profile = value; profileHash = hash; },
    setSourceHash(value: string) { sourceHash = value; },
    async selectSource() { await pageEvents.get("change")?.({ target: { id: "profile-source" } }); },
    setProfileError(value: string) { profileError = value; },
    setNote(value: string, hash: string) { note = value; noteHash = hash; },
    async toggleMenu() { await pageEvents.get("click")?.({ target: { closest: () => menu } }); },
    async escapeMenu() { await pageEvents.get("keydown")?.({ key: "Escape" }); },
    failNext(status: number) { failure = status; },
    beforeRequest(hook: typeof requestHook) { requestHook = hook; },
    setDetail(value: Record<string, any>) { detail = value; },
    setSummary(value: Record<string, any>[]) { summaryJobs = value; },
    setJobDetails(value: Record<string, Record<string, any>>) { jobDetails = value; },
    html: () => app.innerHTML,
    focusCount: () => focused,
    async navigate(value: string) { window.location.hash = value; await navigation; },
    async refresh() { await pageEvents.get("click")?.({ target: { closest: () => ({ id: "refresh" }) } }); },
    async poll() { await interval?.(); },
    async type(id: string, fields: Record<string, string>) {
      const form = updateForm(id, fields);
      await pageEvents.get("input")?.({ target: { closest: () => form } });
    },
    async confirmOpportunity(fields: Record<string, string>) {
      const form = updateForm("opportunity-form", { ...fields, confirmed: "true" });
      form.confirmation.checked = true;
      await pageEvents.get("change")?.({ target: { closest: () => form, name: "confirmed", checked: true } });
    },
    async changeOpportunity(name: "peerId" | "relation", value: string) {
      const form = updateForm("opportunity-form");
      form.fields = { ...form.fields, [name]: value };
      await pageEvents.get("change")?.({ target: { closest: () => form, name, checked: false } });
    },
    opportunityConfirmationChecked: () => currentForm?.confirmation?.checked ?? false,
    submit,
    submitJob: (fields: Record<string, string>) => submit("job-form", fields),
  };
}

function decodeHtml(value: string) {
  return value.replaceAll("&quot;", '"').replaceAll("&#39;", "'").replaceAll("&lt;", "<").replaceAll("&gt;", ">").replaceAll("&amp;", "&");
}

function profileFixture() {
  return {
    contact: { name: "Nguyễn An", email: "an@example.test", phone: "0900000000", location: "Hà Nội", links: ["https://example.test"] },
    headline: "Designer", summary: "Service design", skills: ["Research"],
    experience: [{ title: "Designer", company: "Studio", startDate: "2020", endDate: "2025", highlights: ["Improved a service"] }],
    education: [{ school: "University", degree: "BA", field: "Design", graduationDate: "2020" }],
    languages: [{ language: "Vietnamese", level: "Native" }], certifications: ["Certificate"],
    preferences: { employmentTypes: ["full-time"], workArrangements: ["hybrid"], locations: ["Hà Nội"], minimumSalary: "Negotiable", schedule: "Flexible hours", notes: "No travel" },
  };
}

function populatedFixture() {
  return {
    ...jobSummary(),
    id: "job-example",
    sourcePreview: "Backend developer role",
    title: "Backend Developer",
    company: "Example Co",
    decisionStatus: "consider",
    hasAnalysis: true,
    hasCvDraft: true,
    raw: { content: "Build reliable APIs.", source: { type: "text", value: "Company site" } },
    analysis: {
      title: "Backend Developer",
      company: "Example Co",
      requirements: [{ category: "experience", statement: "TypeScript", priority: "required", minimumYears: 3, degree: "Bachelor", languageLevel: "English B2" }],
      responsibilities: ["Build APIs"],
      employment: { workArrangement: "hybrid", locations: [{ raw: "Ho Chi Minh City" }], schedule: "Monday to Friday" },
      compensation: { salaryStatus: "stated", salary: "30–40M VND", benefits: ["Health insurance"] },
      workConditions: { overtime: "Occasional", onCall: "Monthly", travel: "None" },
      application: { deadline: "September 30", hiringProcess: ["Interview"] },
      opportunities: { conversionToPermanent: "After probation", training: ["Coaching"], careerGrowth: ["Team lead"], relocation: ["Support available"] },
    },
    decision: {
      status: "consider",
      summary: "Relevant API delivery experience.",
      matches: [{ topic: "TypeScript", finding: "Relevant experience", jobEvidence: "TypeScript", profileEvidence: "Built APIs" }],
      gaps: [],
      blockers: [],
      questions: [],
      cvDraftRecommendation: "create",
    },
    cvDraft: "# CV draft",
  };
}
