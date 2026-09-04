# 13. Job source connectors

## Purpose

This specification describes how the workstation obtains and prepares IT job postings relevant to HCMC/Vietnam while retaining local control. Candidate sources include TopCV, VietnamWorks, LinkedIn, ITviec, CareerViet, Glints, company career sites, recruiter emails, and manually saved links. A source being popular does **not** mean automated collection or submission is permitted. It applies [D-004, D-005, and D-008](00-decision-log.md) within the IT/Vietnam scope in [Product scope](01-product-scope.md).

Connector safety requirements are in [Safety, security, and privacy](12-safety-security-and-privacy.md). The core capture contract is [Job discovery and ingestion](05-job-discovery-and-ingestion.md); the separate external-action contract is [Approval and submission](08-approval-and-submission.md). The operator flow is in [Agent orchestration](11-agent-orchestration.md) and [Dashboard](14-local-ui-and-dashboard.md).

## Source status model

Every source integration has a local, versioned capability declaration:

| State | Meaning | Allowed behaviour |
| --- | --- | --- |
| `manual-only` | no reviewed integration or automation permission | user pastes text, saves a file, or records URL; no automated fetch/submit |
| `import-assisted` | local helper can normalize a user-provided export, URL, or copied content | no background crawling; user initiates import |
| `browser-handoff` | user navigates/logs in; the product can prepare values and guide completion | no unattended submit; user sees portal action |
| `connector-enabled` | a reviewed connector is technically and policy permitted for narrowly defined actions | exactly declared operations; still requires approval |
| `suspended` | source changed, policy is uncertain, or health check failed | disable automation; preserve manual import |

Initial releases must treat TopCV, VietnamWorks, LinkedIn, ITviec, CareerViet, Glints, and company sites as `manual-only` unless a specific source’s current permissions and technical interface have been separately verified and documented. Do not infer permission from a public webpage, a user session, a competitor, or a source name.

## Source record

Each saved job retains a source record alongside immutable raw content:

```json
{
  "sourceId": "src-local-uuid",
  "kind": "manual-paste",
  "displayName": "VietnamWorks",
  "url": "https://…",
  "capturedAt": "2026-08-31T10:00:00+07:00",
  "capturedBy": "user",
  "contentHash": "sha256:…",
  "originalFormat": "text/plain",
  "connectorVersion": null,
  "provenanceNote": "Copied by user from an authenticated browser session"
}
```

URLs, portal IDs, capture time, and source labels are evidence about where text came from; they do not prove the posting remains open or that the source approves automation. Never replace `source.md` merely because a connector later sees different text. Save a new snapshot linked to the old job or ask the user whether it is a different posting.

## Connector contract

A connector is a small local adapter with a declared source origin, version, supported operations, input schema, output schema, rate policy, and stop conditions. It must expose no generic browser scripting or arbitrary URL execution to agents.

```ts
type ConnectorCapability = {
  id: string;
  sourceOrigins: string[];
  status: 'manual-only' | 'import-assisted' | 'browser-handoff' | 'connector-enabled' | 'suspended';
  operations: Array<'normalize-user-capture' | 'open-handoff' | 'prepare-application' | 'submit-on-approved-page'>;
  allowedFields: string[];
  requiresUserVisibleBrowser: boolean;
  requiresPerSubmissionApproval: true;
  stopConditions: string[];
};
```

The runtime verifies the current origin and capability before every operation. An agent can request a named capability but cannot choose arbitrary browser selectors, endpoints, redirects, or target URLs.

## Intake paths

1. **Paste text**: default and most reliable. User pastes content, optionally adds a URL/source label, previews it, then saves immutable raw source.
2. **File import**: user selects a local `.txt`, `.md`, PDF, or exported HTML where supported. The system extracts text, retains the original file reference/copy by user choice, and flags unreadable text for review.
3. **Saved-link capture**: user opens a URL through their browser and confirms the intended page. Any capture is user-initiated and records time/origin.
4. **Source export import**: only parse exports the user explicitly supplies; validate schema and preserve unmapped fields in raw text.
5. **Reviewed connector**: later, only after separate policy/technical review. It must use minimal request rate, be cancellable, and provide manual fallback.

No initial feature performs background polling, credential scraping, unrestricted crawling, bypassing robots/rate controls, CAPTCHA solving, or mass job collection.

## Normalization and quality

Normalization produces `raw.json` from captured content without semantic invention. It removes presentation noise while preserving headings, lists, contact/application instructions, language, and source-specific text needed for traceability. It records extraction warnings rather than deleting ambiguous material.

The intake analyst may classify role family, tech stack, seniority cues, location and compensation only as **derived** data in `analysis.json`; raw source remains authoritative. Vietnamese/English mixed content must retain both forms where they differ.

## Deduplication

The UI may propose duplicates using evidence rather than silently merging:

- canonicalized employer and role title;
- normalized source URL/portal job ID when present;
- location/arrangement, posted/capture date, and content fingerprint;
- high-overlap requirement/responsibility text.

The proposal must show why two records appear related. The user chooses `same posting`, `related repost`, or `different job`. A new source snapshot never overwrites an existing job ID. Cross-posted roles are represented as one candidate job with many source records only after user confirmation.

## Submission preparation boundary

Source ingestion and external application are different products and permissions. A `connector-enabled` source may support intake yet still permit only browser handoff for applying. Before an application attempt, the Submission Assistant must have a valid approval record that pins the exact destination and documents; see [Safety](12-safety-security-and-privacy.md).

When portal page content or URL differs from the approved destination, the connector stops. When a field asks for new legal consent, salary expectations, demographic information, work authorization, or screening answers not included in approval, it presents the question to the user and requires a new scoped approval after the answer is finalized.

## HCMC/Vietnam presentation

The UI may make it easier to filter/summarize jobs by HCMC, district, remote/hybrid/onsite, employment type, English requirements, technology, salary currency, gross/net label, and probation. These are source-derived fields with `not stated` as a first-class value. It must not silently convert salary, guess commute time, infer legal benefits, or label a company/location from the portal brand.

## Connector review checklist

Before elevating any source above `manual-only`, maintain a dated local review that checks:

1. current source terms/API/automation permission and account implications;
2. permitted operations and scope (read, export import, form preparation, submission);
3. authentication/MFA/CAPTCHA/manual-only steps;
4. origin allowlist, redirects, cookies, rate limits and cancellation;
5. user-visible proof/receipt behaviour and error handling;
6. fixture-based tests that do not contact the live source;
7. a kill switch that changes status to `suspended` without data loss.

## Acceptance criteria

- A user can save an accurate source snapshot without granting a connector network access.
- No agent or connector can act on a URL outside its declared source origin.
- A suspected duplicate is visible and reversible; neither record is silently lost.
- Every submission-capable action has a portal-specific review record, current capability declaration, user-visible browser state, and an approval bound to its target.
- When any assumption about portal automation becomes uncertain, the source becomes `suspended` and the manual workflow remains available.
