import { renderApplication } from "./render.js";
import { parseRoute } from "./routes.js";
import { mergeProfileSection, profileToSectionDraft } from "./profile-form.js";

export function initializeBrowserApp(browser = globalThis) {
  const { document, window, fetch, FormData, File } = browser;
  const app = document.querySelector("#app");
  let state = { route: parseRoute(window.location.hash), summary: { jobs: [] }, detail: undefined, profile: undefined, profileReady: false, note: "", error: "", notice: "" };
  let loadVersion = 0;
  let pendingNotice;
  let profileDrafts = {};
  let profileSaving = false;
  let profileVersion = 0;

  function render(focus = false) {
    app.innerHTML = renderApplication(state);
    if (focus) document.querySelector("#page-heading")?.focus();
  }

  async function refresh(focus = false) {
    const version = ++loadVersion;
    const loadedProfileVersion = profileVersion;
    const route = parseRoute(window.location.hash);
    try {
      const [loadedSummary, detail, note] = await Promise.all([
        requestJson("/api/summary"),
        route.page === "job" ? requestJson(`/api/jobs/${encodeURIComponent(route.jobId)}`) : undefined,
        route.page === "job" ? requestJson(`/api/jobs/${encodeURIComponent(route.jobId)}/note`) : undefined,
      ]);
      if (version !== loadVersion) return;
      const summary = loadedProfileVersion === profileVersion ? loadedSummary : { ...loadedSummary, profile: state.profile };
      state = { ...state, route, summary, profile: summary.profile, profileReady: true, detail, note: note?.content ?? "", error: "" };
      render(focus);
    } catch (error) {
      if (version !== loadVersion) return;
      state = { ...state, route, detail: undefined, note: "", error: error.message };
      render(focus);
    }
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
    if (button?.id === "refresh") void refresh();
    if (button?.id === "menu-toggle") {
      const navigation = document.querySelector("#workspace-navigation");
      navigation.hidden = !navigation.hidden;
      button.setAttribute("aria-expanded", String(!navigation.hidden));
    }
  });

  app.addEventListener("input", (event) => {
    const form = event.target.closest("form");
    if (form?.id === "profile-form") rememberProfileDraft(form);
  });

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
    if (form.id === "profile-form" && profileSaving) return;
    const button = form.querySelector('button[type="submit"]');
    button.disabled = true;
    const route = state.route;
    try {
      const values = new FormData(form);
      if (form.id === "job-form") {
        const job = await requestJson("/api/jobs", { method: "POST", body: JSON.stringify({ content: values.get("content"), sourceReference: values.get("sourceReference") }) });
        if (!form.isConnected) return;
        const hash = `#jobs/${encodeURIComponent(job.id)}`;
        pendingNotice = { hash, message: "Đã lưu JD trên máy." };
        window.location.hash = hash;
      } else if (form.id === "note-form" && route.page === "job") {
        const saved = await requestJson(`/api/jobs/${encodeURIComponent(route.jobId)}/note`, { method: "PUT", body: JSON.stringify({ content: values.get("content") }) });
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
        await requestJson("/api/profile/source", { method: "POST", body: JSON.stringify({ content: await file.text() }) });
        if (form.isConnected) showNotice("Đã lưu tệp nguồn hồ sơ trên máy.");
      }
    } catch (error) {
      if (form.isConnected || (form.id === "profile-form" && state.route.page === "profile")) showNotice(error.message, true);
    } finally {
      if (form.id === "profile-form") {
        profileSaving = false;
        if (state.profileEditor) state = { ...state, profileEditor: { ...state.profileEditor, saving: false } };
        form.querySelector("fieldset").disabled = false;
        const currentForm = document.querySelector("#profile-form");
        if (currentForm?.id === "profile-form") currentForm.querySelector("fieldset").disabled = false;
      }
      button.disabled = false;
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
    state = { ...state, notice, error: "" };
    return refresh(true);
  });
  render();
  return refresh();
}

if (typeof document !== "undefined") void initializeBrowserApp();
