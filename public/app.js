const state = { summary: { jobs: [], profile: undefined }, selectedId: undefined, detail: undefined, fingerprint: "" };

export function renderDashboard(summary) {
  const jobs = summary.jobs ?? [];
  const queue = jobs.length === 0
    ? `<p class="empty-state">No jobs yet. Use <strong>Add a job</strong> to paste a description you want to assess.</p>`
    : `<ul class="job-list">${jobs.map(renderJobListItem).join("")}</ul>`;

  return `<div class="workspace-grid">
    <aside class="card job-queue" aria-labelledby="queue-heading">
      <div class="section-heading"><h2 id="queue-heading">Job queue</h2><button id="refresh" type="button" class="secondary">Refresh Codex files</button></div>
      ${queue}
    </aside>
    <section id="detail" class="detail-panel" aria-live="polite">${state.detail ? renderJobDetail(state.detail) : renderSelectPrompt(jobs.length)}</section>
  </div>`;
}

export function renderJobDetail(detail) {
  const analysis = detail.analysis;
  const decision = detail.decision;
  const status = decision?.status ?? "awaiting";
  const title = analysis?.title ?? detail.title ?? "Untitled job";
  const company = analysis?.company ?? detail.company;
  const statusLabel = statusText(status);
  const derivedNotice = detail.invalidDerivedData ? `<p class="warning">${escapeHtml(detail.invalidDerivedData)} Ask Codex to validate the affected file before refreshing.</p>` : "";
  const analysisContent = analysis ? renderAnalysis(analysis) : renderAwaitingAnalysis(detail.id);
  const decisionContent = decision ? renderDecision(decision) : renderAwaitingDecision(detail.id, Boolean(analysis));
  const draft = detail.cvDraft
    ? `<section class="detail-section"><div class="section-heading"><h3>Tailored CV draft</h3><a class="button-link" href="/api/jobs/${encodeURIComponent(detail.id)}/cv-draft" download>Download CV draft</a></div><pre class="draft-preview">${escapeHtml(detail.cvDraft)}</pre></section>`
    : "";

  return `<article class="card evidence-sheet">
    <header class="detail-header">
      <div><p class="eyebrow">${escapeHtml(company ?? "Saved local job")}</p><h2>${escapeHtml(title)}</h2><p>${escapeHtml(detail.sourcePreview)}</p></div>
      <div class="decision-strip status-${status}"><span class="status-kicker">Decision</span><strong>${statusLabel}</strong></div>
    </header>
    ${derivedNotice}
    ${analysisContent}
    ${decisionContent}
    ${draft}
    <details class="source-jd"><summary>Original job description</summary><p class="source-reference">Source: ${escapeHtml(detail.raw.source.value)}</p><pre>${escapeHtml(detail.raw.content)}</pre></details>
  </article>`;
}

function renderJobListItem(job) {
  const status = job.decisionStatus ?? (job.hasAnalysis ? "awaiting" : "pending");
  const label = job.title ?? job.company ?? job.sourcePreview;
  return `<li><button type="button" class="job-item${job.id === state.selectedId ? " selected" : ""}" data-job-id="${escapeHtml(job.id)}"><span>${escapeHtml(label)}</span><small>${statusText(status)}</small></button></li>`;
}

function renderSelectPrompt(jobCount) {
  return jobCount === 0
    ? `<div class="card empty-detail"><h2>Start with one job</h2><p>Paste a JD above. When you are ready, Codex can read the local files and create the analysis.</p></div>`
    : `<div class="card empty-detail"><h2>Select a job</h2><p>Choose a job from the queue to see source facts, Codex analysis, and a job-specific decision.</p></div>`;
}

function renderAwaitingAnalysis(id) {
  return `<section class="detail-section"><h3>Role facts</h3><p class="empty-state">Awaiting Codex analysis. Ask Codex to read <code>data/jobs/${escapeHtml(id)}/raw.json</code>, follow <code>skills/analyze-job/SKILL.md</code>, then save validated output as <code>analysis.json</code> in this job folder.</p></section>`;
}

function renderAnalysis(analysis) {
  const employment = analysis.employment ?? {};
  const compensation = analysis.compensation;
  const locations = employment.locations?.map((location) => location.raw).join(" · ") ?? "Not stated";
  const salary = compensation.salaryStatus === "stated" ? compensation.salary : "Salary not stated";
  return `<section class="detail-section">
    <h3>Role facts</h3>
    <dl class="fact-grid">
      ${definition("Salary", salary)}${definition("Location", locations)}${definition("Arrangement", employment.workArrangement ?? "Not stated")}${definition("Schedule", employment.schedule ?? "Not stated")}${definition("Employment", employment.type ?? "Not stated")}
    </dl>
    ${renderTextList("Benefits", compensation.benefits)}
    ${renderRequirements(analysis.requirements)}
    ${renderTextList("Responsibilities", analysis.responsibilities)}
  </section>`;
}

function renderRequirements(requirements) {
  return `<section class="subsection"><h4>Requirements</h4>${requirements.length ? `<ul>${requirements.map((item) => `<li><span class="priority">${escapeHtml(item.priority ?? "unknown")}</span> ${escapeHtml(item.statement)}${item.minimumYears !== undefined ? ` (${item.minimumYears}+ years)` : ""}${item.degree ? ` — ${escapeHtml(item.degree)}` : ""}${item.languageLevel ? ` — ${escapeHtml(item.languageLevel)}` : ""}</li>`).join("")}</ul>` : "<p>None stated.</p>"}</section>`;
}

function renderDecision(decision) {
  return `<section class="detail-section decision-section"><h3>Decision evidence</h3><p>${escapeHtml(decision.summary)}</p>${renderEvidenceList("Matches", decision.matches)}${renderEvidenceList("Gaps", decision.gaps)}${renderEvidenceList("Blockers", decision.blockers)}${renderTextList("Questions to clarify", decision.questions)}<p class="recommendation">CV draft: ${decision.cvDraftRecommendation === "create" ? "recommended" : "on hold"}.</p></section>`;
}

function renderAwaitingDecision(id, hasAnalysis) {
  const next = hasAnalysis
    ? `Ask Codex to follow <code>skills/assess-job/SKILL.md</code> with this job's <code>analysis.json</code> and your base profile, then save <code>decision.json</code> in <code>data/jobs/${escapeHtml(id)}</code>.`
    : "A decision becomes available after Codex has validated the role facts.";
  return `<section class="detail-section decision-section"><h3>Decision evidence</h3><p class="empty-state">${next}</p></section>`;
}

function renderEvidenceList(title, items) {
  if (!items?.length) return "";
  return `<section class="subsection"><h4>${escapeHtml(title)}</h4><ul>${items.map((item) => `<li><strong>${escapeHtml(item.topic)}:</strong> ${escapeHtml(item.finding)}${item.jobEvidence ? `<br><span>Job: ${escapeHtml(item.jobEvidence)}</span>` : ""}${item.profileEvidence ? `<br><span>Profile: ${escapeHtml(item.profileEvidence)}</span>` : ""}</li>`).join("")}</ul></section>`;
}

function renderTextList(title, items) {
  if (!items?.length) return "";
  return `<section class="subsection"><h4>${escapeHtml(title)}</h4><ul>${items.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul></section>`;
}

function definition(term, value) { return `<div><dt>${escapeHtml(term)}</dt><dd>${escapeHtml(value)}</dd></div>`; }
function statusText(status) { return ({ consider: "Consider", clarify: "Clarify", "not-ready": "Not ready", awaiting: "Awaiting Codex analysis", pending: "Awaiting Codex analysis" })[status] ?? "Awaiting Codex analysis"; }
function escapeHtml(value) { return String(value).replace(/[&<>"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[character]); }

if (typeof document !== "undefined") initializeBrowserApp();

function initializeBrowserApp() {
  const dashboard = document.querySelector("#dashboard");
  const notice = document.querySelector("#notice");
  const jobForm = document.querySelector("#job-form");
  const profileForm = document.querySelector("#profile-form");
  const profileToggle = document.querySelector("#profile-toggle");
  const profileSummary = document.querySelector("#profile-summary");
  const profileSourceForm = document.querySelector("#profile-source-form");

  async function refresh(selectFirst = false) {
    try {
      state.summary = await requestJson("/api/summary");
      if (selectFirst && !state.selectedId) state.selectedId = state.summary.jobs[0]?.id;
      if (state.selectedId && state.summary.jobs.some((job) => job.id === state.selectedId)) {
        state.detail = await requestJson(`/api/jobs/${encodeURIComponent(state.selectedId)}`);
      } else {
        state.selectedId = undefined;
        state.detail = undefined;
      }
      state.fingerprint = JSON.stringify(state.summary.jobs);
      dashboard.innerHTML = renderDashboard(state.summary);
      profileSummary.innerHTML = renderProfileSummary(state.summary.profile);
      hydrateProfileForm(state.summary.profile);
      attachDashboardEvents();
    } catch (error) { showNotice(error.message, true); }
  }

  function attachDashboardEvents() {
    dashboard.querySelector("#refresh")?.addEventListener("click", () => refresh());
    dashboard.querySelectorAll("[data-job-id]").forEach((button) => button.addEventListener("click", async () => {
      state.selectedId = button.dataset.jobId;
      await refresh();
    }));
  }

  jobForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = new FormData(jobForm);
    try {
      const job = await requestJson("/api/jobs", { method: "POST", body: JSON.stringify({ content: form.get("content"), sourceReference: form.get("sourceReference") }) });
      jobForm.reset(); state.selectedId = job.id; showNotice("Job saved locally."); await refresh();
    } catch (error) { showNotice(error.message, true); }
  });

  profileToggle.addEventListener("click", () => { profileForm.hidden = !profileForm.hidden; });
  profileForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    try { await requestJson("/api/profile", { method: "PUT", body: JSON.stringify(profileFromForm(new FormData(profileForm))) }); showNotice("Base profile saved locally."); await refresh(); }
    catch (error) { showNotice(error.message, true); }
  });
  profileSourceForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const file = document.querySelector("#profile-source").files[0];
    if (!file) return showNotice("Choose a .txt or .md source file first.", true);
    try { await requestJson("/api/profile/source", { method: "POST", body: JSON.stringify({ content: await file.text() }) }); showNotice("Profile source stored locally."); }
    catch (error) { showNotice(error.message, true); }
  });
  setInterval(async () => {
    try {
      const summary = await requestJson("/api/summary");
      const fingerprint = JSON.stringify(summary.jobs);
      if (fingerprint !== state.fingerprint) await refresh();
    } catch { /* The next manual refresh will show a connection problem. */ }
  }, 5000);
  refresh(true);

  function showNotice(message, isError = false) { notice.textContent = message; notice.className = `notice${isError ? " error" : ""}`; }
}

async function requestJson(path, options = {}) {
  const response = await fetch(path, { headers: { "content-type": "application/json", ...(options.headers ?? {}) }, ...options });
  if (response.status === 204) return undefined;
  const content = await response.json();
  if (!response.ok) throw new Error(content.error ?? "Local request failed.");
  return content;
}

function renderProfileSummary(profile) {
  if (!profile) return `<p class="empty-state">No base profile saved yet. Add only facts you want Codex to reuse for every job.</p>`;
  return `<p><strong>${escapeHtml(profile.contact?.name ?? profile.headline ?? "Base profile")}</strong>${profile.headline ? ` — ${escapeHtml(profile.headline)}` : ""}</p><p>${profile.skills.length} skills · ${profile.experience.length} roles · ${profile.languages.length} languages</p>`;
}

function hydrateProfileForm(profile) {
  const set = (id, value) => { document.querySelector(id).value = value ?? ""; };
  set("#profile-name", profile?.contact?.name); set("#profile-email", profile?.contact?.email); set("#profile-location", profile?.contact?.location); set("#profile-headline", profile?.headline); set("#profile-summary-input", profile?.summary);
  set("#profile-skills", profile?.skills?.join("\n"));
  set("#profile-experience", profile?.experience?.map((item) => [item.title, item.company ?? "", item.highlights.join("; ")].join(" | ")).join("\n"));
  set("#profile-education", profile?.education?.map((item) => [item.school ?? "", item.degree ?? "", item.field ?? ""].join(" | ")).join("\n"));
  set("#profile-languages", profile?.languages?.map((item) => [item.language, item.level ?? ""].join(" | ")).join("\n"));
  set("#profile-arrangement", profile?.preferences?.workArrangements?.[0]); set("#profile-minimum-salary", profile?.preferences?.minimumSalary);
}

function profileFromForm(form) {
  const text = (name) => String(form.get(name) ?? "").trim();
  const lines = (name) => text(name).split("\n").map((line) => line.trim()).filter(Boolean);
  const contact = Object.fromEntries([["name", text("name")], ["email", text("email")], ["location", text("location")]].filter(([, value]) => value));
  const arrangement = text("arrangement");
  const preferences = Object.fromEntries([["minimumSalary", text("minimumSalary")]].filter(([, value]) => value));
  if (arrangement) preferences.workArrangements = [arrangement];
  return {
    ...(Object.keys(contact).length ? { contact } : {}), ...(text("headline") ? { headline: text("headline") } : {}), ...(text("summary") ? { summary: text("summary") } : {}),
    skills: lines("skills"), experience: lines("experience").map(parseExperience), education: lines("education").map(parseEducation), languages: lines("languages").map(parseLanguage),
    ...(Object.keys(preferences).length ? { preferences } : {}),
  };
}

function parseExperience(line) { const [title, company, highlights] = line.split("|").map((value) => value.trim()); return { title, ...(company ? { company } : {}), highlights: (highlights ?? "").split(";").map((value) => value.trim()).filter(Boolean) }; }
function parseEducation(line) { const [school, degree, field] = line.split("|").map((value) => value.trim()); return { ...(school ? { school } : {}), ...(degree ? { degree } : {}), ...(field ? { field } : {}) }; }
function parseLanguage(line) { const [language, level] = line.split("|").map((value) => value.trim()); return { language, ...(level ? { level } : {}) }; }
