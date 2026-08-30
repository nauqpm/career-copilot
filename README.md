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
