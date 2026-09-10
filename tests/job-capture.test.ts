import assert from "node:assert/strict";
import { readFile, mkdtemp, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";

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
