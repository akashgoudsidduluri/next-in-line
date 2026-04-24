/**
 * DTO mappers — convert internal DB rows to the API contract shape.
 * Keeping these here means controllers stay thin.
 */

import type {
  Application,
  Applicant,
  Job,
  EventLog,
} from "@workspace/db";

export interface ApplicationStatusDto {
  id: string;
  jobId: string;
  applicantName: string;
  applicantEmail: string;
  state: "WAITLISTED" | "ACTIVE" | "EXITED";
  queuePosition: number | null;
  ackDeadline: string | null;
  acknowledgedAt: string | null;
  decayCount: number;
  createdAt: string;
}

export function toApplicationStatusDto(
  app: Application,
  applicant: Applicant,
): ApplicationStatusDto {
  return {
    id: app.id,
    jobId: app.jobId,
    applicantName: applicant.name,
    applicantEmail: applicant.email,
    state: app.state,
    queuePosition: app.queuePosition,
    ackDeadline: app.ackDeadline ? app.ackDeadline.toISOString() : null,
    acknowledgedAt: app.acknowledgedAt
      ? app.acknowledgedAt.toISOString()
      : null,
    decayCount: app.decayCount,
    createdAt: app.createdAt.toISOString(),
  };
}

export interface DashboardApplicationDto {
  id: string;
  applicantName: string;
  applicantEmail: string;
  state: "WAITLISTED" | "ACTIVE" | "EXITED";
  queuePosition: number | null;
  ackDeadline: string | null;
  acknowledgedAt: string | null;
  decayCount: number;
  createdAt: string;
}

export function toDashboardApplicationDto(
  app: Application,
  applicant: Applicant,
): DashboardApplicationDto {
  return {
    id: app.id,
    applicantName: applicant.name,
    applicantEmail: applicant.email,
    state: app.state,
    queuePosition: app.queuePosition,
    ackDeadline: app.ackDeadline ? app.ackDeadline.toISOString() : null,
    acknowledgedAt: app.acknowledgedAt
      ? app.acknowledgedAt.toISOString()
      : null,
    decayCount: app.decayCount,
    createdAt: app.createdAt.toISOString(),
  };
}

export interface JobDto {
  id: string;
  title: string;
  capacity: number;
  decaySeconds: number;
  createdAt: string;
}

export function toJobDto(job: Job): JobDto {
  return {
    id: job.id,
    title: job.title,
    capacity: job.capacity,
    decaySeconds: job.decaySeconds,
    createdAt: job.createdAt.toISOString(),
  };
}

export interface EventLogDto {
  id: string;
  applicationId: string;
  jobId: string;
  eventType: "APPLIED" | "PROMOTED" | "ACKNOWLEDGED" | "DECAYED" | "EXITED";
  metadata: Record<string, unknown>;
  createdAt: string;
}

export function toEventLogDto(e: EventLog): EventLogDto {
  return {
    id: e.id,
    applicationId: e.applicationId,
    jobId: e.jobId,
    eventType: e.eventType,
    metadata: (e.metadata as Record<string, unknown>) ?? {},
    createdAt: e.createdAt.toISOString(),
  };
}

export interface DashboardDto {
  job: JobDto & { activeCount: number; waitlistCount: number };
  active: DashboardApplicationDto[];
  waitlist: DashboardApplicationDto[];
  recentEvents: EventLogDto[];
}

export function toDashboardDto(
  job: Job,
  active: { app: Application; applicant: Applicant }[],
  waitlist: { app: Application; applicant: Applicant }[],
  recentEvents: EventLog[],
): DashboardDto {
  return {
    job: {
      ...toJobDto(job),
      activeCount: active.length,
      waitlistCount: waitlist.length,
    },
    active: active.map((a) => toDashboardApplicationDto(a.app, a.applicant)),
    waitlist: waitlist.map((a) => toDashboardApplicationDto(a.app, a.applicant)),
    recentEvents: recentEvents.map(toEventLogDto),
  };
}
