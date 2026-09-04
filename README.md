# Career Copilot

Career Copilot is a local-first, single-user career workstation for IT and adjacent roles in Vietnam/HCMC. Workspace artifacts stay in local files. The CLI and loopback dashboard validate and store data locally; semantic extraction remains an explicit skill-assisted step. External AI, when selected by the candidate, receives only explicitly selected data under that runtime's configuration.

## Product direction and current capabilities

The [M0 baseline and delivery inventory](docs/specs/local-it-career-workstation/27-m0-baseline-and-delivery-inventory.md) records the accepted product direction and first-release boundaries. The [specification index](docs/specs/local-it-career-workstation/README.md) distinguishes accepted foundation decisions from proposed feature contracts.

M1 adds create-only CLI output, hash-checked profile/note/source saves, corruption warnings, safe artifact writes and local recovery guidance. See [M1 backup and recovery](docs/specs/local-it-career-workstation/28-m1-backup-and-recovery.md).

M2 adds an explicit candidate-confirmed profile publish flow, immutable profile revisions, leaf-level evidence, a current pointer and local history. The implementation and verification record is [M2 profile evidence and versions](reports/m2-profile-evidence-versions.md), and the contract is [04 — Profile and evidence](docs/specs/local-it-career-workstation/04-profile-and-evidence.md). Existing `data/profile/candidate-profile.json` remains a compatible legacy fallback until the first successful publish; publishing does not rewrite it.

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

`--out` refuses an existing file by default. For an intentional single-file replacement, read the current file and pass `--expected-hash sha256:<64 lowercase hex digits>`; a stale hash refuses the write. This also applies when validating an analysis/profile/decision into an existing path. On PowerShell, inspect the hash with `(Get-FileHash -LiteralPath '<output-file>' -Algorithm SHA256).Hash.ToLowerInvariant()`. Git privacy warnings are advisory and never modify ignore rules.

## Produce `JobAnalysis`

1. Open `skills/analyze-job/SKILL.md`.
2. Give Codex one normalized `RawJobContent` JSON from `data/raw/`.
3. Save the JSON-only response as a temporary file such as `draft-analysis.json`.
4. Validate and format it locally:

```bash
pnpm dev job validate-analysis ./draft-analysis.json --out ./data/analysis/backend.json
```

The CLI deliberately does not call an LLM provider. It owns input normalization, persistence, and schema validation; Codex applies the skill's semantic extraction rules.

## Candidate profile and M2 publish

Keep an optional private source CV in `data/profile/source.md` and the validated compatibility profile in `data/profile/candidate-profile.json`. Both are ignored by Git. The M2 publish flow additionally uses these local paths:

- `data/profile/evidence/<evidence-id>.json` — one evidence item per non-empty profile claim.
- `data/profile/revisions/<revision-id>.json` — immutable profile revisions with claim-to-evidence status.
- `data/profile/current.json` — the current revision ID and exact revision hash.

Validate a draft profile as before:

```bash
pnpm dev profile validate ./draft-profile.json --out ./data/profile/candidate-profile.json
```

To create an immutable revision, first read the current profile hash, then publish with explicit confirmation and the observed hash:

```bash
pnpm dev profile publish ./draft-profile.json --root . --confirm --expected-hash sha256:<current-hash>
```

`--confirm` is mandatory. The dashboard sends the same confirmation through `POST /api/profile/publish`; it also sends `If-Match` from the profile it loaded. A stale hash is rejected, and the local draft can be retained while the candidate reloads and reconciles the current file. The older `PUT /api/profile` route remains a compatibility alias for confirmed local publishing.

A publish creates evidence from exact non-empty profile leaf values. Candidate-confirmed evidence is `user-asserted`; source/document/public-link evidence can be `supported`; `unverified` evidence remains `needs-confirmation`. The UI shows unresolved claims and revision history. Role tracks are optional free-text labels, so Vietnamese and English labels can coexist without a closed IT taxonomy. M2 stores user-supplied text and references; it does not fetch URLs, PDF files, GitHub repositories, or call AI automatically.

For recovery, copy the workspace before changing artifacts. A malformed or missing revision is never silently replaced: the active pointer is read fail-closed, while history skips malformed orphan revision files and keeps valid revisions visible. Inspect a valid revision's file hash, then restore `current.json` with its exact `revisionId` and `revisionHash`; preserve the orphan file for later inspection. If no current pointer exists, the reader falls back to the legacy profile file.

## Job decision and CV draft

Use `skills/assess-job/SKILL.md` in Codex with one validated `JobAnalysis` and the active profile. It creates a separate decision for that job: `consider`, `clarify`, or `not-ready`; it does not use a fit percentage. A job-specific `cv-draft.md` is created only when the decision recommends it, and never replaces the base profile.

```bash
pnpm dev decision validate ./draft-decision.json --out ./data/jobs/<job-id>/decision.json
```

## Local workspace

Start the browser app:

```bash
pnpm web
```

To store data in a separate local workspace, set `$env:CAREER_WORKSPACE_ROOT = 'C:\CareerWorkspace'` in PowerShell before starting the server from this application checkout. UI assets still come from the checkout. Choose a normal local directory, not a symlink/junction or network/device path. Remove the variable after stopping the server to return to the default root.

Open [http://127.0.0.1:4242](http://127.0.0.1:4242). The app runs only on your computer. Paste a JD and optionally label its source; the app creates a separate ignored folder at `data/jobs/<job-id>/` with `source.md` and `raw.json`.

### Dashboard routes and local files

The dashboard uses stable hash URLs, so a reload keeps the selected local screen:

- `#overview` — **Tổng quan**, with the next JD to inspect, recent local artifacts, profile summary, and available CV drafts.
- `#jobs` — **Job descriptions**, the complete readable JD library.
- `#jobs/<job-id>` — **Chi tiết JD**, including source-derived facts, decision evidence, artifact status, and a job-specific CV draft when one exists.
- `#profile` — **Hồ sơ cá nhân**, the reusable base profile, M2 confirmation/publish control and local revision history.
- `#cvs` — **CV theo vị trí**, only JDs that have a local `cv-draft.md` plus its Markdown download.
- `#new-job` — **Thêm JD mới**, which preserves a pasted source JD locally before any semantic work.

Profile editing remains scoped to one folder at a time. The server validates the complete profile before creating a revision, and the publish flow preserves prior revisions.

The browser does not analyze a JD, send data to an AI provider, embed a chat, scrape jobs, track applications, or create PDF/DOCX files. Semantic analysis and decisions remain explicit Codex/CLI work: use local artifacts and the relevant skill, validate resulting JSON with the CLI, then return to the browser and refresh. Future automation must preserve original source material and stay opt-in.
