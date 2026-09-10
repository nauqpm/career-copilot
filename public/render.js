import { profileToSectionDraft } from "./profile-form.js";

const navigation = [
  ["overview", "Tổng quan"], ["jobs", "Job descriptions"], ["profile", "Hồ sơ cá nhân"],
  ["cvs", "CV theo vị trí"], ["new-job", "Thêm JD mới"],
];
const statusLabels = { consider: "Có thể cân nhắc", clarify: "Cần làm rõ", "not-ready": "Chưa sẵn sàng" };
const arrangementLabels = { onsite: "Tại nơi làm việc", hybrid: "Kết hợp", remote: "Từ xa" };
const employmentLabels = { "full-time": "Toàn thời gian", "part-time": "Bán thời gian", contract: "Hợp đồng", internship: "Thực tập", temporary: "Thời vụ" };
const artifactLabels = [["source", "Nguồn JD"], ["analysis", "Phân tích"], ["decision", "Quyết định"], ["cvDraft", "Bản nháp CV"]];

export function renderApplication({ route = { page: "overview" }, summary = {}, detail, profile = summary.profile, profileEditor, note, jobDraft, error, notice, menuOpen = true, loading = false } = {}) {
  return `${renderSidebar(route, menuOpen)}<main id="workspace" class="workspace-main" aria-busy="${loading}">
    ${(summary.privacyWarnings ?? []).map((warning) => `<p class="warning" role="alert">${escapeHtml(warning)}</p>`).join("")}
    ${summary.profileSourceError ? `<p class="warning" role="alert">${escapeHtml(summary.profileSourceError)}</p>` : ""}
    ${summary.profileError ? `<p class="warning" role="alert">Hồ sơ cần được khôi phục trước khi chỉnh sửa: ${escapeHtml(summary.profileError)}</p>` : ""}
    <p id="notice" class="notice${error ? " error" : ""}" aria-atomic="true" role="${error ? "alert" : "status"}" aria-live="polite">${escapeHtml(error || notice || "")}${error && route.page === "profile" && profileEditor && !error.includes("Nội dung đang nhập được giữ nguyên") ? " Nội dung đang nhập được giữ nguyên; hãy kiểm tra rồi lưu lại." : ""}</p>
    ${loading && route.page === "job" ? pageHeader("Đang tải JD…", "Đọc nguồn và tài liệu trên máy của bạn.") : renderPage({ route, summary, detail, profile, profileEditor, note, jobDraft })}
  </main>`;
}

export function renderSidebar(route = { page: "overview" }, menuOpen = true) {
  const activePage = route.page === "job" ? "jobs" : route.page;
  return `<aside class="app-sidebar" aria-label="Điều hướng chính">
    <a class="brand" href="#overview">Career Copilot</a>
    <p class="local-badge">Chỉ lưu trên máy này</p>
    <button id="menu-toggle" class="menu-toggle secondary" type="button" aria-controls="workspace-navigation" aria-expanded="${menuOpen}">Menu</button>
    <nav id="workspace-navigation" aria-label="Không gian làm việc"${menuOpen ? "" : " hidden"}>${navigation.map(([page, label]) => `<a href="#${page}" class="nav-link${activePage === page ? " active" : ""}"${activePage === page ? ' aria-current="page"' : ""}>${label}${activePage === page ? '<span class="nav-indicator" aria-hidden="true"> •</span>' : ""}</a>`).join("")}</nav>
    <p class="sidebar-note">JD, hồ sơ và bản nháp được giữ trong thư mục cục bộ.</p>
  </aside>`;
}

export function renderPage({ route = { page: "overview" }, summary = {}, detail, profile = summary.profile, profileEditor, note, jobDraft } = {}) {
  switch (route.page) {
    case "jobs": return renderJobs(summary);
    case "job": return renderJobDetail(detail, note);
    case "profile": return summary.profileError && !profileEditor ? pageHeader("Hồ sơ cá nhân", "Hồ sơ đang lỗi. Hãy khôi phục dữ liệu rồi tải lại.") : renderProfile(profile, profileEditor, summary);
    case "cvs": return renderCvLibrary(summary);
    case "new-job": return renderNewJob(jobDraft);
    default: return renderOverview(summary, profile);
  }
}

export function renderOverview(summary = {}, profile = summary.profile) {
  const jobs = sortJobsForDisplay(summary.jobs);
  const priority = jobs.find((job) => job.decisionStatus === "clarify") ?? jobs.find((job) => !job.hasAnalysis) ?? jobs[0];
  const drafts = jobs.filter((job) => job.artifactStatus?.cvDraft === true);
  return `${pageHeader("Tổng quan", "Tiếp tục công việc từ những dữ liệu bạn đã lưu.")}
    ${jobs.length ? `<dl class="workspace-counts">${definition("JD đã lưu", jobs.length)}${definition("Cần làm rõ", jobs.filter((job) => job.decisionStatus === "clarify").length)}${definition("Bản nháp CV", drafts.length)}</dl>` : emptyJobs()}
    <div class="overview-grid">
      ${priority ? `<section class="card priority-panel" aria-labelledby="priority-heading"><h2 id="priority-heading">Ưu tiên hôm nay</h2><div class="priority-job">${renderJobRow(priority)}</div>${renderWorkflow(priority)}</section>` : ""}
      <section class="card recent-jobs" aria-labelledby="recent-heading"><div class="section-heading"><h2 id="recent-heading">JD cập nhật gần đây</h2><a href="#jobs">Xem tất cả JD</a></div>${jobs.length ? renderJobList(jobs.slice(0, 5)) : '<p class="empty-state">JD mới sẽ xuất hiện tại đây sau khi bạn lưu.</p>'}</section>
      <section class="card profile-snapshot"><h2>Hồ sơ cá nhân</h2>${renderProfileSnapshot(profile, summary)}<a href="#profile">Mở hồ sơ cá nhân</a></section>
      <section class="card cv-snapshot"><div class="section-heading"><h2>CV theo vị trí</h2><a href="#cvs">Xem thư viện CV</a></div>${drafts.length ? renderCvList(drafts.slice(0, 3)) : emptyCv()}</section>
      ${priority ? "" : renderWorkflow()}
    </div>`;
}

export function renderJobs(summary = {}) {
  const jobs = sortJobsForDisplay(summary.jobs);
  return `${pageHeader("Job descriptions", "Nguồn JD và các tài liệu đã có cho từng vị trí.")}<section class="card jobs-library" aria-label="Danh sách JD">${jobs.length ? renderJobList(jobs) : emptyJobs()}</section>`;
}

export function renderJobDetail(detail, note = "") {
  if (!detail) return `${pageHeader("Không tìm thấy JD", "JD chưa có trong thư mục cục bộ hoặc chưa tải được.")}<a href="#jobs">Trở về danh sách JD</a>`;
  const analysis = detail.analysis;
  const decision = detail.decision;
  const title = analysis?.title ?? detail.title ?? "JD chưa có tiêu đề";
  const company = analysis?.company ?? detail.company ?? "Chưa có tên đơn vị";
  return `${pageHeader(title, company)}
    <div class="detail-layout">
      <article class="card evidence-sheet">
        <header class="detail-header"><div><p>${escapeHtml(detail.sourcePreview ?? "")}</p><p>${escapeHtml(jobMeta(detail))}</p>${renderTime(detail.updatedAt)}</div>${renderStatus(decision?.status, Boolean(analysis))}</header>
        ${detail.invalidDerivedData ? `<p class="warning" role="alert">Tài liệu dẫn xuất cần được kiểm tra: ${escapeHtml(detail.invalidDerivedData)}. Hãy yêu cầu Codex kiểm tra tệp liên quan trước khi tải lại.</p>` : ""}
        ${analysis ? renderAnalysis(analysis) : `<section class="detail-section"><h2>Chưa có phân tích</h2><p>Chưa có phân tích hợp lệ để hiển thị thông tin vị trí.</p>${renderWorkflow(detail, "analysis")}</section>`}
        ${decision ? renderDecision(decision) : `<section class="detail-section"><h2>Chưa có quyết định</h2><p>${analysis ? "Dùng phân tích đã kiểm tra và hồ sơ cá nhân để đánh giá vị trí trong Codex." : "Hoàn thành và kiểm tra phân tích JD trước khi đánh giá cùng hồ sơ cá nhân."}</p>${analysis ? renderWorkflow(detail, "decision") : ""}</section>`}
        <section class="detail-section"><div class="section-heading"><h2>Bản nháp CV</h2>${detail.cvDraft ? downloadLink(detail.id) : ""}</div>${detail.cvDraft ? `<p>${decision?.cvDraftRecommendation === "hold" ? "Đang giữ theo quyết định hiện tại." : "Bản nháp riêng cho vị trí này; không thay thế hồ sơ gốc."}</p><pre class="draft-preview">${escapeHtml(detail.cvDraft)}</pre>` : '<p class="empty-state">Chưa có bản nháp CV. Chỉ tạo bản nháp trong Codex khi quyết định đã được kiểm tra và cho phép tạo.</p>'}</section>
        <details class="source-jd"><summary>Nội dung JD gốc</summary><p class="source-reference">Nguồn: ${escapeHtml(detail.raw?.source?.value ?? "Chưa có nguồn tham chiếu")}</p><pre>${escapeHtml(detail.raw?.content ?? "")}</pre></details>
      </article>
      <aside class="detail-sidebar" aria-label="Tài liệu và ghi chú JD"><section class="card"><h2>Tài liệu của JD</h2>${renderArtifacts(detail)}</section>${renderNoteForm(note)}</aside>
    </div>`;
}

export function renderProfile(profile, editor, summary = {}) {
  const contact = profile?.contact ?? {};
  const preferences = profile?.preferences ?? {};
  return `${pageHeader("Hồ sơ cá nhân", "Các thông tin gốc của bạn, dùng lại cho nhiều vị trí.")}
    <section class="card profile-summary">${renderProfileSnapshot(profile, summary)}${renderProfileHistory(summary)}</section>
    <p>Chọn “Chỉnh sửa”, cập nhật thông tin có thật rồi chọn “Lưu mục này”. Các nhóm khác được giữ nguyên.</p>
    <div class="profile-folders">
      ${profileFolder("identity", "Liên hệ & giới thiệu", contact.name ?? profile?.headline ?? "Chưa có thông tin giới thiệu", `<dl class="fact-grid">${optionalDefinitions([["Họ tên", contact.name], ["Email", contact.email], ["Điện thoại", contact.phone], ["Nơi ở", contact.location], ["Giới thiệu ngắn", profile?.headline], ["Tóm tắt", profile?.summary]])}</dl>${renderTextList("Liên kết", contact.links)}`, profile, editor)}
      ${profileFolder("experience", "Vai trò & thành tựu", `${profile?.experience?.length ?? 0} vai trò · ${profile?.education?.length ?? 0} học vấn`, `${renderExperience(profile?.experience)}${renderEducation(profile?.education)}`, profile, editor)}
      ${profileFolder("skills", "Kỹ năng & ngôn ngữ", `${profile?.skills?.length ?? 0} kỹ năng · ${profile?.languages?.length ?? 0} ngôn ngữ · ${profile?.certifications?.length ?? 0} chứng chỉ`, `${renderTextList("Kỹ năng", profile?.skills)}${renderTextList("Ngôn ngữ", profile?.languages?.map((item) => [item.language, item.level].filter(Boolean).join(" — ")))}${renderTextList("Chứng chỉ", profile?.certifications)}`, profile, editor)}
      ${profileFolder("preferences", "Điều kiện tìm việc", preferences.locations?.join(" · ") || "Địa điểm, lịch làm việc và mong muốn", `${renderTextList("Loại hình công việc", preferences.employmentTypes?.map((value) => employmentLabels[value] ?? value))}${renderTextList("Hình thức làm việc", preferences.workArrangements?.map((value) => arrangementLabels[value] ?? value))}${renderTextList("Địa điểm", preferences.locations)}<dl class="fact-grid">${optionalDefinitions([["Mức lương tối thiểu", preferences.minimumSalary], ["Lịch làm việc", preferences.schedule], ["Ghi chú", preferences.notes]])}</dl>`, profile, editor)}
    </div>
    <form id="profile-source-form" class="card source-import"><h2>Nguồn CV gốc</h2><p>Tệp nguồn được lưu riêng và không tự thay đổi hồ sơ.</p><label for="profile-source">Tệp CV nguồn (.txt hoặc .md)</label><input id="profile-source" name="source" type="file" accept=".txt,.md,text/plain,text/markdown" required><button type="submit">Lưu tệp nguồn trên máy</button></form>`;
}

export function renderCvLibrary(summary = {}) {
  const drafts = sortJobsForDisplay(summary.jobs).filter((job) => job.artifactStatus?.cvDraft === true);
  return `${pageHeader("CV theo vị trí", "Bản nháp cục bộ gắn với từng JD, tải dưới dạng Markdown.")}<section class="card cv-library">${drafts.length ? renderCvList(drafts) : emptyCv()}</section>`;
}

export function renderNewJob(draft = {}) {
  return `${pageHeader("Thêm JD mới", "Giữ lại nguyên văn nguồn trước khi làm việc với Codex.")}
    <form id="job-form" class="card form-card"><p>Nội dung chỉ lưu trên máy của bạn. Trang này không tự phân tích JD hoặc gửi dữ liệu cho Codex.</p>
      <label for="source-reference">Liên kết hoặc nhãn nguồn <span>(không bắt buộc)</span></label><input id="source-reference" name="sourceReference" type="text" value="${escapeHtml(draft.sourceReference ?? "")}" placeholder="Trang tuyển dụng hoặc nguồn bạn đã nhận">
      <label for="job-content">Nội dung JD gốc</label><textarea id="job-content" name="content" rows="14" required>${escapeHtml(draft.content ?? "")}</textarea>
      <button type="submit">Lưu JD trên máy</button>
    </form>`;
}

function pageHeader(title, description) {
  return `<header class="page-header"><div><p class="eyebrow">Không gian nghề nghiệp cục bộ</p><h1 id="page-heading" tabindex="-1">${escapeHtml(title)}</h1><p>${escapeHtml(description)}</p></div><button id="refresh" type="button" class="secondary">Tải lại dữ liệu</button></header>`;
}

export function sortJobsForDisplay(jobs = []) {
  return [...jobs].sort((left, right) => (Date.parse(right.updatedAt) || 0) - (Date.parse(left.updatedAt) || 0) || left.id.localeCompare(right.id));
}

function renderJobList(jobs) {
  return `<ul class="job-list">${jobs.map((job) => `<li>${renderJobRow(job)}</li>`).join("")}</ul>`;
}

function renderJobRow(job) {
  return `<article class="job-row"><div class="job-identity"><a href="${jobHref(job.id)}">${escapeHtml(job.title ?? job.company ?? "JD chưa có tiêu đề")}</a>${job.title && job.company ? `<p>${escapeHtml(job.company)}</p>` : ""}<p>${escapeHtml(jobMeta(job) || job.sourcePreview || "")}</p></div><div class="job-state">${renderStatus(job.decisionStatus, job.hasAnalysis)}${renderTime(job.updatedAt)}</div>${renderArtifacts(job)}${job.invalidSourceData ? `<p class="warning">Nguồn JD cần được khôi phục: ${escapeHtml(job.invalidSourceData)}</p>` : ""}${job.invalidDerivedData ? '<p class="warning">Có tài liệu cần được kiểm tra. Mở JD để xem chi tiết.</p>' : ""}</article>`;
}

function jobMeta(job) {
  return [job.locationPreview, arrangementLabels[job.workArrangement], employmentLabels[job.employmentType]].filter(Boolean).join(" · ");
}

function renderStatus(status, hasAnalysis) {
  const known = Object.hasOwn(statusLabels, status);
  return `<span class="decision-status status-${known ? status : "pending"}">${known ? statusLabels[status] : hasAnalysis ? "Chờ quyết định" : "Chờ phân tích"}</span>`;
}

function renderArtifacts(job) {
  return `<ul class="artifact-list" aria-label="Tình trạng tài liệu">${artifactLabels.map(([key, label]) => {
    const present = job.artifactStatus?.[key];
    return `<li class="artifact-chip${present === true ? " available" : " missing"}">${label}<span>${present === true ? " — Đã có" : present === false ? " — Chưa có" : " — Chưa xác định"}</span></li>`;
  }).join("")}</ul>`;
}

function renderTime(value) {
  const date = new Date(value);
  if (!value || Number.isNaN(date.getTime())) return '<span class="updated-time">Chưa có thời gian cập nhật</span>';
  return `<time class="updated-time" datetime="${escapeHtml(value)}">Cập nhật ${escapeHtml(date.toLocaleString("vi-VN"))}</time>`;
}

function renderWorkflow(job, kind) {
  const step = kind ?? (job?.hasAnalysis ? "decision" : "analysis");
  const skill = step === "decision" ? "assess-job" : "analyze-job";
  return `<details class="workflow-reminder"><summary>Mở Codex workflow</summary><p>Đây chỉ là hướng dẫn; trang này không tự chạy Codex.</p>${job ? `<p>Trong Codex, đọc <code>data/jobs/${escapeHtml(job.id)}/${step === "decision" ? "analysis.json" : "raw.json"}</code>, làm theo <code>skills/${skill}/SKILL.md</code>, kiểm tra kết quả rồi lưu <code>${step}.json</code> vào cùng thư mục. ${step === "decision" ? "Dùng hồ sơ cá nhân gốc khi đánh giá." : "Giữ nguyên nội dung nguồn JD."}</p>` : '<p>Lưu một JD trước, sau đó mở Codex và làm theo <code>skills/analyze-job/SKILL.md</code> với nguồn cục bộ.</p>'}<p>Quay lại đây và chọn “Tải lại dữ liệu” để xem kết quả.</p></details>`;
}

function renderAnalysis(analysis) {
  const employment = analysis.employment ?? {};
  const conditions = analysis.workConditions ?? {};
  const opportunities = analysis.opportunities ?? {};
  return `<section class="detail-section"><h2>Thông tin từ JD</h2><dl class="fact-grid">${optionalDefinitions([
    ["Mức lương", analysis.compensation?.salaryStatus === "stated" ? analysis.compensation.salary : undefined], ["Cấp bậc", analysis.seniority],
    ["Địa điểm", employment.locations?.map((item) => item.raw).join(" · ")], ["Hình thức", arrangementLabels[employment.workArrangement]], ["Loại hình", employmentLabels[employment.type]],
    ["Lịch làm việc", employment.schedule], ["Thời hạn", employment.duration], ["Ngày bắt đầu", employment.startDate], ["Thử việc", employment.probation], ["Yêu cầu có mặt", employment.onsiteExpectation],
  ])}</dl>${renderRequirements(analysis.requirements)}${renderTextList("Trách nhiệm", analysis.responsibilities)}${renderTextList("Phúc lợi", analysis.compensation?.benefits)}</section>
    ${Object.keys(conditions).length ? `<section class="detail-section"><h2>Điều kiện làm việc</h2><dl class="fact-grid">${optionalDefinitions([["Làm thêm giờ", conditions.overtime], ["Trực ngoài giờ", conditions.onCall], ["Công tác", conditions.travel]])}</dl></section>` : ""}
    ${analysis.application ? `<section class="detail-section"><h2>Lịch tuyển dụng</h2><dl>${optionalDefinitions([["Hạn ứng tuyển", analysis.application.deadline]])}</dl>${renderTextList("Quy trình tuyển dụng", analysis.application.hiringProcess)}</section>` : ""}
    ${Object.keys(opportunities).length ? `<section class="detail-section"><h2>Cơ hội</h2><dl>${optionalDefinitions([["Chuyển sang chính thức", opportunities.conversionToPermanent]])}</dl>${renderTextList("Đào tạo", opportunities.training)}${renderTextList("Phát triển nghề nghiệp", opportunities.careerGrowth)}${renderTextList("Hỗ trợ chuyển nơi ở", opportunities.relocation)}</section>` : ""}`;
}

function renderRequirements(requirements = []) {
  if (!requirements.length) return '<section class="subsection"><h3>Yêu cầu</h3><p>JD chưa nêu yêu cầu cụ thể.</p></section>';
  const priorities = { required: "Bắt buộc", preferred: "Ưu tiên", unknown: "Chưa xác định mức yêu cầu" };
  return `<section class="subsection"><h3>Yêu cầu</h3><ul>${requirements.map((item) => `<li><p>${escapeHtml(item.statement)}${Object.hasOwn(priorities, item.priority) ? ` <span class="priority">${priorities[item.priority]}</span>` : ""}</p><dl>${optionalDefinitions([["Kinh nghiệm", item.minimumYears === undefined ? undefined : `${item.minimumYears} năm trở lên`], ["Trình độ", item.degree], ["Ngôn ngữ", item.languageLevel]])}</dl></li>`).join("")}</ul></section>`;
}

function renderDecision(decision) {
  const cvRecommendation = decision.cvDraftRecommendation === "create" ? "có thể tạo theo quyết định này" : decision.cvDraftRecommendation === "hold" ? "đang giữ" : "chưa có khuyến nghị hợp lệ";
  return `<section class="detail-section decision-section"><h2>Bằng chứng cho quyết định</h2><p>${escapeHtml(decision.summary)}</p>${renderEvidenceList("Điểm đáp ứng", decision.matches)}${renderEvidenceList("Khoảng trống", decision.gaps)}${renderEvidenceList("Trở ngại", decision.blockers)}${renderTextList("Câu hỏi cần làm rõ", decision.questions)}<p class="recommendation">Bản nháp CV: ${cvRecommendation}.</p></section>`;
}

function renderEvidenceList(title, items) {
  if (!items?.length) return "";
  return `<section class="subsection"><h3>${escapeHtml(title)}</h3><ul>${items.map((item) => `<li><strong>${escapeHtml(item.topic)}:</strong> ${escapeHtml(item.finding)}${item.jobEvidence ? `<p>Nguồn JD: ${escapeHtml(item.jobEvidence)}</p>` : ""}${item.profileEvidence ? `<p>Hồ sơ: ${escapeHtml(item.profileEvidence)}</p>` : ""}</li>`).join("")}</ul></section>`;
}

function renderNoteForm(note) {
  return `<form id="note-form" class="card note-form"><label for="job-note">Ghi chú cá nhân</label><p id="note-help">Chỉ lưu trên máy; không tự gửi cho Codex. Lưu ghi chú không rỗng để giữ lại câu hỏi và ý riêng của bạn.</p><textarea id="job-note" name="content" rows="8" aria-describedby="note-help" required>${escapeHtml(note ?? "")}</textarea><button type="submit">Lưu ghi chú</button></form>`;
}

function renderProfileSnapshot(profile, summary = {}) {
  if (!profile) return '<p class="empty-state">Chưa có hồ sơ cá nhân. Thêm những thông tin có thật mà bạn muốn dùng lại cho các vị trí.</p>';
  const revision = summary.profileRevision;
  const evidenceCount = revision?.evidenceCount ?? 0;
  const unresolvedCount = revision?.unresolvedCount ?? summary.unresolvedClaims?.length ?? 0;
  const revisionMeta = revision ? `<p class="profile-revision" data-profile-revision="${escapeHtml(revision.id)}">Phiên bản ${escapeHtml(revision.id)} · ${escapeHtml(revision.createdAt)} · ${evidenceCount} bằng chứng · ${unresolvedCount} cần xác nhận</p>` : '<p class="profile-revision">Hồ sơ legacy · chưa có phiên bản đã xác nhận</p>';
  return `<p><strong>${escapeHtml(profile.contact?.name ?? profile.headline ?? "Hồ sơ đã lưu")}</strong>${profile.contact?.name && profile.headline ? ` — ${escapeHtml(profile.headline)}` : ""}</p><p>${profile.skills?.length ?? 0} kỹ năng · ${profile.experience?.length ?? 0} vai trò · ${profile.languages?.length ?? 0} ngôn ngữ</p>${revisionMeta}`;
}

function renderProfileHistory(summary = {}) {
  const history = summary.profileHistory?.revisions ?? [];
  if (!history.length) return "";
  return `<details class="profile-history"><summary>Lịch sử phiên bản (${history.length})</summary><ul>${history.map((entry) => `<li data-revision-id="${escapeHtml(entry.id)}"><strong>${escapeHtml(entry.id)}</strong> · ${escapeHtml(entry.createdAt)} · ${entry.evidenceCount ?? 0} bằng chứng${entry.unresolvedCount ? ` · ${entry.unresolvedCount} <span class="evidence-status needs-confirmation">Cần xác nhận</span>` : ""}${entry.active ? ' · <span class="evidence-status active">Đang dùng</span>' : ""}</li>`).join("")}</ul></details>`;
}

function profileFolder(section, title, summary, content, profile, editor) {
  const editing = editor?.section === section;
  return `<details class="card profile-folder" data-profile-section="${section}"${editing ? " open" : ""}><summary>${escapeHtml(title)} <span class="folder-summary">— ${escapeHtml(summary)}</span></summary><div class="profile-folder-content">${editing ? renderProfileForm(section, { ...profileToSectionDraft(profile, section), ...editor.draft }, editor.saving) : `${content}<button type="button" data-edit-profile="${section}" aria-label="Chỉnh sửa ${escapeHtml(title)}">Chỉnh sửa</button>`}</div></details>`;
}

function renderProfileForm(section, draft, saving = false) {
  const lineHelp = String.raw`Mỗi dòng một mục. Bỏ trống để xóa danh sách. Trong một mục, dùng \n cho xuống dòng, \\ cho dấu \ và \| cho dấu |.`;
  const recordHelp = String.raw`Mỗi dòng một bản ghi. Giữ dấu | cho ô chưa biết; không đoán dữ liệu. Dùng \| cho dấu | trong nội dung, \\ cho dấu \ và \n cho xuống dòng trong một ô. Xóa dòng để bỏ bản ghi.`;
  const field = (name, label, help = "", rows = 2) => `<div class="profile-field"><label for="profile-${name}">${label}</label><textarea id="profile-${name}" name="${name}" rows="${rows}"${help ? ` aria-describedby="profile-${name}-help"` : ""}>${escapeHtml(draft[name] ?? "")}</textarea>${help ? `<p id="profile-${name}-help" class="field-help">${escapeHtml(help)}</p>` : ""}</div>`;
  let fields;
  if (section === "identity") fields = `${field("name", "Họ tên", "", 1)}${field("email", "Email", "", 1)}${field("phone", "Điện thoại", "", 1)}${field("location", "Nơi ở", "", 1)}${field("links", "Liên kết", lineHelp, 3)}${field("headline", "Giới thiệu ngắn")}${field("summary", "Tóm tắt", "", 5)}`;
  if (section === "experience") fields = `${field("experience", "Vai trò và thành tựu", `Định dạng: Vai trò | Đơn vị | Ngày bắt đầu | Ngày kết thúc | Thành tựu 1 | Thành tựu 2… Vai trò là bắt buộc; có thể để trống thành tựu. ${recordHelp}`, 7)}${field("education", "Học vấn", `Định dạng: Trường | Bằng cấp | Ngành học | Ngày tốt nghiệp. Điền ít nhất một ô. ${recordHelp}`, 5)}`;
  if (section === "skills") fields = `${field("skills", "Kỹ năng", lineHelp, 5)}${field("languages", "Ngôn ngữ", `Định dạng: Ngôn ngữ | Trình độ. Ngôn ngữ là bắt buộc; có thể để trống trình độ. ${recordHelp}`, 4)}${field("certifications", "Chứng chỉ", lineHelp, 4)}`;
  if (section === "preferences") fields = `${field("employmentTypes", "Loại hình công việc", "Mỗi dòng một mã: full-time (toàn thời gian), part-time (bán thời gian), contract (hợp đồng), internship (thực tập), temporary (thời vụ). Bỏ trống nếu chưa có yêu cầu.", 3)}${field("workArrangements", "Hình thức làm việc", "Mỗi dòng một mã: onsite (tại nơi làm việc), hybrid (kết hợp), remote (từ xa). Bỏ trống nếu chưa có yêu cầu.", 3)}${field("locations", "Địa điểm mong muốn", lineHelp, 3)}${field("minimumSalary", "Mức lương tối thiểu", "Ghi cả đơn vị tiền và kỳ trả lương nếu đã xác định; để trống nếu chưa biết.")}${field("schedule", "Lịch làm việc")}${field("notes", "Ghi chú", "", 4)}`;
  return `<form id="profile-form" class="profile-section-form" data-profile-section="${section}"><p>Chỉ lưu thông tin bạn đã xác nhận. Bản đang nhập được giữ khi chuyển nhóm; chỉ nút lưu mới ghi xuống máy.</p><fieldset class="profile-fields" aria-label="Thông tin nhóm hồ sơ"${saving ? " disabled" : ""}>${fields}<label class="profile-confirmation"><input type="checkbox" name="confirmed" value="true" required> Tôi xác nhận các thông tin trong bản hồ sơ này là đúng</label><div class="profile-form-actions"><button type="submit">Lưu mục này</button><button type="button" class="secondary" data-cancel-profile="${section}">Hủy chỉnh sửa nhóm này</button></div></fieldset></form>`;
}

function renderExperience(items) {
  if (!items?.length) return '<p class="empty-state">Chưa có vai trò và thành tựu. Bổ sung kinh nghiệm thực tế của bạn.</p>';
  return items.map((item) => `<section class="subsection"><h3>${escapeHtml(item.title)}</h3><p>${escapeHtml([item.company, item.startDate, item.endDate].filter(Boolean).join(" · "))}</p>${renderTextList("Thành tựu", item.highlights)}</section>`).join("");
}

function renderEducation(items) {
  if (!items?.length) return "";
  return `<section class="subsection"><h3>Học vấn</h3><ul>${items.map((item) => `<li>${escapeHtml([item.school, item.degree, item.field, item.graduationDate].filter(Boolean).join(" · "))}</li>`).join("")}</ul></section>`;
}

function renderCvList(jobs) {
  return `<ul class="cv-list">${jobs.map((job) => `<li><a href="${jobHref(job.id)}">${escapeHtml(job.title ?? job.company ?? "JD chưa có tiêu đề")}</a><p>${job.cvDraftRecommendation === "hold" ? "Đang giữ" : "Đã có bản nháp"}${job.cvRecommendationError ? " · Chưa tải được quyết định; mở JD để kiểm tra." : ""}</p>${renderTime(job.cvDraftUpdatedAt)}${downloadLink(job.id)}</li>`).join("")}</ul>`;
}

function renderTextList(title, items) {
  if (!items?.length) return "";
  return `<section class="subsection"><h3>${escapeHtml(title)}</h3><ul>${items.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul></section>`;
}

function optionalDefinitions(entries) { return entries.filter(([, value]) => value !== undefined && value !== "").map(([label, value]) => definition(label, value)).join(""); }
function definition(label, value) { return `<div><dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value)}</dd></div>`; }
function emptyJobs() { return '<div class="empty-state"><h2>Chưa có JD</h2><p>Dán nội dung một vị trí để bắt đầu giữ nguồn và xem các tài liệu liên quan.</p><a class="button-link" href="#new-job">Thêm JD mới</a></div>'; }
function emptyCv() { return '<p class="empty-state">Chưa có bản nháp CV. Mở một JD đã có quyết định để xem hướng dẫn tạo bản nháp riêng trong Codex.</p><a href="#jobs">Mở danh sách JD</a>'; }
function jobHref(id) { return `#jobs/${escapeHtml(encodeURIComponent(id))}`; }
function downloadLink(id) { return `<a class="button-link" href="/api/jobs/${escapeHtml(encodeURIComponent(id))}/cv-draft" download>Tải bản nháp Markdown</a>`; }
function escapeHtml(value) { return String(value).replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]); }
