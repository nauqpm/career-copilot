import { randomUUID } from "node:crypto";
import { mkdir, readdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

import { type JobDecision, parseJobDecision } from "../decision/schema.js";
import { type RawJobContent } from "../job/input.js";
import {
  type EmploymentType,
  type JobAnalysis,
  type WorkArrangement,
  parseJobAnalysis,
} from "../job/schema.js";

export interface WorkspaceArtifactStatus {
  source: boolean;
  analysis: boolean;
  decision: boolean;
  cvDraft: boolean;
}

export interface WorkspaceJobSummary {
  id: string;
  sourcePreview: string;
  title?: string;
  company?: string;
  decisionStatus?: string;
  hasAnalysis: boolean;
  hasCvDraft: boolean;
  invalidDerivedData?: string;
  artifactStatus: WorkspaceArtifactStatus;
  updatedAt: string;
  cvDraftUpdatedAt?: string;
  employmentType?: EmploymentType;
  workArrangement?: WorkArrangement;
  locationPreview?: string;
}

export type WorkspaceJobDetail = WorkspaceJobSummary & {
  raw: RawJobContent;
  analysis?: JobAnalysis;
  decision?: JobDecision;
  cvDraft?: string;
};

export type PastedJob = {
  content: string;
  sourceReference?: string;
};

const jobIdPattern = /^[a-z0-9-]+$/;

export async function createPastedJob(root: string, input: PastedJob): Promise<WorkspaceJobSummary> {
  const content = requireText(input.content, "Job content");
  const sourceReference = input.sourceReference?.trim() || "Pasted in Career Copilot";
  const id = `job-${randomUUID()}`;
  const directory = jobDirectory(root, id);
  const raw: RawJobContent = { content, source: { type: "text", value: sourceReference } };

  await mkdir(directory, { recursive: true });
  await Promise.all([
    writeAtomically(join(directory, "source.md"), withFinalNewline(input.content)),
    writeAtomically(join(directory, "raw.json"), `${JSON.stringify(raw, null, 2)}\n`),
  ]);

  return readWorkspaceSummary(root, id);
}

export async function listWorkspaceJobs(root: string): Promise<WorkspaceJobSummary[]> {
  let entries;
  try {
    entries = await readdir(jobsDirectory(root), { withFileTypes: true });
  } catch (error) {
    if (isNodeError(error, "ENOENT")) return [];
    throw error;
  }

  const ids = entries.filter((entry) => entry.isDirectory() && jobIdPattern.test(entry.name)).map((entry) => entry.name);
  const summaries = await Promise.all(ids.map((id) => readWorkspaceSummary(root, id)));
  return summaries.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt) || left.id.localeCompare(right.id));
}

export async function readWorkspaceJob(root: string, id: string): Promise<WorkspaceJobDetail> {
  const directory = jobDirectory(root, id);
  const raw = parseRawJobContent(await readJson(join(directory, "raw.json")));
  const [derived, artifactMetadata] = await Promise.all([readDerivedData(directory), readWorkspaceArtifactMetadata(directory)]);
  return {
    ...summaryFrom({ id, raw, ...derived, ...artifactMetadata }),
    raw,
    ...derived,
  };
}

export function getCvDraftPath(root: string, id: string): string {
  return join(jobDirectory(root, id), "cv-draft.md");
}

export function getWorkspaceJobNotePath(root: string, id: string): string {
  return join(jobDirectory(root, id), "notes.md");
}

export async function readWorkspaceJobNote(root: string, jobId: string): Promise<string | undefined> {
  const directory = await requireExistingJobDirectory(root, jobId);
  try {
    return requireText(await readFile(join(directory, "notes.md"), "utf8"), "Note content");
  } catch (error) {
    if (isNodeError(error, "ENOENT")) return undefined;
    throw error;
  }
}

export async function saveWorkspaceJobNote(root: string, jobId: string, content: string): Promise<void> {
  const directory = await requireExistingJobDirectory(root, jobId);
  const normalized = requireText(content, "Note content");
  await writeAtomically(join(directory, "notes.md"), withFinalNewline(normalized));
}

async function readWorkspaceSummary(root: string, id: string): Promise<WorkspaceJobSummary> {
  const directory = jobDirectory(root, id);
  const raw = parseRawJobContent(await readJson(join(directory, "raw.json")));
  const [derived, artifactMetadata] = await Promise.all([readDerivedData(directory), readWorkspaceArtifactMetadata(directory)]);
  return summaryFrom({ id, raw, ...derived, ...artifactMetadata });
}

async function readDerivedData(directory: string): Promise<{
  analysis?: JobAnalysis;
  decision?: JobDecision;
  cvDraft?: string;
  hasAnalysis: boolean;
  hasCvDraft: boolean;
  invalidDerivedData?: string;
}> {
  const failures: string[] = [];
  const analysis = await readOptionalValidatedJson(join(directory, "analysis.json"), parseJobAnalysis, "analysis.json", failures);
  const decision = await readOptionalValidatedJson(join(directory, "decision.json"), parseJobDecision, "decision.json", failures);
  const cvDraft = await readOptionalText(join(directory, "cv-draft.md"), "cv-draft.md", failures);

  return {
    ...(analysis === undefined ? {} : { analysis }),
    ...(decision === undefined ? {} : { decision }),
    ...(cvDraft === undefined ? {} : { cvDraft }),
    hasAnalysis: analysis !== undefined,
    hasCvDraft: cvDraft !== undefined,
    ...(failures.length === 0 ? {} : { invalidDerivedData: failures.join(" ") }),
  };
}

function summaryFrom(input: {
  id: string;
  raw: RawJobContent;
  analysis?: JobAnalysis;
  decision?: JobDecision;
  hasAnalysis: boolean;
  hasCvDraft: boolean;
  invalidDerivedData?: string;
  artifactStatus: WorkspaceArtifactStatus;
  updatedAt: string;
  cvDraftUpdatedAt?: string;
}): WorkspaceJobSummary {
  return {
    id: input.id,
    sourcePreview: input.raw.content.replace(/\s+/g, " ").slice(0, 160),
    ...optionalText(input.analysis?.title, "title"),
    ...optionalText(input.analysis?.company, "company"),
    ...(input.decision === undefined ? {} : { decisionStatus: input.decision.status }),
    hasAnalysis: input.hasAnalysis,
    hasCvDraft: input.hasCvDraft,
    ...(input.invalidDerivedData === undefined ? {} : { invalidDerivedData: input.invalidDerivedData }),
    artifactStatus: input.artifactStatus,
    updatedAt: input.updatedAt,
    ...(input.cvDraftUpdatedAt === undefined ? {} : { cvDraftUpdatedAt: input.cvDraftUpdatedAt }),
    ...(input.analysis?.employment?.type === undefined ? {} : { employmentType: input.analysis.employment.type }),
    ...(input.analysis?.employment?.workArrangement === undefined
      ? {}
      : { workArrangement: input.analysis.employment.workArrangement }),
    ...(input.analysis?.employment?.locations?.[0] === undefined
      ? {}
      : { locationPreview: input.analysis.employment.locations[0].raw }),
  };
}

async function readWorkspaceArtifactMetadata(directory: string): Promise<{
  artifactStatus: WorkspaceArtifactStatus;
  updatedAt: string;
  cvDraftUpdatedAt?: string;
}> {
  const artifacts = await Promise.all([
    readArtifactStat(join(directory, "source.md")),
    readArtifactStat(join(directory, "raw.json")),
    readArtifactStat(join(directory, "analysis.json")),
    readArtifactStat(join(directory, "decision.json")),
    readArtifactStat(join(directory, "cv-draft.md")),
    readArtifactStat(join(directory, "notes.md")),
  ]);
  const [source, raw, analysis, decision, cvDraft] = artifacts;
  const newest = artifacts.reduce<Date | undefined>((latest, artifact) => {
    if (artifact === undefined || (latest !== undefined && latest.getTime() >= artifact.getTime())) return latest;
    return artifact;
  }, undefined);

  if (raw === undefined || newest === undefined) throw new Error("Raw job content is missing");

  return {
    artifactStatus: {
      source: source !== undefined,
      analysis: analysis !== undefined,
      decision: decision !== undefined,
      cvDraft: cvDraft !== undefined,
    },
    updatedAt: newest.toISOString(),
    ...(cvDraft === undefined ? {} : { cvDraftUpdatedAt: cvDraft.toISOString() }),
  };
}

async function readArtifactStat(path: string): Promise<Date | undefined> {
  try {
    return (await stat(path)).mtime;
  } catch (error) {
    if (isNodeError(error, "ENOENT")) return undefined;
    throw error;
  }
}

function optionalText(value: string | undefined, key: "title" | "company"): Partial<Record<typeof key, string>> {
  return value === undefined ? {} : { [key]: value };
}

async function readOptionalValidatedJson<T>(
  path: string,
  parser: (value: unknown) => T,
  label: string,
  failures: string[],
): Promise<T | undefined> {
  try {
    return parser(await readJson(path));
  } catch (error) {
    if (isNodeError(error, "ENOENT")) return undefined;
    failures.push(`${label} is invalid.`);
    return undefined;
  }
}

async function readOptionalText(path: string, label: string, failures: string[]): Promise<string | undefined> {
  try {
    const content = await readFile(path, "utf8");
    if (content.trim()) return content;
    failures.push(`${label} is empty.`);
    return undefined;
  } catch (error) {
    if (isNodeError(error, "ENOENT")) return undefined;
    failures.push(`${label} cannot be read.`);
    return undefined;
  }
}

async function readJson(path: string): Promise<unknown> {
  return JSON.parse(await readFile(path, "utf8")) as unknown;
}

function parseRawJobContent(value: unknown): RawJobContent {
  if (!isRecord(value) || !isNonEmptyString(value.content) || !isRecord(value.source)) {
    throw new Error("Raw job content is invalid");
  }
  if (value.source.type !== "text" && value.source.type !== "file" && value.source.type !== "url") {
    throw new Error("Raw job source is invalid");
  }
  if (!isNonEmptyString(value.source.value)) throw new Error("Raw job source is invalid");

  return {
    content: value.content.trim(),
    source: { type: value.source.type, value: value.source.value.trim() },
  };
}

function jobsDirectory(root: string): string {
  return resolve(root, "data", "jobs");
}

function jobDirectory(root: string, id: string): string {
  if (!jobIdPattern.test(id)) throw new Error("job id is invalid");
  return join(jobsDirectory(root), id);
}

async function requireExistingJobDirectory(root: string, id: string): Promise<string> {
  const directory = jobDirectory(root, id);
  try {
    if ((await stat(directory)).isDirectory()) return directory;
  } catch (error) {
    if (!isNodeError(error, "ENOENT")) throw error;
  }
  throw new Error("job does not exist");
}

function requireText(value: string, field: string): string {
  if (!isNonEmptyString(value)) throw new Error(`${field} must not be empty`);
  return value.trim();
}

function withFinalNewline(content: string): string {
  return content.endsWith("\n") ? content : `${content}\n`;
}

async function writeAtomically(path: string, content: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.${randomUUID()}.tmp`;
  await writeFile(temporary, content, "utf8");
  await rename(temporary, path);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isNodeError(error: unknown, code: string): error is NodeJS.ErrnoException {
  return typeof error === "object" && error !== null && "code" in error && error.code === code;
}
