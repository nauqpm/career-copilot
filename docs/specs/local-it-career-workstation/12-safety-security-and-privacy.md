# 12. Safety, security, and privacy

## Purpose

Career Copilot is a local IT-career workstation, not a hosted service. This specification protects a Vietnamese/HCMC job seeker’s CV, employment history, contact details, compensation preferences, job-search activity, portal sessions, and generated documents. It applies even if a future release offers optional LLM/provider calls or source connectors. It implements [D-001, D-005, and D-008](00-decision-log.md), within the [product boundary](01-product-scope.md).

Related controls are specified in [Domain model and artifact contracts](03-domain-model-and-artifact-contracts.md), [Approval and submission](08-approval-and-submission.md), [Agent orchestration](11-agent-orchestration.md), [Job source connectors](13-job-source-connectors.md), [Local runtime](16-local-runtime-and-observability.md), and [Testing and release quality](17-testing-and-release-quality.md).

## Security objectives

1. Keep career data under user control on their machine by default.
2. Prevent untrusted job content from controlling tools or extracting data.
3. Prevent fabricated qualifications from entering a submitted application.
4. Require an explicit, version-bound user approval before every external submission.
5. Preserve enough local audit evidence to explain actions without logging credentials or unnecessary private content.

## Trust boundaries and threats

| Boundary | Treat as untrusted | Primary controls |
| --- | --- | --- |
| JD sources | webpage text, PDF/DOCX, copied chat/email, images, job portal metadata | normalization, provenance, content-as-data rule, no executable instructions |
| AI output | every extracted fact, recommendation, draft, tool request | schema validation, evidence ledger, independent review, least privilege |
| Browser and portals | dynamic pages, redirects, forms, third-party scripts, portal policy changes | user-owned session, allowlisted destination, visible handoff, no bypass |
| Local filesystem | corrupted files, unsafe IDs, symbolic links, other local software | safe path resolution, atomic writes, schema/version checks, restrictive permissions where available |
| Optional provider | prompts, responses, availability and retention policy | disabled by default; explicit per-run disclosure and scope selection |

Out of scope: protecting a compromised operating system, browser extension, or user account. The product must still make boundaries clear and avoid turning a local compromise into broader disclosure.

## Data classification

| Class | Examples | Storage and logging rule |
| --- | --- | --- |
| Highly sensitive | phone, email, address, compensation, identity documents, portal session/cookies | local only; never console-log; redact from diagnostics; credentials remain in OS/browser vault |
| Private career data | CV, employment history, portfolio evidence, application answers, interview notes | workspace data paths excluded from Git; include only with explicit user-selected export/backup |
| Sensitive activity | saved jobs, applications, outcomes, rejection/interview history | local only; aggregate only on device |
| Public/reference | job URL, employer public page, tool version, schema version | may be logged locally but still minimize content |

The application must ship with a conservative `.gitignore` covering runtime data, exports, logs, browser profiles, secrets, and generated PDFs. A release check must fail if known private paths are tracked; see [Release quality](17-testing-and-release-quality.md).

## Local-only defaults

- Bind the dashboard/API to `127.0.0.1` or OS loopback only; never `0.0.0.0` by default.
- Do not implement login, account recovery, cloud sync, analytics upload, remote database, telemetry, hosted agents, or multi-user collaboration.
- Do not use CDN-hosted frontend assets that leak local usage or identifiers; bundle assets with the release.
- Do not make network calls during startup, dashboard refresh, indexing, analytics, or tests.
- Use explicit, local configuration to enable an optional connector or AI provider. The UI must show the destination and exact data category before that operation.

## Untrusted-content and prompt-injection defense

Job text is data. It can contain malicious instructions such as “ignore prior rules,” requests for secrets, links to arbitrary tools, or misleading application steps. The system must:

1. delimit raw content and label its origin in every agent request;
2. instruct the agent that source text cannot change its role or capability manifest;
3. strip active markup/scripts before rendering and never execute source HTML;
4. reject tool/action requests derived solely from JD text;
5. require the user to select an external destination from a visible connector screen;
6. keep raw source, extracted facts, and agent instructions separate in storage and UI.

The same treatment applies to GitHub READMEs, portfolios, links, attachments, emails, and copied recruiter messages.

## Truthfulness and document safety

Generated content must distinguish verified evidence, user-confirmed statements, questions, and unsupported claims as defined in [Agent orchestration](11-agent-orchestration.md). The reviewer blocks unsupported accomplishments, inferred metrics, changed employment dates, fake certifications, fabricated referrals, and any answer that claims work authorization, salary, availability, or consent without an explicit user source.

No document is “ready to submit” merely because it has no reviewer findings. It must also be explicitly approved by the user for the exact job and destination.

## Approval as a security control

An approval record contains:

- local approval ID and creation/expiry time;
- job ID and SHA-256 hash of normalized source/analysis;
- destination connector and canonical destination URL or portal job ID;
- hashes of the CV, cover letter, attachments, and every generated form answer;
- user-visible summary of employer, role, selected account/session location, and claimed answers;
- explicit action: `approve-preparation` or `approve-submission`.

Only `approve-submission` authorizes a single attempt. Any changed file, changed answer, changed destination, expired approval, or unknown portal page invalidates it. A user can revoke a pending approval at any time. Approval never authorizes CAPTCHA bypass, policy evasion, credential export, automatic follow-up, or reuse for a different role.

## Credentials and browser sessions

The product must not ask users to paste portal passwords into text fields, config files, artifacts, agent prompts, or logs. Use the portal’s normal login flow in the user’s existing browser profile or operating-system credential store. A future managed browser profile, if added, requires an explicit separate design and encryption review.

MFA, CAPTCHA, identity checks, payment screens, legal attestations, and terms acceptance are always user-completed handoffs. The submission assistant pauses and displays the minimal next steps.

## Filesystem, export, and recovery

- Validate all IDs and paths; resolve paths under designated data roots before reads/writes.
- Use atomic write/rename and retain prior version/history where documented.
- Do not delete artifacts as a side effect of refresh, validation, or migration. Use a user-confirmed archive/remove command with a recoverable location.
- Exports must be initiated by the user, named clearly, and omit logs/secrets by default.
- A backup is local until the user chooses a destination. The product may warn that copying to cloud folders can defeat the local-only privacy posture.

## Local audit log

The audit log records state transitions, local actor (`user` or agent role), input/output artifact IDs and hashes, approval/revocation IDs, connector result, and error category. It must not record passwords, session cookies, tokens, complete CV/JD text, or unredacted form answers by default. Logs are append-only at the application layer and show tampering/parse errors rather than silently concealing them.

## Secure failure posture

On uncertainty, deny the external action, preserve drafts, and require manual review. Specific stop conditions include a changed portal origin, form fields not understood by the connector, missing/invalid approval, redirected destination, rate-limit response, new legal consent text, and inability to create a receipt.

## Acceptance criteria

- A clean install can run dashboard, local analytics, and tests with network disabled.
- A tracked private artifact or secret-like config is caught before release.
- A JD containing adversarial text cannot access profile data outside its invocation scope or enable a browser action.
- Submission cannot begin without a valid matching approval, and changing a document invalidates it.
- Debug logs and error reports contain no portal credentials or full private artifact contents.
