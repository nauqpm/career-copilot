import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { readProfileHistory, readProfileSnapshot, publishProfileRevision, saveProfileSource, validateProfileRevisionEvidence } from "../profile/storage.js";
import { parseCandidateProfile } from "../profile/schema.js";
import { parseEvidenceDraft, type EvidenceDraft } from "../profile/evidence.js";
import { parseProfileRevision } from "../profile/versions.js";
import { contentHash, ConflictError, readArtifact } from "../workspace/artifacts.js";
import { workspacePrivacyWarnings } from "../workspace/privacy.js";
import {
  createPastedJob,
  listWorkspaceJobs,
  readWorkspaceJob,
  readWorkspaceJobNoteSnapshot,
  saveWorkspaceJobNote,
} from "../workspace/storage.js";

const maxJsonBytes = 1024 * 1024;

export function createWorkspaceServer(options: { root: string; port?: number; assetsRoot?: string }): Server {
  const root = resolve(options.root);
  return createServer((request, response) => {
    void handleRequest(request, response, root, resolve(options.assetsRoot ?? root));
  });
}

if (isDirectExecution(import.meta.url, process.argv[1])) {
  const port = Number(process.env.PORT ?? 4242);
  const root = resolve(process.env.CAREER_WORKSPACE_ROOT ?? process.cwd());
  const server = createWorkspaceServer({ root, assetsRoot: process.cwd(), port });
  server.listen(port, "127.0.0.1", () => {
    process.stdout.write(`Career Copilot is available at http://127.0.0.1:${port}\n`);
  });
}

async function handleRequest(request: IncomingMessage, response: ServerResponse, root: string, assetsRoot: string): Promise<void> {
  try {
    const host = request.headers.host;
    const port = request.socket.localPort;
    if (host !== `127.0.0.1:${port}` && host !== `localhost:${port}`) throw new LocalRequestError();
    const method = request.method ?? "GET";
    const url = new URL(request.url ?? "/", "http://127.0.0.1");
    const path = url.pathname;
    const privacyWarnings = method === "POST" || method === "PUT" || path === "/api/summary"
      ? await workspacePrivacyWarnings(root) : [];
    if (method === "POST" || method === "PUT") {
      for (const warning of privacyWarnings) process.stderr.write(`Privacy warning: ${warning}\n`);
    }

    if (method === "GET" && path === "/api/summary") {
      const [jobs, profileState] = await Promise.all([listWorkspaceJobs(root), profileSummary(root)]);
      return sendJson(response, 200, { jobs, ...profileState, privacyWarnings });
    }
    if (method === "GET" && path === "/api/jobs") return sendJson(response, 200, await listWorkspaceJobs(root));
    if (method === "POST" && path === "/api/jobs") {
      const body = await readJsonBody(request);
      const job = await createPastedJob(root, pastedJobInput(body));
      return sendJson(response, 201, job);
    }
    if (method === "GET" && path === "/api/profile") {
      let snapshot;
      try { snapshot = await readProfileSnapshot(root); } catch (error) { throw new CorruptionError(error); }
      setVersion(response, snapshot.hash);
      return sendJson(response, 200, snapshot.profile);
    }
    if (method === "GET" && path === "/api/profile/history") {
      return sendJson(response, 200, await readProfileHistory(root));
    }
    const revisionMatch = path.match(/^\/api\/profile\/revisions\/([^/]+)$/);
    if (method === "GET" && revisionMatch) {
      const id = decodeURIComponent(revisionMatch[1]!);
      if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(id) || id.includes("..")) return sendJson(response, 404, { error: "Not found" });
      const artifact = await readArtifact(join(root, "data", "profile", "revisions", `${id}.json`));
      if (!artifact) return sendJson(response, 404, { error: "Not found" });
      let revision;
      try {
        revision = parseProfileRevision(JSON.parse(artifact.content) as unknown);
        await validateProfileRevisionEvidence(root, revision);
      } catch (error) { throw new CorruptionError(error); }
      if (revision.id !== id) return sendJson(response, 404, { error: "Not found" });
      setVersion(response, artifact.hash);
      return sendJson(response, 200, revision);
    }
    if (method === "POST" && path === "/api/profile/publish") {
      const body = profilePublishInput(await readJsonBody(request));
      const result = await publishProfileRevision(root, body.profile, expectedVersion(request), {
        confirmed: body.confirmed,
        ...(body.evidence ? { evidence: body.evidence } : {}),
        ...(body.roleTracks ? { roleTracks: body.roleTracks } : {}),
      });
      setVersion(response, result.revisionHash);
      return sendJson(response, 201, { profile: result.profile, revision: result.revision, unresolvedCount: result.unresolvedCount });
    }
    if (method === "PUT" && path === "/api/profile") {
      const profile = parseCandidateProfile(await readJsonBody(request));
      const result = await publishProfileRevision(root, profile, expectedVersion(request), { confirmed: true });
      setVersion(response, result.revisionHash);
      return sendJson(response, 200, result.profile);
    }
    if (method === "POST" && path === "/api/profile/source") {
      const body = await readJsonBody(request);
      if (!isRecord(body) || typeof body.content !== "string") throw new InputError("Profile source content is required");
      if (!body.content.trim()) throw new InputError("Profile source content is required");
      await saveProfileSource(root, body.content, expectedVersion(request));
      setVersion(response, contentHash(body.content.endsWith("\n") ? body.content : `${body.content}\n`));
      return sendJson(response, 204);
    }

    const draftMatch = path.match(/^\/api\/jobs\/([^/]+)\/cv-draft$/);
    if (method === "GET" && draftMatch) return await sendCvDraft(response, root, decodeURIComponent(draftMatch[1]!));
    const noteMatch = path.match(/^\/api\/jobs\/([^/]+)\/note$/);
    if (method === "GET" && noteMatch) {
      const snapshot = await readWorkspaceJobNoteSnapshot(root, decodeURIComponent(noteMatch[1]!));
      setVersion(response, snapshot?.hash ?? null);
      return sendJson(response, 200, { content: snapshot?.content ?? null });
    }
    if (method === "PUT" && noteMatch) {
      const body = await readJsonBody(request);
      const id = decodeURIComponent(noteMatch[1]!);
      const content = noteInput(body).trim();
      if (!content) throw new InputError("Note content is required");
      await readWorkspaceJobNoteSnapshot(root, id);
      await saveWorkspaceJobNote(root, id, content, expectedVersion(request));
      setVersion(response, contentHash(`${content}\n`));
      return sendJson(response, 200, { content });
    }
    const jobMatch = path.match(/^\/api\/jobs\/([^/]+)$/);
    if (method === "GET" && jobMatch) return sendJson(response, 200, await readWorkspaceJob(root, decodeURIComponent(jobMatch[1]!)));

    if (method === "GET") return await sendStaticFile(response, assetsRoot, path);
    return sendJson(response, 404, { error: "Not found" });
  } catch (error) {
    sendError(response, error);
  }
}

async function sendCvDraft(response: ServerResponse, root: string, id: string): Promise<void> {
  const detail = await readWorkspaceJob(root, id);
  if (detail.cvDraft === undefined) return sendJson(response, 404, { error: "CV draft not found" });

  const content = detail.cvDraft;
  response.writeHead(200, {
    "content-type": "text/markdown; charset=utf-8",
    "content-disposition": `attachment; filename="${id}-cv-draft.md"`,
    "content-length": Buffer.byteLength(content),
  });
  response.end(content);
}

async function sendStaticFile(response: ServerResponse, root: string, requestPath: string): Promise<void> {
  const fileName = requestPath === "/" ? "index.html" : requestPath.slice(1);
  if (!/^[a-z0-9][a-z0-9._-]*$/i.test(fileName)) return sendJson(response, 404, { error: "Not found" });

  try {
    const content = await readFile(join(root, "public", fileName));
    response.writeHead(200, { "content-type": contentType(fileName), "content-length": content.byteLength });
    response.end(content);
  } catch (error) {
    if (isNodeError(error, "ENOENT")) return sendJson(response, 404, { error: "Not found" });
    throw error;
  }
}

async function readJsonBody(request: IncomingMessage): Promise<unknown> {
  if (request.headers.origin !== undefined && request.headers.origin !== `http://${request.headers.host}`) {
    throw new LocalRequestError();
  }
  if (!request.headers["content-type"]?.toLowerCase().startsWith("application/json")) {
    throw new InputError("JSON content type is required");
  }

  const chunks: Buffer[] = [];
  let bytes = 0;
  for await (const chunk of request) {
    bytes += chunk.length;
    if (bytes > maxJsonBytes) throw new InputError("Request body is too large");
    chunks.push(Buffer.from(chunk));
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
  } catch {
    throw new InputError("Request body must be valid JSON");
  }
}

function pastedJobInput(value: unknown): { content: string; sourceReference?: string } {
  if (!isRecord(value) || typeof value.content !== "string") throw new InputError("Job content is required");
  if (value.sourceReference !== undefined && typeof value.sourceReference !== "string") {
    throw new InputError("Source reference must be text");
  }
  return { content: value.content, ...(value.sourceReference === undefined ? {} : { sourceReference: value.sourceReference }) };
}

function noteInput(value: unknown): string {
  if (!isRecord(value) || typeof value.content !== "string") throw new InputError("Note content is required");
  return value.content;
}

function sendJson(response: ServerResponse, status: number, body?: unknown): void {
  if (status === 204) {
    response.writeHead(204).end();
    return;
  }
  const content = JSON.stringify(body ?? null);
  response.writeHead(status, { "content-type": "application/json; charset=utf-8", "content-length": Buffer.byteLength(content) });
  response.end(content);
}

function sendError(response: ServerResponse, error: unknown): void {
  if (response.headersSent) {
    response.end();
    return;
  }
  if (error instanceof LocalRequestError) return sendJson(response, 403, { error: "Only local workspace requests are allowed." });
  if (error instanceof CorruptionError) return sendJson(response, 500, { error: "Unable to read the local profile data. Check or recover the stored artifacts." });
  if (error instanceof PreconditionError) return sendJson(response, 428, { error: "Read the current artifact before saving (If-Match required)." });
  if (error instanceof ConflictError) return sendJson(response, 409, { error: "Artifact changed or is busy. Reload and reconcile your draft before saving." });
  if (error instanceof InputError || error instanceof SyntaxError || isValidationError(error)) {
    return sendJson(response, 400, { error: "The supplied local data is invalid." });
  }
  if (isMissingJobError(error)) return sendJson(response, 404, { error: "Not found" });
  if (isNodeError(error, "ENOENT")) return sendJson(response, 404, { error: "Not found" });
  return sendJson(response, 500, { error: "Unable to process the local request." });
}

function contentType(fileName: string): string {
  switch (extname(fileName)) {
    case ".html": return "text/html; charset=utf-8";
    case ".js": return "text/javascript; charset=utf-8";
    case ".css": return "text/css; charset=utf-8";
    default: return "application/octet-stream";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNodeError(error: unknown, code: string): error is NodeJS.ErrnoException {
  return typeof error === "object" && error !== null && "code" in error && error.code === code;
}

function isValidationError(error: unknown): boolean {
  return error instanceof Error && /must |is invalid|must not|non-empty|unsupported|empty/i.test(error.message);
}

function isMissingJobError(error: unknown): boolean {
  return error instanceof Error && error.message === "job does not exist";
}

class InputError extends Error {}
class LocalRequestError extends Error {}
class PreconditionError extends Error {}
class CorruptionError extends Error {
  constructor(cause: unknown) {
    super("Stored profile data is corrupt", { cause });
  }
}

function expectedVersion(request: IncomingMessage): string | null {
  const token = request.headers["if-match"];
  if (token === undefined) throw new PreconditionError();
  if (token === '"missing"') return null;
  if (typeof token !== "string" || !/^"sha256:[a-f0-9]{64}"$/.test(token)) throw new InputError("Invalid artifact version");
  return token.slice(1, -1);
}

function setVersion(response: ServerResponse, hash: string | null): void {
  response.setHeader("etag", `"${hash ?? "missing"}"`);
  response.setHeader("cache-control", "no-store");
}

async function profileSnapshot(root: string) {
  return readProfileSnapshot(root);
}

async function profileSummary(root: string) {
  let snapshot: Awaited<ReturnType<typeof profileSnapshot>> = { hash: null, legacy: true };
  let profileError: string | undefined;
  try { snapshot = await profileSnapshot(root); } catch {
    profileError = "Không đọc được hồ sơ hoặc phiên bản hiện tại. Dữ liệu được giữ nguyên; hãy kiểm tra hoặc khôi phục trước khi chỉnh sửa.";
  }
  let history: Awaited<ReturnType<typeof readProfileHistory>> = { revisions: [] };
  try { history = await readProfileHistory(root); } catch {
    if (!profileError) profileError = "Không đọc được lịch sử hồ sơ. Dữ liệu hồ sơ hiện tại vẫn được giữ nguyên.";
  }
  try {
    const unresolvedClaims = snapshot.revision?.claimEvidence.filter((claim) => claim.status === "needs-confirmation").map((claim) => claim.claimPath) ?? [];
    const profileRevision = snapshot.revision ? {
      id: snapshot.revision.id,
      createdAt: snapshot.revision.createdAt,
      revisionHash: snapshot.hash,
      evidenceCount: snapshot.revision.claimEvidence.reduce((total, claim) => total + claim.evidenceIds.length, 0),
      unresolvedCount: unresolvedClaims.length,
    } : null;
    let profileSourceHash: string | null = null;
    let profileSourceError: string | undefined;
    try {
      profileSourceHash = (await readArtifact(join(root, "data", "profile", "source.md")))?.hash ?? null;
    } catch {
      profileSourceError = "Không đọc được tệp nguồn hồ sơ. Hãy kiểm tra hoặc khôi phục tệp nguồn; hồ sơ hiện tại vẫn có thể chỉnh sửa.";
    }
    return { profile: snapshot.profile, profileHash: snapshot.hash, profileSourceHash, profileSourceError, ...(profileError ? { profileError } : {}), profileRevision, profileHistory: history, unresolvedClaims };
  } catch {
    return { profile: snapshot.profile, profileHash: snapshot.hash, profileSourceHash: null, profileSourceError: undefined, ...(profileError ? { profileError } : {}), profileRevision: null, profileHistory: history, unresolvedClaims: [] };
  }
}

function profilePublishInput(value: unknown): { profile: ReturnType<typeof parseCandidateProfile>; confirmed: true; evidence?: EvidenceDraft[]; roleTracks?: string[] } {
  if (!isRecord(value) || value.confirmed !== true) throw new PreconditionError("Candidate confirmation is required");
  const profile = parseCandidateProfile(value.profile);
  const evidence = value.evidence === undefined ? undefined : (() => {
    if (!Array.isArray(value.evidence)) throw new InputError("Evidence must be an array");
    return value.evidence.map((item) => parseEvidenceDraft(item));
  })();
  const roleTracks = value.roleTracks === undefined ? undefined : (() => {
    if (!Array.isArray(value.roleTracks) || !value.roleTracks.every((item) => typeof item === "string" && item.trim())) throw new InputError("roleTracks is invalid");
    return value.roleTracks.map((item) => item.trim());
  })();
  return { profile, confirmed: true, ...(evidence ? { evidence } : {}), ...(roleTracks ? { roleTracks } : {}) };
}

function isDirectExecution(moduleUrl: string, executedPath: string | undefined): boolean {
  return executedPath !== undefined && moduleUrl === pathToFileURL(resolve(executedPath)).href;
}
