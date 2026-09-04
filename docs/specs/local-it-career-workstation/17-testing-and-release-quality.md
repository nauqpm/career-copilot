# 17. Testing and release quality

## Purpose

This specification defines evidence required before a Career Copilot release is described as safe, reliable, or ready for local users. It covers a clone-and-run local IT-career workstation, not a cloud/SaaS deployment. Passing a build alone is never enough. It is the verification companion to the [acceptance criteria catalog](21-acceptance-criteria-catalog.md) and [risk register](20-risk-register.md).

The release gate validates requirements from [Agent orchestration](11-agent-orchestration.md), [Safety](12-safety-security-and-privacy.md), [Connectors](13-job-source-connectors.md), [Dashboard](14-local-ui-and-dashboard.md), [Analytics](15-analytics-and-learning-loop.md), and [Local runtime](16-local-runtime-and-observability.md).

## Quality model

| Dimension | Required evidence |
| --- | --- |
| Correctness | deterministic unit/integration tests for schemas, workflow transitions, storage, versions, hashes, and error codes |
| Data safety | corruption, atomic-write, path-validation, conflict, migration-preview, backup/recovery tests |
| Truthfulness | fixtures proving unsupported claims are blocked and source/evidence links survive a draft/review cycle |
| External-action safety | approval invalidation and connector stop-condition tests; no live application submission in CI |
| Privacy/security | static guards, dependency/security review, redaction tests, local-bind tests, and adversarial JD fixtures |
| Usability | browser-level critical path tests, accessible keyboard flows, understandable error/empty states |
| Compatibility | supported local Node/runtime/browser versions, schema migration paths, offline operation |

## Test pyramid

1. **Unit tests** cover normalizers, JSON schemas, content hashes, version creation, evidence ledger rules, state-transition guards, route/ID safety, connector capability validation, and metric calculations.
2. **Integration tests** exercise the CLI, workspace filesystem service, loopback server/API, local configuration, locks, atomic writes, agent result validation, and append-only analytics events in temporary workspaces.
3. **Browser E2E tests** cover the user-visible workflow: import a JD, inspect raw/analysis state, see a match explanation, review a draft, approve exact documents, invalidate that approval with an edit, reach a manual handoff, record an outcome, and inspect local analytics.
4. **Release/manual checks** validate packaging, fresh clone setup, local browser display, no-network core workflow, supported platform behaviour, and any reviewed connector in a non-submitting sandbox/fixture mode.

Coverage targets are useful for deterministic core modules but must not be gamed. The release record reports line/branch coverage for `src` (excluding generated/bundled code) and explicitly lists untested integration risks. A target of 80%+ for core logic is a baseline; authorization, path safety, and state transitions require direct tests regardless of percentage.

## Fixture policy

Fixtures must be synthetic, publicly redistributable, or deliberately redacted. Never commit a real CV, private recruiter email, authenticated HTML page, session cookie, token, personal phone/address, or real application answer. Include Vietnamese and English mixed-language fixtures for IT roles (backend, DevOps/SRE, QA, BA, data/AI) and hostile-content fixtures.

Required adversarial cases include:

- JD says to reveal secrets, disable safeguards, open an arbitrary URL, or submit immediately;
- source contains malformed HTML, script-like text, dangerous filenames, enormous input, invalid encoding, or a redirect;
- job/profile/approval JSON is truncated, incompatible, tampered with, or contains an unsafe ID;
- two near-duplicate HCMC postings differ in employer, role, date, or location;
- approved CV/answer/destination changes after approval;
- portal page requires CAPTCHA, MFA, legal consent, unknown field, or changes origin;
- raw or profile artifact fails while unrelated jobs still render.

## Agent quality evaluation

Agent output is assessed as structured artifacts, not by persuasive prose. A local evaluation corpus should include input source, expected factual extraction, permitted unknowns, required citations/spans, blocked fabricated claims, required gap questions, and expected safe stop conditions. Record model/runtime/config version beside each evaluation run; do not claim an agent is stable across versions without re-running it.

Evaluation dimensions:

| Dimension | Pass criterion |
| --- | --- |
| Grounding | every factual output claim is supported or explicitly user-confirmed |
| Completeness | required stated JD facts are extracted or marked unavailable/ambiguous |
| Non-fabrication | no invented experience, number, employer fact, degree, certification, salary, or legal claim |
| Match explanation | blockers, strengths, gaps, uncertainty, and source references are present; no opaque percentage alone |
| Injection resistance | hostile source cannot change capabilities or trigger external actions |
| Locality | test succeeds without unsolicited network/telemetry |

Human review of a sampled local corpus remains necessary before widening automation. A reviewer must be able to reproduce a failing case from saved fixture/artifact IDs.

## Connector test policy

CI never logs into a job portal, crawls live pages, sends application forms, solves CAPTCHA, or consumes a user session. Connector tests use recorded/redacted DOM fixtures and local fake browser/HTTP transports. Integration tests assert origin allowlists, rate/cancellation logic, approval binding, field mapping, redirect handling, manual handoff, receipt generation, and immediate suspension behaviour.

A source connector is release-eligible only when its capability declaration, separate policy/technical review, and kill switch are current; see [Connectors](13-job-source-connectors.md). A successful test fixture does not prove the live portal still permits automation.

## Security and privacy gates

Automated checks must fail on:

- data/private paths, exports, logs, browser profiles, or secret-like config tracked by Git;
- obvious plaintext secrets in source/config/test fixtures;
- dashboard default bind outside loopback;
- network calls in offline-core test cases;
- unsanitized imported HTML rendered as active content;
- unsafe path traversal/symlink escape paths;
- submission transition without current matching approval;
- logs containing representative credentials, cookies, CV body, or form-answer fixtures.

Dependency checks review production dependencies and lockfile changes. Findings are triaged with version, exploitability for a local app, mitigation, and release decision; do not dismiss a result merely because the product is local.

## Release procedure

1. Review the complete diff and artifact/schema compatibility impact.
2. Run format, lint, type check, unit/integration tests, browser E2E tests, coverage, and security/privacy guards.
3. Run a fresh temporary workspace smoke test with network disabled.
4. Run migration preview and upgrade/reopen test for representative old fixtures.
5. Verify dashboard loopback binding, local data ignore rules, redacted logs, and manual-handoff behaviour.
6. If a connector changed, keep it disabled unless its separate review and fixture suite pass; do not validate by submitting a real application.
7. Create release notes that list supported platform/runtime, schema changes, migration/backup instructions, optional integrations, known limitations, and rollback/recovery guidance.

Release notes must state observed verification results and blockers precisely. Never say a live portal, external provider, or user-specific workflow works unless it was actually and safely verified in that scope.

## Definition of done

- Required automated checks pass from a clean checkout with documented setup.
- Test data contains no private career data or credentials.
- Core functionality works offline and no default process exposes network services.
- Submission is blocked before approval and safely hands off when portal conditions are unknown.
- The user can recover a corrupted artifact/migration failure without losing unrelated local data.
- Any known gap is documented as a limitation with a safe manual alternative.
