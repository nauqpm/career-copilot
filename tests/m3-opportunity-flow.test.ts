import assert from "node:assert/strict";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { once } from "node:events";
import type { AddressInfo } from "node:net";
import test from "node:test";

import { createLocalJob, readWorkspaceJob } from "../src/workspace/storage.js";
import { createWorkspaceServer } from "../src/web/server.js";
import { readOpportunitySnapshot } from "../src/workspace/opportunities.js";

test("M3 retains source bytes while reviewing, correcting and reopening opportunity decisions", async () => {
  const root = await mkdtemp(join(tmpdir(), "career-m3-flow-"));
  const first = await createLocalJob(root, { content: "Backend role\nSalary negotiable", sourceKind: "pasted-text", sourceReference: "https://jobs.example.test/role" });
  const second = await createLocalJob(root, { content: "Backend role\nSalary negotiable", sourceKind: "pasted-text", sourceReference: "https://jobs.example.test/role" });
  const third = await createLocalJob(root, { content: "Backend role\nDifferent salary", sourceKind: "pasted-text", sourceReference: "https://jobs.example.test/role" });
  const originalBytes = await captureBytes(root, [first.id, second.id, third.id]);
  const firstDetail = await readWorkspaceJob(root, first.id);
  assert.deepEqual(firstDetail.duplicateHints?.slice().sort((left, right) => left.jobId.localeCompare(right.jobId)), [
    { jobId: second.id, reasons: ["exact-content", "same-url"] },
    { jobId: third.id, reasons: ["same-url"] },
  ].sort((left, right) => left.jobId.localeCompare(right.jobId)));

  const app = await startServer(root);
  try {
    const initial = await fetch(`${app.url}/api/opportunities`);
    assert.equal(initial.status, 200);
    assert.equal(initial.headers.get("etag"), '"missing"');
    const linkedFirst = await post(app.url, { leftId: first.id, rightId: second.id, relation: "same", confirmed: true }, '"missing"');
    assert.equal(linkedFirst.status, 201);
    const linkedFirstBody = await linkedFirst.json() as OpportunityView;
    const linkedSecond = await post(app.url, { leftId: second.id, rightId: third.id, relation: "same", confirmed: true }, linkedFirst.headers.get("etag")!);
    assert.equal(linkedSecond.status, 201);
    const linkedSecondBody = await linkedSecond.json() as OpportunityView;
    assert.deepEqual(sorted(linkedSecondBody.groups.find((group) => group.jobIds.length === 3)?.jobIds ?? []), sorted([first.id, second.id, third.id]));

    const contradictory = await post(app.url, { leftId: first.id, rightId: third.id, relation: "different", confirmed: true }, linkedSecond.headers.get("etag")!);
    assert.equal(contradictory.status, 400);
    const cleared = await post(app.url, { leftId: second.id, rightId: third.id, relation: "clear", confirmed: true }, linkedSecond.headers.get("etag")!);
    assert.equal(cleared.status, 201);
    const clearedBody = await cleared.json() as OpportunityView;
    assert.deepEqual(sorted(clearedBody.groups.find((group) => group.jobIds.includes(first.id))?.jobIds ?? []), sorted([first.id, second.id]));
    assert.deepEqual(clearedBody.groups.find((group) => group.jobIds.includes(third.id))?.jobIds, [third.id]);

    const different = await post(app.url, { leftId: first.id, rightId: third.id, relation: "different", confirmed: true }, cleared.headers.get("etag")!);
    assert.equal(different.status, 201);
    const differentBody = await different.json() as OpportunityView;
    const pair = sorted([first.id, third.id]);
    assert.equal(differentBody.snapshot.revision.decisions.find((decision) => decision.leftId === pair[0] && decision.rightId === pair[1])?.relation, "different");

    const manual = await createLocalJob(root, { content: "A completely different role", sourceKind: "pasted-text", sourceReference: "Manual note" });
    assert.deepEqual(sorted((await readWorkspaceJob(root, first.id)).duplicateHints?.map((hint) => hint.jobId) ?? []), sorted([second.id, third.id]));
    const manualLink = await post(app.url, { leftId: first.id, rightId: manual.id, relation: "same", confirmed: true }, different.headers.get("etag")!);
    assert.equal(manualLink.status, 201);
    assert.equal((await manualLink.json() as OpportunityView).groups.find((group) => group.jobIds.includes(manual.id))?.jobIds.includes(first.id), true);

    const stale = await post(app.url, { leftId: first.id, rightId: third.id, relation: "defer", confirmed: true }, different.headers.get("etag")!);
    assert.equal(stale.status, 409);
    assert.equal((await readdir(join(root, "data", "opportunities", "revisions"))).length, 5);
  } finally {
    await app.close();
  }

  const reopened = await readOpportunitySnapshot(root);
  assert.equal(reopened.revision?.decisions.some((decision) => decision.relation === "different"), true);
  await assertBytesUnchanged(root, originalBytes);
});

test("legacy members and corrupt grouping state stay readable and block writes", async () => {
  const root = await mkdtemp(join(tmpdir(), "career-m3-repair-"));
  const current = await createLocalJob(root, { content: "Current source", sourceKind: "pasted-text" });
  const legacyId = "job-legacy";
  const legacyDirectory = join(root, "data", "jobs", legacyId);
  await mkdir(legacyDirectory, { recursive: true });
  await writeFile(join(legacyDirectory, "source.md"), "Legacy source");
  await writeFile(join(legacyDirectory, "raw.json"), `${JSON.stringify({ content: "Legacy source", source: { type: "text", value: "Legacy import" } })}\n`);
  const app = await startServer(root);
  try {
    const linked = await post(app.url, { leftId: current.id, rightId: legacyId, relation: "same", confirmed: true }, '"missing"');
    assert.equal(linked.status, 201);
    const linkedBody = await linked.json() as OpportunityView;
    assert.equal(linkedBody.groups.find((group) => group.jobIds.includes(current.id))?.jobIds.includes(legacyId), true);

    const pointerPath = join(root, "data", "opportunities", "current.json");
    const pointerBefore = await readFile(pointerPath, "utf8");
    await writeFile(pointerPath, "{broken");
    const ordinary = await fetch(`${app.url}/api/jobs/${current.id}`);
    assert.equal(ordinary.status, 200);
    const grouping = await fetch(`${app.url}/api/opportunities`);
    assert.equal(grouping.status, 409);
    const blocked = await post(app.url, { leftId: current.id, rightId: legacyId, relation: "different", confirmed: true }, '"missing"');
    assert.equal(blocked.status, 409);
    assert.equal(await readFile(pointerPath, "utf8"), "{broken");
    await writeFile(pointerPath, pointerBefore);
    const restored = await fetch(`${app.url}/api/opportunities`);
    assert.equal(restored.status, 200);
  } finally {
    await app.close();
  }
});

test("keeps an unrelated corrupt singleton visible without allowing a write to it", async () => {
  const root = await mkdtemp(join(tmpdir(), "career-m3-repair-singleton-"));
  const first = await createLocalJob(root, { content: "First role", sourceKind: "pasted-text" });
  const second = await createLocalJob(root, { content: "Second role", sourceKind: "pasted-text" });
  const third = await createLocalJob(root, { content: "Third role", sourceKind: "pasted-text" });
  await writeFile(join(root, "data", "jobs", third.id, "raw.json"), "{broken", "utf8");
  const app = await startServer(root);
  try {
    const view = await fetch(`${app.url}/api/opportunities`);
    assert.equal(view.status, 200);
    const body = await view.json() as { health: string; repairJobIds: string[] };
    assert.equal(body.health, "healthy");
    assert.deepEqual(body.repairJobIds, [third.id]);
    const saved = await post(app.url, { leftId: first.id, rightId: second.id, relation: "same", confirmed: true }, '"missing"');
    assert.equal(saved.status, 201);
    const savedBody = await saved.json() as { health: string; groups: { jobIds: string[] }[]; repairJobIds: string[] };
    assert.equal(savedBody.health, "healthy");
    assert.deepEqual(savedBody.groups.find((group) => group.jobIds.length === 2)?.jobIds.sort(), [first.id, second.id].sort());
    assert.deepEqual(savedBody.repairJobIds, [third.id]);
    const savedEtag = saved.headers.get("etag") ?? "";
    assert.match(savedEtag, /^"sha256:[a-f0-9]{64}"$/);
    const blocked = await post(app.url, { leftId: first.id, rightId: third.id, relation: "same", confirmed: true }, savedEtag);
    assert.equal(blocked.status, 409);
    const after = await fetch(`${app.url}/api/opportunities`);
    assert.equal(after.status, 200);
    assert.equal(after.headers.get("etag"), savedEtag);
    const afterBody = await after.json() as { health: string; groups: { jobIds: string[] }[]; repairJobIds: string[] };
    assert.equal(afterBody.health, "healthy");
    assert.deepEqual(afterBody.groups.find((group) => group.jobIds.length === 2)?.jobIds.sort(), [first.id, second.id].sort());
    assert.deepEqual(afterBody.repairJobIds, [third.id]);
  } finally {
    await app.close();
  }
});

test("returns repair-needed when an active decision references a corrupt raw record", async () => {
  const root = await mkdtemp(join(tmpdir(), "career-m3-repair-active-"));
  const first = await createLocalJob(root, { content: "First role", sourceKind: "pasted-text" });
  const second = await createLocalJob(root, { content: "Second role", sourceKind: "pasted-text" });
  const app = await startServer(root);
  try {
    const linked = await post(app.url, { leftId: first.id, rightId: second.id, relation: "same", confirmed: true }, '"missing"');
    assert.equal(linked.status, 201);
    await writeFile(join(root, "data", "jobs", second.id, "raw.json"), "{broken", "utf8");
    const grouping = await fetch(`${app.url}/api/opportunities`);
    assert.equal(grouping.status, 409);
    assert.equal((await grouping.json() as { health: string }).health, "needs-repair");
    assert.equal((await fetch(`${app.url}/api/jobs/${first.id}`)).status, 200);
  } finally {
    await app.close();
  }
});

test("marks a legacy job missing source.md for repair while healthy pairs remain writable", async () => {
  const root = await mkdtemp(join(tmpdir(), "career-m3-legacy-source-"));
  const first = await createLocalJob(root, { content: "First role", sourceKind: "pasted-text" });
  const second = await createLocalJob(root, { content: "Second role", sourceKind: "pasted-text" });
  const legacyId = "job-legacy-missing-source";
  const legacyDirectory = join(root, "data", "jobs", legacyId);
  await mkdir(legacyDirectory, { recursive: true });
  await writeFile(join(legacyDirectory, "raw.json"), `${JSON.stringify({ content: "Legacy role", source: { type: "text", value: "Legacy import" } })}\n`, "utf8");
  const app = await startServer(root);
  try {
    const initial = await fetch(`${app.url}/api/opportunities`);
    assert.equal(initial.status, 200);
    const initialBody = await initial.json() as { health: string; repairJobIds: string[]; groups: { jobIds: string[] }[] };
    assert.equal(initialBody.health, "healthy");
    assert.deepEqual(initialBody.repairJobIds, [legacyId]);

    const saved = await post(app.url, { leftId: first.id, rightId: second.id, relation: "same", confirmed: true }, '"missing"');
    assert.equal(saved.status, 201);
    const savedBody = await saved.json() as { health: string; repairJobIds: string[]; groups: { jobIds: string[] }[] };
    assert.equal(savedBody.health, "healthy");
    assert.deepEqual(savedBody.repairJobIds, [legacyId]);
    assert.deepEqual(savedBody.groups.find((group) => group.jobIds.length === 2)?.jobIds.sort(), [first.id, second.id].sort());

    const blocked = await post(app.url, { leftId: first.id, rightId: legacyId, relation: "same", confirmed: true }, saved.headers.get("etag")!);
    assert.equal(blocked.status, 409);
  } finally {
    await app.close();
  }
});

type OpportunityView = {
  snapshot: { revision: { decisions: { leftId: string; rightId: string; relation: string }[] } };
  groups: { jobIds: string[] }[];
};

async function captureBytes(root: string, ids: string[]): Promise<Map<string, string>> {
  const paths = ids.flatMap((id) => ["source.md", "source.json", "raw.json"].map((name) => join(root, "data", "jobs", id, name)));
  return new Map(await Promise.all(paths.map(async (path) => [path, await readFile(path, "utf8")] as const)));
}

async function assertBytesUnchanged(root: string, bytes: Map<string, string>): Promise<void> {
  for (const [path, expected] of bytes) assert.equal(await readFile(path, "utf8"), expected, path.replace(root, ""));
}

async function startServer(root: string) {
  const server = createWorkspaceServer({ root, port: 0 });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address() as AddressInfo;
  return { url: `http://127.0.0.1:${address.port}`, close: () => new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())) };
}

function post(url: string, body: unknown, ifMatch: string) {
  return fetch(`${url}/api/opportunities/decisions`, { method: "POST", headers: { "content-type": "application/json", "if-match": ifMatch }, body: JSON.stringify(body) });
}

function sorted(values: string[]): string[] { return [...values].sort((left, right) => left.localeCompare(right)); }
