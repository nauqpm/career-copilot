---
name: assess-job
description: Use when a Career Copilot user explicitly asks Codex to compare one validated JobAnalysis with one validated CandidateProfile and create job-specific decision artifacts.
---

# Assess Job

Read the raw JD, its validated `analysis.json`, and the base `candidate-profile.json`. Return or save a `JobDecision` with only `consider`, `clarify`, or `not-ready`.

## Rules

1. Every match includes source-backed job and profile evidence.
2. Record missing or ambiguous salary, location, arrangement, eligibility, experience, degree, language, overtime, on-call, or travel as gaps, blockers, or questions. Do not infer them.
3. Preserve required/preferred/unknown modality from the JobAnalysis. Never assign a percentage score.
4. Set `cvDraftRecommendation` to `create` only when a job-specific draft would be useful; otherwise use `hold`.
5. A draft uses only base-profile facts and is saved as `cv-draft.md` beside that job's `decision.json`.

## Boundaries

- Never overwrite raw JD source, `analysis.json`, or `candidate-profile.json`.
- Do not submit an application, create a cover letter, or make a final career decision for the user.
- Validate the decision with `career decision validate` before saving it.
