# Decision Log

**Status:** Foundation decisions accepted at M0, 2026-09-04
**Scope:** product direction and delivery boundaries; not authorization to implement future capabilities. See [M0 record](27-m0-baseline-and-delivery-inventory.md).

| ID | Decision | Rationale | Consequence |
|---|---|---|---|
| D-001 | Ship as a clone-and-run local workspace. | The intended users are developers who want ownership of their career data and workflow. | No hosted backend, sign-in, tenancy, or cloud synchronization. |
| D-002 | Serve one candidate per workspace. | There is no defined human-advisor operating model. | AI agents replace advisor roles; collaboration features are out of scope. |
| D-003 | Use a local dashboard plus CLI/agent workflows. | The dashboard makes progress inspectable; command workflows make complex work explicit. | Both surfaces read/write the same artifact contracts. |
| D-004 | Focus first on IT roles in HCMC/Vietnam. | This permits domain-aware matching and localization without pretending to support every profession. | Technical evidence, bilingual documents, local compensation, location, and source adapters are first-class. |
| D-005 | Candidate approval gates every external submission. | Applying has irreversible consequences and third-party sites impose their own constraints. | Approval is version-bound and auditable; automation must pause when consent is absent or stale. |
| D-006 | Use specialist AI agents. | Separation improves factual grounding, review quality, and safe tool access. | Agents have narrow input/output contracts and cannot silently expand their authority. |
| D-007 | Preserve explainability over opaque scoring. | A score alone cannot tell a candidate what to change or why a job is unsuitable. | Matching output includes evidence, gaps, exclusions, confidence, and open questions. |
| D-008 | Treat all job posting content as untrusted. | Postings can contain malformed, misleading, or adversarial content. | No posting instruction overrides workspace policy or triggers an external action. |
| D-009 | Defer n8n; adopt it only when a concrete automation proves it is simpler than a small native Node implementation. | The product is single-user and core artifact contracts are higher priority than an orchestration platform. | n8n is never required for the offline core. Before enabling it, define one user-valued workflow, compare a bounded Node spike with n8n, and record why n8n reduces rather than adds operational burden. |

## Open decisions

M0 also fixes these delivery choices: evolve existing local modules; combine agent roles where useful while keeping an independent grounding review; deliver one CV/manual application workflow before browser automation; provide basic recovery before real-data migration; keep n8n deferred. Detailed contract work remains listed in the M0 backlog.

These specifications deliberately leave the following implementation choices open until a later plan:

- exact desktop packaging approach and timing;
- exact model/runtime provider and local credential configuration;
- which job-source integrations are permitted and supportable;
- data format evolution and migration mechanism;
- supported document renderers and ATS-check tooling.
