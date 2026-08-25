import { readdir, readFile, stat } from "node:fs/promises";
import { extname, join, resolve } from "node:path";

import type { JobInput, RawJobContent } from "./input.js";

const supportedFileExtensions = new Set([".txt", ".md"]);

export type JobBatchResolution = {
  jobs: RawJobContent[];
  failures: Array<{ path: string; message: string }>;
};

export async function resolveJobInput(input: JobInput): Promise<RawJobContent> {
  switch (input.type) {
    case "text":
      return normalize(input.content, { type: "text", value: "inline" });
    case "file":
      return resolveFile(input.path);
    case "url":
      return resolveUrl(input.url);
  }
}

export async function resolveJobInputsInDirectory(directory: string): Promise<JobBatchResolution> {
  const absoluteDirectory = resolve(directory);
  const metadata = await statOrThrow(absoluteDirectory, "Job directory does not exist");
  if (!metadata.isDirectory()) throw new Error(`Job input is not a directory: ${absoluteDirectory}`);

  const entries = await readdir(absoluteDirectory, { withFileTypes: true });
  const files = entries
    .filter((entry) => entry.isFile() && supportedFileExtensions.has(extname(entry.name).toLowerCase()))
    .map((entry) => join(absoluteDirectory, entry.name))
    .sort();

  if (files.length === 0) throw new Error(`Job directory has no .txt or .md files: ${absoluteDirectory}`);

  const results = await Promise.allSettled(files.map((path) => resolveFile(path)));
  return results.reduce<JobBatchResolution>(
    (batch, result, index) => {
      if (result.status === "fulfilled") batch.jobs.push(result.value);
      else {
        batch.failures.push({
          path: files[index]!,
          message: result.reason instanceof Error ? result.reason.message : "Unable to resolve job input",
        });
      }
      return batch;
    },
    { jobs: [], failures: [] },
  );
}

async function resolveFile(path: string): Promise<RawJobContent> {
  const absolutePath = resolve(path);
  const metadata = await statOrThrow(absolutePath, "Job file does not exist");
  if (!metadata.isFile()) throw new Error(`Job input is not a file: ${absolutePath}`);
  if (!supportedFileExtensions.has(extname(absolutePath).toLowerCase())) {
    throw new Error(`Unsupported job file type: ${extname(absolutePath) || "no extension"}`);
  }

  return normalize(await readFile(absolutePath, "utf8"), { type: "file", value: absolutePath });
}

async function resolveUrl(url: string): Promise<RawJobContent> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`Invalid job URL: ${url}`);
  }
  if (!/^https?:$/.test(parsed.protocol)) throw new Error("Job URL must use http or https");

  let response: Response;
  try {
    response = await fetch(parsed, { signal: AbortSignal.timeout(10_000) });
  } catch {
    throw new Error(`Unable to fetch job URL: ${url}. Save or paste the JD locally and try again.`);
  }
  if (!response.ok) throw new Error(`Unable to fetch job URL (${response.status}): ${url}`);

  return normalize(extractText(await response.text()), { type: "url", value: url });
}

function extractText(document: string): string {
  return document
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/\s+/g, " ");
}

function normalize(content: string, source: RawJobContent["source"]): RawJobContent {
  const normalized = content.trim();
  if (!normalized) throw new Error(`Job content is empty: ${source.value}`);
  return { content: normalized, source };
}

async function statOrThrow(path: string, message: string) {
  try {
    return await stat(path);
  } catch (error: unknown) {
    if (isNodeError(error, "ENOENT")) throw new Error(`${message}: ${path}`);
    throw error;
  }
}

function isNodeError(error: unknown, code: string): error is NodeJS.ErrnoException {
  return typeof error === "object" && error !== null && "code" in error && error.code === code;
}
