import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { isDirectExecution, runCli } from "../src/cli.js";
import { resolveJobInput, resolveJobInputsInDirectory } from "../src/job/resolve-input.js";
import { parseJobAnalysis } from "../src/job/schema.js";

test("resolves a file into normalized raw job content", async () => {
  const directory = await mkdtemp(join(tmpdir(), "career-copilot-"));
  const path = join(directory, "job.txt");
  await writeFile(path, "Marketing Manager\nLead campaigns.", "utf8");

  const result = await resolveJobInput({ type: "file", path });

  assert.deepEqual(result, {
    content: "Marketing Manager\nLead campaigns.",
    source: { type: "file", value: path },
  });
});

test("recognizes an absolute Windows CLI path as direct execution", () => {
  assert.equal(
    isDirectExecution(
      "file:///C:/Users/quanp/Project/Career%20Copilot/dist/cli.js",
      "C:\\Users\\quanp\\Project\\Career Copilot\\dist\\cli.js",
    ),
    true,
  );
});

test("career job analyze emits normalized JSON for a single file", async () => {
  const directory = await mkdtemp(join(tmpdir(), "career-copilot-"));
  const path = join(directory, "job.txt");
  await writeFile(path, "Marketing Manager\nLead campaigns.", "utf8");

  const capture = createIo();
  const exitCode = await runCli(["job", "analyze", path], capture.io);

  assert.equal(exitCode, 0);
  assert.deepEqual(JSON.parse(capture.stdout()), {
    content: "Marketing Manager\nLead campaigns.",
    source: { type: "file", value: path },
  });
  assert.equal(capture.stderr(), "");
});

test("career job analyze writes one JSON file per batch input and reports progress", async () => {
  const directory = await mkdtemp(join(tmpdir(), "career-copilot-"));
  const outputDirectory = join(directory, "prepared");
  await writeFile(join(directory, "designer.txt"), "Design systems", "utf8");
  await writeFile(join(directory, "sales.md"), "# Sales\nBuild partnerships", "utf8");

  const capture = createIo();
  const exitCode = await runCli(["job", "analyze", directory, "--out", outputDirectory], capture.io);

  assert.equal(exitCode, 0);
  assert.match(capture.stderr(), /Analyzing 2 jobs/);
  assert.match(capture.stderr(), /2 succeeded/);

  const designer = JSON.parse(await readFile(join(outputDirectory, "designer.json"), "utf8"));
  const sales = JSON.parse(await readFile(join(outputDirectory, "sales.json"), "utf8"));

  assert.equal(designer.source.value.split("\\").at(-1), "designer.txt");
  assert.equal(sales.source.value.split("\\").at(-1), "sales.md");
  assert.equal(capture.stdout(), "");
});

test("career job analyze keeps both outputs when two batch files share a stem", async () => {
  const directory = await mkdtemp(join(tmpdir(), "career-copilot-"));
  const outputDirectory = join(directory, "prepared");
  await writeFile(join(directory, "job.txt"), "First job", "utf8");
  await writeFile(join(directory, "job.md"), "Second job", "utf8");

  const capture = createIo();
  const exitCode = await runCli(["job", "analyze", directory, "--out", outputDirectory], capture.io);

  assert.equal(exitCode, 0);
  assert.equal(JSON.parse(await readFile(join(outputDirectory, "job.json"), "utf8")).content, "Second job");
  assert.equal(JSON.parse(await readFile(join(outputDirectory, "job-2.json"), "utf8")).content, "First job");
  assert.match(capture.stderr(), /2 succeeded/);
});

test("resolves each supported file in a directory independently", async () => {
  const directory = await mkdtemp(join(tmpdir(), "career-copilot-"));
  await writeFile(join(directory, "designer.txt"), "Design systems", "utf8");
  await writeFile(join(directory, "sales.md"), "# Sales\nBuild partnerships", "utf8");
  await writeFile(join(directory, "ignore.pdf"), "not parsed", "utf8");
  await mkdir(join(directory, "nested"));

  const results = await resolveJobInputsInDirectory(directory);

  assert.equal(results.jobs.length, 2);
  assert.deepEqual(results.jobs.map((result) => result.source.value.split("\\").at(-1)).sort(), ["designer.txt", "sales.md"]);
  assert.deepEqual(results.failures, []);
});

test("keeps valid jobs when another batch file is empty", async () => {
  const directory = await mkdtemp(join(tmpdir(), "career-copilot-"));
  await writeFile(join(directory, "valid.txt"), "Coordinate partner events", "utf8");
  await writeFile(join(directory, "empty.md"), "  ", "utf8");

  const results = await resolveJobInputsInDirectory(directory);

  assert.equal(results.jobs.length, 1);
  assert.equal(results.failures.length, 1);
  assert.equal(results.failures[0]?.path.split("\\").at(-1), "empty.md");
  assert.match(results.failures[0]?.message ?? "", /Job content is empty/);
});

test("rejects a missing job file with a helpful error", async () => {
  await assert.rejects(
    resolveJobInput({ type: "file", path: join(tmpdir(), "career-copilot-missing-job.txt") }),
    /Job file does not exist/,
  );
});

test("rejects empty normalized job content", async () => {
  const directory = await mkdtemp(join(tmpdir(), "career-copilot-"));
  const path = join(directory, "empty.txt");
  await writeFile(path, " \n\t", "utf8");

  await assert.rejects(resolveJobInput({ type: "file", path }), /Job content is empty/);
});

test("rejects malformed job analysis without requirements", () => {
  assert.throws(
    () => parseJobAnalysis({ title: "Product Manager", responsibilities: [] }),
    /requirements must be an array/,
  );
});

test("preserves job details that affect whether a candidate can apply", () => {
  const analysis = parseJobAnalysis({
    requirements: [
      {
        category: "experience",
        statement: "At least two years of experience.",
        minimumYears: 2,
      },
      {
        category: "education",
        statement: "Bachelor degree in Computer Science.",
        degree: "Bachelor degree in Computer Science",
      },
      {
        category: "language",
        statement: "Business-fluent English.",
        languageLevel: "Business fluent",
      },
    ],
    responsibilities: [],
    employment: {
      type: "full-time",
      workArrangement: "hybrid",
      locations: [
        {
          raw: "Vina Building, 131 Xô Viết Nghệ Tĩnh, Hồ Chí Minh",
          city: "Hồ Chí Minh",
          address: "Vina Building, 131 Xô Viết Nghệ Tĩnh",
        },
      ],
      schedule: "Monday–Friday, 08:00–17:00",
      duration: "3 months",
      startDate: "September or October 2026",
      probation: "Two months",
      onsiteExpectation: "Three days per week onsite",
    },
    compensation: {
      salaryStatus: "stated",
      salary: "3,500,000–4,000,000 VND/month",
      benefits: ["Claude Code license during on-site training"],
    },
    application: {
      deadline: "30 September 2026",
      hiringProcess: ["Online application", "Technical interview"],
    },
    workConditions: {
      overtime: "Not stated",
      onCall: "Not stated",
      travel: "Occasional travel to client sites",
    },
    opportunities: {
      conversionToPermanent: "Potential conversion after the internship",
      training: ["Mentoring from experienced engineers"],
      careerGrowth: ["Career coaching"],
      relocation: ["Potential relocation to Japan"],
    },
  });

  assert.equal(analysis.requirements[0]?.minimumYears, 2);
  assert.equal(analysis.requirements[1]?.degree, "Bachelor degree in Computer Science");
  assert.equal(analysis.requirements[2]?.languageLevel, "Business fluent");
  assert.deepEqual(analysis.employment?.locations, [
    {
      raw: "Vina Building, 131 Xô Viết Nghệ Tĩnh, Hồ Chí Minh",
      city: "Hồ Chí Minh",
      address: "Vina Building, 131 Xô Viết Nghệ Tĩnh",
    },
  ]);
  assert.equal(analysis.compensation?.salary, "3,500,000–4,000,000 VND/month");
  assert.equal(analysis.compensation?.salaryStatus, "stated");
  assert.deepEqual(analysis.application?.hiringProcess, ["Online application", "Technical interview"]);
  assert.equal(analysis.workConditions?.travel, "Occasional travel to client sites");
  assert.equal(analysis.employment?.onsiteExpectation, "Three days per week onsite");
  assert.deepEqual(analysis.opportunities?.relocation, ["Potential relocation to Japan"]);
});

test("keeps an explicit no-salary finding separate from a salary amount", () => {
  const analysis = parseJobAnalysis({
    requirements: [],
    responsibilities: [],
    compensation: { salaryStatus: "not-stated" },
  });

  assert.equal(analysis.compensation?.salaryStatus, "not-stated");
  assert.equal(analysis.compensation?.salary, undefined);
});

test("requires an explicit salary status for every job analysis", () => {
  assert.throws(
    () => parseJobAnalysis({ requirements: [], responsibilities: [] }),
    /compensation must be an object/,
  );
});

test("requires a salary amount when salary is marked as stated", () => {
  assert.throws(
    () => parseJobAnalysis({
      requirements: [],
      responsibilities: [],
      compensation: { salaryStatus: "stated" },
    }),
    /compensation.salary is required when salaryStatus is stated/,
  );
});

test("rejects negative experience years and unsupported work arrangements", () => {
  assert.throws(
    () => parseJobAnalysis({
      requirements: [{ category: "experience", statement: "Experience", minimumYears: -1 }],
      responsibilities: [],
    }),
    /minimumYears must be a non-negative integer/,
  );
  assert.throws(
    () => parseJobAnalysis({
      requirements: [],
      responsibilities: [],
      employment: { workArrangement: "flexible" },
    }),
    /employment.workArrangement is invalid/,
  );
});

test("requires each structured location to keep raw text and rejects empty location objects", () => {
  const analysis = parseJobAnalysis({
    requirements: [],
    responsibilities: [],
    compensation: { salaryStatus: "not-stated" },
    employment: {
      locations: [
        {
          raw: "Ho Chi Minh City, Vietnam",
          city: "Ho Chi Minh City",
        },
      ],
    },
  });

  assert.deepEqual(analysis.employment?.locations, [
    {
      raw: "Ho Chi Minh City, Vietnam",
      city: "Ho Chi Minh City",
    },
  ]);

  assert.throws(
    () => parseJobAnalysis({
      requirements: [],
      responsibilities: [],
      compensation: { salaryStatus: "not-stated" },
      employment: {
        locations: [
          {
            city: "Ho Chi Minh City",
          },
        ],
      },
    }),
    /employment.locations\[0\]\.raw must be a non-empty string/,
  );
});

function createIo(input = "") {
  const stdout: string[] = [];
  const stderr: string[] = [];

  return {
    io: {
      writeStdout(chunk: string) {
        stdout.push(chunk);
      },
      writeStderr(chunk: string) {
        stderr.push(chunk);
      },
      async readStdin() {
        return input;
      },
    },
    stdout() {
      return stdout.join("");
    },
    stderr() {
      return stderr.join("");
    },
  };
}
