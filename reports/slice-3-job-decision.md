# Slice 3 — Job Decision

## Status

Implemented locally on branch `slice-3-job-decision`, branched from Slice 2. No branch was pushed and no private career data was added to Git.

## What changed

- Added the validated `JobDecision` domain: `consider`, `clarify`, and `not-ready`, with an explicit `create` or `hold` CV-draft recommendation.
- Added evidence-aware matches. A match must point to job or profile evidence; the model cannot emit a fit percentage or a bare, unsupported claim.
- Added atomic writers for `decision.json` and `cv-draft.md`. They only write inside an existing job-artifact directory and never modify `candidate-profile.json`.
- Added `career decision validate <decision.json> [--out path]` to normalize and validate a Codex-produced decision before it is saved.
- Added `skills/assess-job/SKILL.md`, which directs Codex to preserve uncertainty, distinguish missing information, and make each CV draft job-specific.
- Updated the README with the manual Codex-first workflow.

## How to use it

1. Keep one validated JobAnalysis, its raw JD, and `data/profile/candidate-profile.json` available to Codex.
2. Ask Codex to follow `skills/assess-job/SKILL.md` and save its JSON-only result as a temporary file, for example `draft-decision.json`.
3. Validate and save it in that job's existing directory:

```powershell
pnpm dev decision validate ./draft-decision.json --out ./data/jobs/<job-id>/decision.json
```

4. When the decision recommends `create`, Codex may write `cv-draft.md` beside `decision.json`. It must use only base-profile facts.

Slice 4 will create and manage `data/jobs/<job-id>/` from the browser, so this slice intentionally does not introduce a job database or a UI.

## Verification

- `pnpm test` — 25 passed, 0 failed.
- `pnpm build` — passed.
- `pnpm audit` — no known vulnerabilities.
- The new storage test first failed because the writer created a missing directory. The implementation was then changed so decision and CV-draft writes reject a non-existent job directory.

## Notes outside the plan

- Windows PowerShell does not expand `tests/*.test.ts` reliably in the package script, so the new test file is listed explicitly alongside the prior suites. This preserves cross-platform test execution without a new dependency.
- The decision schema keeps concerns separate rather than scoring them: concrete alignment belongs in `matches`; absent or unclear facts belong in `gaps`, `blockers`, or `questions`. This is a small implementation clarification of the plan's no-score policy.
