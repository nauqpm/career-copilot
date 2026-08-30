# Career Copilot

Local-first, agent-assisted career workspace. Job Descriptions and candidate profile data stay in local files; the CLI validates structure and Codex skills perform requested semantic extraction.

## Install

```bash
pnpm install
pnpm build
```

## Dogfood Slice 1

Place private JDs in `fixtures/real-jobs/`; this directory is intentionally ignored by Git.

```bash
pnpm dev job analyze ./fixtures/real-jobs/backend.txt --out ./data/raw/backend.json
pnpm dev job analyze ./fixtures/real-jobs --out ./data/raw
pnpm dev job analyze https://example.com/job --out ./data/raw/job.json
```

Use `--text` for an explicit inline JD or `--stdin` as a fallback.

For a directory input, the CLI writes one normalized JSON file per JD and prints a success/failure summary to stderr.

## Produce `JobAnalysis`

1. Open `skills/analyze-job/SKILL.md`.
2. Give Codex one normalized `RawJobContent` JSON from `data/raw/`.
3. Save the JSON-only response as a temporary file such as `draft-analysis.json`.
4. Validate and format it locally:

```bash
pnpm dev job validate-analysis ./draft-analysis.json --out ./data/analysis/backend.json
```

The analysis includes work arrangement, structured locations (`raw`, optional `city`, optional `address`), schedule, duration, start date, probation, onsite expectations, salary-or-not-stated status, benefits, application details, working conditions, opportunities, and explicit degree/language/experience requirements when the JD states them. The CLI deliberately does not call an LLM provider. It owns input normalization, persistence, and schema validation; Codex applies the skill's semantic extraction rules.

## Candidate profile

Keep an optional private source CV in `data/profile/source.md` and the validated base profile in `data/profile/candidate-profile.json`. Both are ignored by Git.

1. Open `skills/analyze-profile/SKILL.md` and ask Codex to structure your source CV only when you want that help.
2. Save the JSON-only result temporarily, for example as `draft-profile.json`.
3. Validate it before placing it in the profile directory:

```bash
pnpm dev profile validate ./draft-profile.json --out ./data/profile/candidate-profile.json
```

The base profile stores work history, skills, education, languages, contact details, and job-search constraints such as location, arrangement, and minimum salary. It is not a tailored CV and must not be overwritten for a particular job.

## Job decision and CV draft

Use `skills/assess-job/SKILL.md` in Codex with one validated JobAnalysis and the base profile. It creates a separate decision for that job: `consider`, `clarify`, or `not-ready`; it does not use a fit percentage. A job-specific `cv-draft.md` is created only when the decision recommends it, and never replaces the base profile.

```bash
pnpm dev decision validate ./draft-decision.json --out ./data/jobs/<job-id>/decision.json
```

## Local workspace

Start the browser app:

```bash
pnpm web
```

Open [http://127.0.0.1:4242](http://127.0.0.1:4242). The app runs only on your computer. Paste a JD and optionally label its source; the app creates a separate ignored folder at `data/jobs/<job-id>/` with `source.md` and `raw.json`.

### Dashboard routes and local files

The dashboard uses stable hash URLs, so a reload keeps the selected local screen:

- `#overview` — **Tổng quan**, with the next JD to inspect, recent local artifacts, profile summary, and available CV drafts.
- `#jobs` — **Job descriptions**, the complete readable JD library.
- `#jobs/<job-id>` — **Chi tiết JD**, including source-derived facts, decision evidence, artifact status, and a job-specific CV draft when one exists.
- `#profile` — **Hồ sơ cá nhân**, the reusable base profile and optional source-CV import.
- `#cvs` — **CV theo vị trí**, only JDs that have a local `cv-draft.md` plus its Markdown download.
- `#new-job` — **Thêm JD mới**, which preserves a pasted source JD locally before any semantic work.

Each existing job may also have `data/jobs/<job-id>/notes.md`. It is an optional, non-empty personal note stored only on this computer. The browser saves it atomically for an existing safe job ID, never shares it between JDs, and never sends it to Codex automatically.

Profile editing is scoped to one folder at a time, while saving preserves the other current profile groups:

- **Liên hệ & giới thiệu** — contact fields, links, headline, and summary.
- **Vai trò & thành tựu** — experience plus education. Use one `Vai trò | Đơn vị | Ngày bắt đầu | Ngày kết thúc | Thành tựu…` record per line for experience, and one `Trường | Bằng cấp | Ngành học | Ngày tốt nghiệp` record per line for education.
- **Kỹ năng & ngôn ngữ** — one item per line for skills/certifications, and `Ngôn ngữ | Trình độ` per line for languages.
- **Điều kiện tìm việc** — accepted type/arrangement codes, locations, salary, schedule, and notes. Enter one code per line: employment type is `full-time`, `part-time`, `contract`, `internship`, or `temporary`; arrangement is `onsite`, `hybrid`, or `remote`.

Use `\|` for a literal pipe, `\\` for a literal backslash, and `\n` for a line break inside a record field. The server validates the complete profile before replacing the local profile file.

You can also edit the base profile and optionally store a private `.txt` or `.md` CV source from the browser. The normal workflow is:

1. Paste a job and save your base profile locally.
2. Ask Codex to follow `skills/analyze-job/SKILL.md` for that job's `raw.json`, then save a validated `analysis.json` in the same job folder.
3. Ask Codex to follow `skills/assess-job/SKILL.md` with that analysis and `data/profile/candidate-profile.json`, then save `decision.json` and, when appropriate, `cv-draft.md` beside it.
4. Return to the browser and use **Refresh Codex files**. It shows readable role facts, decision evidence, and a Markdown download when a CV draft exists.

The browser does not analyze a JD, send data to an AI provider, embed a chat, scrape jobs, research companies, track applications, or create PDF/DOCX files. Semantic analysis and decisions remain explicit Codex/CLI work: use the local artifacts and the relevant skill, validate the resulting JSON with the CLI, then return to the browser and refresh. Future automation must preserve the original pasted source, record the source URL and retrieval time, and stay opt-in.
