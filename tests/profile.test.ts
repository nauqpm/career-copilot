import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { runCli } from "../src/cli.js";
import { parseCandidateProfile } from "../src/profile/schema.js";
import { readCandidateProfile, saveCandidateProfile, saveProfileSource } from "../src/profile/storage.js";

test("parses a candidate profile with job-search constraints", () => {
  const profile = parseCandidateProfile({
    headline: " Backend developer ",
    experience: [{ title: "Intern", highlights: ["Built internal tooling"] }],
    skills: [" TypeScript "],
    education: [],
    languages: [{ language: "English", level: "B2" }],
    preferences: { workArrangements: ["hybrid"], minimumSalary: "20M VND/month" },
  });

  assert.equal(profile.headline, "Backend developer");
  assert.deepEqual(profile.skills, ["TypeScript"]);
  assert.equal(profile.preferences?.minimumSalary, "20M VND/month");
});

test("rejects empty skills, missing highlights, and unsupported arrangements", () => {
  assert.throws(
    () => parseCandidateProfile({ experience: [], skills: [""], education: [], languages: [] }),
    /skills/,
  );
  assert.throws(
    () => parseCandidateProfile({ experience: [{ title: "Intern" }], skills: [], education: [], languages: [] }),
    /highlights/,
  );
  assert.throws(
    () =>
      parseCandidateProfile({
        experience: [],
        skills: [],
        education: [],
        languages: [],
        preferences: { workArrangements: ["flexible"] },
      }),
    /workArrangements/,
  );
});

test("stores a validated profile and preserves imported Markdown", async () => {
  const root = await mkdtemp(join(tmpdir(), "career-profile-"));
  const profile = profileFixture();

  await saveProfileSource(root, "# My CV\nBuilt APIs");
  await saveCandidateProfile(root, profile);

  assert.equal(await readFile(join(root, "data", "profile", "source.md"), "utf8"), "# My CV\nBuilt APIs\n");
  assert.deepEqual(await readCandidateProfile(root), profile);
});

test("career profile validate writes normalized JSON", async () => {
  const root = await mkdtemp(join(tmpdir(), "career-profile-"));
  const input = join(root, "profile.json");
  const output = join(root, "normalized.json");
  await writeFile(input, JSON.stringify(profileFixture()), "utf8");
  const capture = createIo();

  const exitCode = await runCli(["profile", "validate", input, "--out", output], capture.io);

  assert.equal(exitCode, 0);
  assert.deepEqual(JSON.parse(await readFile(output, "utf8")), profileFixture());
  assert.match(capture.stderr(), /Wrote/);
});

function profileFixture() {
  return {
    headline: "Backend developer",
    experience: [{ title: "Intern", highlights: ["Built internal tooling"] }],
    skills: ["TypeScript"],
    education: [],
    languages: [{ language: "English", level: "B2" }],
    preferences: { workArrangements: ["hybrid"] as const, minimumSalary: "20M VND/month" },
  };
}

function createIo() {
  const stderr: string[] = [];

  return {
    io: {
      writeStdout() {},
      writeStderr(chunk: string) {
        stderr.push(chunk);
      },
      async readStdin() {
        return "";
      },
    },
    stderr() {
      return stderr.join("");
    },
  };
}
