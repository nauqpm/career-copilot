import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { once } from "node:events";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AddressInfo } from "node:net";
import test from "node:test";

import { createLocalJob } from "../src/workspace/storage.js";
import { createWorkspaceServer } from "../src/web/server.js";

test("opportunity API exposes an empty local state and candidate-confirmed same link", async () => {
  const root = await mkdtemp(join(tmpdir(), "career-opportunity-api-"));
  const first = await createLocalJob(root, { content: "First role", sourceKind: "pasted-text" });
  const second = await createLocalJob(root, { content: "Second role", sourceKind: "pasted-text" });
  const app = await startServer(root);
  try {
    const initial = await fetch(`${app.url}/api/opportunities`);
    assert.equal(initial.status, 200);
    assert.equal((await initial.json()).health, "healthy");
    assert.equal(initial.headers.get("etag"), '"missing"');

    const missingHeader = await post(app.url, { leftId: first.id, rightId: second.id, relation: "same", confirmed: true });
    assert.equal(missingHeader.status, 428);
    const saved = await post(app.url, { leftId: first.id, rightId: second.id, relation: "same", confirmed: true }, '"missing"');
    assert.equal(saved.status, 201);
    const body = await saved.json();
    assert.deepEqual(body.groups.find((group: { jobIds: string[] }) => group.jobIds.length === 2).jobIds.sort(), [first.id, second.id].sort());
    assert.deepEqual(body.repairJobIds, []);
    assert.match(saved.headers.get("etag") ?? "", /^"sha256:[a-f0-9]{64}"$/);
  } finally { await app.close(); }
});

test("opportunity API rejects stale, unconfirmed and invalid decisions without mutation", async () => {
  const root = await mkdtemp(join(tmpdir(), "career-opportunity-api-"));
  const first = await createLocalJob(root, { content: "First role", sourceKind: "pasted-text" });
  const second = await createLocalJob(root, { content: "Second role", sourceKind: "pasted-text" });
  const app = await startServer(root);
  try {
    const invalid = await post(app.url, { leftId: first.id, rightId: second.id, relation: "same", confirmed: false }, '"missing"');
    assert.equal(invalid.status, 400);
    const stale = await post(app.url, { leftId: first.id, rightId: second.id, relation: "same", confirmed: true }, '"sha256:' + "0".repeat(64) + '"');
    assert.equal(stale.status, 409);
    const traversal = await post(app.url, { leftId: "../profile", rightId: second.id, relation: "same", confirmed: true }, '"missing"');
    assert.equal(traversal.status, 400);
  } finally { await app.close(); }
});

async function startServer(root: string) {
  const server = createWorkspaceServer({ root, port: 0 });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address() as AddressInfo;
  return { url: `http://127.0.0.1:${address.port}`, close: () => new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())) };
}

function post(url: string, body: unknown, ifMatch?: string) {
  return fetch(`${url}/api/opportunities/decisions`, { method: "POST", headers: { "content-type": "application/json", ...(ifMatch === undefined ? {} : { "if-match": ifMatch }) }, body: JSON.stringify(body) });
}
