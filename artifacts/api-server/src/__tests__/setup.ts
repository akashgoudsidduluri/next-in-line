/**
 * Test setup — ensures SESSION_SECRET is set for JWT tests.
 * DB-backed tests use the configured DATABASE_URL with table truncation
 * between cases (see resetDb.ts). In CI you would point DATABASE_URL at
 * a dedicated test database.
 */
process.env["SESSION_SECRET"] ??= "test-secret-please-change";
process.env["NODE_ENV"] ??= "test";
