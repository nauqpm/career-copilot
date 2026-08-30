import { renderApplication, sortJobsForDisplay } from "./render.js";
import { parseRoute } from "./routes.js";
import { mergeProfileSection, profileToSectionDraft } from "./profile-form.js";

export function initializeBrowserApp(browser = globalThis) {
  const { document, window, fetch, FormData, File } = browser;
  const app = document.querySelector("#app");
  let state = { route: parseRoute(window.location.hash), summary: { jobs: [] }, detail: undefined, profile: undefined, profileReady: false, note: "", jobDraft: {}, error: "", notice: "", menuOpen: !window.matchMedia?.("(max-width: 760px)").matches };
  let loadVersion = 0;
  let pendingNotice;
  let profileDrafts = {};
  let profileSaving = false;
  let profileVersion = 0;
  let noteDrafts = {};
  let noteVersions = {};
  let refreshing = false;
  let savingForms = [];

  function render(focus = false) {
    const sourceInput = document.querySelector("#profile-source");
    app.innerHTML = renderApplication({ ...state, note: noteDrafts[state.route.jobId] ?? state.note });
    // File inputs cannot be repopulated. Keep the user's selected local file on refresh.
    if (sourceInput?.files?.length && state.route.page === "profile") document.querySelector("#profile-source")?.replaceWith(sourceInput);
    if (focus) document.querySelector("#page-heading")?.focus();
  }

  async function refresh(focus = false, automatic = false) {
    const version = ++loadVersion;
    const loadedProfileVersion = profileVersion;
    const route = parseRoute(window.location.hash);
    const loadedNoteVersion = noteVersions[route.jobId];
    refreshing = true;
    try {
      const [loadedSummary, detail, note] = await Promise.all([
        route.page === "new-job" ? state.summary : requestJson("/api/summary"),
        route.page === "job" ? requestJson(`/api/jobs/${encodeURIComponent(route.jobId)}`) : undefined,
        route.page === "job" ? requestJson(`/api/jobs/${encodeURIComponent(route.jobId)}/note`) : undefined,
      ]);
      const hydratedSummary = await hydrateCvRecommendations(loadedSummary, route);
      if (version !== loadVersion) return;
      if (automatic && document.activeElement?.closest("a, button, input, textarea, select, summary")) return;
      const summary = loadedProfileVersion === profileVersion ? hydratedSummary : { ...hydratedSummary, profile: state.profile };
      const content = loadedNoteVersion === noteVersions[route.jobId] ? note?.content ?? "" : state.note;
      const changed = JSON.stringify([state.summary, state.detail, state.note]) !== JSON.stringify([summary, detail, content]);
      state = { ...state, route, summary, profile: summary.profile, profileReady: route.page !== "new-job" || state.profileReady, detail, note: content, error: automatic ? state.error : "", loading: false };
      if (automatic && !changed) return;
      render(focus);
    } catch (error) {
      if (version !== loadVersion) return;
      state = { ...state, loading: false };
      if (automatic) showNotice(error.message, true);
      else { state = { ...state, route, error: error.message }; render(focus); }
    } finally {
      if (version === loadVersion) refreshing = false;
    }
  }

  async function hydrateCvRecommendations(summary, route) {
    if (!["overview", "cvs"].includes(route.page)) return summary;
    const drafts = sortJobsForDisplay(summary.jobs).filter((job) => job.artifactStatus?.cvDraft === true);
    const visibleIds = new Set((route.page === "overview" ? drafts.slice(0, 3) : drafts).map((job) => job.id));
    const jobs = await Promise.all(summary.jobs.map(async (job) => {
      if (!visibleIds.has(job.id)) return job;
      try {
        const detail = await requestJson(`/api/jobs/${encodeURIComponent(job.id)}`);
        return { ...job, cvDraftRecommendation: detail.decision?.cvDraftRecommendation };
      } catch { return { ...job, cvRecommendationError: true }; }
    }));
    return { ...summary, jobs };
  }

  app.addEventListener("click", (event) => {
    const button = event.target.closest("button");
    if (button?.dataset?.editProfile && !profileSaving) {
      if (!state.profileReady) return showNotice("Hồ sơ chưa tải xong. Hãy tải lại dữ liệu trước khi chỉnh sửa.", true);
      rememberProfileDraft();
      const section = button.dataset.editProfile;
      state = { ...state, profileEditor: { section, draft: profileDrafts[section] ?? profileToSectionDraft(state.profile, section) }, error: "", notice: "" };
      render();
      document.querySelector("#profile-form textarea")?.focus();
    }
    if (button?.dataset?.cancelProfile && !profileSaving) {
      profileDrafts = Object.fromEntries(Object.entries(profileDrafts).filter(([section]) => section !== button.dataset.cancelProfile));
      state = { ...state, profileEditor: undefined, error: "", notice: "" };
      render();
      document.querySelector("#page-heading")?.focus();
    }
    if (button?.id === "refresh") return refresh();
    if (button?.id === "menu-toggle") {
      const navigation = document.querySelector("#workspace-navigation");
      navigation.hidden = !navigation.hidden;
      state = { ...state, menuOpen: !navigation.hidden };
      button.setAttribute("aria-expanded", String(!navigation.hidden));
    }
  });

  app.addEventListener("input", (event) => {
    const form = event.target.closest("form");
    rememberDraft(form);
  });

  app.addEventListener("keydown", (event) => {
    if (event.key !== "Escape" || !window.matchMedia?.("(max-width: 760px)").matches || !state.menuOpen) return;
    state = { ...state, menuOpen: false };
    document.querySelector("#workspace-navigation").hidden = true;
    const toggle = document.querySelector("#menu-toggle");
    toggle.setAttribute("aria-expanded", "false");
    toggle.focus();
  });

  function rememberDraft(form) {
    if (form?.id === "profile-form") return rememberProfileDraft(form);
    if (form?.id === "job-form") state = { ...state, jobDraft: Object.fromEntries(new FormData(form).entries()) };
    if (form?.id === "note-form" && state.route.page === "job") noteDrafts = { ...noteDrafts, [state.route.jobId]: new FormData(form).get("content") };
  }

  function rememberProfileDraft(form = document.querySelector("#profile-form")) {
    if (form?.id !== "profile-form" || !state.profileEditor) return;
    const { section, draft } = state.profileEditor;
    const entered = { ...draft, ...Object.fromEntries(new FormData(form).entries()) };
    profileDrafts = { ...profileDrafts, [section]: entered };
    state = { ...state, profileEditor: { section, draft: entered } };
  }

  document.querySelector(".skip-link").addEventListener("click", (event) => {
    event.preventDefault();
    document.querySelector("#page-heading")?.focus();
  });

  app.addEventListener("submit", async (event) => {
    const form = event.target;
    if (!["job-form", "note-form", "profile-source-form", "profile-form"].includes(form.id)) return;
    event.preventDefault();
    if (savingForms.includes(form.id) || state.loading) return;
    savingForms = [...savingForms, form.id];
    rememberDraft(form);
    const button = form.querySelector('button[type="submit"]');
    button.disabled = true;
    const route = state.route;
    try {
      const values = new FormData(form);
      if (form.id === "job-form") {
        const savedDraft = state.jobDraft;
        if (!String(values.get("content") ?? "").trim()) throw new Error("Hãy nhập nội dung JD không rỗng trước khi lưu.");
        const job = await requestJson("/api/jobs", { method: "POST", body: JSON.stringify({ content: values.get("content"), sourceReference: values.get("sourceReference") }) });
        state = { ...state, jobDraft: state.jobDraft === savedDraft ? {} : state.jobDraft };
        const hash = `#jobs/${encodeURIComponent(job.id)}`;
        const message = "Đã lưu JD trên máy.";
        if (window.location.hash === hash) {
          showNotice(message);
          await refresh(true);
        } else {
          pendingNotice = { hash, message };
          window.location.hash = hash;
        }
      } else if (form.id === "note-form" && route.page === "job") {
        const content = values.get("content");
        if (!String(content ?? "").trim()) throw new Error("Hãy nhập ghi chú không rỗng trước khi lưu.");
        const saved = await requestJson(`/api/jobs/${encodeURIComponent(route.jobId)}/note`, { method: "PUT", body: JSON.stringify({ content: values.get("content") }) });
        noteVersions = { ...noteVersions, [route.jobId]: (noteVersions[route.jobId] ?? 0) + 1 };
        if (noteDrafts[route.jobId] === content) noteDrafts = Object.fromEntries(Object.entries(noteDrafts).filter(([id]) => id !== route.jobId));
        if (state.route.page === "job" && state.route.jobId === route.jobId) {
          state = { ...state, note: saved.content };
          showNotice("Đã lưu ghi chú trên máy.");
        }
      } else if (form.id === "profile-form") {
        rememberProfileDraft(form);
        const { section, draft } = state.profileEditor;
        const profile = mergeProfileSection(state.profile, section, draft);
        profileSaving = true;
        state = { ...state, profileEditor: { ...state.profileEditor, saving: true } };
        form.querySelector("fieldset").disabled = true;
        const saved = await requestJson("/api/profile", { method: "PUT", body: JSON.stringify(profile) });
        profileVersion += 1;
        profileDrafts = Object.fromEntries(Object.entries(profileDrafts).filter(([key]) => key !== section));
        state = { ...state, profile: saved, summary: { ...state.summary, profile: saved }, profileEditor: undefined };
        if (state.route.page === "profile") {
          state = { ...state, error: "", notice: "Đã lưu mục hồ sơ trên máy. Các nhóm khác được giữ nguyên." };
          render();
          document.querySelector("#page-heading")?.focus();
        }
      } else if (form.id === "profile-source-form") {
        const file = values.get("source");
        if (!(file instanceof File) || !file.name) throw new Error("Hãy chọn tệp .txt hoặc .md trước khi lưu.");
        if (!/\.(txt|md)$/i.test(file.name)) throw new Error("Chỉ hỗ trợ tệp nguồn .txt hoặc .md.");
        if (file.size > 1024 * 1024) throw new Error("Tệp nguồn vượt quá 1 MiB. Hãy chọn tệp nhỏ hơn.");
        await requestJson("/api/profile/source", { method: "POST", body: JSON.stringify({ content: await file.text() }) });
        if (form.isConnected) showNotice("Đã lưu tệp nguồn hồ sơ trên máy.");
      }
    } catch (error) {
      if (form.isConnected || (form.id === "profile-form" && state.route.page === "profile")) showNotice(`${error.message}${form.id === "profile-form" ? " Nội dung đang nhập được giữ nguyên; hãy kiểm tra rồi lưu lại." : ""}`, true);
    } finally {
      if (form.id === "profile-form") {
        profileSaving = false;
        if (state.profileEditor) state = { ...state, profileEditor: { ...state.profileEditor, saving: false } };
        form.querySelector("fieldset").disabled = false;
        const currentForm = document.querySelector("#profile-form");
        if (currentForm?.id === "profile-form") currentForm.querySelector("fieldset").disabled = false;
      }
      button.disabled = false;
      savingForms = savingForms.filter((id) => id !== form.id);
    }
  });

  function showNotice(message, isError = false) {
    state = { ...state, notice: isError ? "" : message, error: isError ? message : "" };
    const notice = document.querySelector("#notice");
    notice.textContent = message;
    notice.className = `notice${isError ? " error" : ""}`;
    notice.setAttribute("role", isError ? "alert" : "status");
  }

  async function requestJson(path, options = {}) {
    let response;
    try {
      response = await fetch(path, { ...options, headers: { "content-type": "application/json", ...(options.headers ?? {}) } });
    } catch {
      throw new Error("Không kết nối được ứng dụng cục bộ. Hãy kiểm tra máy chủ và thử tải lại.");
    }
    if (response.status === 204) return undefined;
    if (!response.ok) throw new Error(response.status === 404 ? "Không tìm thấy dữ liệu cục bộ được yêu cầu." : response.status === 400 ? "Dữ liệu chưa hợp lệ. Kiểm tra nội dung rồi thử lưu lại." : "Không xử lý được yêu cầu cục bộ. Hãy thử lại.");
    return response.json();
  }

  window.addEventListener("hashchange", () => {
    const notice = pendingNotice?.hash === window.location.hash ? pendingNotice.message : "";
    pendingNotice = undefined;
    state = { ...state, route: parseRoute(window.location.hash), detail: undefined, note: "", notice, error: "", loading: true, menuOpen: !window.matchMedia?.("(max-width: 760px)").matches };
    render();
    return refresh(true);
  });
  window.setInterval?.(() => {
    if (document.hidden || refreshing || savingForms.length || document.activeElement?.closest("a, button, input, textarea, select, summary") || !["overview", "jobs", "job", "cvs"].includes(state.route.page)) return;
    return refresh(false, true);
  }, 15000);
  render();
  return refresh();
}

if (typeof document !== "undefined") void initializeBrowserApp();
