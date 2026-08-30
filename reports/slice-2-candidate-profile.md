# Slice 2 — Candidate Profile Report

**Branch:** `slice-2-candidate-profile`
**Status:** Complete

## Delivered

- Added a strict local `CandidateProfile` contract for contact details, headline, work history, skills, education, languages, certifications, and job-search constraints.
- Added atomic local persistence for `data/profile/source.md` and `data/profile/candidate-profile.json`.
- Added `career profile validate <profile.json> [--out path]`; it validates/formats JSON and does not call an AI model.
- Added `skills/analyze-profile/SKILL.md` for deliberate Codex-first profile structuring.
- Updated `.gitignore` so private profile data remains local, with `data/profile/.gitkeep` retained in Git.
- Updated README with the manual profile workflow.

## Data ownership

| File | Owner | Rule |
|---|---|---|
| `data/profile/source.md` | User | Original CV/profile source; preserved as entered. |
| `data/profile/candidate-profile.json` | User | Validated base profile; never a job-specific CV. |
| `skills/analyze-profile/SKILL.md` | Codex workflow | May structure explicit source facts only; cannot create a CV draft or modify a JD. |

## Verification

- `pnpm test`: 20 passed, 0 failed.
- `pnpm build`: passed.
- `pnpm audit`: no known vulnerabilities found.
- Profile skill check: without explicit save request, it returns only source-backed profile JSON and writes no file; it does not create a CV draft.

## Manual Codex workflow

1. Save a private source CV as `data/profile/source.md`.
2. Ask Codex to use `skills/analyze-profile/SKILL.md` on that source.
3. Save the JSON response as `draft-profile.json`.
4. Run:

```powershell
pnpm dev profile validate .\draft-profile.json --out .\data\profile\candidate-profile.json
```

## Known limits

- There is no browser profile editor yet; it is planned for Slice 4.
- There is no job decision, tailored CV draft, PDF, DOCX, or application submission.
- Codex profile extraction is manual by design and does not use an API key.

## Outside the original plan

- Windows does not expand the `tests/*.test.ts` wildcard for `tsx`. The test script now lists test files explicitly; subsequent slices must append their test file to `package.json`.
- During verification, `node_modules/.bin` was missing although the lockfile was valid. `pnpm install --frozen-lockfile` restored the local executable links without changing project dependencies or the lockfile.
