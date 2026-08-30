# Career Copilot Dashboard Redesign

**Status:** Accepted
**Date:** 2026-08-29
**Decider:** quanp
**Design companion:** `career-copilot-page-map.html`

## 1. Goal

Replace the current single-screen intake-and-detail layout with a dark, local-first workspace for managing Job Descriptions (JDs), a base candidate profile, and job-specific CV drafts.

The redesign makes the work visible as a small set of folders and artifacts rather than JSON files or AI chat. It preserves the existing Codex-first workflow: the web app stores and renders local data, while Codex is invoked explicitly to create semantic analysis and decisions.

## 2. Fixed product rules

- The default and only theme in this redesign is dark.
- The browser remains bound to `127.0.0.1`; no hosted service, authentication, account, database, remote AI API, embedded chat, scraping, or application-tracking workflow is introduced.
- Source JD text and the base profile remain user-owned. Codex-derived `analysis.json`, `decision.json`, and `cv-draft.md` remain separate files per job.
- The regular UI never exposes raw JSON as a working surface.
- Decisions remain evidence-led (`consider`, `clarify`, `not-ready`) and must not become a percentage fit score.
- A new personal note is local-only and is never supplied to Codex unless the user explicitly chooses to do so outside the web app.

## 3. Information architecture

The browser uses one persistent sidebar and hash-based in-page navigation. A framework router is unnecessary for this local single-page app.

| Page | Purpose | Reads | Writes |
| --- | --- | --- | --- |
| **Tổng quan** | Direct the user to the next JD needing attention. | Job summaries, profile summary, CV availability. | None. |
| **Job descriptions** | Browse all saved JDs and see artifact readiness. | Job summaries. | None. |
| **Chi tiết JD** | Read source-derived facts, evidence, artifacts, and a personal note for one JD. | One job detail and its note. | Local personal note only. |
| **Hồ sơ cá nhân** | Browse and edit the reusable base profile as clear folders. | Candidate profile and optional source CV. | Candidate profile and source CV. |
| **CV theo vị trí** | Browse job-specific CV drafts and download Markdown. | Job summaries/details. | None. |
| **Thêm JD mới** | Paste and preserve original JD source before calling Codex. | None. | Source Markdown and normalized raw record. |

### Navigation model

- Sidebar entries select `#overview`, `#jobs`, `#jobs/<id>`, `#profile`, `#cvs`, or `#new-job`.
- Reloading restores the selected screen from the hash; an unknown hash falls back to the overview.
- Browser back/forward works through native `hashchange`, with no external routing dependency.
- The current “Mở Codex workflow” affordance is instructional only: it reveals the exact local artifact path and relevant skill. It does not open an embedded agent or consume a model token.

## 4. Page contracts

### 4.1 Tổng quan

Desktop has a narrow persistent sidebar and a fluid content column. Mobile collapses navigation into a horizontal strip above the content.

The overview shows only actionable state:

- One **Ưu tiên hôm nay** row: the newest `clarify` job; otherwise a job waiting for analysis; otherwise the most recently updated job.
- A short recent-JD list with role, location/arrangement, decision state, and last updated time.
- A compact base-profile snapshot: headline/name plus counts for skills, experience, and languages.
- A short CV-draft list with the originating JD and readiness for Markdown download.

It intentionally does not invent productivity scores, progress percentages, or “AI recommendations.”

### 4.2 Job descriptions

This is the readable library view. Each row shows role/company, location and arrangement when available, decision state, and the actual artifacts currently present: Source, Analysis, Decision, and CV draft.

Initial release keeps the list unfiltered. Search, sorting, archive, delete, and application status are deferred until real dogfood data shows they are needed.

### 4.3 Chi tiết JD

The detail screen has two columns on desktop and one column on mobile.

The primary column contains:

- role title, company, location, arrangement, employment type, and source preview;
- compensation, schedule, experience, language, degree, requirements, responsibilities, benefits, and working conditions only when present in `analysis.json`;
- decision summary plus evidence-backed matches, gaps, blockers, and questions;
- job-specific CV draft preview and Markdown download when it exists;
- a collapsible original JD source.

The side column contains an artifact checklist and **Ghi chú cá nhân**. The note is a plain Markdown/text file at `data/jobs/<job-id>/notes.md`. It is owned only by the user and is not parsed by the skills.

If analysis or decision files are missing or invalid, this page names the missing artifact and gives the safe next Codex instruction. It does not infer content or mask a validation error.

### 4.4 Hồ sơ cá nhân

The profile screen groups the existing `CandidateProfile` fields into four readable folders:

1. **Liên hệ & giới thiệu** — contact, headline, summary, links.
2. **Vai trò & thành tựu** — experience and reusable highlights.
3. **Kỹ năng & ngôn ngữ** — skills, languages, certifications.
4. **Điều kiện tìm việc** — preferred type, arrangement, locations, minimum salary, schedule, and notes.

Clicking a folder opens the existing editable form scoped to that group. The profile source import remains separate and keeps `.txt`/`.md` untouched. The server validates the complete profile before replacing `candidate-profile.json`.

### 4.5 CV theo vị trí

This library lists only CV drafts that exist. Each row links a draft to its source JD, shows its latest file timestamp, and exposes a Markdown download. A draft that the decision recommends holding stays visible as “Đang giữ”; no automatic export is attempted.

### 4.6 Thêm JD mới

The page retains the current behavior in a focused form: optional source reference, original pasted text, validation feedback, and a clear statement that Codex processing is separate. On success it navigates directly to `#jobs/<new-id>`.

## 5. Data and API changes

Existing file ownership is unchanged. The redesign adds only user-owned notes and read-model metadata.

| Change | Shape | Ownership |
| --- | --- | --- |
| `notes.md` | optional non-empty Markdown/text next to a job | Browser/user |
| `updatedAt` | ISO timestamp from the newest relevant local artifact stat | Read-only server read model |
| `artifactStatus` | `source`, `analysis`, `decision`, `cvDraft` booleans | Read-only server read model |

New localhost routes:

```text
GET  /api/jobs/:id/note
PUT  /api/jobs/:id/note       { content }
```

Existing routes remain compatible. `GET /api/summary`, `GET /api/jobs`, and `GET /api/jobs/:id` gain optional metadata but keep their existing data. All user-written note content is capped at 1 MiB, written atomically, and resolved only through the existing safe job-ID boundary.

## 6. Visual and interaction system

Use premium utilitarian minimalism, adapted to a fixed dark canvas:

- Canvas `#0D1012`, navigation `#121618`, quiet panels `#131719`, and 1px structure lines around `#2A3033`.
- One muted sage accent for primary actions, selected navigation, successful/consider states, and status support. Amber stays reserved for `clarify`; red remains reserved for `not-ready` or invalid data.
- UI uses system sans text; headings use a Georgia-like editorial serif. No external font loading, gradients, large rounded containers, heavy shadows, icon library, or decorative illustration is required.
- Text plus color always communicates decision state. Focus outlines stay visible. The palette must meet readable contrast in dark mode.
- Motion is limited to opacity/transform for page and list transitions, disabled by `prefers-reduced-motion`.

## 7. Error, empty, and migration behavior

- Empty overview asks the user to add a JD rather than showing empty analytic cards.
- Empty profile directs the user to create their reusable facts.
- A malformed derived file results in a visible neutral warning plus its next validation step; list browsing remains available.
- Existing `data/jobs/<id>/` directories require no migration. Absence of `notes.md`, timestamps, or artifact metadata is handled as “not yet available.”
- All existing imports, CLI commands, and Markdown CV downloads remain functional.

## 8. Test and acceptance criteria

- Pure view tests cover every route/screen, selected navigation, empty state, profile group labels, JD artifact checklist, local note surface, and no JSON leakage.
- Workspace tests cover note save/read, traversal rejection, atomic writes, and summary metadata when derived files change.
- Server tests cover both note endpoints, required JSON content type, 1 MiB cap, and non-existent jobs.
- Browser verification covers: add JD → detail route; create/update a profile group; display a valid decision and CV draft; save a personal note; refresh after an external derived-file update; download Markdown; and mobile navigation.
- `pnpm test`, `pnpm build`, `pnpm audit`, and `git diff --check` pass before implementation is complete.

## 9. Deferred work

- Search/filter and sort controls, archive/delete, application tracking, reminders, company research, automated ingestion, chat, scoring, PDF/DOCX, and collaboration remain out of scope.
- If local notes prove useful through dogfooding, a later slice may add note history or attach notes to explicit application stages. This redesign does not create either concept.

## 10. Delivery record

The implementation follows this accepted design on `slice-4-local-workspace`. The delivery report records the final verification evidence, browser scenarios, and deliberate scope decisions: [dashboard redesign delivery report](../../../reports/dashboard-redesign.md). The implementation plan remains the task-level change record: [dashboard redesign plan](../plans/2026-08-29-career-copilot-dashboard-redesign.md).
