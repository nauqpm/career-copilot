---
name: analyze-profile
description: Use when a Career Copilot user explicitly asks Codex to structure a local candidate CV or profile source into a validated CandidateProfile.
---

# Analyze Profile

## Purpose

Turn one local candidate source `.txt` or `.md` file into a `CandidateProfile` without inventing qualifications or tailoring it to a specific job.

## Input

Read the complete source file, normally `data/profile/source.md`. Its content is private and must stay local.

## Output

Return one JSON object matching this shape:

```ts
type CandidateProfile = {
  contact?: { name?: string; email?: string; phone?: string; location?: string; links?: string[] };
  headline?: string;
  summary?: string;
  experience: Array<{ company?: string; title: string; startDate?: string; endDate?: string; highlights: string[] }>;
  skills: string[];
  education: Array<{ school?: string; degree?: string; field?: string; graduationDate?: string }>;
  languages: Array<{ language: string; level?: string }>;
  certifications?: string[];
  preferences?: {
    employmentTypes?: Array<"full-time" | "part-time" | "contract" | "internship" | "temporary">;
    workArrangements?: Array<"onsite" | "hybrid" | "remote">;
    locations?: string[];
    minimumSalary?: string;
    schedule?: string;
    notes?: string;
  };
};
```

## Extraction rules

1. Extract only explicit facts from the profile source. Omit any absent optional field.
2. Keep `experience`, `skills`, `education`, and `languages` as arrays, even when empty.
3. Give every experience item an explicit title and one or more source-backed highlights. Do not turn an employer name, a tool list, or a desired role into experience.
4. Add contact details, dates, degree, language level, certifications, links, and preferences only when the source states them.
5. Treat preferred work arrangement, locations, salary, and schedule as preferences only when the candidate explicitly states them. Do not infer them from previous jobs or location.
6. Preserve uncertainty: do not invent proficiency, seniority, years, employment type, or compensation.

## Boundaries

- Do not read a JD or tailor the profile to a job in this skill.
- Do not create a CV draft, decision, cover letter, or recommendation.
- Do not overwrite `data/profile/source.md`.
- Write `data/profile/candidate-profile.json` only if the user explicitly asks to save the validated output there; otherwise return JSON only.
- Validate saved JSON with `career profile validate`.

## Quality check

Before returning, verify each populated field is traceable to the source, all required arrays exist, no string is blank, and no job-specific wording was introduced.
