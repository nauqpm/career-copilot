import { randomUUID } from "node:crypto";
import { mkdir, readdir, stat } from "node:fs/promises";
import { join, resolve } from "node:path";
import { assertSafePath, readArtifact, writeArtifact } from "./artifacts.js";
import { captureRawSource, createJobCapture, maxCaptureBytes, parseJobCapture, serializeJobCapture, type JobCapture, type LocalJobInput } from "../job/capture.js";
import { findExactDuplicateHints, type DuplicateCandidate, type DuplicateHint } from "../job/duplicates.js";
import { assessmentFreshness, readCurrentMatch, readMatchHistory, type MatchHistory } from "../match/storage.js";
import type { MatchAssessment } from "../match/schema.js";

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

export type WorkspaceMatchAssessmentSummary = {
  status: "current" | "stale" | "needs-repair";
  id?: string;
  createdAt?: string;
  assessmentHash?: string;
  recommendation?: MatchAssessment["recommendation"];
  confidence?: MatchAssessment["confidence"];
  staleReasons?: string[];
};

export interface WorkspaceJobSummary {
  id: string;
  sourcePreview: string;
  title?: string;
  company?: string;
  decisionStatus?: string;
  hasAnalysis: boolean;
  hasCvDraft: boolean;
  invalidDerivedData?: string;
  invalidSourceData?: string;
  artifactStatus: WorkspaceArtifactStatus;
  updatedAt: string;
  cvDraftUpdatedAt?: string;
  employmentType?: EmploymentType;
  workArrangement?: WorkArrangement;
  locationPreview?: string;
  captureStatus?: "verified" | "legacy" | "invalid";
  captureCreatedAt?: string;
  duplicateHints?: DuplicateHint[];
  duplicateScanIncomplete?: boolean;
  matchAssessment?: WorkspaceMatchAssessmentSummary;
  matchAssessmentHistory?: MatchHistory["assessments"];
}

export type WorkspaceJobDetail = WorkspaceJobSummary & {
  raw: RawJobContent;
  capture?: JobCapture;
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
  return createLocalJob(root, {
    content: input.content,
    sourceKind: "pasted-text",
    sourceReference: input.sourceReference?.trim() || "Pasted in Career Copilot",
  });
}

export async function createLocalJob(root: string, input: LocalJobInput): Promise<WorkspaceJobSummary> {
  const content = requireCaptureText(input.content);
  const id = `job-${randomUUID()}`;
  const directory = jobDirectory(root, id);
  const capture = createJobCapture(id, input);
  const raw: WorkspaceRawJobContent = {
    content: content.trim(),
    source: captureRawSource(capture),
    capture: { id, manifestHash: "" },
  };

  await assertSafePath(directory);
  await mkdir(directory, { recursive: true });
  // Source is durable before raw metadata; interrupted creation remains a visible repair row.
  await writeArtifact(join(directory, "source.md"), content);
  const manifestHash = await writeArtifact(join(directory, "source.json"), serializeJobCapture(capture));
  await writeArtifact(join(directory, "raw.json"), `${JSON.stringify({ ...raw, capture: { id, manifestHash } }, null, 2)}\n`);

  return readWorkspaceSummary(root, id);
}

export async function listWorkspaceJobs(root: string): Promise<WorkspaceJobSummary[]> {
  await assertSafePath(jobsDirectory(root));
  let entries;
  try {
    entries = await readdir(jobsDirectory(root), { withFileTypes: true });
  } catch (error) {
    if (isNodeError(error, "ENOENT")) return [];
    throw error;
  }

  const ids = entries.filter((entry) => (entry.isDirectory() || entry.isSymbolicLink()) && jobIdPattern.test(entry.name)).map((entry) => entry.name);
  const summaries = await Promise.all(ids.map(async (id): Promise<WorkspaceJobSummary> => {
    try { return await readWorkspaceSummary(root, id); }
    catch {
      return { id, sourcePreview: "Nguồn JD cần kiểm tra", invalidSourceData: "Không đọc được nguồn JD. Dữ liệu gốc được giữ nguyên; hãy kiểm tra hoặc khôi phục từ backup.", hasAnalysis: false, hasCvDraft: false, artifactStatus: { source: false, analysis: false, decision: false, cvDraft: false }, updatedAt: "" };
    }
  }));
  return summaries.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt) || left.id.localeCompare(right.id));
}

export async function readWorkspaceJob(root: string, id: string): Promise<WorkspaceJobDetail> {
  const directory = jobDirectory(root, id);
  const raw = parseRawJobContent(await readJson(join(directory, "raw.json")));
  const [derived, artifactMetadata, captureState, matchState] = await Promise.all([readDerivedData(directory), readWorkspaceArtifactMetadata(directory), readCaptureState(directory, id, raw), readMatchState(root, id)]);
  const duplicateState = await readDuplicateState(root, id, raw, captureState);
  return {
    ...summaryFrom({ id, raw, ...derived, ...artifactMetadata, ...captureState, ...duplicateState, ...matchState }),
    raw,
    ...(captureState.capture === undefined ? {} : { capture: captureState.capture }),
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
  return (await readWorkspaceJobNoteSnapshot(root, jobId))?.content;
}

export async function readWorkspaceJobNoteSnapshot(root: string, jobId: string): Promise<{content: string; hash: string} | undefined> {
  const directory = await requireExistingJobDirectory(root, jobId);
  const artifact = await readArtifact(join(directory, "notes.md"));
  return artifact === undefined ? undefined : { ...artifact, content: requireText(artifact.content, "Note content") };
}

export async function saveWorkspaceJobNote(root: string, jobId: string, content: string, expectedHash: string | null = null): Promise<void> {
  const directory = await requireExistingJobDirectory(root, jobId);
  const normalized = requireText(content, "Note content");
  await writeArtifact(join(directory, "notes.md"), withFinalNewline(normalized), expectedHash);
}

async function readWorkspaceSummary(root: string, id: string): Promise<WorkspaceJobSummary> {
  const directory = jobDirectory(root, id);
  const raw = parseRawJobContent(await readJson(join(directory, "raw.json")));
  const [derived, artifactMetadata, captureState, matchState] = await Promise.all([readDerivedData(directory), readWorkspaceArtifactMetadata(directory), readCaptureState(directory, id, raw), readMatchState(root, id)]);
  return summaryFrom({ id, raw, ...derived, ...artifactMetadata, ...captureState, ...matchState });
}

async function readMatchState(root: string, jobId: string): Promise<{
  matchAssessment?: WorkspaceMatchAssessmentSummary;
  matchAssessmentHistory?: MatchHistory["assessments"];
}> {
  let history: MatchHistory;
  try {
    history = await readMatchHistory(root, jobId);
  } catch {
    return { matchAssessment: { status: "needs-repair" } };
  }
  let pointerArtifact;
  try {
    pointerArtifact = await readArtifact(join(resolve(root), "data", "jobs", jobId, "assessments", "current.json"));
  } catch {
    return { matchAssessment: { status: "needs-repair" }, matchAssessmentHistory: history.assessments };
  }
  if (history.assessments.length === 0 && history.current === undefined && pointerArtifact === undefined) return {};

  if (pointerArtifact !== undefined) {
    try {
      const current = await readCurrentMatch(root, jobId);
      if (current === undefined) return { matchAssessmentHistory: history.assessments };
      const freshness = await assessmentFreshness(root, current.assessment);
      return {
        matchAssessment: {
          status: freshness.stale ? "stale" : "current",
          id: current.assessment.id,
          createdAt: current.assessment.createdAt,
          assessmentHash: current.assessmentHash,
          recommendation: current.assessment.recommendation,
          confidence: current.assessment.confidence,
          ...(freshness.reasons.length === 0 ? {} : { staleReasons: freshness.reasons }),
        },
        matchAssessmentHistory: history.assessments,
      };
    } catch {
      return { matchAssessment: { status: "needs-repair" }, matchAssessmentHistory: history.assessments };
    }
  }
  return { matchAssessmentHistory: history.assessments };
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
  capture?: JobCapture;
  captureStatus: "verified" | "legacy" | "invalid";
  captureCreatedAt?: string;
  sourceHash?: string;
  invalidSourceData?: string;
  duplicateHints?: DuplicateHint[];
  duplicateScanIncomplete?: boolean;
  matchAssessment?: WorkspaceMatchAssessmentSummary;
  matchAssessmentHistory?: MatchHistory["assessments"];
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
    captureStatus: input.captureStatus,
    ...(input.captureCreatedAt === undefined ? {} : { captureCreatedAt: input.captureCreatedAt }),
    ...(input.invalidSourceData === undefined ? {} : { invalidSourceData: input.invalidSourceData }),
    ...(input.duplicateHints === undefined ? {} : { duplicateHints: input.duplicateHints }),
    ...(input.duplicateScanIncomplete === undefined ? {} : { duplicateScanIncomplete: input.duplicateScanIncomplete }),
    ...(input.matchAssessment === undefined ? {} : { matchAssessment: input.matchAssessment }),
    ...(input.matchAssessmentHistory === undefined ? {} : { matchAssessmentHistory: input.matchAssessmentHistory }),
  };
}

type WorkspaceRawJobContent = RawJobContent & { capture?: { id: string; manifestHash: string } };

async function readCaptureState(directory: string, id: string, raw: WorkspaceRawJobContent): Promise<{
  capture?: JobCapture;
  captureStatus: "verified" | "legacy" | "invalid";
  captureCreatedAt?: string;
  sourceHash?: string;
  invalidSourceData?: string;
}> {
  const manifest = await readArtifact(join(directory, "source.json"));
  const source = await readArtifact(join(directory, "source.md"));
  if (manifest === undefined && raw.capture === undefined) return { captureStatus: "legacy", ...(source === undefined ? {} : { sourceHash: source.hash }) };
  try {
    if (manifest === undefined || raw.capture === undefined || raw.capture.id !== id || raw.capture.manifestHash !== manifest.hash) throw new Error("Capture reference is missing or inconsistent");
    const capture = parseJobCapture(JSON.parse(manifest.content) as unknown);
    const expectedSource = captureRawSource(capture);
    if (
      capture.id !== id ||
      source === undefined ||
      source.hash !== capture.rawContentHash ||
      raw.content !== source.content.trim() ||
      raw.source.type !== expectedSource.type ||
      raw.source.value !== expectedSource.value
    ) {
      throw new Error("Captured source metadata does not match its manifest");
    }
    return { capture, captureStatus: "verified", captureCreatedAt: capture.createdAt, sourceHash: source.hash };
  } catch {
    return { captureStatus: "invalid", invalidSourceData: "Nguồn JD capture bị thiếu hoặc không toàn vẹn. Dữ liệu gốc được giữ nguyên; hãy khôi phục source.md, source.json và raw.json cùng nhau." };
  }
}

async function readDuplicateState(root: string, currentId: string, raw: WorkspaceRawJobContent, captureState: { capture?: JobCapture; captureStatus: "verified" | "legacy" | "invalid"; sourceHash?: string }): Promise<{ duplicateHints: DuplicateHint[]; duplicateScanIncomplete: boolean }> {
  if (captureState.captureStatus === "invalid" || captureState.sourceHash === undefined) return { duplicateHints: [], duplicateScanIncomplete: false };
  const candidates: DuplicateCandidate[] = [{
    jobId: currentId,
    sourceHash: captureState.sourceHash,
    ...(captureState.capture?.sourceReference === undefined
      ? captureState.captureStatus === "legacy" ? { sourceReference: raw.source.value } : {}
      : { sourceReference: captureState.capture.sourceReference }),
  }];
  let incomplete = false;
  let entries;
  try {
    entries = await readdir(jobsDirectory(root), { withFileTypes: true });
  } catch {
    return { duplicateHints: [], duplicateScanIncomplete: true };
  }
  for (const entry of entries) {
    if (!jobIdPattern.test(entry.name) || entry.name === currentId) continue;
    if (entry.isSymbolicLink() || !entry.isDirectory()) {
      incomplete = true;
      continue;
    }
    try {
      const otherRaw = parseRawJobContent(await readJson(join(jobsDirectory(root), entry.name, "raw.json")));
      const otherState = await readCaptureState(join(jobsDirectory(root), entry.name), entry.name, otherRaw);
      if (otherState.captureStatus === "invalid" || otherState.sourceHash === undefined) {
        incomplete = true;
        continue;
      }
      candidates.push({
        jobId: entry.name,
        sourceHash: otherState.sourceHash,
        ...(otherState.capture?.sourceReference === undefined
          ? otherState.captureStatus === "legacy" ? { sourceReference: otherRaw.source.value } : {}
          : { sourceReference: otherState.capture.sourceReference }),
      });
    } catch {
      incomplete = true;
    }
  }
  const [current, ...others] = candidates;
  return { duplicateHints: findExactDuplicateHints(current!, others), duplicateScanIncomplete: incomplete };
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
    await assertSafePath(path);
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
    const artifact = await readArtifact(path);
    if (artifact === undefined) return undefined;
    const content = artifact.content;
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
  const artifact = await readArtifact(path);
  if (artifact === undefined) throw Object.assign(new Error("Artifact missing"), { code: "ENOENT" });
  return JSON.parse(artifact.content) as unknown;
}

function parseRawJobContent(value: unknown): WorkspaceRawJobContent {
  if (!isRecord(value) || !isNonEmptyString(value.content) || !isRecord(value.source)) {
    throw new Error("Raw job content is invalid");
  }
  if (value.source.type !== "text" && value.source.type !== "file" && value.source.type !== "url") {
    throw new Error("Raw job source is invalid");
  }
  if (!isNonEmptyString(value.source.value)) throw new Error("Raw job source is invalid");

  const capture = value.capture;
  if (capture !== undefined && (!isRecord(capture) || !isNonEmptyString(capture.id) || !isNonEmptyString(capture.manifestHash))) throw new Error("Raw job capture marker is invalid");
  return {
    content: value.content.trim(),
    source: { type: value.source.type, value: value.source.value.trim() },
    ...(capture === undefined ? {} : { capture: { id: String(capture.id), manifestHash: String(capture.manifestHash) } }),
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
  await assertSafePath(directory);
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

function requireCaptureText(value: string): string {
  if (typeof value !== "string" || !value.trim()) throw new Error("Job content must not be empty");
  if (Buffer.byteLength(value, "utf8") > maxCaptureBytes) throw new Error("Job content exceeds the 1 MiB limit");
  return value;
}

function withFinalNewline(content: string): string {
  return content.endsWith("\n") ? content : `${content}\n`;
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
