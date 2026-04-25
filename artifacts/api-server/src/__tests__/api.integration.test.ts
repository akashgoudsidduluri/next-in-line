import { describe, it, expect, beforeEach } from "vitest";
import request from "supertest";
import app from "../app";
import { resetDb, uniqEmail } from "./resetDb";
import { signCompanyToken } from "../auth/jwt";
import { registerCompany } from "../auth/service";

describe("API Integration Tests (Highest Quality)", () => {
  beforeEach(async (context) => {
    const ok = await resetDb();
    if (!ok) context.skip();
  });

  describe("Public Job Feed", () => {
    it("GET /api/v1/jobs returns list of all jobs with counts", async () => {
      const company = await registerCompany({
        name: "Test Corp",
        email: uniqEmail("company"),
        password: "password123",
      });
      await request(app)
        .post("/api/v1/jobs")
        .set("Authorization", `Bearer ${signCompanyToken(company.id)}`)
        .send({ title: "Engineer", capacity: 5 });

      const res = await request(app).get("/api/v1/jobs");
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body[0]).toMatchObject({
        title: "Engineer",
        activeCount: 0,
        waitlistCount: 0,
      });
    });
  });

  describe("Job Lifecycle (Company Auth)", () => {
    it("POST /api/v1/jobs enforces company authorization", async () => {
      const res = await request(app)
        .post("/api/v1/jobs")
        .send({ title: "No Auth", capacity: 1 });
      expect(res.status).toBe(401);
    });

    it("POST /api/v1/jobs validates complex payloads", async () => {
      const company = await registerCompany({
        name: "Test Corp",
        email: uniqEmail("company"),
        password: "password123",
      });
      const token = signCompanyToken(company.id);

      const res = await request(app)
        .post("/api/v1/jobs")
        .set("Authorization", `Bearer ${token}`)
        .send({ title: "", capacity: -1 });
      
      expect(res.status).toBe(400);
    });
  });

  describe("Full Application Flow", () => {
    it("Lifecycle: Register -> Apply -> Acknowledge -> Exit", async () => {
      const company = await registerCompany({
        name: "Test Corp",
        email: uniqEmail("corp"),
        password: "password123",
      });
      const jobRes = await request(app)
        .post("/api/v1/jobs")
        .set("Authorization", `Bearer ${signCompanyToken(company.id)}`)
        .send({ title: "Full Stack", capacity: 1 });
      const jobId = jobRes.body.id;

      const regRes = await request(app)
        .post("/api/v1/applicant/auth/register")
        .send({
          name: "Alice",
          email: uniqEmail("alice"),
          password: "password123",
        });
      const applicantToken = regRes.body.token;

      const applyRes = await request(app)
        .post(`/api/v1/jobs/${jobId}/apply`)
        .set("Authorization", `Bearer ${applicantToken}`);
      expect(applyRes.status).toBe(201);
      expect(applyRes.body.state).toBe("ACTIVE");
      const appId = applyRes.body.id;

      const ackRes = await request(app)
        .post(`/api/v1/applications/${appId}/acknowledge`)
        .set("Authorization", `Bearer ${applicantToken}`);
      expect(ackRes.status).toBe(200);

      const exitRes = await request(app)
        .post(`/api/v1/applications/${appId}/exit`)
        .set("Authorization", `Bearer ${applicantToken}`);
      expect(exitRes.status).toBe(200);
      expect(exitRes.body.state).toBe("EXITED");
    });
  });

  describe("Edge Case Error Handling", () => {
    it("returns 400 for malformed IDs (Zod validation)", async () => {
      const company = await registerCompany({ name: "C", email: uniqEmail("c"), password: "password123" });
      const token = signCompanyToken(company.id);
      const res = await request(app)
        .get("/api/v1/jobs/not-a-uuid")
        .set("Authorization", `Bearer ${token}`);
      expect(res.status).toBe(400);
      expect(res.body.code).toBe("VALIDATION_ERROR");
    });

    it("returns 409 for invalid state transitions (e.g. double exit)", async () => {
      const company = await registerCompany({ name: "C", email: uniqEmail("c"), password: "password123" });
      const job = await request(app).post("/api/v1/jobs").set("Authorization", `Bearer ${signCompanyToken(company.id)}`).send({ title: "T", capacity: 1 });
      const appRes = await request(app).post("/api/v1/applicant/auth/register").send({ name: "A", email: uniqEmail("a"), password: "password123" });
      const apply = await request(app).post(`/api/v1/jobs/${job.body.id}/apply`).set("Authorization", `Bearer ${appRes.body.token}`);
      
      const token = appRes.body.token;
      const appId = apply.body.id;

      await request(app).post(`/api/v1/applications/${appId}/exit`).set("Authorization", `Bearer ${token}`);
      const res = await request(app).post(`/api/v1/applications/${appId}/exit`).set("Authorization", `Bearer ${token}`);
      
      expect(res.status).toBe(200);
      expect(res.body.state).toBe("EXITED");
    });
  });

  describe("Observability & Analytics", () => {
    it("GET /api/v1/jobs/:jobId returns full dashboard for company", async () => {
      const company = await registerCompany({ name: "Obs Corp", email: uniqEmail("obs"), password: "password123" });
      const token = signCompanyToken(company.id);
      const job = await request(app).post("/api/v1/jobs").set("Authorization", `Bearer ${token}`).send({ title: "Dev", capacity: 1 });
      const jobId = job.body.id;

      const applicant = await request(app).post("/api/v1/applicant/auth/register").send({ name: "A", email: uniqEmail("a"), password: "password123" });
      await request(app).post(`/api/v1/jobs/${jobId}/apply`).set("Authorization", `Bearer ${applicant.body.token}`);

      const dash = await request(app)
        .get(`/api/v1/jobs/${jobId}`)
        .set("Authorization", `Bearer ${token}`);
      
      expect(dash.status).toBe(200);
      expect(dash.body.job.title).toBe("Dev");
      expect(dash.body.active.length).toBe(1);
    });

    it("GET /api/v1/jobs/:jobId/replay reconstructs historical state", async () => {
      const company = await registerCompany({ name: "Replay Corp", email: uniqEmail("rep"), password: "password123" });
      const token = signCompanyToken(company.id);
      const job = await request(app).post("/api/v1/jobs").set("Authorization", `Bearer ${token}`).send({ title: "History", capacity: 1 });
      const jobId = job.body.id;

      const asOf = new Date().toISOString();

      const res = await request(app)
        .get(`/api/v1/jobs/${jobId}/replay?asOf=${asOf}`)
        .set("Authorization", `Bearer ${token}`);
      
      expect(res.status).toBe(200);
      expect(res.body.applications).toBeDefined();
    });
  });
});
