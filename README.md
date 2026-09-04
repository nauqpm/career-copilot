# Career Copilot

Local-first, agent-assisted career workspace for one person, initially focused on IT and adjacent roles in Vietnam/HCMC. Workspace artifacts stay in local files; the CLI validates structure and skills perform requested semantic extraction. If you invoke an external agent, its selected inputs may leave your machine under that runtime's configuration; local files alone do not provide an offline AI guarantee.

## Product direction and current capabilities

The [M0 baseline and delivery inventory](docs/specs/local-it-career-workstation/27-m0-baseline-and-delivery-inventory.md) records the accepted direction, reusable source, remaining work, historical statements and first-release scope. The [specification index](docs/specs/local-it-career-workstation/README.md) distinguishes that direction from proposed feature contracts.

The commands and screens below describe the current implementation: JD preparation, profile editing, explicit skill-based decisions/CV drafts, and a loopback dashboard. Immutable evidence revisions, approval/submission flows and application outcomes remain planned. M0 does not implement them. Older slice plans describe prior work and must not be replayed as new tasks.

M1 adds create-only CLI output, hash-checked profile/note/source saves, corruption warnings, safe artifact writes and local recovery guidance. It does not migrate existing data or add evidence revisions. See [M1 backup and recovery](docs/specs/local-it-career-workstation/28-m1-backup-and-recovery.md).

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
```

The existing CLI also accepts an explicitly supplied URL (`pnpm dev job analyze <url> --out <path>`). This is a legacy generic fetch capability, not a reviewed portal connector or the first-release intake path. The new direction starts with paste/local files; expanding portal access requires its own review.

Use `--text` for an explicit inline JD or `--stdin` as a fallback.

For a directory input, the CLI writes one normalized JSON file per JD and prints a success/failure summary to stderr.

`--out` refuses an existing file by default. Batch mode keeps existing outputs and exits with status 1 if any input/output fails. For an intentional single-file replacement, read the current file and pass `--expected-hash sha256:<64 lowercase hex digits>`; a stale hash refuses the write. This also applies when validating an analysis/profile/decision into an existing path. On PowerShell, inspect the hash with `(Get-FileHash -LiteralPath '<output-file>' -Algorithm SHA256).Hash.ToLowerInvariant()`. Git privacy warnings are advisory and never modify ignore rules.

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

To store data in a separate local workspace, set `$env:CAREER_WORKSPACE_ROOT = 'C:\CareerWorkspace'` in PowerShell before starting the server from this application checkout. UI assets still come from the checkout. Choose a normal local directory, not a symlink/junction or network/device path. Remove the variable after stopping the server to return to the default root.

When another tab/CLI has changed a profile, note or source file, saving shows a conflict and retains the draft. Copy the draft to a private place, reload the page and reconcile it with the current file before saving again. The internal refresh button deliberately keeps a draft's old version token. A corrupt profile/raw JD stays on disk and shows a warning without hiding healthy jobs.

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
