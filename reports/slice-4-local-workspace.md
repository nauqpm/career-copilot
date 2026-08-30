# Slice 4 — Local Workspace UI

## Status

Implemented locally on `slice-4-local-workspace`, branched from Slice 3. The branch remains local only; no private career records or Slice branches were pushed.

## Delivered workspace

- A Node standard-library localhost server bound by `pnpm web` to `http://127.0.0.1:4242`.
- A responsive, accessible browser dashboard for pasting an original JD, browsing job folders, editing the base profile, storing an optional `.txt`/`.md` profile source, and reading job facts and decision evidence without opening JSON files.
- One generated, safe job ID per pasted JD under `data/jobs/<job-id>/`. The browser owns `source.md` and `raw.json`; Codex owns the optional `analysis.json`, `decision.json`, and `cv-draft.md` in the same directory.
- Read models that validate Codex-derived JSON before displaying it. A malformed derived file is surfaced as a short warning instead of crashing the job list.
- Markdown-only CV draft download, available only if `cv-draft.md` exists for the selected job.

## Local API routes

| Route | Purpose |
| --- | --- |
| `GET /api/summary`, `GET /api/jobs`, `GET /api/jobs/:id` | Read the workspace and one readable job detail. |
| `POST /api/jobs` | Persist a pasted JD and optional source label. |
| `GET /api/profile`, `PUT /api/profile` | Read and edit the validated base profile. |
| `POST /api/profile/source` | Store an optional private source CV. |
| `GET /api/jobs/:id/cv-draft` | Download that job's Markdown draft only. |

Mutation routes require JSON, cap request bodies at 1 MiB, and return generic errors. The static asset server accepts only fixed local filenames, and job IDs must match a safe lowercase ID pattern.

## Manual workflow

1. Run `pnpm web` and open `http://127.0.0.1:4242`.
2. Paste a JD and save profile facts you are comfortable keeping locally.
3. In Codex, follow `skills/analyze-job/SKILL.md` using `data/jobs/<job-id>/raw.json`; save validated `analysis.json` beside it.
4. Follow `skills/assess-job/SKILL.md` with the job analysis and base profile; save `decision.json` and, when useful, `cv-draft.md` in the same folder.
5. Use **Refresh Codex files**. The dashboard also checks for job-file changes every five seconds while open.

## Verification

- `pnpm test` — 32 passed, 0 failed.
- `pnpm build` — passed.
- `pnpm audit` — no known vulnerabilities.
- `git diff --check` — passed.
- Browser check on localhost: pasted a demo JD, refreshed after adding validated analysis/decision/draft artifacts, saw the `Consider` evidence sheet, triggered the Markdown download, and saved a demo base profile. All demo job/profile data was deleted immediately afterward.

## Notes outside the plan

- The profile editor deliberately uses readable line-based inputs for repeatable experience, education, and languages instead of exposing a JSON editor. The server remains the validation boundary and reports invalid input without writing a partial profile.
- Importing a `.txt`/`.md` profile source only preserves the source file. It does not automatically ask Codex to extract it; that stays an explicit Codex-first action to control token use.
- Future n8n/company-research work remains deferred. Any later ingestion adapter must create a separate source-labelled record, retain source URL plus retrieval time, and never replace the user's pasted JD.
