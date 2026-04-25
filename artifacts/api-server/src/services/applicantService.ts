/**
 * Applicant Service — owns the Applicant Identity domain.
 * 
 * Separating this from the Queue Engine prevents tight coupling between
 * recruitment process logic and user identity management.
 */

import { eq } from "drizzle-orm";
import { db, applicantsTable, jobsTable, type Applicant } from "@workspace/db";
import { NotFoundError } from "../lib/errors";
import { withTransaction } from "../lib/transaction";
import { logger } from "../lib/logger";
import { toJobDto } from "./dto";

export async function findOrCreateApplicant(input: {
  name: string;
  email: string;
}): Promise<Applicant> {
  const email = input.email.trim().toLowerCase();
  
  return withTransaction(async (tx) => {
    // 1. Check for existing applicant by email (stable identity)
    const existing = await tx
      .select()
      .from(applicantsTable)
      .where(eq(applicantsTable.email, email))
      .limit(1);
      
    if (existing[0]) {
      return existing[0];
    }

    // 2. Create new if not found
    logger.info({ email, name: input.name }, "Creating new applicant identity");
    const [created] = await tx
      .insert(applicantsTable)
      .values({
        name: input.name.trim(),
        email,
      })
      .returning();
      
    if (!created) {
      throw new Error("Failed to create applicant identity");
    }
    
    return created;
  });
}

export async function getApplicantById(id: string): Promise<Applicant> {
  const rows = await db
    .select()
    .from(applicantsTable)
    .where(eq(applicantsTable.id, id))
    .limit(1);
    
  const applicant = rows[0];
  if (!applicant) {
    throw new NotFoundError(`Applicant not found: ${id}`);
  }
  return applicant;
}
