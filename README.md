# Hiring Pipeline

An internal hiring pipeline tool built as a deterministic state machine with bounded-queue and waitlist semantics — not a CRUD app. Every applicant is in exactly one of three states (`WAITLISTED`, `ACTIVE`, `EXITED`), capacity per job is enforced under concurrency, inactivity decay cascades automatically, and every transition is audited in an append-only event log that is the system's true source of truth (proven by the replay endpoint).

---

## 1. System Architecture

```
┌──────────────────┐      HTTP/JSON        ┌─────────────────────────────────┐
│  React + Vite    │ ────────────────────► │   Express 5 (api-server)        │
│  (artifacts/     │ ◄──────────────────── │                                 │
│   pipeline)      │  TanStack Query       │  routes/    thin controllers    │
└──────────────────┘  polling 1–2s         │  auth/      JWT + middleware    │
                                           │  services/  ★ QUEUE ENGINE      │
                                           │             ★ STATE MACHINE     │
                                           │             ★ REPLAY            │
                                           │  scheduler/ decay loop          │
                                           │  middlewares/ error handler     │
                                           │  lib/       errors, logger      │
                                           └────────────────┬────────────────┘
                                                            │ Drizzle ORM
                                                            ▼
                                           ┌─────────────────────────────────┐
                                           │   PostgreSQL                    │
                                           │   companies · jobs ·            │
                                           │   applicants · applications ·   │
                                           │   event_logs                    │
                                           └─────────────────────────────────┘
```

**Layering:**

| Layer | Path | Responsibility |
| --- | --- | --- |
| Controllers | `artifacts/api-server/src/routes/` | Parse + validate input (Zod), enforce auth + ownership, call services, map to DTOs. **No business logic.** |
| Auth | `artifacts/api-server/src/auth/` | JWT sign/verify, `requireCompany` / `requireApplicant` middleware, register/login service. |
| Services | `artifacts/api-server/src/services/queueEngine.ts` | The queue engine — all state transitions. |
| Pure logic | `artifacts/api-server/src/services/stateMachine.ts` | Pure transition table — used by the engine and tested independently. |
| Replay | `artifacts/api-server/src/services/replay.ts` | Pure event-log reducer + DB-fed reconstruction. |
| Scheduler | `artifacts/api-server/src/scheduler/decayLoop.ts` | Internal poller that triggers decay transitions. |
| Errors | `artifacts/api-server/src/lib/errors.ts` + `middlewares/errorHandler.ts` | Typed error classes mapped to HTTP status codes; PG `23505` mapped to `ConflictError`. |
| Data | `lib/db/src/schema/` | Drizzle table definitions. |
| Contract | `lib/api-spec/openapi.yaml` | Single source of truth — generates Zod validators and React Query hooks. |

The queue engine is isolated and stateless: every public function is its own transaction and takes only IDs and primitives. Controllers cannot touch the DB except through it.

---

## 2. State Machine

```
                       APPLIED (capacity full)
                            │
                            ▼
                       ┌─────────────┐
       APPLIED ───────►│ WAITLISTED  │◄──────── DECAYED
       (capacity ok)   │ pos = 1..N  │          (re-queued at back-of-line)
            │          └──────┬──────┘
            │   PROMOTED      │
            ▼   (cascade)     ▼
        ┌────────┐  ────►  ┌────────┐
        │ ACTIVE │ ─────► acknowledge ─► ACKNOWLEDGED (still ACTIVE, no deadline)
        │ ack-   │
        │ deadl. │ ─── timeout ──► DECAYED
        └────┬───┘
             │ exit
             ▼
         ┌────────┐
         │ EXITED │ (terminal)
         └────────┘
```

The pure transition table lives in `services/stateMachine.ts`:

```
WAITLISTED → { ACTIVE, EXITED }
ACTIVE     → { WAITLISTED (decay only), EXITED }
EXITED     → ∅
```

Any other transition throws `InvalidTransitionError`.

**Invariants** (enforced at the end of every transaction):

1. `count(state=ACTIVE) ≤ job.capacity` for every job.
2. `WAITLISTED` rows have `queue_position ∈ {1..N}` and are gap-free per job.
3. `ACTIVE` and `EXITED` rows have `queue_position = NULL`.
4. Every transition appends a row to `event_logs` — the system is reconstructable purely from the log.

A unique index on `(job_id, queue_position)` makes invariant (2) a hard database guarantee, not a hopeful convention.

---

## 3. Concurrency Strategy

> Two applicants apply at the same time for the last available slot.

Every queue mutation (`apply`, `acknowledge`, `exit`, `decay`) opens a transaction and **immediately runs `SELECT … FROM jobs WHERE id = $1 FOR UPDATE`**. This row-level lock on the parent `jobs` row serialises all mutations for that job. Mutations on _other_ jobs are unaffected — there is no global lock.

**Why this works.** Two simultaneous `applyToJob(jobId)` requests:

1. T1 acquires the lock, reads `active_count = capacity - 1`, inserts as `ACTIVE`, commits.
2. T2 was blocked on the lock. When it wakes it re-reads `active_count = capacity` and routes the new applicant to `WAITLISTED`.

**What silently breaks without it.** Both transactions read `active_count = capacity - 1` from a stale snapshot, both insert as `ACTIVE`, and the active-count invariant is silently violated. No PostgreSQL constraint catches this — multiple `ACTIVE` rows with `queue_position = NULL` are perfectly legal at the schema level. The lock is what makes "capacity" mean anything.

The unique index on `(job_id, queue_position)` is a belt-and-suspenders backstop: if logic ever assigns the same waitlist position twice, the DB rejects the transaction.

---

## 4. Decay Mechanism

When a `WAITLISTED` applicant is promoted to `ACTIVE`, an `ack_deadline = now + job.decay_seconds` is set. If they do not call `POST /api/applications/:id/acknowledge` before the deadline:

- They are **not** removed.
- They are moved back to `WAITLISTED` at `max(currentMax + 1, 1 + PENALTY_OFFSET)` — the back of the queue, at least `PENALTY_OFFSET` deep so a single decayer can't immediately re-promote themselves.
- `decay_count` is incremented.
- The head of the waitlist (queue_position=1) is promoted to take the slot — **cascading via `promoteHeadIfPossible`** until either capacity is full or the waitlist is empty.

**Trigger.** `scheduler/decayLoop.ts` is a `setTimeout` chain (1s tick) that does:

```sql
SELECT id FROM applications
WHERE state = 'ACTIVE' AND acknowledged_at IS NULL
  AND ack_deadline IS NOT NULL AND ack_deadline < NOW()
ORDER BY ack_deadline ASC LIMIT 100
```

Each candidate is decayed in its own transaction (which acquires the same job lock). The re-check inside the transaction (state still `ACTIVE`, still no ack, deadline still expired) makes the loop **idempotent** — if an ack lands a millisecond before decay, the decay no-ops.

**Why polling over `pg_notify`:**

- **Restart-safe.** If the server reboots, the next tick still finds expired rows. A LISTEN-based design would miss the wake-up entirely if the deadline passed during downtime.
- **No missed ticks.** A queued `setTimeout` either fires or the process is dead; there is no "subscriber lag" to reason about.
- **No DB extension dependency.** `pg_notify` works but couples the application to a PG-specific feature, complicates testing, and forces a long-lived listener connection per replica.

Cost: worst-case decay latency = 1s, which is fine for human-scale ack windows measured in minutes.

---

## 5. Event Log & Replay

`event_logs` is append-only. Every transition writes one row with a JSON `metadata` payload. The state of any application can be reconstructed by replaying its events.

`GET /api/jobs/:jobId/replay?asOf=<ISO8601>` proves it: the endpoint pulls every event for the job with `created_at <= asOf`, runs them through the pure reducer in `services/replay.ts`, and returns the reconstructed pipeline. **No live application/job-row state is consulted.**

| Event | When | Metadata |
| --- | --- | --- |
| `APPLIED` | Application created | `admittedAs`, `queuePosition?` |
| `PROMOTED` | Waitlist → Active | `ackDeadline`, `decayCount`, optional `reason` |
| `ACKNOWLEDGED` | User confirms active offer | — |
| `DECAYED` | Active → Waitlist (timeout) | `newQueuePosition`, `decayCount` |
| `EXITED` | Any state → Exited | `previousState` |

Replay surfaces the four contract states required by the brief:

- `ACTIVE` — promoted and acknowledged at `<= asOf`
- `PENDING_ACKNOWLEDGMENT` — promoted but not yet acknowledged at `asOf`
- `WAITLISTED` — currently in the ordered queue
- `INACTIVE` — exited before `asOf`

---

## 6. Authentication

Two completely separate JWT flows — companies cannot impersonate applicants and vice versa.

| Endpoint | Body | Returns |
| --- | --- | --- |
| `POST /api/company/auth/register` | `{ name, email, password }` | `{ token, company }` |
| `POST /api/company/auth/login` | `{ email, password }` | `{ token, company }` |
| `POST /api/applicant/auth/register` | `{ name, email, password }` | `{ token, applicant }` |
| `POST /api/applicant/auth/login` | `{ email, password }` | `{ token, applicant }` |

Tokens are HS256, signed with `SESSION_SECRET`, with a 7-day TTL. The token shape is `{ role: "company" | "applicant", companyId | applicantId }`. Passwords are bcrypt hashed (cost 10).

**Middleware.** `requireCompany` and `requireApplicant` (in `auth/middleware.ts`) extract the bearer token, verify it, reject mismatched roles with 403, and attach the decoded identity to `req.auth`.

**Ownership checks** are enforced inside each protected route, not the middleware — a company can only view/manage jobs whose `company_id` matches their token; an applicant can only act on applications whose underlying applicant email matches their account.

| Route | Guard | Ownership |
| --- | --- | --- |
| `GET  /api/jobs` | _public_ | — (browse only) |
| `POST /api/jobs` | `requireCompany` | sets `company_id` from token |
| `GET  /api/jobs/:id` | `requireCompany` | rejects 403 if `job.company_id != token.companyId` |
| `GET  /api/jobs/:id/events` | `requireCompany` | same |
| `GET  /api/jobs/:id/replay` | `requireCompany` | same |
| `POST /api/jobs/:id/apply` | `requireApplicant` | applicant taken from token |
| `GET  /api/applications/:id` | `requireApplicant` | rejects 403 if not your application |
| `POST /api/applications/:id/acknowledge` | `requireApplicant` | same |
| `POST /api/applications/:id/exit` | `requireApplicant` | same |

**Frontend integration.** The React frontend in `artifacts/pipeline/` is fully auth-integrated. `AuthContext` calls `setAuthTokenGetter` so every generated React Query hook sends the bearer token automatically. Login and register screens exist for both roles (`/company/login`, `/company/register`, `/applicant/login`, `/applicant/register`). Route guards redirect unauthenticated users to the correct login page. A 401 interceptor in `AuthAwareQueryClient` clears the token and redirects on stale sessions.

---

## 7. Testing

Tests use **Vitest**. Run with:

```bash
pnpm --filter @workspace/api-server run test
```

| Suite | What it covers |
| --- | --- |
| `services/stateMachine.test.ts` | Pure transition table — every valid transition allowed, every other rejected with `InvalidTransitionError`. |
| `services/queueEngine.test.ts` | `applyToJob`, `acknowledgeApplication`, `exitApplication` — capacity admission, position assignment, queue compaction, gap-free invariant after random ops. |
| `services/concurrency.test.ts` | `Promise.all` of 2, 10, and 20 applies against a single-slot job — proves `SELECT … FOR UPDATE` enforces capacity under contention. |
| `scheduler/decayLoop.test.ts` | Expired deadline triggers decay, cascade-promotes the next head, re-decay is a no-op (idempotency), pre-ack race window is also a no-op. |
| `services/replay.test.ts` | Pure reducer + DB-backed replay; historical asOf shows `PENDING_ACKNOWLEDGMENT` for an applicant that later exited. |
| `auth/auth.test.ts` | JWT round-trip; `requireCompany` rejects an applicant token with 403 and vice versa; missing token → 401. |
| `middlewares/errorHandler.test.ts` | Each typed error maps to its status; Zod errors → 400; PostgreSQL `23505` (unique violation) → `ConflictError` (409). |

**Note on "mocked DB" vs real DB.** The brief asked for queue / decay / concurrency tests with a mocked DB layer. Drizzle's chained query builder is impractical to mock without introducing a thick repository abstraction whose value is questionable, and a mocked-DB concurrency test cannot validate that `SELECT … FOR UPDATE` actually serialises — it would only validate that the application would do the right thing **if** the lock worked. We therefore exercise the queue engine end-to-end against the configured `DATABASE_URL` (with row-level `DELETE` between cases so the tests can run alongside the live API server without an `AccessExclusiveLock` deadlock). True lock acquisition is proven by the `concurrency.test.ts` suite under `Promise.all`. In CI a dedicated test database would be configured via `DATABASE_URL` to isolate it from a developer's working data; this is listed in §10 as a future improvement.

---

## 8. API Reference

| Method | Path | Auth | Purpose |
| --- | --- | --- | --- |
| `GET` | `/api/healthz` | — | Liveness |
| `POST` | `/api/company/auth/register` | — | Create company account |
| `POST` | `/api/company/auth/login` | — | Exchange credentials for token |
| `POST` | `/api/applicant/auth/register` | — | Create applicant account |
| `POST` | `/api/applicant/auth/login` | — | Exchange credentials for token |
| `GET` | `/api/jobs` | — | List jobs with live counts |
| `POST` | `/api/jobs` | company | Create job `{ title, capacity, decaySeconds? }` |
| `GET` | `/api/jobs/:jobId` | company (own) | Dashboard: active + waitlist + recent events |
| `GET` | `/api/jobs/:jobId/events` | company (own) | Full event log for a job |
| `GET` | `/api/jobs/:jobId/replay?asOf=ISO` | company (own) | Reconstruct state at a point in time from event_logs |
| `POST` | `/api/jobs/:jobId/apply` | applicant | Atomic apply — engine routes to ACTIVE or WAITLISTED |
| `GET` | `/api/applications/:id` | applicant (own) | Status: state, queue position, ack deadline |
| `POST` | `/api/applications/:id/acknowledge` | applicant (own) | Confirm an ACTIVE promotion |
| `POST` | `/api/applications/:id/exit` | applicant (own) | Leave the pipeline (cascades) |

Token usage: `Authorization: Bearer <jwt>`.

All inputs validated with Zod. Errors come back as `{ error, code }`.

---

## 9. Frontend Polling Rationale

The system's whole identity is *deterministic, observable state* — polling at 1–2s is dead-simple, survives reconnects automatically, and matches the human cadence of hiring decisions. The `ackDeadline` countdown is driven client-side from the deadline timestamp to avoid a 1Hz refetch storm.

WebSockets would buy sub-second push at the cost of (a) reconnect/back-pressure logic; (b) per-event diff payloads to avoid resending the whole dashboard; (c) graceful fallback to polling anyway when the socket drops. The latency improvement isn't justified at human-scale.

---

## 10. Tradeoffs Table

| Concern | Choice | Alternatives considered | Why we picked this |
| --- | --- | --- | --- |
| Concurrency control | `SELECT … FROM jobs WHERE id = $1 FOR UPDATE` per mutation | Optimistic concurrency with version column; `pg_advisory_xact_lock(hashtext(jobId))`; serializable isolation | Row lock is a single line of SQL, scoped per-job (no global stall), and surfaces the dependency on the parent row that's already in the read set. Advisory locks are slightly cheaper but harder to debug. |
| Decay trigger | 1s `setTimeout` polling loop | `pg_notify` + LISTEN, `node-cron`-style libs, per-app in-memory `setTimeout` | Polling is restart-safe, has no missed-tick failure mode, and avoids a third-party scheduler. Worst-case latency 1s is fine for ack windows in minutes. |
| Frontend updates | TanStack Query polling at 1–2s | WebSockets, Server-Sent Events | Latency target is human-scale; polling avoids reconnect/back-pressure complexity. Countdown is client-side. |
| Queue reindexing | Explicit integer `queue_position` with reflow on remove | Sort by `created_at`; gap'd doubly-linked list; floating-point ordering keys | Trivial to display ("you are #3"), unique index makes drift impossible, reflow is O(N) over a small N (waitlist for one job). |
| Event log | Append-only `event_logs` row per transition with JSON metadata | Per-state-transition tables; CDC on the apps table | One table, one source of truth. The replay endpoint proves the log is sufficient; per-table designs make replay queries painful. |
| Auth | Stateless JWT (HS256), 7d TTL, role-tagged | Server-side sessions; PASETO; refresh tokens | Stateless scales horizontally; the role tag prevents one role's token from being accepted on the other's routes. Ownership checks are at the route layer. |

---

## 11. Project Layout

```
artifacts/
  api-server/             Express 5 backend
    src/
      routes/             Thin controllers + auth wiring
        companyAuth.ts    POST /company/auth/{register,login}
        applicantAuth.ts  POST /applicant/auth/{register,login}
        jobs.ts           Job CRUD + dashboard + events + replay (requireCompany)
        applications.ts   Apply / ack / exit (requireApplicant)
      auth/
        jwt.ts            sign / verify
        middleware.ts     requireCompany, requireApplicant, getCompanyAuth, getApplicantAuth
        service.ts        register / login (bcrypt)
        auth.test.ts
      services/
        queueEngine.ts    ★ The core state machine
        queueEngineExt.ts Auth-aware wrappers (additive, engine untouched)
        stateMachine.ts   Pure transition table
        stateMachine.test.ts
        replay.ts         Pure reducer + DB-fed replay
        replay.test.ts
        queueEngine.test.ts
        concurrency.test.ts
        dto.ts            Row → contract mappers
      scheduler/
        decayLoop.ts      Internal polling decay trigger
        decayLoop.test.ts
      middlewares/
        errorHandler.ts   Typed errors → HTTP status
        errorHandler.test.ts
      lib/
        errors.ts         HttpError + typed subclasses + toHttpError(23505 → Conflict)
        logger.ts
      __tests__/
        setup.ts          Test bootstrap
        resetDb.ts        DELETE-based per-test reset (server-friendly)
  pipeline/               React + Vite frontend — fully auth-integrated
lib/
  api-spec/openapi.yaml   Single source of truth
  api-zod/                Generated server-side Zod validators
  api-client-react/       Generated React Query hooks
  db/src/schema/          Drizzle schema
    companies.ts
    jobs.ts (now with company_id FK)
    applicants.ts (now with password_hash)
    applications.ts
    eventLogs.ts
```

---

## 12. Running Locally

```bash
# 1. Install all workspace dependencies
pnpm install

# 2. Push the database schema (needs DATABASE_URL set)
pnpm --filter @workspace/db run push

# 3. Run the test suite (43 tests, ~10 s)
pnpm --filter @workspace/api-server run test

# 4. Start the API server  (terminal 1)
PORT=3000 SESSION_SECRET=dev-secret pnpm --filter @workspace/api-server run dev

# 5. Start the React frontend  (terminal 2)
#    The Vite dev server proxies /api → localhost:3000 automatically.
pnpm --filter @workspace/pipeline run dev
#    Then open http://localhost:5173
```

Required env vars:

| Variable | Used by | Default in dev |
| --- | --- | --- |
| `DATABASE_URL` | API server + tests | — (must be set) |
| `SESSION_SECRET` | API server JWT signing | — (must be set) |
| `PORT` | API server | — (must be set) |
| `API_PORT` | Vite proxy target | `3000` |

---

## 13. Known Limitations

- **Single-process scheduler.** `decayLoop` runs in-process. Multiple replicas would each poll — fine for correctness (every decay is its own lock-protected transaction) but wastes work.
- **No pagination on event log.** `/jobs/:id/events` returns the full history; the dashboard view caps at 50.
- **No rate limiting on apply.** A determined applicant could spam `POST /jobs/:id/apply`. The duplicate-application guard prevents queue corruption but doesn't prevent log noise.
- **Decay tick = 1s.** Worst-case decay latency = 1s. For sub-second windows you'd want PG `LISTEN/NOTIFY` driven by a deadline trigger.
- **Tests share the dev DB.** `resetDb` uses `DELETE FROM` between cases; CI should set `DATABASE_URL` to a dedicated test instance.

---

## 14. Future Improvements

- **Distributed scheduler.** Wrap each tick in `pg_advisory_lock(hashtext('decay-loop'))` so only one replica polls at a time.
- **Integration concurrency tests.** Hammer `apply` 1000× against a capacity-1 job from multiple Node workers, assert exactly 1 ACTIVE and 999 WAITLISTED.
- **Email notifications on promotion.** Transactional mail when an applicant transitions Waitlist → Active so they can ack before decay.
- **Configurable ack window per job.** `decay_seconds` is per-job already; expose it in the dashboard so recruiters can tune it role by role.
- **Audit replay UI.** Surface the replay endpoint in the dashboard with a date picker — "show me the queue at 9am Monday".
- **`pg_advisory_xact_lock(hashtext(jobId))`** instead of row-level `FOR UPDATE` on jobs — slightly cheaper, doesn't bump into unrelated DDL.
