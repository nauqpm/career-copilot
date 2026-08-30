# Career Copilot Dashboard Redesign Implementation Plan

> **For Codex:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace the current utility-style local web screen with a Vietnamese, dark, minimalist dashboard that lets one user browse locally stored JDs, inspect each JD without reading JSON, maintain their personal profile, and review per-JD CV drafts.

**Architecture:** Keep the existing local Node HTTP server and filesystem-backed workspace as the only backend. Extend the workspace storage boundary with safe per-JD note handling and derived presentation metadata. Keep browser rendering modular: a small route/controller module fetches local APIs and delegates pure HTML rendering and profile form conversion to focused modules. Hash routes make all six approved pages directly addressable without adding a client framework.

**Tech Stack:** TypeScript, Node.js built-in HTTP/filesystem APIs, `tsx`, Node test runner, browser-native ES modules, HTML, and CSS. No database, third-party UI package, external font, hosted service, or agent runtime is added.

**Spec:** `docs/superpowers/specs/2026-08-29-career-copilot-dashboard-redesign-design.md`

## Global constraints

- Preserve Career Copilot as local-first. All data remains under the configured local `data/` root and remains ignored by Git.
- Preserve raw JD content and source references. Never derive, invent, score, or recommend candidate fit in the web app.
- The application must display derived information as readable UI, never require the user to inspect JSON.
- The only theme is dark graphite with one muted sage accent. Do not add a theme toggle, gradients, heavy shadows, rounded-card overload, external imagery, or external fonts.
- Keep Vietnamese user-facing copy. Use system sans-serif text plus Georgia only for editorial display headings.
- Support all professions; no technical-only terminology or taxonomy.
- Do not add authentication, remote storage, scraping, company lookup, application tracking, export to PDF/DOCX, embedded Codex chat, or an API that controls Codex.
- The browser may show a local workflow reminder, but it must not automatically send personal or job data anywhere.
- All mutated request input remains JSON-only, size-limited, validated, and written atomically.

## File structure and ownership

```text
src/workspace/storage.ts             # Workspace summaries, artifact metadata, safe notes.md storage
src/web/server.ts                    # Local API routes for job notes
public/index.html                    # Minimal application document and module entry point
public/app.js                        # Local API requests, DOM events and state
public/render.js                     # Pure page and component HTML renderers
public/routes.js                     # Pure hash-route parser and route utilities
public/profile-form.js               # Profile section drafts, conversion, and merge-preserving updates
public/styles.css                    # Dark desktop-first responsive design system and page layout
tests/workspace.test.ts              # Storage and HTTP API coverage
tests/web-smoke.test.ts              # Pure page renderer coverage
tests/profile-form.test.ts           # Profile conversion and preservation coverage
package.json                         # Includes the profile form test file
README.md                            # Updated local web workspace instructions
reports/dashboard-redesign.md        # User-facing delivery report for this redesign
```

## Task 1: Add safe workspace metadata and per-JD notes

**Files:**
- Modify: `src/workspace/storage.ts`
- Modify: `tests/workspace.test.ts`

### Step 1: Write the failing storage tests

Add cases that create a temporary workspace and prove all presentation metadata comes from local artifacts:

```ts
test("lists artifact status and latest local update time", async () => {
  // Create source.md/raw.json, then analysis.json and cv-draft.md with newer mtimes.
  // Assert source, analysis, decision, and cvDraft booleans exactly match files present.
  // Assert updatedAt is the newest artifact mtime in ISO 8601 form.
});

test("stores and reads a non-empty note for an existing job", async () => {
  await saveWorkspaceJobNote(root, "backend-01", "Ask about the on-call rotation.");
  assert.equal(await readWorkspaceJobNote(root, "backend-01"), "Ask about the on-call rotation.");
});

test("rejects blank notes and cannot create a note for a missing job", async () => {
  await assert.rejects(() => saveWorkspaceJobNote(root, "backend-01", "   "));
  await assert.rejects(() => saveWorkspaceJobNote(root, "does-not-exist", "text"));
});
```

Run the focused test file. Confirm the new tests fail because neither metadata nor note functions exist yet.

### Step 2: Implement derived artifact metadata

In `src/workspace/storage.ts`, add a stable shape for the list and detail UI:

```ts
export interface WorkspaceArtifactStatus {
  source: boolean;
  analysis: boolean;
  decision: boolean;
  cvDraft: boolean;
}

export interface WorkspaceJobSummary {
  id: string;
  sourcePreview: string;
  title?: string;
  company?: string;
  decisionStatus?: string;
  hasAnalysis: boolean;
  hasCvDraft: boolean;
  invalidDerivedData?: string;
  artifactStatus: WorkspaceArtifactStatus;
  updatedAt: string;
  cvDraftUpdatedAt?: string;
  employmentType?: EmploymentType;
  workArrangement?: WorkArrangement;
  locationPreview?: string;
}
```

Use one private helper to inspect `source.md`, `raw.json`, `analysis.json`, `decision.json`, `cv-draft.md`, and `notes.md`. Missing optional artifacts must resolve to `false` and must not make a JD disappear. Calculate `updatedAt` from the newest existing artifact mtime, serialised as `Date#toISOString()`, and set `cvDraftUpdatedAt` only from `cv-draft.md`. Populate the optional employment summary fields from valid analysis only; use the first stated location as `locationPreview`. `raw.json` remains required for a valid job; malformed derived JSON keeps the current `invalidDerivedData` behavior. Sort returned summaries by `updatedAt` descending, with job ID as a stable tie-breaker.

### Step 3: Implement note storage at the workspace boundary

Add `getWorkspaceJobNotePath`, `readWorkspaceJobNote`, and `saveWorkspaceJobNote`. The write function must:

```ts
export async function saveWorkspaceJobNote(
  root: string,
  jobId: string,
  content: string,
): Promise<void> {
  const directory = await requireExistingJobDirectory(root, jobId);
  const normalized = requireText(content, "Note content");
  await writeAtomically(join(directory, "notes.md"), withFinalNewline(normalized));
}
```

Do not add delete semantics in this slice. The UI only saves a non-empty note, so no filesystem deletion is needed.

### Step 4: Verify and commit

Run the focused workspace tests, then the complete `pnpm test` suite. Inspect the diff to confirm no files under `data/` were staged. Commit only Task 1 files:

```text
feat: add job workspace metadata and notes
```

## Task 2: Expose notes through the local HTTP API

**Files:**
- Modify: `src/web/server.ts`
- Modify: `tests/workspace.test.ts`

### Step 1: Write failing HTTP tests

Using the existing temporary-server helper, add coverage for the contract below:

```http
GET /api/jobs/:id/note
200 Content-Type: application/json
{ "content": "Ask about the on-call rotation." }

GET /api/jobs/:id/note
200 Content-Type: application/json
{ "content": null }

PUT /api/jobs/:id/note
Content-Type: application/json
{ "content": "Ask about the on-call rotation." }
200 Content-Type: application/json
{ "content": "Ask about the on-call rotation." }
```

Also test a blank `content`, a non-string `content`, an unknown job, and a request with the wrong content type. Each must produce the existing JSON error envelope and must not create a directory or file.

### Step 2: Add routes before the generic job-detail matcher

Import the note functions and place exact note route handling before `GET /api/jobs/:id`. Parse the identifier with the same safe path boundary used by other job routes. Reuse the existing JSON body limit and response helpers. Do not expose a filesystem path in either success or error responses.

### Step 3: Verify and commit

Run focused workspace tests and the complete test suite. Commit only Task 2 files:

```text
feat: expose local job notes API
```

## Task 3: Build testable page renderers and hash-route model

**Files:**
- Add: `public/render.js`
- Add: `public/routes.js`
- Modify: `public/app.js`
- Modify: `public/index.html`
- Modify: `tests/web-smoke.test.ts`

### Step 1: Write failing renderer and route tests

Move existing rendering tests to import from `public/render.js`, then add pure tests for every approved route from `public/routes.js`:

```js
assert.deepEqual(parseRoute("#overview"), { page: "overview" });
assert.deepEqual(parseRoute("#jobs"), { page: "jobs" });
assert.deepEqual(parseRoute("#jobs/backend-01"), { page: "job", jobId: "backend-01" });
assert.deepEqual(parseRoute("#profile"), { page: "profile" });
assert.deepEqual(parseRoute("#cvs"), { page: "cvs" });
assert.deepEqual(parseRoute("#new-job"), { page: "new-job" });
assert.deepEqual(parseRoute("#not-a-page"), { page: "overview" });
```

For renderer output, assert the empty and populated state of Overview, Jobs, Job Detail, Profile, CV library, and New Job. Assertions must check Vietnamese labels, useful empty-state guidance, accessible form labels, and that no renderer serializes a raw JSON object into the page.

### Step 2: Implement a small hash route parser

Keep `public/app.js` browser-focused by placing its importable route parser in `public/routes.js`. Treat an absent hash or invalid route as Overview. Preserve job identifiers exactly after URI decoding only if they match the existing lowercase-hyphen job ID contract.

### Step 3: Create the reusable dark application shell renderer

In `public/render.js`, create pure renderers with an explicit data input rather than reading global state:

```js
export function renderApplication({ route, summary, detail, profile, note, error }) {
  return `${renderSidebar(route)}${renderPage({ route, summary, detail, profile, note, error })}`;
}
```

The shared sidebar must link to these exact destinations:

```text
#overview  Tổng quan
#jobs      Job descriptions
#profile   Hồ sơ cá nhân
#cvs       CV theo vị trí
#new-job   Thêm JD mới
```

Each link needs a text label; active state needs both an accessible current-page marker and a visual indicator. The shell includes a short local-only badge and a mobile-friendly menu control.

### Step 4: Implement the content contracts in pure HTML

Implement the six page renderers from the accepted spec:

- **Overview:** real workspace counts, one priority row selected as newest `clarify` decision, otherwise newest JD without analysis, otherwise newest local update; up to five recently updated JDs; profile readiness card; and an instructions-only Codex workflow reminder.
- **Jobs:** complete most-recently-updated list with title/company fallback, decision status, artifact chips, last updated time, and readable empty state.
- **Job Detail:** header, a collapsible raw source in readable text, structured analysis/decision sections, local note form, CV draft preview, and download link only when a draft exists.
- **Profile:** grouped folder-like sections with a save affordance; form field values will be supplied by Task 4.
- **CV library:** only JDs with `artifactStatus.cvDraft === true`, each linked to its job and to the existing local CV download endpoint.
- **New Job:** paste form with source label/reference and a short explanation that it stores locally; it does not perform automatic analysis.

Use text escaping for all source, note, and profile content before interpolating it into HTML. Never use source content as HTML.

### Step 5: Verify and commit

Run `pnpm test`; renderer tests must pass in Node without a browser DOM dependency. Commit only Task 3 files:

```text
feat: add dashboard page rendering model
```

## Task 4: Make profile editing complete and preservation-safe

**Files:**
- Add: `public/profile-form.js`
- Modify: `public/render.js`
- Modify: `public/app.js`
- Add: `tests/profile-form.test.ts`
- Modify: `package.json`

### Step 1: Write failing profile conversion tests

Test conversion independently from the DOM. Start with a profile containing every supported field, update only Liên hệ & giới thiệu, and assert all other fields remain unchanged. Add one test per grouped profile area:

```js
const merged = mergeProfileSection(existing, "identity", {
  name: "Nguyen Minh Anh",
  email: "anh@example.test",
  phone: "0900000000",
  location: "Ho Chi Minh City",
  links: ["https://example.test"],
});

assert.deepEqual(merged.experience, existing.experience);
assert.deepEqual(merged.preferences, existing.preferences);
```

Include validation-facing tests for line-delimited arrays, education records, experience records, language records, certifications, and preference fields. They must produce new objects and never mutate the source profile.

### Step 2: Implement section-aware form helpers

`public/profile-form.js` owns:

```js
export function profileToSectionDraft(profile, section) { return { ...profile, section }; }
export function mergeProfileSection(profile, section, draft) { return { ...profile, ...draft }; }
export function parseDelimitedLines(value) { return value.split("\\n").map((line) => line.trim()).filter(Boolean); }
```

Support the existing CandidateProfile fields without dropping data in the four accepted folders:

- **Liên hệ & giới thiệu:** name, email, phone, location, links, headline, summary.
- **Vai trò & thành tựu:** experience records with role, company, dates, highlights, plus education records with school, degree, field, and graduation date.
- **Kỹ năng & ngôn ngữ:** skills, language records, and certifications.
- **Điều kiện tìm việc:** employment types, work arrangements, locations, minimum salary, schedule, and notes.

Use clearly labeled multi-line text formats for repeatable local records rather than adding a complex client-side data grid. Show the accepted line format directly under its field. The final PUT still goes through the existing CandidateProfile server validation.

### Step 3: Render profile folders and scoped editor forms

Give each accepted folder a compact summary and an explicit edit action. Opening one folder displays only its own editable fields, saving merges only that folder with the loaded profile, and then submits the full validated profile to `PUT /api/profile`. Report errors in an `aria-live` region while retaining the user’s entered draft.

### Step 4: Add the test script entry and verify

Extend the existing `test` script to run `tests/profile-form.test.ts`. Run the focused profile tests and full test suite. Commit only Task 4 files:

```text
feat: add complete local profile editing
```

## Task 5: Wire browser interactions and apply the approved dark visual system

**Files:**
- Modify: `public/index.html`
- Modify: `public/app.js`
- Modify: `public/render.js`
- Rewrite: `public/styles.css`
- Modify: `tests/web-smoke.test.ts`

### Step 1: Write failing controller-facing renderer tests

Add assertions for page-level status feedback: save-note success/error text, profile save error preservation marker, no-CV library state, and the New JD form labels. These tests prevent a visual refactor from erasing required local workflows.

### Step 2: Implement browser state and local API calls

Keep a deliberately small state object:

```js
const state = {
  route: parseRoute(window.location.hash),
  summary: null,
  detail: null,
  note: null,
  profile: null,
  notice: null,
  error: null,
};
```

On `hashchange`, load the local data required for the new route, render the shell, and restore focus to the page heading. Event delegation handles:

- opening and closing the mobile navigation;
- submitting the New JD form to the existing `POST /api/jobs` route;
- saving a non-empty note with `PUT /api/jobs/:id/note`;
- opening/saving profile sections via the existing `PUT /api/profile` route;
- importing profile source through the existing source endpoint;
- following existing local CV download URLs.

Retain polling only for the active route and only when it is useful to refresh local artifacts. Do not send data to Codex, a remote URL, or a tracking service.

### Step 3: Replace the stylesheet with the approved visual language

Use CSS custom properties scoped at `:root` for this fixed palette:

```css
:root {
  --canvas: #0d1012;
  --panel: #121618;
  --panel-raised: #131719;
  --line: #2a3033;
  --text: #eef0eb;
  --muted: #a6aca3;
  --sage: #9faf8b;
  --sage-ink: #152015;
  --danger: #e4a1a1;
}
```

Apply a desktop sidebar plus single content column, 16px/20px structural spacing, readable source text, quiet bordered panels, and a restrained active nav strip. Use Georgia only on display headings. Add a single breakpoint where the sidebar becomes an accessible top menu; do not hide navigation links without an operable menu button. Include visible `:focus-visible`, error text that is not color-only, and reduced-motion support.

### Step 4: Browser verification against a disposable local workspace

Run the local web server against a disposable test data root. Verify manually in a browser:

1. Default hash opens Overview with a dark theme and real empty-state guidance.
2. Pasting a JD creates a Job Detail view without exposing raw JSON.
3. Sidebar and hash links reach all six pages.
4. A saved note persists after refresh and stays attached to the same JD.
5. Editing Liên hệ & giới thiệu preserves existing role and preference values.
6. CV library shows only a JD with a real local `cv-draft.md`.
7. Keyboard navigation has a visible focus indicator and the narrow viewport menu remains usable.

Remove only the explicitly created disposable test workspace after verification; never alter real user data.

### Step 5: Verify and commit

Run `pnpm test` and `pnpm build`. Inspect the source for external URL fetches and confirm none were added. Commit only Task 5 files:

```text
feat: redesign local career dashboard
```

## Task 6: Update delivery documentation and complete a final review

**Files:**
- Modify: `README.md`
- Add: `reports/dashboard-redesign.md`
- Modify: `docs/superpowers/specs/2026-08-29-career-copilot-dashboard-redesign-design.md`
- Modify: `docs/superpowers/plans/2026-08-29-career-copilot-dashboard-redesign.md`

### Step 1: Update user documentation

Document the local web command, each dashboard route, the `notes.md` location and local-only behavior, the profile section editing format, and the fact that analysis remains a Codex/CLI workflow rather than a browser action. Do not document a feature that is not implemented.

### Step 2: Write the delivery report

Create `reports/dashboard-redesign.md` with:

- links to the accepted design and implementation plan;
- implemented page list and API/storage additions;
- per-JD note and profile-preservation guarantees;
- exact verification commands and browser scenarios that passed;
- known limitations explicitly deferred: analysis in the web UI, automated company research, remote storage, application tracking, scoring, search/filter, archive/delete, and document export.

### Step 3: Final quality review

Before the documentation commit:

1. Run `pnpm test`, `pnpm build`, and `pnpm audit` again after all final edits.
2. Inspect `git diff --check` for whitespace errors.
3. Inspect the staged file list so it contains no `data/` artifacts, credentials, or unrelated files.
4. Review route/API code for path traversal, unescaped HTML, malformed JSON, oversized bodies, and accidental external requests.
5. Compare the rendered pages with every acceptance criterion in the accepted design spec.

Commit only Task 6 files:

```text
docs: report dashboard redesign
```

## Acceptance checklist

- [ ] All six approved pages exist and are reachable by a stable hash URL.
- [ ] The default and only presentation is the accepted dark minimalist design.
- [ ] The UI shows all local JD information as readable interface, not a JSON viewer.
- [ ] Every job summary reports source/analysis/decision/CV artifact status and an ISO last-updated value derived from local files.
- [ ] A non-empty `notes.md` can be saved and retrieved only for an existing JD, with safe IDs and atomic writes.
- [ ] Profile edits expose all existing CandidateProfile data groups and preserve fields from untouched groups.
- [ ] No new remote request, authentication, database, agent integration, scoring, or export feature exists.
- [ ] Node tests and TypeScript build pass, and the browser scenarios in Task 5 pass against disposable local data.
- [ ] `reports/dashboard-redesign.md` records any decision made during execution that was not already in the accepted spec or this plan.

## Intentional deferrals

Search/filter, archive/delete, a light theme, job analysis from the web UI, embedded Codex chat, company-data automation, application tracking, CV export, remote backup/sync, and candidate-fit scoring remain out of scope. They require separate user-approved design work after this local dashboard is validated.

## Delivery record

The delivery evidence and implementation decisions are recorded in [reports/dashboard-redesign.md](../../../reports/dashboard-redesign.md). In particular, the accepted palette is `#0D1012`, `#121618`, `#131719`, and `#2A3033`, and final quality checks include `pnpm audit` as required by the accepted design.
