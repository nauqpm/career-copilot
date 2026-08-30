const pages = new Set(["overview", "jobs", "profile", "cvs", "new-job"]);

export function parseRoute(hash = "") {
  if (typeof hash !== "string" || !hash.startsWith("#")) return { page: "overview" };
  const path = hash.slice(1);
  if (pages.has(path)) return { page: path };
  if (path.startsWith("jobs/")) {
    try {
      const jobId = decodeURIComponent(path.slice(5));
      if (/^[a-z0-9-]+$/.test(jobId)) return { page: "job", jobId };
    } catch { /* A malformed URI is an invalid route. */ }
  }
  return { page: "overview" };
}
