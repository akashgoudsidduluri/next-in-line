import crypto from "crypto";

/**
 * Test setup — ensures secure environment variables are set for tests.
 * We generate dynamic secrets to prevent hardcoded credential leakage
 * and satisfy security scanners while adhering to our own Zod constraints.
 */
process.env["SESSION_SECRET"] ??= crypto.randomBytes(32).toString("hex");
process.env["NODE_ENV"] ??= "test";

// Mock DB URL for non-DB unit tests if needed
process.env["DATABASE_URL"] ??= "postgresql://postgres@localhost:5432/test_db";
