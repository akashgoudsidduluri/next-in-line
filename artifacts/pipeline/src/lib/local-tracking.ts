/**
 * Local-storage tracking for resources the backend can't list per-owner.
 *
 * - `myJobs[companyId]` → job IDs the company has created in this browser.
 *   Used because the public list endpoint returns *all* jobs and JobSummary
 *   doesn't include companyId; the dashboard filters down to "your jobs".
 *
 * - `myApplications[applicantId]` → application IDs an applicant has created
 *   in this browser. Used because the backend doesn't expose a "list my
 *   applications" endpoint.
 */

const JOBS_KEY = "hiring-pipeline.my-jobs.v1";
const APPS_KEY = "hiring-pipeline.my-apps.v1";

function readMap(key: string): Record<string, string[]> {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object") return parsed as Record<string, string[]>;
    return {};
  } catch {
    return {};
  }
}

function writeMap(key: string, m: Record<string, string[]>): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(key, JSON.stringify(m));
}

export function getMyJobIds(companyId: string): string[] {
  return readMap(JOBS_KEY)[companyId] ?? [];
}

export function rememberMyJob(companyId: string, jobId: string): void {
  const map = readMap(JOBS_KEY);
  const ids = new Set(map[companyId] ?? []);
  ids.add(jobId);
  map[companyId] = [...ids];
  writeMap(JOBS_KEY, map);
}

export function getMyApplicationIds(applicantId: string): string[] {
  return readMap(APPS_KEY)[applicantId] ?? [];
}

export function rememberMyApplication(
  applicantId: string,
  applicationId: string,
): void {
  const map = readMap(APPS_KEY);
  const ids = new Set(map[applicantId] ?? []);
  ids.add(applicationId);
  map[applicantId] = [...ids];
  writeMap(APPS_KEY, map);
}
