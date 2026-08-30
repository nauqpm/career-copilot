import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { mergeProfileSection, parseDelimitedLines, profileToSectionDraft } from "../public/profile-form.js";
import { renderApplication, renderProfile } from "../public/render.js";
import { initializeBrowserApp } from "../public/app.js";
import { parseCandidateProfile, type CandidateProfile } from "../src/profile/schema.js";
import { saveCandidateProfile } from "../src/profile/storage.js";
import { createWorkspaceServer } from "../src/web/server.js";

const sections = ["identity", "experience", "skills", "preferences"];

test("editing identity preserves every other complete-profile field without sharing mutable values", () => {
  const profile = completeProfile();
  const before = structuredClone(profile);
  const saved = mergeProfileSection(profile, "identity", {
    name: "Nguyen Minh Anh", email: "anh@example.test", phone: "0900000000", location: "Ho Chi Minh City",
    links: ["https://new.example.test"], headline: "Team leader", summary: "Confirmed experience",
    experience: [], preferences: { notes: "Must not replace other groups" },
  });
  assert.deepEqual(saved, {
    ...before,
    contact: { name: "Nguyen Minh Anh", email: "anh@example.test", phone: "0900000000", location: "Ho Chi Minh City", links: ["https://new.example.test"] },
    headline: "Team leader", summary: "Confirmed experience",
  });
  assert.deepEqual(profile, before);
  assert.notEqual(saved, profile);
  assert.notEqual(saved.contact, profile.contact);
  assert.notEqual(saved.experience, profile.experience);
  assert.notEqual(saved.experience[0], profile.experience[0]);
  assert.notEqual(saved.preferences, profile.preferences);
  assert.deepEqual(parseCandidateProfile(saved), saved);
});

test("line lists preserve commas and remove blank lines while accepting Windows line endings", () => {
  assert.deepEqual(parseDelimitedLines("  Listening, facilitation \r\n\n Planning \r\n  "), ["Listening, facilitation", "Planning"]);
  assert.deepEqual(parseDelimitedLines(""), []);
});

test("role lines parse dates and every highlight, and education keeps all supported fields", () => {
  const profile = completeProfile();
  const saved = mergeProfileSection(profile, "experience", {
    experience: "Nurse | Clinic | 2021-01 | Present | Patient care | Trained colleagues\nAssistant | | | |",
    education: "Medical College | Diploma | Nursing | 2020\n | | Short course |",
  });
  assert.deepEqual(saved, { ...profile,
    experience: [{ title: "Nurse", company: "Clinic", startDate: "2021-01", endDate: "Present", highlights: ["Patient care", "Trained colleagues"] }, { title: "Assistant", highlights: [] }],
    education: [{ school: "Medical College", degree: "Diploma", field: "Nursing", graduationDate: "2020" }, { field: "Short course" }],
  });
  assert.deepEqual(parseCandidateProfile(saved), saved);
});

test("skills section parses skills, optional language levels, and certifications independently", () => {
  const profile = completeProfile();
  const saved = mergeProfileSection(profile, "skills", {
    skills: "Teaching\nPlanning, coordination", languages: "Tiếng Việt | Bản ngữ\nEnglish |", certifications: "First aid\nTeaching certificate",
  });
  assert.deepEqual(saved, { ...profile, skills: ["Teaching", "Planning, coordination"], languages: [{ language: "Tiếng Việt", level: "Bản ngữ" }, { language: "English" }], certifications: ["First aid", "Teaching certificate"] });
  assert.deepEqual(parseCandidateProfile(saved), saved);
});

test("preferences parse all enum, location, salary, schedule, and note fields without numeric assumptions", () => {
  const profile = completeProfile();
  const saved = mergeProfileSection(profile, "preferences", {
    employmentTypes: "part-time\ncontract", workArrangements: "remote\nhybrid", locations: "Hà Nội\nĐà Nẵng",
    minimumSalary: "  20–25 triệu VND / tháng  ", schedule: "Weekdays\nNo night shifts", notes: "No relocation",
  });
  assert.deepEqual(saved, { ...profile, preferences: { employmentTypes: ["part-time", "contract"], workArrangements: ["remote", "hybrid"], locations: ["Hà Nội", "Đà Nẵng"], minimumSalary: "20–25 triệu VND / tháng", schedule: "Weekdays\nNo night shifts", notes: "No relocation" } });
  assert.deepEqual(parseCandidateProfile(saved), saved);
});

test("every section round-trips a complete profile, including literal delimiters, slashes, and embedded newlines", () => {
  const profile = completeProfile();
  profile.experience[0] = { title: "Trainer | Coach", company: "Group\\north", startDate: "2020", endDate: "Now", highlights: ["A | B; C", "Line one\nLine two", "Keep \\n literal"] };
  profile.education[0] = { school: "School | College", degree: "A\\B", field: "Line one\nLine two", graduationDate: "2020" };
  profile.languages[0] = { language: "Sign | spoken", level: "Level\\one\nDetails" };
  profile.skills = ["Line one\nLine two", "A\\B"];
  profile.certifications = ["Certificate\nDetails"];
  const before = structuredClone(profile);
  for (const section of sections) {
    const draft = profileToSectionDraft(profile, section);
    assert.deepEqual(mergeProfileSection(profile, section, draft), before, section);
    assert.deepEqual(profile, before);
    assert.notEqual(draft, profile);
  }
});

test("unchanged empty drafts retain optional-field absence and initialize required arrays for new profiles", () => {
  const empty = { experience: [], skills: [], education: [], languages: [] };
  for (const section of sections) {
    const draft = profileToSectionDraft(undefined, section);
    assert.deepEqual(mergeProfileSection(undefined, section, draft), empty);
    assert.deepEqual(mergeProfileSection(empty, section, draft), empty);
  }
  assert.deepEqual(mergeProfileSection(undefined, "identity", { name: "An" }), { ...empty, contact: { name: "An" } });
});

test("clearing fields removes optional text and clears only selected section arrays", () => {
  const profile = completeProfile();
  const identity = mergeProfileSection(profile, "identity", { email: " ", headline: "", links: "" });
  assert.equal(identity.contact.email, undefined);
  assert.deepEqual(identity.contact.links, []);
  assert.equal(identity.headline, undefined);
  assert.equal(identity.contact.name, profile.contact?.name);
  assert.deepEqual(identity.experience, profile.experience);
  const skills = mergeProfileSection(profile, "skills", { skills: "", languages: "", certifications: "" });
  assert.deepEqual(skills.skills, []);
  assert.deepEqual(skills.languages, []);
  assert.deepEqual(skills.certifications, []);
  assert.deepEqual(skills.education, profile.education);
  assert.deepEqual(parseCandidateProfile(identity), identity);
});

test("malformed records fail before saving without dropping extra cells or changing the source", () => {
  const profile = completeProfile();
  const before = structuredClone(profile);
  for (const [section, draft] of [
    ["experience", { experience: "Role | Company" }],
    ["experience", { experience: " | Company | | | Highlight" }],
    ["experience", { education: "School | Degree | Field | 2020 | Extra" }],
    ["experience", { education: " | | | " }],
    ["skills", { languages: "English | B2 | Extra" }],
    ["skills", { languages: " | B2" }],
  ] as const) assert.throws(() => mergeProfileSection(profile, section, draft), /dòng 1/);
  assert.throws(() => mergeProfileSection(profile, "unknown", {}), /nhóm/);
  assert.throws(() => profileToSectionDraft(profile, "unknown"), /nhóm/);
  assert.deepEqual(profile, before);
});

test("the server schema remains the complete-profile validator for unsupported preferences", () => {
  const saved = mergeProfileSection(completeProfile(), "preferences", { workArrangements: "unsupported" });
  assert.throws(() => parseCandidateProfile(saved), /workArrangements/);
});

test("each folder has an enabled edit action and only its own fields appear in the active editor", () => {
  const fields = {
    identity: ["name", "email", "phone", "location", "links", "headline", "summary"],
    experience: ["experience", "education"],
    skills: ["skills", "languages", "certifications"],
    preferences: ["employmentTypes", "workArrangements", "locations", "minimumSalary", "schedule", "notes"],
  };
  for (const [section, names] of Object.entries(fields)) {
    const html = renderProfile(completeProfile(), { section, draft: profileToSectionDraft(completeProfile(), section) });
    assert.equal((html.match(/class="card profile-folder"/g) ?? []).length, 4);
    assert.equal((html.match(/data-edit-profile=/g) ?? []).length, 3);
    const form = html.match(/<form id="profile-form"[\s\S]*?<\/form>/)?.[0] ?? "";
    for (const name of names) {
      assert.match(form, new RegExp(`name="${name}"`));
      assert.match(form, new RegExp(`<label for="profile-${name}">`));
    }
    for (const name of Object.values(fields).flat().filter((name) => !names.includes(name))) assert.doesNotMatch(form, new RegExp(`name="${name}"`));
    assert.match(form, /type="submit"[^>]*>Lưu mục này/);
    assert.match(form, /data-cancel-profile/);
    if (section !== "identity") assert.match(form, /aria-describedby="profile-[^"]+-help"/);
  }
});

test("editor escapes entered drafts and renders live validation feedback", () => {
  const attack = '</textarea><img src=x onerror="alert(1)">';
  const html = renderApplication({ route: { page: "profile" }, profile: completeProfile(), profileEditor: { section: "identity", draft: { summary: attack } }, error: "Invalid profile" });
  assert.match(html, /&lt;\/textarea&gt;&lt;img/);
  assert.doesNotMatch(html, /<img/);
  assert.match(html, /role="alert" aria-live="polite">Invalid profile/);
});

test("browser saves a complete merged profile and reuses the server result for the next group", async () => {
  const browser = profileBrowser();
  await initializeBrowserApp(browser.environment);
  await browser.edit("identity");
  await browser.submit({ name: "Updated name" });
  assert.equal(browser.saved.length, 1);
  assert.deepEqual(browser.saved[0], { ...completeProfile(), contact: { ...completeProfile().contact, name: "Updated name" } });
  assert.doesNotMatch(browser.html(), /id="profile-form"/);
  await browser.edit("preferences");
  await browser.submit({ notes: "No night shift" });
  assert.equal(browser.saved[1].contact?.name, "Updated name");
  assert.equal(browser.saved[1].preferences?.notes, "No night shift");
  assert.deepEqual(browser.saved[1].experience, completeProfile().experience);
});

test("browser retains entered draft and re-enables saving after server validation or network failure", async () => {
  for (const failure of [400, "network"]) {
    const browser = profileBrowser(failure);
    await initializeBrowserApp(browser.environment);
    await browser.edit("preferences");
    const form = await browser.submit({ workArrangements: "unsupported", notes: "Do not lose this draft" });
    assert.equal(form.button.disabled, false);
    assert.equal(form.fields.notes, "Do not lose this draft");
    assert.equal(browser.renderCount(), 3, "saving error must not replace the entered form");
    assert.equal(browser.notice.role, "alert");
    assert.match(browser.notice.textContent, /chưa hợp lệ|Không kết nối/);
    await browser.edit("identity");
    await browser.edit("preferences");
    assert.match(browser.html(), /Do not lose this draft/);
    assert.match(browser.html(), />unsupported<\/textarea>/);
  }
});

test("browser cannot edit a blank profile while the existing local profile is still loading", async () => {
  let release!: () => void;
  const pending = new Promise<void>((resolve) => { release = resolve; });
  const browser = profileBrowser(undefined, () => pending);
  const loading = initializeBrowserApp(browser.environment);
  await browser.edit("identity");
  assert.doesNotMatch(browser.html(), /id="profile-form"/);
  assert.equal(browser.saved.length, 0);
  release();
  await loading;
  await browser.edit("identity");
  assert.match(browser.html(), />Nguyễn An<\/textarea>/);
});

test("browser locks profile inputs during an in-flight save and unlocks them when it finishes", async () => {
  let release!: () => void;
  const pending = new Promise<void>((resolve) => { release = resolve; });
  const browser = profileBrowser(undefined, (path) => path === "/api/profile" ? pending : Promise.resolve());
  await initializeBrowserApp(browser.environment);
  await browser.edit("identity");
  assert.match(browser.html(), /<fieldset[^>]*>/);
  const saving = browser.submit({ name: "New name" });
  assert.equal(browser.form().fieldset.disabled, true);
  browser.refresh();
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.match(browser.html(), /<fieldset[^>]*disabled/);
  release();
  const form = await saving;
  assert.equal(form.fieldset.disabled, false);
  assert.equal(browser.saved[0].contact?.name, "New name");
});

test("browser retains malformed record drafts without sending a profile update", async () => {
  const browser = profileBrowser();
  await initializeBrowserApp(browser.environment);
  await browser.edit("experience");
  const form = await browser.submit({ education: "School | Degree | Field | Year | Extra" });
  assert.equal(browser.saved.length, 0);
  assert.equal(form.button.disabled, false);
  assert.match(browser.notice.textContent, /Học vấn.*dòng 1/);
  await browser.edit("identity");
  await browser.edit("experience");
  assert.match(browser.html(), /School \| Degree \| Field \| Year \| Extra/);
});

test("a summary started before saving cannot replace the newly saved profile in later edits", async () => {
  let release!: () => void;
  let summaries = 0;
  const pending = new Promise<void>((resolve) => { release = resolve; });
  const browser = profileBrowser(undefined, (path) => path === "/api/summary" && ++summaries === 2 ? pending : Promise.resolve());
  await initializeBrowserApp(browser.environment);
  await browser.edit("identity");
  browser.refresh();
  await browser.submit({ name: "Saved after refresh began" });
  release();
  await new Promise<void>((resolve) => setImmediate(resolve));
  await browser.edit("preferences");
  await browser.submit({ notes: "Retain the saved identity" });
  assert.equal(browser.saved[1].contact?.name, "Saved after refresh began");
});

test("the local profile endpoint stores a complete section merge and rejects invalid preferences without changing it", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "career-profile-form-"));
  const server = createWorkspaceServer({ root });
  context.after(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await rm(root, { recursive: true, force: true });
  });
  await saveCandidateProfile(root, completeProfile());
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const url = `http://127.0.0.1:${address.port}/api/profile`;
  const original = await (await fetch(url)).json();
  const merged = mergeProfileSection(original, "identity", { name: "Confirmed new name" });
  const saved = await fetch(url, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(merged) });
  assert.equal(saved.status, 200);
  assert.deepEqual(await saved.json(), { ...completeProfile(), contact: { ...completeProfile().contact, name: "Confirmed new name" } });
  const invalid = mergeProfileSection(merged, "preferences", { workArrangements: "unsupported" });
  const rejected = await fetch(url, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(invalid) });
  assert.equal(rejected.status, 400);
  assert.deepEqual(await (await fetch(url)).json(), merged);
});

test("typing survives folder switches, and cancelling discards only the selected draft with visible focus", async () => {
  const browser = profileBrowser();
  await initializeBrowserApp(browser.environment);
  await browser.edit("identity");
  await browser.type({ name: "Unsubmitted identity" });
  await browser.edit("preferences");
  await browser.type({ notes: "Discard these preferences" });
  await browser.cancel("preferences");
  assert.equal(browser.focused(), "#page-heading");
  await browser.edit("identity");
  assert.match(browser.html(), />Unsubmitted identity<\/textarea>/);
  await browser.edit("preferences");
  assert.doesNotMatch(browser.html(), /Discard these preferences/);
  assert.match(browser.html(), />No travel<\/textarea>/);
  assert.equal(browser.saved.length, 0);
});

function completeProfile(): CandidateProfile {
  return {
    contact: { name: "Nguyễn An", email: "an@example.test", phone: "0901234567", location: "Hà Nội", links: ["https://example.test"] },
    headline: "Designer", summary: "Service design", skills: ["Research"],
    experience: [{ title: "Designer", company: "Studio", startDate: "2020", endDate: "2025", highlights: ["Improved a service"] }],
    education: [{ school: "University", degree: "BA", field: "Design", graduationDate: "2020" }],
    languages: [{ language: "Vietnamese", level: "Native" }], certifications: ["Certificate"],
    preferences: { employmentTypes: ["full-time"], workArrangements: ["hybrid"], locations: ["Hà Nội"], minimumSalary: "Negotiable", schedule: "Flexible hours", notes: "No travel" },
  };
}

function profileBrowser(failure?: number | string, beforeRequest?: (path: string) => Promise<void>) {
  type Handler = (event: any) => unknown;
  const events = new Map<string, Handler>();
  const saved: CandidateProfile[] = [];
  let profile = completeProfile();
  let html = "";
  let renders = 0;
  let currentForm: any;
  let focused = "";
  const notice = { textContent: "", className: "", role: "status", setAttribute(name: string, value: string) { if (name === "role") this.role = value; } };
  const app = { get innerHTML() { return html; }, set innerHTML(value: string) { html = value; renders += 1; }, addEventListener(name: string, handler: Handler) { events.set(name, handler); } };
  const environment = {
    window: { location: { hash: "#profile" }, addEventListener() {} },
    document: { querySelector(selector: string) {
      if (selector === "#app") return app;
      if (selector === "#notice") return notice;
      if (selector === ".skip-link") return { addEventListener() {} };
      if (selector === "#profile-form") return currentForm;
      return { focus() { focused = selector; } };
    } },
    FormData: class {
      constructor(private form: { fields: Record<string, string> }) {}
      entries() { return Object.entries(this.form.fields)[Symbol.iterator](); }
      get(name: string) { return this.form.fields[name] ?? null; }
    },
    File: class {},
    async fetch(path: string, options: { method?: string; body?: string } = {}) {
      const loadedProfile = profile;
      await beforeRequest?.(path);
      if (path === "/api/summary") return Response.json({ jobs: [], profile: loadedProfile });
      assert.equal(path, "/api/profile");
      assert.equal(options.method, "PUT");
      if (failure === "network") throw new Error("offline");
      if (typeof failure === "number") return Response.json({ error: "Invalid profile" }, { status: failure });
      profile = parseCandidateProfile(JSON.parse(options.body ?? "null"));
      saved.push(profile);
      return Response.json(profile);
    },
  };
  return {
    environment, saved, notice, html: () => html, renderCount: () => renders, form: () => currentForm, focused: () => focused,
    refresh() { void events.get("click")?.({ target: { closest: () => ({ id: "refresh" }) } }); },
    async edit(section: string) { await events.get("click")?.({ target: { closest: () => ({ dataset: { editProfile: section } }) } }); currentForm = undefined; },
    async cancel(section: string) { await events.get("click")?.({ target: { closest: () => ({ dataset: { cancelProfile: section } }) } }); currentForm = undefined; },
    async type(fields: Record<string, string>) {
      currentForm = { id: "profile-form", fields };
      await events.get("input")?.({ target: { closest: () => currentForm } });
    },
    async submit(fields: Record<string, string>) {
      const section = html.match(/id="profile-form"[^>]*data-profile-section="([^"]+)"/)?.[1];
      const form = { id: "profile-form", dataset: { profileSection: section }, fields, isConnected: true, button: { disabled: false }, fieldset: { disabled: false }, querySelector(selector: string) { return selector === "fieldset" ? this.fieldset : this.button; } };
      currentForm = form;
      await events.get("submit")?.({ target: form, preventDefault() {} });
      return form;
    },
  };
}
