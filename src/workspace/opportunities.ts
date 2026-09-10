import { randomUUID } from "node:crypto";
import { readdir } from "node:fs/promises";
import { join, resolve } from "node:path";

import { applyPairDecision, deriveOpportunityGroups, parseOpportunityRevision, type OpportunityRevision, type PairDecision } from "../job/opportunities.js";
import { readWorkspaceJob, listWorkspaceJobs } from "./storage.js";
import { ConflictError, contentHash, readArtifact, writeArtifact } from "./artifacts.js";

export class OpportunityRepairError extends Error { constructor(message = "Opportunity data needs repair.") { super(message); this.name = "OpportunityRepairError"; } }
export class OpportunityMissingJobError extends Error { constructor() { super("Referenced job does not exist."); this.name = "OpportunityMissingJobError"; } }
export class OpportunityInputError extends Error { constructor(message = "Opportunity input is invalid.") { super(message); this.name = "OpportunityInputError"; } }

export type OpportunitySnapshot = {
  revision: OpportunityRevision | null;
  pointerHash: string | null;
  revisionHash: string | null;
};

export async function readOpportunitySnapshot(root: string): Promise<OpportunitySnapshot> {
  const pointerArtifact = await readArtifact(pointerPath(root));
  if (pointerArtifact === undefined) {
    if ((await revisionNames(root)).length) throw new OpportunityRepairError("Opportunity pointer is missing while revisions exist.");
    return { revision: null, pointerHash: null, revisionHash: null };
  }
  try {
    const pointer = parsePointer(JSON.parse(pointerArtifact.content) as unknown);
    const revisionArtifact = await readArtifact(revisionPath(root, pointer.revisionId));
    if (revisionArtifact === undefined || revisionArtifact.hash !== pointer.revisionHash) throw new Error("revision hash mismatch");
    const revision = parseOpportunityRevision(JSON.parse(revisionArtifact.content) as unknown);
    if (revision.id !== pointer.revisionId) throw new Error("revision id mismatch");
    return { revision, pointerHash: pointerArtifact.hash, revisionHash: revisionArtifact.hash };
  } catch {
    throw new OpportunityRepairError("Opportunity pointer or active revision is invalid. Restore the matching pointer and revision together.");
  }
}

export async function saveOpportunityDecision(root: string, input: {
  leftId: string;
  rightId: string;
  relation: "same" | "different" | "defer" | "clear";
  expectedHash: string | null;
  confirmed: boolean;
}): Promise<OpportunitySnapshot> {
  if (!input.confirmed) throw new OpportunityInputError("Candidate confirmation is required.");
  if (input.expectedHash !== null && !/^sha256:[a-f0-9]{64}$/.test(input.expectedHash)) throw new OpportunityInputError("Opportunity pointer hash is invalid.");
  const current = await readOpportunitySnapshot(root);
  if (current.pointerHash !== input.expectedHash) throw new ConflictError();
  await ensureHealthyJob(root, input.leftId);
  await ensureHealthyJob(root, input.rightId);
  const jobs = await listWorkspaceJobs(root);
  const jobIds = jobs.map((job) => job.id);
  const previousDecisions = current.revision?.decisions ?? [];
  const decisions = applyPairDecision(previousDecisions, { leftId: input.leftId, rightId: input.rightId, relation: input.relation });
  try { deriveOpportunityGroups(jobIds, decisions); } catch (error) {
    if (error instanceof Error && /unknown job/i.test(error.message)) throw new OpportunityMissingJobError();
    throw new OpportunityInputError(error instanceof Error ? error.message : "Opportunity decision is invalid.");
  }
  for (const decision of decisions) await ensureHealthyJob(root, decision.leftId).then(() => ensureHealthyJob(root, decision.rightId));
  const revision: OpportunityRevision = {
    schemaVersion: 1,
    id: `opportunity-rev-${randomUUID()}`,
    createdAt: new Date().toISOString(),
    createdBy: { kind: "candidate" },
    previous: current.revision === null || current.revisionHash === null ? null : { id: current.revision.id, hash: current.revisionHash },
    decisions,
  };
  const serialized = `${JSON.stringify(revision, null, 2)}\n`;
  const revisionHash = await writeArtifact(revisionPath(root, revision.id), serialized);
  const pointer = { schemaVersion: 1, revisionId: revision.id, revisionHash };
  const pointerSerialized = `${JSON.stringify(pointer, null, 2)}\n`;
  const pointerHash = await writeArtifact(pointerPath(root), pointerSerialized, input.expectedHash);
  return { revision, pointerHash, revisionHash };
}

export async function readOpportunityView(root: string): Promise<{ snapshot: OpportunitySnapshot; groups: ReturnType<typeof deriveOpportunityGroups>; jobIds: string[]; repairJobIds: string[] }> {
  const snapshot = await readOpportunitySnapshot(root);
  const jobs = await listWorkspaceJobs(root);
  const jobIds = jobs.map((job) => job.id);
  let groups;
  try { groups = deriveOpportunityGroups(jobIds, snapshot.revision?.decisions ?? []); }
  catch { throw new OpportunityRepairError("Opportunity decisions reference missing or contradictory jobs."); }
  for (const decision of snapshot.revision?.decisions ?? []) {
    await ensureHealthyJob(root, decision.leftId);
    await ensureHealthyJob(root, decision.rightId);
  }
  return { snapshot, groups, jobIds, repairJobIds: jobs.filter((job) => job.invalidSourceData !== undefined).map((job) => job.id).sort() };
}

async function ensureHealthyJob(root: string, id: string): Promise<void> {
  try {
    const job = await readWorkspaceJob(root, id);
    if (job.invalidSourceData || job.artifactStatus.source !== true) throw new OpportunityRepairError("Referenced job source needs repair.");
  } catch (error) {
    if (error instanceof OpportunityRepairError) throw error;
    throw new OpportunityMissingJobError();
  }
}

function parsePointer(value: unknown): { schemaVersion: 1; revisionId: string; revisionHash: string } {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error("pointer invalid");
  const pointer = value as Record<string, unknown>;
  if (pointer.schemaVersion !== 1 || typeof pointer.revisionId !== "string" || !/^[a-z0-9-]+$/.test(pointer.revisionId) || typeof pointer.revisionHash !== "string" || !/^sha256:[a-f0-9]{64}$/.test(pointer.revisionHash)) throw new Error("pointer invalid");
  return { schemaVersion: 1, revisionId: pointer.revisionId, revisionHash: pointer.revisionHash };
}

async function revisionNames(root: string): Promise<string[]> {
  try { return (await readdir(revisionsDirectory(root), { withFileTypes: true })).filter((entry) => entry.isFile() && entry.name.endsWith(".json")).map((entry) => entry.name); }
  catch { return []; }
}
function opportunitiesDirectory(root: string): string { return resolve(root, "data", "opportunities"); }
function revisionsDirectory(root: string): string { return join(opportunitiesDirectory(root), "revisions"); }
function pointerPath(root: string): string { return join(opportunitiesDirectory(root), "current.json"); }
function revisionPath(root: string, id: string): string { return join(revisionsDirectory(root), `${id}.json`); }
