# 25 — AI Provider and Data Egress Policy

**Status:** Proposed for review
**Depends on:** [Explainable matching](06-explainable-matching.md), [Agent orchestration](11-agent-orchestration.md), [Safety, security, and privacy](12-safety-security-and-privacy.md), [Local runtime](16-local-runtime-and-observability.md), and [Testing and release quality](17-testing-and-release-quality.md). It does not require n8n.

## 1. Purpose and outcome

Career Copilot works without an AI provider. Its default mode is **local and offline-safe**: store, view, version, compare, approve, and audit career artifacts without sending data to a network service. This specification makes optional AI assistance operational without weakening that posture.

An **AI provider** is any local model runtime or remote service that receives prompt input and returns generated output. **Data egress** is any transfer of workspace data from the local Career Copilot process to a destination outside the workspace boundary, including a remote model API, an embedding API, a proxy, a managed local-network model server, or a diagnostic service. A request to a model on `localhost` is not remote egress, but remains an explicit provider invocation and must be visible to the candidate.

This document defines:

- what can be sent, to which destination, and only after which consent;
- how local and remote provider profiles, credentials, cost, capacity, and failure are controlled;
- how model output is reproducible, evaluated, and prevented from becoming undocumented truth;
- how n8n may trigger an agent stage without acquiring permission to disclose data or act externally.

It does **not** authorize collecting jobs from a source, changing a profile fact, submitting an application, or sending email. Those authorities remain governed by the cited specifications.

## 2. Non-negotiable posture

1. **Offline by default.** A fresh installation has no provider enabled, no API key required, no automatic model download, and no outbound request during startup, dashboard refresh, indexing, analytics, or tests.
2. **Local-first, not local-only by assertion.** A remote provider is optional and is a disclosed data transfer. It may be useful, but it never silently becomes the fallback for a failed local model.
3. **Minimum necessary input.** Send a purpose-built, redacted excerpt and stable artifact references locally; never a whole workspace merely because an agent can read it.
4. **No authority in model text.** Provider output is an untrusted proposal. It passes schema, evidence, and policy checks before becoming a draft; it cannot request tools, change its own network scope, approve a document, or advance submission.
5. **No hidden retention.** Career Copilot does not store a full prompt, response transcript, provider request body, or private artifact body in routine logs, n8n execution history, analytics, or error reports.
6. **Candidate remains in control.** A candidate makes the egress decision for each remote run. A remembered preference may preselect a profile but cannot replace the per-run confirmation described below.
7. **Failure is safe.** If consent, reachability, credential, schema, budget, or policy validation fails, preserve inputs and show a recoverable `needs-review`/`failed-safe` state. Do not replace a prior approved artifact or submit anything.

## 3. Provider modes and egress classification

### 3.1 Provider modes

| Mode | Destination | Default | Remote egress? | Typical use | Important constraint |
| --- | --- | --- | --- | --- | --- |
| `disabled` | none | enabled by default | no | deterministic local features only | agent action returns a clear unavailable state |
| `local-runtime` | loopback/Unix socket runtime on the same machine | optional | no | private inference with an installed model | endpoint must resolve to loopback or an explicitly confirmed local socket |
| `local-network` | user-selected LAN runtime | disabled | yes | a personally managed model server | treated as remote egress; never assume a private Wi-Fi is safe |
| `remote-api` | named provider HTTPS origin | disabled | yes | higher-quality extraction/drafting | explicit per-run disclosure and consent |
| `mock-eval` | test fixture only | test-only | no | repeatable tests/evaluations | cannot be selectable in a normal user run |

`local-runtime` does not imply zero privacy risk: other local users/processes, model files, and runtime logs can still expose content. It is nevertheless the preferred AI mode for private artifacts when the user has assessed their machine.

### 3.2 Data classes and egress decision

The [safety data classes](12-safety-security-and-privacy.md) are made actionable as follows:

| Data category | Examples | Local runtime | Remote provider default | Remote provider only when |
| --- | --- | --- | --- | --- |
| `public-reference` | public job URL, product/schema version, selected role label | allowed when needed | allowed only if relevant | disclosure confirms the exact origin |
| `job-content` | copied JD, recruiter email body, employer requirements | allowed after injection framing | blocked by default | candidate selects a minimized excerpt and approves this run |
| `private-career` | CV text, work history, portfolio evidence, interview notes | allowed after user starts run | blocked by default | candidate selects exact document/evidence scope and approves this run |
| `highly-sensitive` | phone, address, compensation, identity documents, passwords, portal cookies, OTPs | never send by default | prohibited | no standard consent override exists; user must manually redact/export outside the product if they choose |
| `activity-history` | applications, rejections, outcomes, interview schedules | local aggregate only | prohibited by default | a future separately-approved feature and policy explicitly permits a minimized aggregate; this spec does not |

Before prompt construction, the launcher classifies every selected field. An unclassified field blocks the run rather than inheriting the most permissive category. The candidate can remove any eligible field before confirmation.

## 4. Consent and request lifecycle

### 4.1 Consent is per remote run

For every `remote-api` or `local-network` invocation, the UI must present a blocking **Data egress confirmation** immediately before the request. It must say, in Vietnamese/English according to UI locale:

- provider profile name, provider operator, canonical HTTPS origin, and selected model;
- purpose and agent role, for example `Job intake analyst — extract stated requirements`;
- exact input artifacts, selected excerpts/fields, and classification; counts are insufficient;
- explicit exclusions/redactions, especially phone/address/credentials;
- expected output type, not a promise of correctness;
- configured provider retention/training statement as entered/verified by the user, plus a link to its current policy when available;
- configured maximum cost/usage, timeout, and the fact that a failed request may still be billable according to the provider;
- a one-run choice: `Send selected data` or `Cancel`.

The UI must not pre-tick `Send selected data`, hide the origin behind a brand name, or bundle unrelated jobs/documents into one confirmation. Selecting "remember this provider" stores only a local preference; it does not skip later per-run confirmation.

### 4.2 Local runtime confirmation

For a `local-runtime` run, the user starts the action in the dashboard/CLI and sees the model name, endpoint class (`localhost` or local socket), selected artifacts, and resource estimate. A separate modal is not required each time, but the run screen must make the use visible and allow cancellation before dispatch. A switch in settings can require the stricter remote-style confirmation for all providers.

### 4.3 Consent record and idempotency

Each attempted provider run creates a local, append-only metadata record with:

```json
{
  "providerRunId": "prun_...",
  "requestedAt": "2026-08-31T00:00:00.000Z",
  "mode": "remote-api",
  "providerProfileId": "provider_...",
  "providerProfileRevision": "3",
  "modelId": "provider-model-id",
  "agentRole": "it-match-analyst",
  "purpose": "explainable-match",
  "inputManifest": [
    { "artifactId": "job_...", "versionId": "analysis_...", "fieldPaths": ["requirements"], "classification": "job-content", "contentHash": "sha256:..." }
  ],
  "promptTemplateId": "match-v2",
  "promptTemplateHash": "sha256:...",
  "consent": { "kind": "per-run", "grantedAt": "...", "scopeHash": "sha256:..." },
  "limits": { "timeoutMs": 45000, "maxInputTokens": 6000, "maxOutputTokens": 1800, "maxCostVnd": 12000 },
  "outcome": "succeeded | cancelled | failed-safe | blocked"
}
```

This record intentionally contains hashes, references, sizes, classifications, status codes, and usage totals—not prompt text, response text, API keys, or private body content. Its `scopeHash` covers profile revision, provider revision, model ID, prompt-template hash, selected field hashes, and limits. Reuse is allowed only for retrying the same request before expiry; a different profile/JD/excerpt/model/prompt requires new consent.

## 5. Prompt construction and output boundary

### 5.1 A deterministic prompt envelope

The launcher—not an agent-generated instruction—builds the request in this fixed order:

1. trusted system/policy envelope and schema requested;
2. fixed role instruction and no-tool/no-external-action constraint;
3. source provenance labels and untrusted-content delimiters;
4. the user-confirmed minimal data fields;
5. a structured-output instruction with evidence-reference requirements.

Raw JDs, email bodies, web pages, and attachments are always inserted only in the delimited untrusted-content section. They never select a provider, endpoint, model, file path, tool, or destination URL. Active HTML is converted to inert text before it enters any model input.

### 5.2 Input minimization rules

- Job analysis receives the relevant raw/normalized JD excerpt and source span IDs, not profile/CV data.
- Matching receives validated job-analysis fields plus only evidence snippets relevant to stated requirements; it receives no portal session, raw email headers, unrelated documents, or whole workspace export.
- Drafting receives the user-selected job facts, approved profile evidence and selected base document revision. Contact/address/compensation are omitted unless their field is necessary and locally confirmed.
- Grounding review receives the proposed draft and claim ledger/evidence references. It does not need provider-call history or portal data.
- Long documents must be section-selected or summarized locally first. The system must expose truncation/summarization to the candidate and never claim omitted content was considered.

### 5.3 Response validation

Provider output first lands in an ephemeral response buffer. Before creating a derived artifact it must:

1. parse against a versioned JSON schema;
2. reject unauthorized fields, executable/tool directives, unbounded URLs, and invented identifiers;
3. map every factual claim to supplied evidence IDs/source spans or label it `unknown`/`unsupported`;
4. run role-specific policy checks from [Agent orchestration](11-agent-orchestration.md) and [Explainable matching](06-explainable-matching.md);
5. write a new proposal/revision only after validation succeeds.

Invalid output is not silently repaired by a second model call. It becomes `needs-review` with a redacted failure category. The candidate can retry with a changed provider/model/prompt scope only through a new consented run.

### 5.4 Transcript policy

The full outbound request and raw provider response exist only in process memory for the minimum time required to validate and produce a local artifact. They must be cleared on success, cancellation, or failure to the extent supported by the runtime. They are never persisted in:

- normal application logs, browser console output, crash reports, analytics, or clipboard;
- n8n execution JSON, node output, raw collection, or Wait payload;
- artifact metadata other than allowed hashes/references/usage;
- test fixtures, unless fully synthetic and marked `mock-eval`.

A local, explicit developer diagnostic mode may record a redacted structured trace for a short configured duration. It must be off by default, display a privacy warning, omit private content and credentials, auto-expire, and be stored outside Git-tracked paths. It is not a mechanism to capture full transcripts.

## 6. Provider profiles, credentials, and endpoint validation

### 6.1 Local provider profile

Provider configuration is stored locally, separately from workspace artifacts and excluded from Git. A profile has a stable ID and revisions; editing origin/model/retention claim creates a new revision. Required fields:

| Field | Requirement |
| --- | --- |
| `profileId`, `revision`, `displayName`, `mode`, `enabled` | stable, local, human-readable profile identity |
| `operator`, `canonicalOrigin`, `allowedOriginSet` | explicit destination identity; remote origins must use HTTPS |
| `modelAllowlist`, default model, capability flags | only explicit models may run; capability flags are conservative |
| `retentionTrainingStatement`, policy URL, checked-at time | user-visible provider policy evidence; unknown means remote profile remains disabled |
| `tokenizer/price revision` and currency | estimate provenance; unknown price requires zero-cost-only/local use or a user-set hard request cap |
| `limits` | per-run/workspace monthly cost, tokens, timeout, concurrency, request-rate caps |
| `credentialReference` | opaque operating-system/n8n credential-store reference only |

Remote origin validation is fail-closed: HTTPS only; exact origin allowlist; no arbitrary URL from a prompt/JD; DNS/IP checks reject loopback/private/link-local targets unless the mode is intentionally `local-runtime` or explicitly confirmed `local-network`; redirects are rejected unless the redirect target is also exact-allowlisted. Do not expose a generic “custom URL” field in the normal UI.

### 6.2 Credential management

- API keys, OAuth refresh tokens, and client secrets must live in the operating-system credential vault or n8n encrypted credential store as appropriate—not in `.env` committed to the repository, artifact JSON, prompt input, screenshots, support bundles, or logs.
- Career Copilot reads only an opaque `credentialReference`; the key value is injected just-in-time by the provider adapter and is never returned to agents.
- The setup UI supports a test connection that sends no career artifact. It reports origin/model identity without echoing secrets.
- Disconnect/revoke removes the local reference and prevents future runs. It does not claim to revoke data already received by a remote provider; the UI links to the provider’s revocation/deletion process.
- n8n may own a credential for an n8n-run connector, but it must not pass it to Career Copilot, a model prompt, raw capture, or Wait payload. See [n8n local automation](22-n8n-local-automation.md).

## 7. Model routing, budgets, capacity, and cancellation

### 7.1 Explicit routing, never invisible fallback

The user selects a provider profile/model when starting a task or accepts a clearly displayed local default. The agent role declares a compatibility requirement (structured JSON, context size, Vietnamese/English handling) but cannot select a network destination. If the selected model is unavailable, the run stops with choices: retry later, select another model and reconfirm if egress changes, or continue manually/offline.

Recommended default routing:

| Work | Default route | Remote fallback |
| --- | --- | --- |
| deterministic normalization, hashing, versioning, hard filters | no model | none |
| JD extraction, explainable matching, draft/review | eligible local runtime | user-selected, per-run-consented remote profile only |
| bulk n8n intake | queued local runtime, one at a time | no automatic remote fallback |
| evaluation and CI | mock or pinned local test runtime | prohibited unless a separately controlled non-CI evaluation run is explicitly requested |

### 7.2 Limits

Every provider adapter enforces the lowest of profile, workspace, role, and run limits before dispatch:

- **tokens:** default `6,000` input and `1,800` output tokens for a single analysis/match; role-specific caps may be lower;
- **timeout:** default `45 seconds` remote and `120 seconds` local runtime, configurable only within profile maximums;
- **concurrency:** one active model invocation per workspace by default; local model work queues behind it;
- **rate:** conservative per-origin request and token window, with no automatic burst after recovery;
- **cost:** a per-run VND ceiling, rolling daily and monthly workspace caps, and an estimated preflight. A request is blocked if the estimate exceeds any cap; unknown remote pricing blocks the run unless its explicit hard request cap is `0` cost/approved by the user;
- **payload:** byte and attachment limits before tokenization; oversized data requires the candidate to select an excerpt.

The UI labels cost as an estimate before dispatch and records actual provider-reported usage after a successful response when available. It never reports `0 VND` when usage is unknown. Provider usage is local, aggregated by profile/model/role/day, with no content attached.

### 7.3 Queue and cancellation

Each job has a cancellable local queue entry with `providerRunId`, priority, selected artifact hashes, profile revision, and deadline. Cancelling before send removes it. Cancelling after send stops local processing and attempts provider cancellation if the provider supports it, but must state that remote billing/processing may already have occurred. A cancelled run cannot later materialize an artifact.

## 8. Outage, retry, and degraded/offline behaviour

### 8.1 Failure categories

| Category | Examples | Automatic action | User outcome |
| --- | --- | --- | --- |
| `blocked-policy` | no consent, prohibited data class, unallowlisted origin, budget exceeded | no request | explain block and offer local/manual alternative |
| `blocked-configuration` | missing credential, disabled profile, uninstalled local model | no request | settings repair path |
| `transient-provider` | timeout, temporary 5xx, local runtime starting | bounded retry only if same consent/scope remains valid | queued/retry-later state |
| `rate-limited` | 429 or provider quota | honor server delay; no burst | show next eligible attempt and budget state |
| `authentication` | revoked/invalid key | no retry | reconnect credential without exposing it |
| `invalid-response` | schema mismatch, malformed JSON, unsafe directive | no automatic retry | `needs-review`, retry must be user-triggered |
| `ambiguous-charge` | response lost after provider may have accepted request | no automatic repeat | user sees potential duplicate/billing warning |

### 8.2 Bounded retry

Only `transient-provider` and safely confirmed `rate-limited` runs may retry automatically: maximum two retries with jittered exponential backoff, preserving the same `providerRunId` and consent `scopeHash`. A retry never changes provider/profile/model/input/prompt/limits. It stops if the consent expires, a pinned artifact changes, a workspace cost cap is reached, or the user cancels.

An n8n workflow may schedule or display the retry, but it may not place prompt/response bodies in its execution data and may not choose a remote fallback. It passes only the `providerRunId` and receives a redacted status. A waiting workflow must remain `waiting-for-user` or `needs-review` when a run requires fresh consent.

### 8.3 Degraded modes

When no provider is available, Career Copilot continues to support import, raw capture, deterministic validation, versioning, evidence editing, hard filters, manual comparison checklists, document editing, approvals, browser handoff, receipts, outcomes, and local analytics. AI-only actions show a useful manual alternative:

| Unavailable AI action | Offline/manual alternative |
| --- | --- |
| extract JD | show raw text with editable structured fields and source spans |
| explain match | requirement/evidence matrix with user-entered assessment and gaps |
| draft document | base-document editor plus claim ledger and role checklist |
| grounding review | deterministic claim/evidence link audit and candidate review queue |

No user should be unable to apply solely because an AI provider is unavailable.

## 9. Reproducibility, evaluation, and change control

### 9.1 Version pinning

Every derived artifact that involved a provider records: provider profile revision, operator/origin, model ID and model revision when exposed, adapter version, prompt-template ID/hash, schema version, agent-role version, input artifact/version hashes, response validator version, limits, timestamp, and usage/status. It does not record model chain-of-thought, credentials, or transcript.

“Latest” model aliases are forbidden for release baselines and evaluation profiles. A normal user profile may select a provider’s moving alias only after a warning that results can change; its observed model/version must be recorded if the provider exposes it. If it does not, the run is marked `model-version-unavailable`.

### 9.2 Evaluation corpus and gates

The evaluation corpus extends [Testing and release quality](17-testing-and-release-quality.md): synthetic/redacted Vietnamese and English IT job/profile fixtures, expected extraction spans, supported claims, gaps, disqualifiers, hostile prompt-injection text, and false-claim traps. It contains no real provider credentials or career data.

For each approved provider/model/prompt combination, record an evaluation report with corpus revision, configuration manifest, pass/fail by dimension, failures, evaluator version, and date. Required gates:

- extraction preserves stated facts and flags unknowns rather than inventing them;
- every factual generated claim has a valid input evidence/source reference;
- hostile source text cannot alter capability/egress/approval behaviour;
- schema-invalid output is safely rejected;
- logs/metadata contain no fixture CV/JD body or credential markers;
- offline and disabled-provider paths remain usable;
- a model/provider/profile/prompt/schema/validator change re-runs the affected evaluation before it becomes a recommended default.

Evaluation results guide a candidate but never certify a remote provider as private, available, or suitable for a real application.

### 9.3 Local model provenance and trade-offs

Local models reduce third-party disclosure but add practical risks: substantial disk/RAM/VRAM use, slower inference, lower quality for mixed Vietnamese/English text, untrusted downloaded model weights, and local-runtime logging/telemetry defaults. The setup screen must show model source, checksum/signature when available, file size, hardware estimate, license, installed runtime version, and last tested evaluation profile. Downloads happen only after user action and from an allowlisted source; no model auto-download occurs during a job workflow.

An offline model can still fabricate facts. Locality never relaxes evidence checks, independent review, approval binding, or the no-submission-without-user rule.

## 10. n8n integration contract

n8n is an optional local orchestrator, not an AI policy authority. For Workflows 04/06/07 and related maintenance in [n8n local automation](22-n8n-local-automation.md):

- n8n may enqueue a named local `providerRunId` only after Career Copilot has created its input manifest and determined provider eligibility;
- any remote/local-network run without current consent transitions to `waiting-for-user`; n8n exposes a dashboard event but cannot create consent itself;
- n8n receives and stores only opaque run ID, state, retry-after time, redacted error category, and aggregate usage/cost fields;
- raw captures remain source evidence, never prompt-transcript storage;
- Workflow 15 retains its human gate. Provider completion may create a draft/review proposal but never an approval or external action;
- retry/maintenance respects the bounded retry policy above and cannot swap a provider/profile/model to make a failed run succeed.

## 11. Acceptance criteria

- A clean workspace works with all provider modes disabled, makes no network request, and offers manual alternatives for each AI action.
- Enabling a remote profile requires an explicit origin, retention/training statement, policy URL/check time, model allowlist, limits, and credential reference; a generic arbitrary endpoint is rejected.
- Before every remote/local-network run, the candidate can inspect and remove each selected field, sees destination/model/purpose/cost/timeout, and must make a positive one-run consent action.
- Phone, address, identity files, secrets, cookies, OTPs, compensation, and activity history cannot enter a standard remote request, even when a model/prompt asks for them.
- Changing selected input content, provider revision, model, prompt template, or limits invalidates prior consent; a retry with the identical scope does not request consent again before expiry.
- Provider metadata supports reproducing an artifact’s configuration without retaining a full prompt/response transcript or credentials.
- A schema-invalid, injected, timed-out, rate-limited, or unavailable provider response cannot overwrite raw/approved artifacts, create approval, or trigger a submission.
- Cost/token/concurrency caps block dispatch before a remote request; cancellation and ambiguous-charge states are visible and do not create a hidden retry.
- n8n execution data and Wait payloads contain no prompt/response body, API key, CV/JD body, cookie, or token; they can only observe opaque run status.
- A provider/model/prompt/schema/validator change fails release promotion until the relevant synthetic evaluation suite is rerun and results are recorded.
- A local-model download requires a user action and displays provenance, resource estimate, and license; a local model still fails factual/evidence checks when it fabricates.

## 12. Cross-reference map

- [Explainable matching](06-explainable-matching.md) defines match evidence, confidence, and versioned matcher snapshots.
- [Agent orchestration](11-agent-orchestration.md) defines agent roles, capability manifests, and evidence-ledger constraints.
- [Safety, security, and privacy](12-safety-security-and-privacy.md) defines data classes, prompt-injection defence, credentials, and the secure-failure posture.
- [Local runtime and observability](16-local-runtime-and-observability.md) defines loopback binding, redacted local logs, backup, and health visibility.
- [Testing and release quality](17-testing-and-release-quality.md) defines fixture restrictions, quality gates, and release evidence.
- [n8n local automation](22-n8n-local-automation.md) defines the fifteen workflows, raw evidence, waits, retention, and local automation boundaries.
