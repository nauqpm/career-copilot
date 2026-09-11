import assert from "node:assert/strict";
import { mkdtemp, readFile, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";

import { captureRawSource, createJobCapture } from "../src/job/capture.js";
import { createLocalJob, readWorkspaceJob } from "../src/workspace/storage.js";
import { runCli, type CliIo } from "../src/cli.js";

test("local job capture preserves exact source bytes and trims only raw content", async () => {
  const root = await mkdtemp(join(tmpdir(), "career-capture-"));
  const original = "\uFEFF  Backend\r\nLương: thỏa thuận  ";
  const job = await createLocalJob(root, { content: original, sourceKind: "pasted-text", sourceReference: "Pasted source" });

  assert.equal(await readFile(join(root, "data", "jobs", job.id, "source.md"), "utf8"), original);
  const raw = JSON.parse(await readFile(join(root, "data", "jobs", job.id, "raw.json"), "utf8"));
  assert.equal(raw.content, original.trim());
  assert.equal(raw.capture.id, job.id);
  assert.equal(job.captureStatus, "verified");
  assert.equal((await readWorkspaceJob(root, job.id)).capture?.sourceReference, "Pasted source");
});

test("normalizes a local filename before writing raw source metadata", async () => {
  const root = await mkdtemp(join(tmpdir(), "career-capture-"));
  const job = await createLocalJob(root, { content: "Role", sourceKind: "local-file", sourceFileName: " role.md " });
  const raw = JSON.parse(await readFile(join(root, "data", "jobs", job.id, "raw.json"), "utf8"));

  assert.deepEqual(raw.source, { type: "file", value: "role.md" });
  assert.equal((await readWorkspaceJob(root, job.id)).captureStatus, "verified");
});

test("capture rejects empty and oversized input before creating a job", async () => {
  const root = await mkdtemp(join(tmpdir(), "career-capture-"));
  await assert.rejects(() => createLocalJob(root, { content: "  ", sourceKind: "pasted-text" }));
  await assert.rejects(() => createLocalJob(root, { content: "x".repeat(1024 * 1024 + 1), sourceKind: "pasted-text" }), /1 MiB/);
});

test("capture parser rejects tampered manifest fields", async () => {
  const root = await mkdtemp(join(tmpdir(), "career-capture-"));
  const job = await createLocalJob(root, { content: "Backend role", sourceKind: "pasted-text" });
  const manifestPath = join(root, "data", "jobs", job.id, "source.json");
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  manifest.id = "job-other";
  await (await import("node:fs/promises")).writeFile(manifestPath, `${JSON.stringify(manifest)}\n`, "utf8");

  const detail = await readWorkspaceJob(root, job.id);
  assert.equal(detail.captureStatus, "invalid");
  assert.match(detail.invalidSourceData ?? "", /nguồn JD|capture/i);
});

test("maps a verified capture to the raw source metadata written by storage", () => {
  const pasted = createJobCapture("job-pasted", { content: "Role", sourceKind: "pasted-text" }, "2026-09-11T00:00:00.000Z");
  assert.deepEqual(captureRawSource(pasted), { type: "text", value: "Pasted in Career Copilot" });

  const local = createJobCapture("job-local", { content: "Role", sourceKind: "local-file", sourceFileName: "role.md" }, "2026-09-11T00:00:00.000Z");
  assert.deepEqual(captureRawSource(local), { type: "file", value: "role.md" });

  const referenced = createJobCapture("job-referenced", { content: "Role", sourceKind: "local-file", sourceReference: "Company export", sourceFileName: "role.md" }, "2026-09-11T00:00:00.000Z");
  assert.deepEqual(captureRawSource(referenced), { type: "file", value: "Company export" });
});

test("marks a capture invalid when raw source metadata no longer matches its manifest", async () => {
  const root = await mkdtemp(join(tmpdir(), "career-capture-"));
  const job = await createLocalJob(root, {
    content: "Backend role",
    sourceKind: "pasted-text",
    sourceReference: "https://jobs.example.test/original",
  });
  const rawPath = join(root, "data", "jobs", job.id, "raw.json");
  const raw = JSON.parse(await readFile(rawPath, "utf8"));
  raw.source.value = "https://jobs.example.test/forged";
  await writeFile(rawPath, `${JSON.stringify(raw)}\n`, "utf8");

  const detail = await readWorkspaceJob(root, job.id);
  assert.equal(detail.captureStatus, "invalid");
  assert.deepEqual(detail.duplicateHints, []);
  assert.equal(detail.duplicateScanIncomplete, false);
});

test("skips a damaged duplicate candidate and marks the scan incomplete", async () => {
  const root = await mkdtemp(join(tmpdir(), "career-capture-"));
  const first = await createLocalJob(root, { content: "Same role", sourceKind: "pasted-text" });
  const second = await createLocalJob(root, { content: "Same role", sourceKind: "pasted-text" });
  await writeFile(join(root, "data", "jobs", second.id, "source.md"), "Different bytes", "utf8");

  const detail = await readWorkspaceJob(root, first.id);
  assert.deepEqual(detail.duplicateHints, []);
  assert.equal(detail.duplicateScanIncomplete, true);
});

test("marks a Windows junction job as an incomplete duplicate scan without following it", async () => {
  if (process.platform !== "win32") return;

  const root = await mkdtemp(join(tmpdir(), "career-capture-"));
  const first = await createLocalJob(root, { content: "Same role", sourceKind: "pasted-text" });
  const target = await mkdtemp(join(tmpdir(), "career-capture-junction-target-"));
  await writeFile(join(target, "source.md"), "Same role", "utf8");
  await writeFile(join(target, "raw.json"), `${JSON.stringify({ content: "Same role", source: { type: "text", value: "Pasted in Career Copilot" } })}\n`, "utf8");
  await symlink(target, join(root, "data", "jobs", "job-damaged"), "junction");

  const detail = await readWorkspaceJob(root, first.id);
  assert.deepEqual(detail.duplicateHints, []);
  assert.equal(detail.duplicateScanIncomplete, true);
});

test("CLI imports one UTF-8 text file without invoking URL resolution", async () => {
  const root = await mkdtemp(join(tmpdir(), "career-capture-"));
  const sourcePath = join(root, "role.md");
  const original = "\uFEFFRole\r\nNo final newline";
  await writeFile(sourcePath, Buffer.from(original, "utf8"));
  const io = captureIo();

  assert.equal(await runCli(["job", "import", sourcePath, "--root", root], io), 0);
  const job = JSON.parse(io.stdout()) as { id: string };
  assert.equal(await readFile(join(root, "data", "jobs", job.id, "source.md"), "utf8"), original);
  assert.equal(io.stderr(), "");
});

test("CLI import rejects unsupported files and invalid UTF-8 before creating jobs", async () => {
  const root = await mkdtemp(join(tmpdir(), "career-capture-"));
  const unsupported = join(root, "role.pdf");
  const invalid = join(root, "invalid.txt");
  await writeFile(unsupported, "not imported", "utf8");
  await writeFile(invalid, Buffer.from([0xc3, 0x28]));

  for (const source of [unsupported, invalid]) {
    const io = captureIo();
    assert.equal(await runCli(["job", "import", source, "--root", root], io), 1);
    assert.match(io.stderr(), /supports only|UTF-8/i);
  }
});

test("job detail shows exact duplicate hints without merging records", async () => {
  const root = await mkdtemp(join(tmpdir(), "career-capture-"));
  const first = await createLocalJob(root, { content: "Same role", sourceKind: "pasted-text", sourceReference: "https://jobs.example.test/role?id=1" });
  await createLocalJob(root, { content: "Same role", sourceKind: "pasted-text", sourceReference: "https://jobs.example.test/role?id=2" });
  const detail = await readWorkspaceJob(root, first.id);
  assert.equal(detail.duplicateHints?.length, 1);
  assert.deepEqual(detail.duplicateHints?.[0]?.reasons, ["exact-content"]);
});

function captureIo(): CliIo & { stdout: () => string; stderr: () => string } {
  let out = "";
  let err = "";
  return { writeStdout: (value) => { out += value; }, writeStderr: (value) => { err += value; }, readStdin: async () => "", stdout: () => out, stderr: () => err };
}
