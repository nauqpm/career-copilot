import assert from "node:assert/strict";
import test from "node:test";

import { renderApplication, renderCvLibrary, renderJobDetail, renderJobs, renderNewJob, renderOverview, renderProfile } from "../public/render.js";
import { parseRoute } from "../public/routes.js";
import { initializeBrowserApp } from "../public/app.js";

test("browser controller loads the initial job hash with its source and note", async () => {
  const browser = browserFixture("#jobs/job-example");
  await initializeBrowserApp(browser.environment);

  assert.match(browser.html(), /<h1[^>]*>Backend Developer<\/h1>/);
  assert.match(browser.html(), /Build reliable APIs\./);
  assert.match(browser.html(), />Initial local note<\/textarea>/);
  assert.deepEqual(browser.requests.map((request) => request.path), ["/api/summary", "/api/jobs/job-example", "/api/jobs/job-example/note"]);
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

function browserFixture(initialHash: string) {
  type Handler = (event?: any) => unknown;
  const pageEvents = new Map<string, Handler>();
  const windowEvents = new Map<string, Handler>();
  const requests: { path: string; options: { method?: string; body?: string } }[] = [];
  const app = { innerHTML: "", addEventListener: (name: string, handler: Handler) => pageEvents.set(name, handler) };
  let hash = initialHash;
  let navigation: Promise<unknown> = Promise.resolve();
  let focused = 0;
  let created: Record<string, any> | undefined;
  const window = {
    location: {
      get hash() { return hash; },
      set hash(value: string) {
        hash = value;
        navigation = Promise.resolve().then(() => windowEvents.get("hashchange")?.());
      },
    },
    addEventListener: (name: string, handler: Handler) => windowEvents.set(name, handler),
  };
  const environment = {
    window,
    document: {
      querySelector(selector: string) {
        if (selector === "#app") return app;
        if (selector === "#page-heading") return { focus: () => { focused += 1; } };
        if (selector === ".skip-link") return { addEventListener() {} };
        throw new Error(`Unexpected element: ${selector}`);
      },
    },
    FormData: class {
      form: { fields: Record<string, string> };
      constructor(form: { fields: Record<string, string> }) { this.form = form; }
      get(name: string) { return this.form.fields[name] ?? null; }
    },
    File: class {},
    async fetch(path: string, options: { method?: string; body?: string } = {}) {
      requests.push({ path, options });
      if (options.method === "POST" && path === "/api/jobs") {
        const input = JSON.parse(options.body ?? "null");
        created = { ...jobSummary({ id: "job-created", title: undefined, company: undefined, hasAnalysis: false, decisionStatus: undefined, hasCvDraft: false, artifactStatus: { source: true, analysis: false, decision: false, cvDraft: false } }), raw: { content: input.content, source: { value: input.sourceReference } } };
        return Response.json(created, { status: 201 });
      }
      if (path === "/api/summary") return Response.json({ jobs: [jobSummary(), ...(created ? [created] : [])], profile: profileFixture() });
      if (path === "/api/jobs/job-example") return Response.json(populatedFixture());
      if (path === "/api/jobs/job-example/note") return Response.json({ content: "Initial local note" });
      if (path === "/api/jobs/job-created" && created) return Response.json(created);
      if (path === "/api/jobs/job-created/note" && created) return Response.json({ content: null });
      throw new Error(`Unexpected request: ${options.method ?? "GET"} ${path}`);
    },
  };
  return {
    environment, requests,
    html: () => app.innerHTML,
    focusCount: () => focused,
    async navigate(value: string) { window.location.hash = value; await navigation; },
    async submitJob(fields: Record<string, string>) {
      const form = { id: "job-form", fields, isConnected: true, querySelector: () => ({ disabled: false }) };
      await pageEvents.get("submit")?.({ target: form, preventDefault() {} });
      await navigation;
    },
  };
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
