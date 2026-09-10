export type DuplicateCandidate = { jobId: string; sourceHash?: string; sourceReference?: string };
export type DuplicateHint = { jobId: string; reasons: ("exact-content" | "same-url")[] };

export function findExactDuplicateHints(current: DuplicateCandidate, others: DuplicateCandidate[]): DuplicateHint[] {
  const hints = new Map<string, Set<"exact-content" | "same-url">>();
  const currentUrl = comparableUrl(current.sourceReference);
  for (const other of others) {
    if (other.jobId === current.jobId) continue;
    const reasons = new Set<"exact-content" | "same-url">();
    if (current.sourceHash !== undefined && current.sourceHash === other.sourceHash) reasons.add("exact-content");
    if (currentUrl !== undefined && currentUrl === comparableUrl(other.sourceReference)) reasons.add("same-url");
    if (reasons.size) hints.set(other.jobId, reasons);
  }
  return [...hints.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([jobId, reasons]) => ({ jobId, reasons: ["exact-content", "same-url"].filter((reason) => reasons.has(reason as "exact-content" | "same-url")) as ("exact-content" | "same-url")[] }));
}

function comparableUrl(value: string | undefined): string | undefined {
  if (!value) return undefined;
  try {
    const url = new URL(value);
    if ((url.protocol !== "http:" && url.protocol !== "https:") || url.username || url.password) return undefined;
    return url.href;
  } catch {
    return undefined;
  }
}
