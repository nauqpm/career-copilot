# M2 — Profile evidence and immutable versions

**Delivered:** 2026-09-04
**Scope:** local profile evidence, candidate confirmation and immutable versions
**Contract:** [04 — Profile and evidence](../docs/specs/local-it-career-workstation/04-profile-and-evidence.md)
**Roadmap:** [19 — Roadmap and milestones](../docs/specs/local-it-career-workstation/19-roadmap-and-milestones.md)

## Outcome

M2 gives Career Copilot a safe profile publish boundary. A candidate can keep editing a validated profile, review the exact local version they loaded, and explicitly publish a new immutable revision. Every non-empty profile leaf receives an evidence item, and the dashboard exposes the active revision, history and unresolved evidence.

The implementation stays local and preserves the existing workflow. There is no account, cloud storage, sync, database, network fetch or agent runtime requirement.

## Delivered contract

- `data/profile/candidate-profile.json` remains the compatibility profile and fallback when no current pointer exists. A publish does not rewrite it.
- `data/profile/evidence/<evidence-id>.json` stores content-hashed evidence items.
- `data/profile/revisions/<revision-id>.json` stores content-hashed immutable revisions with claim paths, evidence IDs, statuses and optional `supersedes`.
- `data/profile/current.json` points to the active revision ID and exact revision hash.
- A revision is published only after candidate confirmation and an exact current hash (`If-Match` in the API or `--expected-hash` in the CLI).
- `GET /api/profile/history` lists valid revisions and marks the active one. `GET /api/profile/revisions/:id` reads one revision. `POST /api/profile/publish` creates a revision. `PUT /api/profile` remains a compatibility alias.
- `profile publish` requires `--confirm`, `--root` and `--expected-hash`. The command prints the published profile, revision and unresolved count.
- `candidate-confirmed` evidence maps to `user-asserted`; source/document/public-link evidence maps to `supported`; `unverified` remains `needs-confirmation`.
- Role tracks are optional free-text labels. Vietnamese, English and mixed profile/evidence text are accepted; no closed IT taxonomy or automatic translation is introduced.

The default publish path creates evidence from the exact candidate profile value. Optional evidence drafts can add a user-supplied source reference or excerpt for a claim. M2 does not fetch a URL, parse a PDF, read GitHub, or infer facts with AI.

## Compatibility and recovery

The reader checks `current.json` first. If it is absent, the legacy profile is read. If a pointer is malformed or points to a missing/changed revision, active profile reads fail closed so the dashboard can warn the candidate. History independently ignores malformed orphan revision files and retains valid entries. A valid but unpointed revision remains inactive; the system never silently promotes it.

For recovery, make a local copy of the workspace, validate the intended revision, compute its exact artifact hash, and restore a `current.json` pointer containing that revision ID and hash. Keep the original orphan or malformed file for inspection. If there is no current pointer, the legacy fallback remains usable. This is manual recovery; M2 does not auto-migrate or label legacy data as reviewed.

## Verification

The M2 implementation was checked with the focused profile schema/evidence/version tests, server and CLI M2 tests, browser profile confirmation/history tests, the existing full test suite, TypeScript build, and diff/link inspection. The final command output and any limitations belong in the task ledger and the final implementation review.

## Deferred boundaries

The following remain explicitly deferred:

- PDF parsing and GitHub/URL fetching or source connectors.
- Salary format/model restructuring.
- M3 job intake provenance and opportunity grouping.
- M4 explainable matching and fit/gap behavior.
- Portal automation, product-controlled submission, accounts, cloud storage and remote sync.

M2 supplies the fixed profile/evidence foundation that later M3–M6 contracts may consume. It does not claim those later behaviors are implemented.
