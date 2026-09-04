# Acceptance Criteria Catalog

**Status:** Draft for review
**Purpose:** a product-level checklist for later plans and tests. It is intentionally implementation-neutral.

## Candidate data and evidence

- A candidate can create and revise a profile without losing prior valid data.
- Every candidate fact used in a generated document is traceable to a local evidence record or a user-confirmed addition.
- The workspace distinguishes `supported`, `adjacent`, `unknown`, and `gap`; it never promotes an unknown claim to supported.
- Invalid profile or evidence data does not prevent unrelated jobs from appearing in the dashboard.

## Jobs and matching

- A raw JD is stored verbatim before any semantic extraction.
- Imports preserve the source URL or source label and retrieval time when known.
- A duplicate candidate is surfaced with the matching evidence instead of being silently merged or discarded.
- A match result contains strengths, gaps, exclusion conditions, open questions, evidence references, and confidence.
- A candidate can understand why a job is not recommended without reading agent prompts or raw model output.

## Documents and approvals

- A draft document belongs to one job and declares the exact profile/evidence basis used to create it.
- Editing a profile or document produces a new version; prior approved versions remain readable.
- An approval names the job, destination, CV version, cover-letter version, form-answer version, and creation time.
- A changed artifact invalidates any approval that referenced an older version.
- The dashboard makes pending, valid, expired, consumed, and revoked approvals visually distinct.

## Submission

- A submission cannot begin without a valid candidate approval.
- The submission workflow stops for login, MFA, CAPTCHA, an unsupported question, suspicious request, or unsupported portal behavior.
- A successful submission saves a local receipt with timestamp, destination, artifacts used, and result evidence.
- A failed or uncertain submission remains recoverable and never becomes `submitted` automatically.

## Safety and local operation

- No product account, remote workspace synchronization, or hosted database is required.
- Sensitive workspace paths remain ignored by Git and are checked by automated tests.
- The system binds its local server only to loopback interfaces.
- Job posting text cannot cause a tool action, policy override, or data export.
- The application remains usable when one derived artifact or connector operation is invalid.
- Remote model/provider use is disabled until the candidate selects a provider, sees the data scope leaving the machine, and confirms that run.

## Local n8n automation

- n8n is optional: disabling or uninstalling it never makes local paste/import, artifact review, approval records, or submitted-application history unreadable.
- Every automated intake stores an immutable raw capture before normalization, deduplication or agent analysis; candidate can inspect source, time, hash and processing outcome.
- Every workflow package has a versioned manifest, compatibility check and a safe rollback/restore path; package changes never silently resume or alter a prior wait.
- Gmail Job Alert ingestion has explicit candidate consent, a narrow configured mailbox/filter scope, idempotent message checkpointing and a manual-import fallback when permission/token/network fails.
- A waiting candidate approval contains only minimal references/hashes, validates a one-time local resume event, and becomes stale when its bundle, destination, policy or expiry no longer matches.
- A backup/restore preview covers the workspace, n8n state, raw collection, workflow package and protected encryption-key recovery material without exposing plaintext secrets.

## Localization and IT focus

- The first-class role taxonomy covers software engineering, DevOps/SRE, AI/data engineering, QA/testing, business analysis, and related technical roles.
- The system supports Vietnamese and English JD/document evidence without translating facts into invented claims.
- Location, compensation, work arrangement, English requirements, probation, and technical stack are represented separately.
- HCMC location preferences can express district/area, commute tolerance, and onsite/hybrid/remote constraints without fabricating a precise address.
