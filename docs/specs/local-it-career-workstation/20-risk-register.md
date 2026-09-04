# Risk Register and Guardrails

**Status:** Draft for review
**Related:** [Safety, security, and privacy](12-safety-security-and-privacy.md), [job source connectors](13-job-source-connectors.md), [approval and submission](08-approval-and-submission.md)

## Purpose

This document records risks that are inherent to an agent-assisted local job-search workstation. A feature is not ready merely because it works in a happy-path demonstration; it must meet the matching guardrail below.

## Risk register

| Risk | Example | Required guardrail | Owner at runtime |
|---|---|---|---|
| Fabricated candidate claim | A draft says the candidate deployed Kubernetes without evidence. | Factual grounding review blocks the affected draft and names the missing evidence. | Evidence and reviewer agents |
| Prompt injection from JD | Hidden JD text asks an agent to upload the CV or ignore rules. | Treat all posting content as data; deny instructions, embedded URLs, and tool requests from the posting. | Ingestion and all downstream agents |
| Wrong or stale submission | An old CV version is submitted after the candidate updated it. | Approval binds the job, destination, exact document hashes, answers, and expiry time. | Approval/submission workflow |
| Unauthorized portal automation | A connector bypasses a portal rule, CAPTCHA, or login control. | Connector must use only supported interaction modes and stop for manual browser handoff. | Connector runtime |
| Credential exposure | Password/token appears in an artifact, log, prompt, or generated document. | Never persist credentials in workspace artifacts; use a browser session or OS credential store. | Local runtime |
| Job scam or misleading listing | A listing asks for payment, remote-control software, or sensitive identity material. | Safety classifier flags the job, disables submission, and requires a deliberate candidate override. | Job scout and submission gate |
| Duplicate application | Same employer/role is present on LinkedIn and a company site. | Dedupe candidates are shown before approval; candidate must explicitly allow a duplicate. | Ingestion and application lifecycle |
| Data loss | Batch import overwrites a raw JD or malformed local file breaks the dashboard. | Immutable source preservation, versioned artifacts, non-overwrite defaults, degraded read behavior, and backup export. | Artifact storage |
| Model/tool failure | An agent times out or returns invalid structured output. | Validate every artifact at the boundary; retain the last valid version and create an actionable failure record. | Agent orchestrator |
| Analytics misuse | A weak signal labels a candidate as unsuitable. | Analytics are descriptive and explainable; no hidden auto-rejection or external action. | Analytics layer |

## Stop conditions

The system must stop and request candidate action when any of the following occurs:

- no valid approval exists for the current submission payload;
- the destination form is materially different from the connector contract;
- CAPTCHA, MFA, unsupported upload format, unknown screening question, or a payment request appears;
- a document fails factual grounding or ATS validation;
- the job is flagged as suspicious, expired, duplicate, or already submitted;
- a required artifact is missing, invalid, or from a different job;
- an agent asks for a capability outside its approved tool scope.

## Recovery expectations

1. Never discard a candidate-entered draft after a validation or integration error.
2. Preserve the raw error privately in a local operation record; display a safe, actionable summary in the dashboard.
3. Let the candidate retry, edit, abandon, or hand off to a manual browser flow.
4. Do not change an application state to `submitted` without a receipt or explicit candidate confirmation.
