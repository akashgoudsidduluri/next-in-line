import { describe, it, expect, beforeAll } from "vitest";
import request from "supertest";
import app from "../app";
import { resetDb, uniqEmail } from "./resetDb";
import { db, jobsTable, companiesTable } from "@workspace/db";
import { registerCompany } from "../auth/service";
import { signCompanyToken, signApplicantToken } from "../auth/jwt";
import { eq } from "drizzle-orm";

describe("API Integration Tests", () => {
  let companyToken: string;
  let applicantToken: string;
  let applicantId: string;
  let jobId: string;

  beforeAll(async () => {
    await resetDb();

    // Setup Company
    const company = await registerCompany({
      name: "Test Corp",
      email: uniqEmail("company"),
      password: "password123",
    });
    companyToken = signCompanyToken(company.id);

    // Setup Applicant
    const applicantEmail = uniqEmail("applicant");
    const regRes = await request(app)
      .post("/api/applicant/auth/register")
      .send({
        name: "Alice",
        email: applicantEmail,
        password: "password123",
      });
    applicantToken = regRes.body.token;
    applicantId = regRes.body.applicant.id;

    // Create a Job
    const jobRes = await request(app)
      .post("/api/jobs")
      .set("Authorization", `Bearer ${companyToken}`)
      .send({
        title: "Software Engineer",
        capacity: 1,
        decaySeconds: 300,
      });
    jobId = jobRes.body.id;
  });

  it("Full Application Lifecycle: Apply -> Acknowledge -> Exit", async () => {
    // 1. Apply
    const applyRes = await request(app)
      .post(`/api/jobs/${jobId}/apply`)
      .set("Authorization", `Bearer ${applicantToken}`);
    
    expect(applyRes.status).toBe(201);
    expect(applyRes.body.state).toBe("ACTIVE");
    const applicationId = applyRes.body.id;

    // 2. Acknowledge
    const ackRes = await request(app)
      .post(`/api/applications/${applicationId}/acknowledge`)
      .set("Authorization", `Bearer ${applicantToken}`);
    
    expect(ackRes.status).toBe(200);
    expect(ackRes.body.acknowledgedAt).not.toBeNull();

    // 3. Exit
    const exitRes = await request(app)
      .post(`/api/applications/${applicationId}/exit`)
      .set("Authorization", `Bearer ${applicantToken}`);
    
    expect(exitRes.status).toBe(200);
    expect(exitRes.body.state).toBe("EXITED");
  });

  it("Enforces Authorization: Applicant cannot acknowledge another's application", async () => {
    // Create another applicant
    const otherRes = await request(app)
      .post("/api/applicant/auth/register")
      .send({
        name: "Bob",
        email: uniqEmail("other"),
        password: "password123",
      });
    const otherToken = otherRes.body.token;

    // First applicant applies
    const applyRes = await request(app)
      .post(`/api/jobs/${jobId}/apply`)
      .set("Authorization", `Bearer ${applicantToken}`);
    const appId = applyRes.body.id;

    // Other applicant tries to ack
    const ackRes = await request(app)
      .post(`/api/applications/${appId}/acknowledge`)
      .set("Authorization", `Bearer ${otherToken}`);
    
    expect(ackRes.status).toBe(403);
  });
});
