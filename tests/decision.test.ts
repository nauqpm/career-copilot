import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { runCli } from "../src/cli.js";
import { parseJobDecision } from "../src/decision/schema.js";
import { saveCvDraft, saveJobDecision } from "../src/decision/storage.js";

test("parses a considered job with evidence and a CV recommendation", () => {
  const decision = parseJobDecision(validDecision());

  assert.equal(decision.status, "consider");
  assert.equal(decision.cvDraftRecommendation, "create");
  assert.equal(decision.matches[0]?.jobEvidence, "TypeScript required");
});

test("rejects scores, invalid states, and matches without evidence", () => {
  assert.throws(() => parseJobDecision({ status: "92%" }), /status/);
  assert.throws(() => parseJobDecision(validDecision({ status: "ready" })), /status/);
  assert.throws(
    () => parseJobDecision(validDecision({ matches: [{ topic: "English", finding: "Relevant language" }] })),
    /evidence/,
  );
});

test("saves decision and CV draft without changing the base profile", async () => {
  const root = await mkdtemp(join(tmpdir(), "career-decision-"));
  const jobDirectory = join(root, "job");
  const profilePath = join(root, "data", "profile", "candidate-profile.json");
  await mkdir(join(root, "data", "profile"), { recursive: true });
  await mkdir(jobDirectory);
  await writeFile(profilePath, '{"profile":"unchanged"}', "utf8");

  await saveJobDecision(jobDirectory, validDecision());
  await saveCvDraft(jobDirectory, "# Tailored CV\n");

  assert.equal(JSON.parse(await readFile(join(jobDirectory, "decision.json"), "utf8")).status, "consider");
  assert.equal(await readFile(join(jobDirectory, "cv-draft.md"), "utf8"), "# Tailored CV\n");
  assert.equal(await readFile(profilePath, "utf8"), '{"profile":"unchanged"}');
});

test("refuses to create a decision outside an existing job directory", async () => {
  const root = await mkdtemp(join(tmpdir(), "career-decision-"));

  await assert.rejects(
    saveJobDecision(join(root, "missing-job"), validDecision()),
    /Job artifact directory does not exist/,
  );
});

test("career decision validate writes normalized JSON", async () => {
  const root = await mkdtemp(join(tmpdir(), "career-decision-"));
  const input = join(root, "decision.json");
  const output = join(root, "normalized.json");
  await writeFile(input, JSON.stringify(validDecision()), "utf8");
  const capture = createIo();

  assert.equal(await runCli(["decision", "validate", input, "--out", output], capture.io), 0);
  assert.equal(JSON.parse(await readFile(output, "utf8")).status, "consider");
});

function validDecision(overrides: Record<string, unknown> = {}) {
  return {
    status: "consider",
    summary: "Relevant backend work is present.",
    matches: [
      {
        topic: "TypeScript",
        finding: "Relevant experience",
        jobEvidence: "TypeScript required",
        profileEvidence: "Built TypeScript APIs",
      },
    ],
    gaps: [],
    blockers: [],
    questions: ["Confirm salary"],
    cvDraftRecommendation: "create",
    ...overrides,
  };
}

function createIo() {
  return {
    io: {
      writeStdout() {},
      writeStderr() {},
      async readStdin() { return ""; },
    },
  };
}
