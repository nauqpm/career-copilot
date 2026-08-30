# Dashboard redesign delivery report

**Status:** Delivered locally on `slice-4-local-workspace`.

This report covers the accepted [design](../docs/superpowers/specs/2026-08-29-career-copilot-dashboard-redesign-design.md) and [implementation plan](../docs/superpowers/plans/2026-08-29-career-copilot-dashboard-redesign.md). It documents the local dashboard only; it does not change the Codex/CLI semantic workflow.

## Delivered workspace

The local web command is `pnpm web`. It binds the application to `127.0.0.1:4242`; the browser uses stable hash navigation with the following pages:

- `#overview` — priority, recent local JDs, profile snapshot, and available CV drafts.
- `#jobs` — readable JD library with source, analysis, decision, CV-draft status, and local last-updated values.
- `#jobs/<job-id>` — readable source-derived facts, decision evidence, artifact checklist, personal note, and a CV-draft preview/download when present.
- `#profile` — the reusable profile in four editable folders plus an optional local `.txt`/`.md` source-CV import.
- `#cvs` — only jobs with a local `cv-draft.md`, including the Markdown download.
- `#new-job` — local source-JD intake; it does not run analysis.

The fixed presentation is the accepted dark minimalist interface. It uses the corrected palette `#0D1012`, `#121618`, `#131719`, and `#2A3033`, local system/Georgia typography, a persistent desktop sidebar, and an operable narrow-screen menu. Readable UI renders source, derived facts, evidence, and drafts; raw JSON is not the regular working surface.

## Local data and APIs

Each browser-created JD remains under `data/jobs/<job-id>/`: `source.md` and `raw.json` are preserved source artifacts; `analysis.json`, `decision.json`, and `cv-draft.md` remain separately created Codex-derived artifacts. Summary metadata reports each artifact’s presence and an ISO `updatedAt` computed from the newest relevant local artifact.

The dashboard adds the optional `data/jobs/<job-id>/notes.md` file and these localhost JSON endpoints:

- `GET /api/jobs/:id/note`
- `PUT /api/jobs/:id/note` with `{ "content": "…" }`

A note is accepted only for an existing lowercase/digit/hyphen job ID, must be non-empty, is capped by the server’s 1 MiB JSON body limit, and is written atomically. It is local-only, never automatically supplied to Codex, and is independent for each JD. The application does not add remote storage, authentication, a database, embedded agents, scoring, or an export format beyond the existing local Markdown CV download.

The profile exposes all four current schema groups while saving one group at a time and merges it with untouched groups before the complete profile is validated and written:

1. **Liên hệ & giới thiệu:** contact, links, headline, and summary.
2. **Vai trò & thành tựu:** experience and education.
3. **Kỹ năng & ngôn ngữ:** skills, languages, and certifications.
4. **Điều kiện tìm việc:** employment type, arrangement, locations, minimum salary, schedule, and notes.

The current storage/schema contract is intentionally the preservation boundary: current declared `CandidateProfile` fields from untouched groups survive an edit. Future fields require a server/schema/storage change and an end-to-end preservation test before the browser can retain them.

## Verification evidence

Final Task 6 checks after the documentation change:

| Command | Result |
| --- | --- |
| `pnpm test` | 90 passed, 0 failed. |
| `pnpm build` | Passed (`tsc`). |
| `pnpm audit` | No known vulnerabilities found. |

The sandboxed `pnpm test`/`pnpm build` invocations aborted before execution with `ERR_PNPM_ABORTED_REMOVE_MODULES_DIR_NO_TTY`, while their dependency-layout guard attempted a modules-directory action. The existing local runtime then ran both commands successfully without installing or modifying dependencies, the manifest, lockfile, or `node_modules`.

Task 5 browser verification passed the following exercise against a disposable, isolated workspace on `127.0.0.1:4245`:

1. The default hash opened the dark Overview with empty-state guidance.
2. Pasting a JD navigated to its generated detail hash and showed readable local source without a JSON work surface.
3. Sidebar/hash navigation reached all six pages with focused headings and active navigation.
4. A saved note persisted after document reload and remained private to its JD.
5. Editing **Liên hệ & giới thiệu** preserved prior experience and work preferences.
6. A profile source Markdown file remained separate from the structured profile.
7. Only the JD with a local analysis, decision, and `cv-draft.md` appeared in the CV library; its existing Markdown download completed.
8. External local decision-file edits became visible through manual refresh and then the 15-second active-page refresh while an unsaved note was retained.
9. The 390px menu was operable, had visible focus, returned focus on Escape, and the dashboard had no horizontal overflow at 1280px, 800px, or 390px.

The earlier focused Task 5 evidence was `pnpm exec tsx --test tests/web-smoke.test.ts tests/profile-form.test.ts` (49 passed). The Task 5 fix round then ran `pnpm test` (90 passed), `pnpm build`, and `git diff --check`; the fresh Task 6 checks above independently repeat the test/build/audit commands.

## Decisions made during delivery

- The existing user-approved `slice-4-local-workspace` branch was used instead of another worktree because the multi-agent environment shares this checkout; no additional worktree would isolate child writes.
- Education is grouped with **Vai trò & thành tựu**, ensuring all existing profile fields have a visible folder.
- The original plan’s palette and audit checklist were corrected to match the accepted design: the dark palette above and required `pnpm audit` are authoritative.
- Preservation is limited to the current declared `CandidateProfile` schema. Unknown future fields are not silently promised by a browser whose unchanged server validator intentionally normalizes to the current schema.
- The Task 5 fix round made CV recommendation rendering strict: only an actual `hold` renders **Đang giữ**; missing or malformed recommendations are neutral. Overview CV hydration now follows the same copy-sorted `updatedAt`-descending, ID-tiebreak display order as the renderer, without mutating the server array.

## Intentional deferrals

The dashboard deliberately does not provide web-UI job analysis, embedded Codex chat, automated company research, remote storage or backup/sync, application tracking, candidate-fit scoring, search/filter, archive/delete, a light theme, or document export to PDF/DOCX. Semantic analysis remains an explicit Codex/CLI workflow over local artifacts, followed by CLI validation and a browser refresh.
