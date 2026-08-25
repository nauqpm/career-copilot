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

You can also edit the base profile and optionally store a private `.txt` or `.md` CV source from the browser. The normal workflow is:

1. Paste a job and save your base profile locally.
2. Ask Codex to follow `skills/analyze-job/SKILL.md` for that job's `raw.json`, then save a validated `analysis.json` in the same job folder.
3. Ask Codex to follow `skills/assess-job/SKILL.md` with that analysis and `data/profile/candidate-profile.json`, then save `decision.json` and, when appropriate, `cv-draft.md` beside it.
4. Return to the browser and use **Refresh Codex files**. It shows readable role facts, decision evidence, and a Markdown download when a CV draft exists.

The browser does not send data to an AI provider, embed a chat, scrape jobs, research companies, track applications, or create PDF/DOCX files. Future automation must preserve the original pasted source, record the source URL and retrieval time, and stay opt-in.
