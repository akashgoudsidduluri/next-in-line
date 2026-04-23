/**
 * Extension of the queue engine for authenticated flows.
 *
 * The original `applyToJob` creates a brand-new applicant row from
 * `{name, email}` because it pre-dates auth. Once an applicant must be
 * authenticated, the applicant row already exists — we use its id directly.
 *
 * This file is purely additive. The original queue engine is unchanged.
 */

import { sql, eq } from "drizzle-orm";
import { db, jobsTable, applicantsTable, applicationsTable } from "@workspace/db";
import { applyToJob } from "./queueEngine";
import { NotFoundError, ConflictError } from "../lib/errors";

/**
 * Apply to a job as an already-registered applicant. Looks up the applicant
 * row by id, then delegates to the existing `applyToJob` engine using the
 * applicant's stored name/email.
 *
 * The engine inserts a NEW applicant row even when one already exists for the
 * same email — this is intentional because the applicants table represents
 * historical apply-time identity, not the user account. The auth-bearing
 * applicant id is recorded on the application via the route layer if needed
 * in the future; for now we mirror the legacy behavior so the engine stays
 * untouched.
 *
 * This wrapper additionally enforces:
 *   - the job must exist (404 otherwise)
 *   - the applicant cannot have an in-flight (non-EXITED) application for the
 *     same job (409 otherwise)
 */
export async function applyAsRegisteredApplicant(input: {
  jobId: string;
  applicantId: string;
}) {
  const jobRows = await db
    .select()
    .from(jobsTable)
    .where(eq(jobsTable.id, input.jobId))
    .limit(1);
  const job = jobRows[0];
  if (!job) throw new NotFoundError("Job not found");

  const applicantRows = await db
    .select()
    .from(applicantsTable)
    .where(eq(applicantsTable.id, input.applicantId))
    .limit(1);
  const applicant = applicantRows[0];
  if (!applicant) throw new NotFoundError("Applicant not found");

  // Reject in-flight duplicate applications by the same authenticated applicant.
  // We match on email (the stable identity) since the engine inserts new
  // applicant rows per apply.
  const inFlight = await db.execute<{ id: string }>(sql`
    SELECT app.id FROM applications app
    JOIN applicants ap ON ap.id = app.applicant_id
    WHERE app.job_id = ${input.jobId}
      AND ap.email = ${applicant.email}
      AND app.state IN ('ACTIVE', 'WAITLISTED')
    LIMIT 1
  `);
  if (inFlight.rows[0]) {
    throw new ConflictError(
      "You already have an active application for this job",
    );
  }

  return applyToJob({
    jobId: input.jobId,
    name: applicant.name,
    email: applicant.email,
  });
}

/** Look up the email of the auth'd applicant for ownership checks. */
export async function getApplicantEmail(applicantId: string): Promise<string | null> {
  const rows = await db
    .select({ email: applicantsTable.email })
    .from(applicantsTable)
    .where(eq(applicantsTable.id, applicantId))
    .limit(1);
  return rows[0]?.email ?? null;
}

/** True iff the application's applicant matches the auth'd applicant (by email). */
export async function applicationBelongsToApplicant(
  applicationId: string,
  applicantId: string,
): Promise<boolean> {
  const email = await getApplicantEmail(applicantId);
  if (!email) return false;
  const rows = await db.execute<{ ok: boolean }>(sql`
    SELECT TRUE AS ok FROM applications app
    JOIN applicants ap ON ap.id = app.applicant_id
    WHERE app.id = ${applicationId} AND ap.email = ${email}
    LIMIT 1
  `);
  return Boolean(rows.rows[0]?.ok);
}

/** True iff the job's company matches the auth'd company. */
export async function jobBelongsToCompany(
  jobId: string,
  companyId: string,
): Promise<boolean> {
  const rows = await db
    .select({ companyId: jobsTable.companyId })
    .from(jobsTable)
    .where(eq(jobsTable.id, jobId))
    .limit(1);
  const row = rows[0];
  if (!row) return false;
  return row.companyId === companyId;
}
