# Career Copilot

Career Copilot is a single-user, local-first career workstation, initially focused on IT and adjacent roles in Vietnam/HCMC. M0 establishes the product direction; it does not authorize implementation of every future feature.

The active direction and delivery scope are recorded in `docs/specs/local-it-career-workstation/27-m0-baseline-and-delivery-inventory.md`. The specification index distinguishes accepted foundation decisions from proposed feature contracts. Older Slice 1–4 and dashboard plans are historical references, not executable plans for the new direction.

- Keep workspace storage local. Do not add product accounts, remote storage/sync, multi-tenancy, or hosted agent services. Optional external AI receives only explicitly selected data with disclosed consent; local storage does not make an external agent local.
- Focus initial UX and examples on IT/Vietnam while preserving free-text facts and existing profiles. Do not impose a closed skill taxonomy or reject legacy non-IT data.
- Preserve raw JD content and its source reference. Derived fields must be traceable to that content.
- Do not fabricate title, company, requirements, responsibilities, dates, seniority, or any missing fact.
- Use `skills/analyze-job/SKILL.md` to produce a `JobAnalysis` from normalized raw content.
- The CLI and local server share deterministic validation/storage rules. Skills own semantic extraction and proposals; neither contract is coupled to a specific agent runtime.
- Evolve the existing CLI, dashboard, profile, decision and Markdown draft workflow. Prefer shared functions and local JSON/Markdown files; do not introduce a database, MCP server, agent framework, background workers or runtime dependencies without a concrete need.
- Preserve source material and old revisions. Never migrate private data silently or label legacy drafts as reviewed/approved.
- First-release planning prioritizes evidence-linked matching, one CV workflow, local export, manual application/outcome records, and recovery. Portal automation, n8n, broad analytics and additional document types are deferred.
- No product-controlled external submission without approval bound to the exact destination and outgoing files/answers. A manually recorded outcome is candidate-reported, not proof of a system-authorized submission.
- Implement only the next explicitly requested, bounded task. M0 is documentation and inventory; future executable plans must start from current source and specify tests, compatibility and acceptance criteria.
