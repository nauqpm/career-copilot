---
name: analyze-job
description: Extract a generic, traceable JobAnalysis from normalized local Job Description content.
---

# Analyze Job

## Purpose

Turn one `RawJobContent` object into a valid `JobAnalysis` without adding facts that are absent from the Job Description.

## Input

```ts
type RawJobContent = {
  content: string;
  source: { type: "text" | "file" | "url"; value: string };
};
```

## Output

```ts
type JobAnalysis = {
  title?: string;
  company?: string;
  seniority?: string;
  requirements: Array<{
    category: "skill" | "experience" | "education" | "language" | "other";
    statement: string;
    priority?: "required" | "preferred" | "unknown";
    minimumYears?: number;
    degree?: string;
    languageLevel?: string;
  }>;
  responsibilities: string[];
  employment?: {
    type?: "full-time" | "part-time" | "contract" | "internship" | "temporary";
    workArrangement?: "onsite" | "hybrid" | "remote";
    locations?: Array<{
      raw: string;
      city?: string;
      address?: string;
    }>;
    schedule?: string;
    duration?: string;
    startDate?: string;
    probation?: string;
    onsiteExpectation?: string;
  };
  compensation: {
    salaryStatus: "stated" | "not-stated";
    salary?: string;
    benefits?: string[];
  };
  application?: { deadline?: string; hiringProcess?: string[] };
  workConditions?: { overtime?: string; onCall?: string; travel?: string };
  opportunities?: {
    conversionToPermanent?: string;
    training?: string[];
    careerGrowth?: string[];
    relocation?: string[];
  };
};
```

## Procedure

1. Read the complete `content`; retain the source reference separately.
2. Extract title, company, and seniority only when explicitly stated. Omit any unknown field.
3. Extract candidate requirements as concise statements. Classify them without assuming a profession.
4. Mark a requirement `required` only when the JD clearly makes it mandatory. Use `preferred` for language such as “plus” or “nice to have”; use `unknown` when the priority is unclear.
5. Record explicit minimum years, degree wording, and language proficiency in the corresponding requirement fields.
6. Extract employment type, arrangement, locations, schedule, duration, start date, probation, and any explicit onsite expectation. For each location, keep `raw` as the exact location wording from the JD and add `city` and `address` only when they are explicitly present.
7. Always include `compensation.salaryStatus`: use `stated` with the exact salary wording when any salary statement appears; otherwise use `not-stated`. Extract benefits separately.
8. Extract application deadlines, hiring steps, overtime, on-call, travel, conversion-to-permanent, training, career growth, and relocation only when the JD states them.
9. Extract responsibilities only when they describe work the role performs.
10. Return only the JSON object that matches `JobAnalysis`, then validate it with `career job validate-analysis`.

## Constraints

- Preserve meaning; do not turn preferences into mandatory requirements.
- Do not convert a vague trait into years of experience, a skill level, or a certification.
- Do not infer company, title, location, industry, compensation, or seniority.
- Do not turn a city into a street address, split a vague location into fake structured parts, or summarize a salary into a number or currency that the JD did not state.
- Do not score fit or make an apply/skip recommendation.
- Do not rewrite raw JD text as if it were verified structured fact.

## Quality checks

Before returning the JSON, confirm every requirement and responsibility can be located in the source JD, optional fields are explicit, `salaryStatus` accurately records whether a salary was mentioned, ambiguous information remains ambiguous, and both `requirements` and `responsibilities` are arrays.
