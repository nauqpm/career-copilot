# Career Copilot — Slices 2–4 Design

**Status:** Proposed for user review
**Date:** 2026-08-25
**Decider:** quanp

## 1. Context and goal

Slice 1 already normalizes pasted Job Descriptions (JDs), validates `JobAnalysis`, and keeps semantic extraction in a Codex skill. The next three slices turn that local data into a practical job-search workspace without embedding an AI chat or sending career data to an API.

The user needs to paste a JD into a local browser app, maintain a personal profile there, ask Codex Desktop or CLI to analyse the local files when needed, then return to the browser to decide whether a job is worth pursuing and to download a job-specific CV draft.

## 2. Decisions

- The product is a localhost web app backed by a small local Node server and the repository's `data/` directory.
- The web app never calls an AI provider. Codex Desktop or CLI remains the semantic worker.
- Raw JD text and the candidate's base profile are source records. Codex must not overwrite either.
- For each JD, Codex creates separate derived files: `analysis.json`, `decision.json`, and optionally `cv-draft.md`.
- The decision is evidence-led and one of `consider`, `clarify`, or `not-ready`; there is no fit percentage.
- The only initial export is Markdown. PDF/DOCX templating is deferred.
- Each Slice gets a local branch, scoped commits, tests, and one report. No Slice branch is pushed.

## 3. Architecture

```text
Browser (localhost)
  - paste and browse JDs
  - edit base candidate profile
  - display analysis, decision, and CV draft
              |
              v
Local Node server + shared validators
              |
              v
data/
  profile/candidate-profile.json       <- browser owns base profile
  jobs/<job-id>/source.md              <- browser owns pasted JD source
  jobs/<job-id>/raw.json               <- normalized source record
  jobs/<job-id>/analysis.json          <- Codex owns derived extraction
  jobs/<job-id>/decision.json          <- Codex owns derived assessment
  jobs/<job-id>/cv-draft.md            <- Codex owns derived, job-specific draft
              ^
              |
Codex Desktop or CLI + local skills
```

The browser uses only localhost endpoints. The server reads and writes the shared files atomically and validates all structured JSON before accepting it. A refresh action, plus lightweight polling while the page is open, detects files Codex has updated; no WebSocket service is needed.

## 4. Data ownership and lifecycle

| Artifact | Writer | Rule |
|---|---|---|
| `source.md`, `raw.json` | Browser / ingestion CLI | Preserve original pasted JD and source reference; never replace it with generated prose. |
| `candidate-profile.json` | Browser | Base profile is edited by the user only. |
| `analysis.json` | Codex | Must match `JobAnalysis` validation and remain traceable to the source JD. |
| `decision.json` | Codex | Must link each conclusion to an explicit job or profile fact, or mark it as a question. |
| `cv-draft.md` | Codex | One draft per job; never overwrite the base profile or another job's draft. |

`job-id` is generated locally when a pasted JD is saved. The app keeps the existing Slice 1 `data/raw/` and `data/analysis/` convention readable during the transition, but new browser-created records use the per-job directory above.

## 5. Slice scope

### Slice 2 — Candidate profile

Branch: `slice-2-candidate-profile`, from `main`.

- Define and validate `CandidateProfile`: contact details, headline, summary, work history, skills, education, languages, certifications, links, and job preferences/constraints.
- Add local CLI validation and a Codex skill for reading a profile source `.txt`/`.md` when the user wants Codex to help structure it.
- Create a base profile form and `.txt`/`.md` import route in the browser app.
- Report: `reports/slice-2-candidate-profile.md`.

### Slice 3 — Job decision and CV draft

Branch: `slice-3-job-decision`, from Slice 2.

- Define and validate `JobDecision` with status, matching evidence, blockers, gaps, and questions to clarify.
- Add a Codex skill that reads one `JobAnalysis` and the base `CandidateProfile`, writes a job-specific decision, and may write a `cv-draft.md`.
- Keep the assessment explicit: salary, location, work arrangement, eligibility, experience, degree, language, and working conditions are shown separately from context/benefit information.
- Report: `reports/slice-3-job-decision.md`.

### Slice 4 — Local workspace UI

Branch: `slice-4-local-workspace`, from Slice 3.

- Add the localhost browser application and local server.
- Let the user paste a JD, provide a source label/URL when known, and save it locally.
- Provide a dashboard, job list, readable job detail screen, profile editor, decision screen, CV-draft preview, and Markdown download.
- Present structured information in normal UI sections; JSON is internal and not a day-to-day user surface.
- Report: `reports/slice-4-local-workspace.md`.

## 6. Codex workflow

The app does not invoke Codex. It makes the local paths for a selected job clear to the user. The user can then ask Codex Desktop or CLI to run the relevant skill against those paths. The resulting validated files appear on refresh in the web UI.

This keeps token use deliberate: pasting and browsing are free local operations; only explicit Codex work consumes agent context or model usage.

## 7. Testing and acceptance criteria

- Unit tests cover each schema validator and invalid-input boundary.
- Integration tests cover local file persistence, non-destructive source preservation, and browser/server request flows.
- Browser smoke tests cover: paste JD, save profile, show a valid decision, and download a job-specific Markdown draft.
- A test fixture must show that the base profile stays unchanged after a job-specific CV draft is created.
- Slice reports record files changed, tests run, known limitations, and the next manual Codex command/workflow.

## 8. Per-slice planning and approval

This document is the shared architecture, not permission to implement all three slices at once. Before code begins for each slice, create a dedicated implementation plan on that slice's branch. The plan must state the files it owns, data/schema changes, user flow, tests, acceptance criteria, migration/compatibility behavior, and report path.

The user reviews and approves the individual plan before implementation starts. Finishing one slice does not automatically authorize implementation of the next one; the next slice begins only after its plan is reviewed and approved.

## 9. Deferred: automation and company research

Future automation may use n8n or another orchestrator to collect public JD/company information after the user asks for it. It is intentionally out of scope for Slices 2–4.

The stable future boundary is an ingestion adapter that produces a source-labelled raw record in the same job directory. Any automation must preserve source URLs and retrieval time, must not overwrite user-pasted source text, and must treat company claims as unverified until their source is recorded. Credentials, scraping policy, rate limits, and consent are later design decisions.

## 10. Non-goals

- No hosted database, accounts, remote storage, or multi-user features.
- No AI chat embedded in the web app and no API key.
- No automatic job scraping or company research yet.
- No automatic application submission or application tracking.
- No PDF/DOCX generation or visual CV template system.
