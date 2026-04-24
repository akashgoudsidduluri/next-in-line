import { describe, it, expect, beforeEach } from "vitest";
import { db, applicantsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { findOrCreateApplicant, getApplicantById } from "./applicantService";
import { resetDb, uniqEmail } from "../__tests__/resetDb";
import { NotFoundError } from "../lib/errors";

describe("ApplicantService", () => {
  beforeEach(async () => {
    await resetDb();
  });

  describe("findOrCreateApplicant", () => {
    it("creates a new applicant if email doesn't exist", async () => {
      const email = uniqEmail("new");
      const applicant = await findOrCreateApplicant({
        name: "New Applicant",
        email,
      });

      expect(applicant.id).toBeDefined();
      expect(applicant.name).toBe("New Applicant");
      expect(applicant.email).toBe(email);

      // Verify DB persistence
      const rows = await db
        .select()
        .from(applicantsTable)
        .where(eq(applicantsTable.id, applicant.id));
      expect(rows).toHaveLength(1);
    });

    it("returns existing applicant if email already exists (normalised)", async () => {
      const email = "STABLE@example.com";
      const a1 = await findOrCreateApplicant({ name: "First", email });
      const a2 = await findOrCreateApplicant({ name: "Second", email: " stable@example.com " });

      expect(a1.id).toBe(a2.id);
      expect(a2.name).toBe("First"); // Original name preserved
    });
  });

  describe("getApplicantById", () => {
    it("returns applicant if it exists", async () => {
      const created = await findOrCreateApplicant({
        name: "Test",
        email: uniqEmail(),
      });
      const found = await getApplicantById(created.id);
      expect(found.id).toBe(created.id);
    });

    it("throws NotFoundError if applicant doesn't exist", async () => {
      await expect(getApplicantById("00000000-0000-0000-0000-000000000000")).rejects.toThrow(NotFoundError);
    });
  });
});
