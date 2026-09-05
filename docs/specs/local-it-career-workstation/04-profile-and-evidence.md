# 04 — Profile and evidence

**Status:** M2 v1 delivered 2026-09-04; the broader evidence graph remains a future contract.
**Implementation record:** [M2 profile evidence and versions](../../../reports/m2-profile-evidence-versions.md)
**Related:** [01 — Product scope](01-product-scope.md) · [02 — System architecture](02-system-architecture.md) · [03 — Domain model and artifact contracts](03-domain-model-and-artifact-contracts.md) · [19 — Roadmap](19-roadmap-and-milestones.md)

## M2 v1 contract

M2 gives the candidate a local, explicit publish boundary for a reusable profile. A profile edit is only active after the candidate confirms and publishes it with the current artifact hash. Each publish creates new evidence items and an immutable profile revision, then advances a small current pointer. Earlier revisions and evidence remain on disk.

The reader first checks `data/profile/current.json`. When it is absent, it reads the compatible legacy `data/profile/candidate-profile.json`; the legacy file is not silently migrated or rewritten. After the first publish, the active profile is read from the pointed revision.

| Local path | Contract |
| --- | --- |
| `data/profile/candidate-profile.json` | Existing validated profile and legacy fallback. Publishing leaves it unchanged. |
| `data/profile/evidence/<evidence-id>.json` | Content-hashed evidence item with claim, source reference, quote, verification and optional language. |
| `data/profile/revisions/<revision-id>.json` | Content-hashed immutable profile, claim paths, evidence IDs, statuses and optional `supersedes`. |
| `data/profile/current.json` | Content-hashed pointer containing `revisionId` and `revisionHash`. |
| `data/profile/source.md` | Optional private source CV/text; retained separately from derived profile data. |

A revision claim path points to a non-empty leaf in that revision's profile, for example `skills[0]` or `experience[0].title`. A publish with no evidence draft creates candidate-confirmed evidence whose quote and claim equal the exact leaf value. A supplied draft may reference a source/document/public link, but the candidate still explicitly confirms the profile publish. There is no network fetch or automatic AI extraction in M2.

When a claim's path and value remain unchanged, a subsequent publish retains its evidence IDs and status unless replacement evidence is explicitly supplied. For leaves inside an experience, education or language record, that entire record must also remain unchanged; an equal leaf value at the same array index is not sufficient to reuse evidence for a different employer or language. Unverified evidence is not silently confirmed by editing another section. Draft JSON field order does not affect validation, and existing stored evidence hashes remain compatible.

## Verification and language boundaries

The stored verification values are:

- `candidate-confirmed` becomes claim status `user-asserted`.
- `source-excerpt`, `document-excerpt` and `public-link` become `supported`.
- `unverified` becomes `needs-confirmation` and is shown as unresolved in the dashboard.

The profile may contain Vietnamese, English or mixed free text. Optional `roleTracks` are user-provided labels such as `Backend / Platform` or `Kỹ sư dữ liệu`; they do not form a closed taxonomy and do not reject other roles or legacy profiles. An evidence item's optional `language` records the supplied language label; it does not translate or validate proficiency.

The dashboard exposes `profileRevision`, `profileHistory` and `unresolvedClaims`. The API uses the current profile hash as an ETag and requires the same value in `If-Match` for writes:

```text
GET  /api/profile
GET  /api/profile/history
GET  /api/profile/revisions/:revisionId
POST /api/profile/publish
PUT  /api/profile              (compatibility alias)
```

`POST /api/profile/publish` accepts `{ "profile": <CandidateProfile>, "confirmed": true, "evidence": [<EvidenceDraft>], "roleTracks": [<string>] }`. A successful response is `201` with `{ profile, revision, unresolvedCount }` and an ETag for the new revision. Missing confirmation is rejected; a missing or stale `If-Match` cannot overwrite the active state. The legacy `PUT /api/profile` alias accepts the old raw profile body and auto-confirms that caller-owned mutation because the compatibility shape has no confirmation field; new dashboard and CLI publishes use explicit confirmation.

The CLI equivalent is:

```bash
pnpm dev profile publish ./draft-profile.json --root . --confirm --expected-hash sha256:<current-hash>
```

## Recovery and orphan handling

Writes use the existing local artifact writer and preserve the previous valid artifact. A revision file is never edited in place. If `current.json` is malformed, points to a missing revision, or its hash does not match the revision file, active profile reads fail closed so the UI can warn the candidate. History independently skips malformed orphan revision files and still lists valid revisions; a valid but unpointed revision is visible as inactive.

Active and individual revision reads also validate each referenced evidence file, its content hash, ID and claim locator. Missing, corrupt or mismatched evidence blocks the read and publication from that snapshot, triggering the existing recovery warning. History excludes revisions with invalid evidence while retaining healthy revisions. Restore the original evidence files as well as the revision and pointer when recovering; no damaged files are deleted automatically.

Recovery is manual and additive: copy the workspace, identify a valid revision by parsing it and computing its file hash, then restore `current.json` with that revision's exact ID and hash. Keep malformed or unpointed files for inspection. If `current.json` is absent, the legacy profile fallback remains available. The implementation does not silently promote an orphan revision or mark it reviewed.

## Deliberate M2 boundary

M2 delivers profile revisions, leaf evidence, candidate confirmation, ETag/`If-Match` conflict protection, local history, basic status labels, bilingual/free-text handling and recovery visibility. It does not deliver PDF parsing, GitHub or URL fetching, salary model restructuring, M3 job provenance/opportunity grouping, M4 explainable matching, portal automation, application submission or remote storage.

The larger graph proposal below remains a design reference for later milestones; it is not an implementation promise for M2.

## Future evidence graph reference

Every claim used by later matching, drafting or coaching should be traceable to local evidence. A graph database is unnecessary: JSON IDs are sufficient. Later work may add source import and contradiction workflows, but it must preserve raw sources and require candidate review before changing active facts.

```mermaid
flowchart LR
  Source[Candidate-selected source] --> Evidence[Evidence item]
  Evidence --> Claim[Profile claim]
  Claim --> Revision[Immutable profile revision]
  Revision --> Future[Later matching or drafting]
```

## Links for later milestones

- [06 — Explainable matching](06-explainable-matching.md) may consume only fixed, evidence-linked revisions after M4 is designed and implemented.
- [07 — Document Studio and versioning](07-document-studio-and-versioning.md) will define document claims and selected profile revision binding.
- [19 — Roadmap and milestones](19-roadmap-and-milestones.md) records the M2 delivery and explicit M3/M4 sequencing.
