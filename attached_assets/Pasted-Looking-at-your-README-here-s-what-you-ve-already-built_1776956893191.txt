Looking at your README, here's what you've already built:
Done: Core state machine, queue engine with FOR UPDATE locking, decay loop (1s tick), event logs, API routes, OpenAPI-first contract, basic frontend (3 pages), no auth yet, replay endpoint listed as future work, tests listed as future work.
Gaps: Auth (both sides), test suite (+3 bonus at stake), replay endpoint, README completeness.

Here's your prompt:

The core hiring pipeline is fully built and working — state machine, queue engine with PostgreSQL FOR UPDATE locking, decay loop, event logs, all API routes, and the React frontend. Now add the remaining pieces:
1. Authentication — two separate JWT flows
Add bcrypt + jsonwebtoken. Create two auth route groups:

POST /api/company/auth/register and /login — returns JWT with { role: "company", companyId }
POST /api/applicant/auth/register and /login — returns JWT with { role: "applicant", applicantId }

Add passwordHash column to both companies and applicants tables via a Drizzle migration. Add two middleware guards — requireCompany and requireApplicant — that verify the JWT and attach the decoded identity to req. Apply requireCompany to all job management and applicant removal routes. Apply requireApplicant to apply, withdraw, and acknowledge routes. Enforce ownership checks: a company can only manage their own jobs, an applicant can only act on their own applications — throw ForbiddenError (403) otherwise. Add login/register forms to both the company dashboard and applicant views in the frontend. Store the JWT in memory (React state or a context), attach it as Authorization: Bearer on every API call via the React Query client.
2. Replay endpoint
Implement GET /api/jobs/:jobId/replay?asOf=ISO8601 — query audit_logs for all events on this job where createdAt <= asOf, replay them in order, and return the reconstructed pipeline state: which applications were ACTIVE, WAITLISTED, PENDING_ACKNOWLEDGMENT, or INACTIVE at that moment. This is pure log replay — no current DB state involved.
3. Test suite — Vitest
Write these suites:

stateMachine.test.ts — every valid transition passes, every invalid transition throws InvalidTransitionError
queueEngine.test.ts — applyToJob, withdrawApplication, acknowledgePromotion with mocked DB layer
concurrency.test.ts — two simultaneous applies for the last slot, capacity boundary enforcement, state machine rejection of illegal concurrent transitions
decayLoop.test.ts — expired PENDING_ACKNOWLEDGMENT triggers decay, cascade promotes next in queue, idempotency (already-decayed row is a no-op)
auth.test.ts — JWT generation and verification, requireCompany rejects applicant token, requireApplicant rejects company token, missing token returns 401
errorHandler.test.ts — each error class maps to correct HTTP status, PostgreSQL constraint code 23505 maps to ConflictError

Document in README: concurrency tests mock the DB and validate application-level logic; true lock acquisition requires integration tests with Promise.all against a live test DB — listed as a known future improvement.
4. README additions
Add these sections to the existing README:

ASCII architecture diagram
State machine diagram with all transitions and invariants
Concurrency section: exactly why SELECT … FROM jobs FOR UPDATE on the parent row, and what silently breaks without it (both transactions read stale activeCount, both insert ACTIVE, capacity invariant violated with no DB constraint to catch it)
Decay section: 1s tick, back-of-queue penalty, cascade via promoteUntilFull, why polling over pg_notify (restart-safe, no missed ticks, no DB extension dependency)
Frontend polling rationale: why not WebSockets (human-scale latency, reconnect complexity not justified, countdown driven client-side from ackDeadline)
Tradeoffs table covering: concurrency strategy, decay trigger mechanism, frontend update strategy, queue reindex approach
Known limitations: single-process scheduler, no pagination on event log, no rate limiting on apply endpoint
Future improvements: distributed worker with pg_advisory_lock, integration concurrency tests, email notifications on promotion, configurable ack window per job

Do not change any existing queue engine, state machine, decay loop, or route logic — only add auth on top of existing routes, add the replay endpoint, add tests, and expand the README.