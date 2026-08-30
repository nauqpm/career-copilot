import { renderApplication } from "./render.js";
import { parseRoute } from "./routes.js";

const app = document.querySelector("#app");
let state = { route: parseRoute(window.location.hash), summary: { jobs: [] }, detail: undefined, profile: undefined, note: "", error: "", notice: "" };
let loadVersion = 0;

function render(focus = false) {
  app.innerHTML = renderApplication(state);
  if (focus) document.querySelector("#page-heading")?.focus();
}

async function refresh(focus = false) {
  const version = ++loadVersion;
  const route = parseRoute(window.location.hash);
  try {
    const [summary, detail, note] = await Promise.all([
      requestJson("/api/summary"),
      route.page === "job" ? requestJson(`/api/jobs/${encodeURIComponent(route.jobId)}`) : undefined,
      route.page === "job" ? requestJson(`/api/jobs/${encodeURIComponent(route.jobId)}/note`) : undefined,
    ]);
    if (version !== loadVersion) return;
    state = { ...state, route, summary, profile: summary.profile, detail, note: note?.content ?? "", error: "" };
    render(focus);
  } catch (error) {
    if (version !== loadVersion) return;
    state = { ...state, route, detail: undefined, note: "", error: error.message };
    render(focus);
  }
}

app.addEventListener("click", (event) => {
  const button = event.target.closest("button");
  if (button?.id === "refresh") void refresh();
  if (button?.id === "menu-toggle") {
    const navigation = document.querySelector("#workspace-navigation");
    navigation.hidden = !navigation.hidden;
    button.setAttribute("aria-expanded", String(!navigation.hidden));
  }
});

document.querySelector(".skip-link").addEventListener("click", (event) => {
  event.preventDefault();
  document.querySelector("#page-heading")?.focus();
});

app.addEventListener("submit", async (event) => {
  const form = event.target;
  if (!["job-form", "note-form", "profile-source-form"].includes(form.id)) return;
  event.preventDefault();
  const button = form.querySelector('button[type="submit"]');
  button.disabled = true;
  const route = state.route;
  try {
    const values = new FormData(form);
    if (form.id === "job-form") {
      const job = await requestJson("/api/jobs", { method: "POST", body: JSON.stringify({ content: values.get("content"), sourceReference: values.get("sourceReference") }) });
      if (!form.isConnected) return;
      state = { ...state, notice: "Đã lưu JD trên máy.", error: "" };
      window.location.hash = `#jobs/${encodeURIComponent(job.id)}`;
    } else if (form.id === "note-form" && route.page === "job") {
      const saved = await requestJson(`/api/jobs/${encodeURIComponent(route.jobId)}/note`, { method: "PUT", body: JSON.stringify({ content: values.get("content") }) });
      if (state.route.page === "job" && state.route.jobId === route.jobId) {
        state = { ...state, note: saved.content };
        showNotice("Đã lưu ghi chú trên máy.");
      }
    } else if (form.id === "profile-source-form") {
      const file = values.get("source");
      if (!(file instanceof File) || !file.name) throw new Error("Hãy chọn tệp .txt hoặc .md trước khi lưu.");
      await requestJson("/api/profile/source", { method: "POST", body: JSON.stringify({ content: await file.text() }) });
      if (form.isConnected) showNotice("Đã lưu tệp nguồn hồ sơ trên máy.");
    }
  } catch (error) {
    if (form.isConnected) showNotice(error.message, true);
  } finally {
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
  state = { ...state, notice: "", error: "" };
  void refresh(true);
});
render();
void refresh();
