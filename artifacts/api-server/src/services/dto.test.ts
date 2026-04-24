import { describe, it, expect } from "vitest";
import {
  toApplicationStatusDto,
  toDashboardApplicationDto,
  toJobDto,
  toEventLogDto,
} from "./dto";
import type { Application, Applicant, Job, EventLog } from "@workspace/db";

describe("DTO Mappers", () => {
  const mockDate = new Date("2026-04-24T12:00:00Z");
  const mockApplicant: Applicant = {
    id: "app-123",
    name: "Alice",
    email: "alice@example.com",
    passwordHash: "hash",
    createdAt: mockDate,
  };

  const mockApplication: Application = {
    id: "ap-456",
    jobId: "job-789",
    applicantId: mockApplicant.id,
    state: "ACTIVE",
    queuePosition: null,
    ackDeadline: mockDate,
    acknowledgedAt: null,
    decayCount: 1,
    createdAt: mockDate,
    updatedAt: mockDate,
  };

  describe("toApplicationStatusDto", () => {
    it("maps application and applicant correctly to ApplicationStatusDto", () => {
      const dto = toApplicationStatusDto(mockApplication, mockApplicant);
      expect(dto).toEqual({
        id: "ap-456",
        jobId: "job-789",
        applicantName: "Alice",
        applicantEmail: "alice@example.com",
        state: "ACTIVE",
        queuePosition: null,
        ackDeadline: "2026-04-24T12:00:00.000Z",
        acknowledgedAt: null,
        decayCount: 1,
        createdAt: "2026-04-24T12:00:00.000Z",
      });
    });

    it("handles null dates correctly", () => {
      const waitlistedApp = { ...mockApplication, ackDeadline: null };
      const dto = toApplicationStatusDto(waitlistedApp, mockApplicant);
      expect(dto.ackDeadline).toBeNull();
    });
  });

  describe("toDashboardApplicationDto", () => {
    it("maps correctly for dashboard view", () => {
      const dto = toDashboardApplicationDto(mockApplication, mockApplicant);
      expect(dto).toEqual({
        id: "ap-456",
        applicantName: "Alice",
        applicantEmail: "alice@example.com",
        state: "ACTIVE",
        queuePosition: null,
        ackDeadline: "2026-04-24T12:00:00.000Z",
        acknowledgedAt: null,
        decayCount: 1,
        createdAt: "2026-04-24T12:00:00.000Z",
      });
    });
  });

  describe("toJobDto", () => {
    it("maps a Job row correctly", () => {
      const mockJob: Job = {
        id: "job-789",
        companyId: "comp-123",
        title: "Software Engineer",
        capacity: 5,
        decaySeconds: 600,
        createdAt: mockDate,
      };
      const dto = toJobDto(mockJob);
      expect(dto).toEqual({
        id: "job-789",
        title: "Software Engineer",
        capacity: 5,
        decaySeconds: 600,
        createdAt: "2026-04-24T12:00:00.000Z",
      });
    });
  });

  describe("toEventLogDto", () => {
    it("maps EventLog correctly with metadata fallback", () => {
      const mockEvent: EventLog = {
        id: "evt-123",
        applicationId: "ap-456",
        jobId: "job-789",
        eventType: "PROMOTED",
        metadata: { reason: "INITIAL_ADMISSION" },
        createdAt: mockDate,
      };
      const dto = toEventLogDto(mockEvent);
      expect(dto).toEqual({
        id: "evt-123",
        applicationId: "ap-456",
        jobId: "job-789",
        eventType: "PROMOTED",
        metadata: { reason: "INITIAL_ADMISSION" },
        createdAt: "2026-04-24T12:00:00.000Z",
      });
    });

    it("handles null metadata gracefully", () => {
      const mockEventWithoutMeta: EventLog = {
        id: "evt-124",
        applicationId: "ap-456",
        jobId: "job-789",
        eventType: "APPLIED",
        metadata: null,
        createdAt: mockDate,
      };
      const dto = toEventLogDto(mockEventWithoutMeta);
      expect(dto.metadata).toEqual({});
    });
  });
});
