/**
 * Auth service — register and login for both roles. Passwords are bcrypt-hashed
 * (cost 10). Email is the unique identifier; uniqueness is enforced by the DB.
 */

import bcrypt from "bcryptjs";
import { eq } from "drizzle-orm";
import {
  db,
  companiesTable,
  applicantsTable,
  type Company,
  type Applicant,
} from "@workspace/db";
import { ConflictError, UnauthorizedError, BadRequestError, HttpError } from "../lib/errors";
import { logger } from "../lib/logger";

const BCRYPT_COST = 10;

function normaliseEmail(email: string): string {
  const trimmed = email.trim().toLowerCase();
  if (!trimmed || !trimmed.includes("@")) {
    throw new BadRequestError("Invalid email");
  }
  return trimmed;
}

export async function registerCompany(input: {
  name: string;
  email: string;
  password: string;
}): Promise<Company> {
  if (input.password.length < 8) {
    throw new BadRequestError("Password must be at least 8 characters");
  }
  const email = normaliseEmail(input.email);
  const existing = await db
    .select()
    .from(companiesTable)
    .where(eq(companiesTable.email, email))
    .limit(1);
  
  if (existing[0]) {
    logger.warn({ email }, "Company registration failed: email conflict");
    throw new ConflictError("Email already registered");
  }

  logger.info({ email, name: input.name }, "Attempting company registration");

  const passwordHash = await bcrypt.hash(input.password, BCRYPT_COST);
  const [created] = await db
    .insert(companiesTable)
    .values({ name: input.name.trim(), email, passwordHash })
    .returning();
  if (!created) throw new HttpError(500, "DATABASE_ERROR", "Failed to create company");
  return created;
}

export async function loginCompany(input: {
  email: string;
  password: string;
}): Promise<Company> {
  const email = normaliseEmail(input.email);
  const rows = await db
    .select()
    .from(companiesTable)
    .where(eq(companiesTable.email, email))
    .limit(1);
  const company = rows[0];
  if (!company) {
    logger.warn({ email }, "Company login failed: account not found");
    throw new UnauthorizedError("Invalid credentials");
  }
  const ok = await bcrypt.compare(input.password, company.passwordHash);
  if (!ok) {
    logger.warn({ email, companyId: company.id }, "Company login failed: password mismatch");
    throw new UnauthorizedError("Invalid credentials");
  }
  
  logger.info({ email, companyId: company.id }, "Company login successful");
  return company;
}

export async function registerApplicant(input: {
  name: string;
  email: string;
  password: string;
}): Promise<Applicant> {
  if (input.password.length < 8) {
    throw new BadRequestError("Password must be at least 8 characters");
  }
  const email = normaliseEmail(input.email);
  const existing = await db
    .select()
    .from(applicantsTable)
    .where(eq(applicantsTable.email, email))
    .limit(1);
  
  if (existing[0]) {
    logger.warn({ email }, "Applicant registration failed: email conflict");
    throw new ConflictError("Email already registered");
  }

  logger.info({ email, name: input.name }, "Attempting applicant registration");

  const passwordHash = await bcrypt.hash(input.password, BCRYPT_COST);
  const [created] = await db
    .insert(applicantsTable)
    .values({ name: input.name.trim(), email, passwordHash })
    .returning();
  if (!created) throw new HttpError(500, "DATABASE_ERROR", "Failed to create applicant");
  return created;
}

export async function loginApplicant(input: {
  email: string;
  password: string;
}): Promise<Applicant> {
  const email = normaliseEmail(input.email);
  const rows = await db
    .select()
    .from(applicantsTable)
    .where(eq(applicantsTable.email, email))
    .limit(1);
  const applicant = rows[0];
  if (!applicant || !applicant.passwordHash) {
    throw new UnauthorizedError("Invalid credentials");
  }
  const ok = await bcrypt.compare(input.password, applicant.passwordHash);
  if (!ok) throw new UnauthorizedError("Invalid credentials");
  return applicant;
}
