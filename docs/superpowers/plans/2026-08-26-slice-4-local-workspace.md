# Slice 4 — Local Workspace UI Implementation Plan

> **Historical reference — M0, 2026-09-04:** This document records prior implementation/design work. Its scope exclusions, task checkboxes and verification results are historical; do not replay it as a new plan or treat old test results as current. See the [active M0 baseline](../../specs/local-it-career-workstation/27-m0-baseline-and-delivery-inventory.md) for current direction, reuse inventory and remaining work.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver a readable localhost browser workspace: paste JDs, edit the base profile, see Codex-derived decisions, and download job-specific Markdown without using JSON as the normal interface.

**Architecture:** A standard-library Node HTTP server serves static browser assets and explicit localhost API routes. Workspace storage owns safe job IDs, source preservation, atomic file writes, and read models; browser ES modules render the dashboard and poll for files Codex changes externally.

**Tech Stack:** TypeScript, Node.js `http`/`fs/promises`, browser ES modules, HTML, CSS, `tsx`, `node:test`.

**Spec:** `docs/superpowers/specs/2026-08-25-career-copilot-slices-2-4-design.md`

## Global Constraints

- Create branch `slice-4-local-workspace` from the completed Slice 3 branch.
- Bind only to `127.0.0.1`; no cloud storage, AI API, chat, database, accounts, or automation.
- Show normal readable UI sections. JSON is internal persistence only.
- Pasted JD and base profile remain user-owned; UI reads derived analysis/decision/draft files but does not edit them.
- Use Node and browser native facilities only; no frontend framework, backend framework, or database.
- Keep all commits local.

---

## File structure

| Path | Responsibility |
|---|---|
| `src/workspace/storage.ts` | Job directories, safe IDs, source/raw persistence, summaries, and details. |
| `src/web/server.ts` | Localhost routes, static files, input caps, and error responses. |
| `public/index.html` | Accessible app shell. |
| `public/app.js` | Forms, API calls, rendering, polling, and download action. |
| `public/styles.css` | Responsive visual system and accessibility states. |
| `tests/workspace.test.ts` | Storage/API integration tests. |
| `tests/web-smoke.test.ts` | Pure view rendering smoke tests. |
| `reports/slice-4-local-workspace.md` | Final report. |

## Design contract

The audience is a job seeker deciding whether a role deserves a tailored CV. Desktop uses a job queue on the left and an evidence sheet on the right; mobile stacks them. The signature element is an always-visible decision strip: “Consider”, “Clarify”, “Not ready”, or “Awaiting Codex analysis”. It is useful state, not decoration.

Use `#182028` ink, `#F3F1EB` paper, `#FFFFFF` cards, `#1E5AA8` actions/focus, `#246B4B` consider, `#A85D00` clarify, and `#9C3434` not-ready. Use system fonts, visible focus, sentence-case labels, text plus color for state, and `prefers-reduced-motion`.

## API contract

```text
GET  /api/summary
GET  /api/jobs
POST /api/jobs                 { content, sourceReference? }
GET  /api/jobs/:id
GET  /api/profile
PUT  /api/profile              CandidateProfile JSON
POST /api/profile/source       { content }
GET  /api/jobs/:id/cv-draft
GET  / and static public assets
```

```ts
export type WorkspaceJobSummary = {
  id: string; sourcePreview: string; title?: string; company?: string;
  decisionStatus?: DecisionStatus; hasAnalysis: boolean; hasCvDraft: boolean;
};
export type WorkspaceJobDetail = WorkspaceJobSummary & {
  raw: RawJobContent; analysis?: JobAnalysis; decision?: JobDecision; cvDraft?: string;
};
export function createWorkspaceServer(options: { root: string; port?: number }): Server;
```

### Task 1: Workspace storage and read models

**Files:** Create `src/workspace/storage.ts`, `tests/workspace.test.ts`, `data/jobs/.gitkeep`; modify `.gitignore`.

**Interfaces:** Consumes `RawJobContent`, Job Analysis, Job Decision, and Candidate Profile parsers. Produces safe job directory files and UI-facing summaries/details.

- [ ] **Step 1: Write failing storage tests.**

```ts
test("creates a local job from pasted text and preserves source Markdown", async () => {
  const job = await createPastedJob(root, { content: "# Backend developer\nBuild APIs", sourceReference: "LinkedIn" });
  assert.match(job.id, /^[a-z0-9-]+$/);
  assert.equal(await readFile(join(root, "data", "jobs", job.id, "source.md"), "utf8"), "# Backend developer\nBuild APIs\n");
});
test("lists an unanalyzed job without exposing raw JSON", async () => {
  const [job] = await listWorkspaceJobs(root);
  assert.equal(job.hasAnalysis, false);
  assert.equal("raw" in job, false);
});
test("rejects traversal-like job IDs", async () => {
  await assert.rejects(readWorkspaceJob(root, "../profile"), /job id/);
});
```

- [ ] **Step 2: Run `pnpm exec tsx --test tests/workspace.test.ts`; confirm it fails because storage is absent.**
- [ ] **Step 3: Implement storage.** Generate IDs from `crypto.randomUUID()` with a lowercase prefix; persist exact `source.md` plus final newline and normalized `raw.json`; allow only `/^[a-z0-9-]+$/`; validate derived JSON before returning it; turn malformed derived files into `invalidDerivedData` text rather than a crashed list; use same-directory temporary writes plus rename.
- [ ] **Step 4: Ignore `data/jobs/*` except `.gitkeep`; run `pnpm test` and `pnpm build`; commit:** `feat: add local workspace storage`.

### Task 2: Localhost server

**Files:** Create `src/web/server.ts`; modify `package.json`, `tests/workspace.test.ts`.

**Interfaces:** Consumes workspace/profile storage; produces the explicit HTTP contract above and static public assets.

- [ ] **Step 1: Add failing API tests.**

```ts
test("accepts pasted JD through localhost", async () => {
  const app = await startTestServer(root);
  const response = await fetch(`${app.url}/api/jobs`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ content: "Role description", sourceReference: "Company site" }) });
  assert.equal(response.status, 201);
  assert.equal((await response.json()).hasAnalysis, false);
  await app.close();
});
test("rejects empty pasted JD", async () => {
  const app = await startTestServer(root);
  const response = await postJson(app.url, "/api/jobs", { content: " " });
  assert.equal(response.status, 400);
  await app.close();
});
```

- [ ] **Step 2: Run focused test and confirm server is missing.** Define this test helper in `tests/workspace.test.ts` before the tests so no browser/runtime dependency is hidden:

```ts
async function startTestServer(root: string) {
  const server = createWorkspaceServer({ root, port: 0 });
  await once(server.listen(0, "127.0.0.1"), "listening");
  const address = server.address() as AddressInfo;
  return { url: `http://127.0.0.1:${address.port}`, close: () => new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())) };
}
```
- [ ] **Step 3: Implement only the listed routes.** Cap JSON body at 1 MiB; require JSON content type for mutation routes; bind `127.0.0.1`; return JSON with charset; resolve static files from fixed `public/`; return 404 for path traversal; return Markdown attachment only when a draft exists; use validator errors as 400 and unexpected errors as 500 without path/stack leakage.
- [ ] **Step 4: Add `"web": "tsx src/web/server.ts"`; run tests/build; start `pnpm web` and prove `GET /api/summary` returns 200; commit:** `feat: serve local career workspace`.

### Task 3: Browser UI

**Files:** Create `public/index.html`, `public/app.js`, `public/styles.css`, `tests/web-smoke.test.ts`.

**Interfaces:** Consumes the HTTP contract. Produces readable job/profile/detail screens with no raw JSON rendering.

- [ ] **Step 1: Write failing pure-render tests.**

```ts
test("empty dashboard directs the user to paste a JD", () => {
  assert.match(renderDashboard({ jobs: [], profile: undefined }), /Add a job/);
});
test("detail shows decision evidence and a Markdown download but no JSON", () => {
  const html = renderJobDetail(populatedFixture());
  assert.match(html, /Consider/);
  assert.match(html, /Download CV draft/);
  assert.doesNotMatch(html, /\"requirements\"/);
});
```

- [ ] **Step 2: Run focused test and confirm renderers are absent.**
- [ ] **Step 3: Build semantic shell and forms.** Export pure `renderDashboard(summary)` and `renderJobDetail(detail)` functions from `public/app.js`; guard browser startup with `if (typeof document !== "undefined")` so `tsx` can import the functions in `tests/web-smoke.test.ts`. Include local-only header, Add job form, base-profile form, job queue, detail region, loading/empty/saved/error states, `<label>` for every input, and buttons rather than clickable divs.
- [ ] **Step 4: Implement interactions.** Use relative `fetch`; display field errors; render source JD, role/company, salary/benefits, location/arrangement/schedule, requirements, responsibilities, decision strip, matches/gaps/blockers/questions, and draft preview. Poll `/api/summary` every five seconds and reload selected detail only when its fingerprint changes. The download action uses the Markdown route.
- [ ] **Step 5: Implement visual/accessibility contract.** Apply palette/layout above, keyboard focus, one-column mobile layout, no external font, reduced motion, and text plus color status.
- [ ] **Step 6: Run test/build; manually use a running browser: paste fixture JD, save profile, add valid derived fixture files, refresh, verify decision/draft, and download `.md`; commit:** `feat: add local career dashboard`.

### Task 4: Documentation and report

**Files:** Modify `README.md`; create `reports/slice-4-local-workspace.md`.

- [ ] **Step 1: Document `pnpm web`, localhost URL, paste/edit/Codex/refresh sequence, private file locations, Markdown download, and absent features (chat/API/automation).**
- [ ] **Step 2: Record actual commits, routes, ownership, tests/build/audit/browser evidence, manual Codex workflow, and deferred automation contract.**
- [ ] **Step 3: Run `pnpm test`, `pnpm build`, `pnpm audit`, `git diff --check`, and browser smoke; then commit:** `docs: report local workspace slice`.
