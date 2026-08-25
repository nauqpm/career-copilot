# Career Copilot

Career Copilot is a local-first workspace for career work. Vertical Slice 1 only prepares and structures Job Descriptions; it does not assess candidate fit, recommend applying, or modify a CV.

- Keep career data local. Do not add authentication, remote storage, multi-tenancy, or hosted agent runtimes.
- Support all professions. Do not assume a technical role or a skill taxonomy.
- Preserve raw JD content and its source reference. Derived fields must be traceable to that content.
- Do not fabricate title, company, requirements, responsibilities, dates, seniority, or any missing fact.
- Use `skills/analyze-job/SKILL.md` to produce a `JobAnalysis` from normalized raw content.
- The CLI owns input normalization and JSON/schema validation. The skill owns semantic extraction. Neither is coupled to a specific agent runtime.
- Keep the current slice small. Do not introduce a database, UI, MCP server, profile, scoring, application tracking, or resume features.
