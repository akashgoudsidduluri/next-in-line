import * as zod from "zod";

/**
 * Schema for ReplayJob query parameters.
 */
export const ReplayJobQuery = zod.object({
  asOf: zod.preprocess((arg) => {
    if (typeof arg === "string" || arg instanceof Date) return new Date(arg);
    return arg;
  }, zod.date({
    invalid_type_error: "asOf must be a valid ISO8601 timestamp",
    required_error: "asOf is required"
  }))
});

/**
 * Generic Params schema for routes with :jobId
 */
export const JobIdParams = zod.object({
  jobId: zod.string().uuid({ message: "jobId must be a valid UUID" }),
});

/**
 * Generic Params schema for routes with :applicationId
 */
export const ApplicationIdParams = zod.object({
  applicationId: zod.string().uuid({ message: "applicationId must be a valid UUID" }),
});
