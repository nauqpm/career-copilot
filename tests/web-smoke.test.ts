import assert from "node:assert/strict";
import test from "node:test";

import { renderDashboard, renderJobDetail } from "../public/app.js";

test("empty dashboard directs the user to paste a JD", () => {
  assert.match(renderDashboard({ jobs: [], profile: undefined }), /Add a job/);
});

test("detail shows decision evidence and a Markdown download but no JSON", () => {
  const html = renderJobDetail(populatedFixture());

  assert.match(html, /Consider/);
  assert.match(html, /Download CV draft/);
  assert.doesNotMatch(html, /"requirements"/);
});

function populatedFixture() {
  return {
    id: "job-example",
    sourcePreview: "Backend developer role",
    title: "Backend Developer",
    company: "Example Co",
    decisionStatus: "consider",
    hasAnalysis: true,
    hasCvDraft: true,
    raw: { content: "Build reliable APIs.", source: { type: "text", value: "Company site" } },
    analysis: {
      title: "Backend Developer",
      company: "Example Co",
      requirements: [{ category: "skill", statement: "TypeScript", priority: "required" }],
      responsibilities: ["Build APIs"],
      employment: { workArrangement: "hybrid", locations: [{ raw: "Ho Chi Minh City" }], schedule: "Monday to Friday" },
      compensation: { salaryStatus: "stated", salary: "30–40M VND", benefits: ["Health insurance"] },
    },
    decision: {
      status: "consider",
      summary: "Relevant API delivery experience.",
      matches: [{ topic: "TypeScript", finding: "Relevant experience", jobEvidence: "TypeScript", profileEvidence: "Built APIs" }],
      gaps: [],
      blockers: [],
      questions: [],
      cvDraftRecommendation: "create",
    },
    cvDraft: "# CV draft",
  };
}
