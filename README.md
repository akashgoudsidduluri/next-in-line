# Hiring Pipeline

An internal hiring pipeline tool built as a deterministic state machine with bounded-queue and waitlist semantics — not a CRUD app. Every applicant is in exactly one of three states (`WAITLISTED`, `ACTIVE`, `EXITED`), capacity per job is enforced under concurrency, and inactivity decay cascades automatically.

---

## 1. System Architecture

```
┌──────────────────┐      HTTP/JSON       ┌─────────────────────────────┐
│  React + Vite    │ ───────────────────► │   Express 5 (api-server)    │
│  (artifacts/     │ ◄─────────────────── │                             │
│   pipeline)      │  TanStack Query      │  routes/   thin controllers │
└──────────────────┘  polling 1–2s        │  services/ QUEUE ENGINE     │
                                          │  scheduler/ decay loop      │
                                          │  lib/      logger           │
                                          └──────────────┬──────────────┘
                                                         │ Drizzle ORM
                                                         ▼
                                          ┌─────────────────────────────┐
                                          │   PostgreSQL                │
                                          │   jobs · applicants ·       │
                                          │   applications · event_logs │
                                          └─────────────────────────────┘
```

**Layering:**

| Layer | Path | Responsibility |
| --- | --- | --- |
| Controllers | `artifacts/api-server/src/routes/` | Parse + validate input (Zod), call services, map to DTOs. **No business logic.** |
| Services | `artifacts/api-server/src/services/queueEngine.ts` | The queue engine — all state transitions live here. |
| DTOs | `artifacts/api-server/src/services/dto.ts` | Convert DB rows to API contract shape. |
| Scheduler | `artifacts/api-server/src/scheduler/decayLoop.ts` | Internal poller that triggers decay transitions. |
| Data | `lib/db/src/schema/` | Drizzle table definitions (jobs, applicants, applications, event_logs). |
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
       (capacity ok)   │ pos = 1..N  │          (re-queue + penalty)
            │          └──────┬──────┘
            │   PROMOTED      │
            ▼   (cascade)     ▼
        ┌────────┐  ────►  ┌────────┐
        │ ACTIVE │ ─────► acknowledge ─► ACKNOWLEDGED (still ACTIVE)
        │ ack-   │
        │ deadl. │ ─── timeout ──► DECAYED
        └────┬───┘
             │ exit
             ▼
         ┌────────┐
         │ EXITED │ (terminal)
         └────────┘
```

**Invariants** (enforced by every transaction):

1. `count(state=ACTIVE) ≤ job.capacity` for every job.
2. `WAITLISTED` rows have `queue_position ∈ {1..N}` and are gap-free per job.
3. `ACTIVE` and `EXITED` rows have `queue_position = NULL`.
4. Every transition appends a row to `event_logs` — the system is reconstructable purely from the log.

A unique index on `(job_id, queue_position)` makes invariant (2) a hard database guarantee, not a hopeful convention.

---

## 3. Concurrency Strategy

> Two applicants apply at the same time for the last available slot.

Every queue mutation (`apply`, `acknowledge`, `exit`, `decay`) opens a transaction and **immediately runs `SELECT … FROM jobs WHERE id = $1 FOR UPDATE`**. This row-level lock on the parent `jobs` row serialises all queue mutations for that job. Mutations on _other_ jobs are unaffected — there is no global lock.

**Why this works.** Two simultaneous `applyToJob(jobId)` requests:

1. T1 acquires the lock, reads `active_count = capacity - 1`, inserts as `ACTIVE`, commits.
2. T2 was blocked on the lock. When it wakes it re-reads `active_count = capacity` and routes the new applicant to `WAITLISTED`.

**What would break without it.** Both transactions would read `active_count = capacity - 1` from a stale snapshot, both would insert as `ACTIVE`, and the active-count invariant would be silently violated. No PostgreSQL constraint catches this — multiple `ACTIVE` rows with `queue_position = NULL` are perfectly legal at the schema level. The lock is what makes "capacity" mean anything.

The unique index on `(job_id, queue_position)` is a belt-and-suspenders backstop: if logic ever assigns the same waitlist position twice, the DB rejects the transaction.

---

## 4. Decay Mechanism

When a `WAITLISTED` applicant is promoted to `ACTIVE`, an `ack_deadline = now + job.decay_seconds` is set. If they do not call `POST /applications/:id/acknowledge` before the deadline:

- They are **not** removed.
- They are moved back to `WAITLISTED` with `queue_position = max(currentMax + 1, 1 + PENALTY_OFFSET)` — i.e. the back of the queue.
- `decay_count` is incremented.
- The head of the waitlist is promoted to take the slot — **cascading** until either capacity is full or the waitlist is empty.

**Trigger.** `scheduler/decayLoop.ts` is a `setTimeout` chain (1s tick) that does:

```sql
SELECT id FROM applications
WHERE state = 'ACTIVE' AND acknowledged_at IS NULL
  AND ack_deadline IS NOT NULL AND ack_deadline < NOW()
ORDER BY ack_deadline ASC LIMIT 100
```

Each candidate is decayed in its own transaction (which acquires the same job lock). The re-check inside the transaction (state still `ACTIVE`, still no ack, deadline still expired) makes the loop **idempotent** — if an ack lands a millisecond before decay, the decay no-ops.

**Tradeoffs considered:**

| Approach | Why we didn't pick it |
| --- | --- |
| Pure event-driven (e.g. PG `LISTEN/NOTIFY` on a deadline trigger) | No external scheduler, but adds machinery and doesn't survive a missed tick or a server restart. |
| Long-poll with `pg_sleep` | Holds a connection forever; doesn't scale. |
| Cron with a `node-cron` style library | The brief explicitly forbids scheduling libraries. |
| Per-application `setTimeout` in-memory | Lost on server restart; doesn't survive horizontal scale. |

The polling loop is **simple, restart-safe** (it only reads state from PG), and its worst-case latency is one tick (1s) — acceptable for human-scale ack windows measured in minutes.

---

## 5. Queue Design Decisions

- **Explicit `queue_position` column.** Easier to reason about and to display ("you are #3 in line") than reconstructing order from `created_at`. Updates are O(N) but N is tiny (waitlist for one job), and a unique index makes drift impossible.
- **Compaction on remove.** When a `WAITLISTED` applicant exits or gets promoted, positions behind them shift down by 1 inside the same transaction. The waitlist is always gap-free; clients can trust the displayed position.
- **Decay penalty = back-of-queue, with a floor.** Constant `+2` would be cruel to a 50-deep queue and meaningless on an empty one. We push to `max(maxPos + 1, 3)` — strictly behind everyone else, but at least 2 deep so a single decayer can't immediately re-promote themselves into the same slot.

---

## 6. Event Log

`event_logs` is append-only. Every transition writes one row with a JSON `metadata` payload. The state of any application can be reconstructed by replaying its events — useful for audit, debugging, and reasoning about race conditions after the fact.

| Event | When | Metadata |
| --- | --- | --- |
| `APPLIED` | Application created | `admittedAs`, `queuePosition?` |
| `PROMOTED` | Waitlist → Active | `ackDeadline`, `decayCount`, optional `reason` |
| `ACKNOWLEDGED` | User confirms active offer | — |
| `DECAYED` | Active → Waitlist (timeout) | `newQueuePosition`, `decayCount` |
| `EXITED` | Any state → Exited | `previousState` |

---

## 7. API

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/api/healthz` | Liveness |
| `GET` | `/api/jobs` | List jobs with live `activeCount` / `waitlistCount` |
| `POST` | `/api/jobs` | Create job `{ title, capacity, decaySeconds? }` |
| `GET` | `/api/jobs/:jobId` | Full company dashboard (active + waitlist + recent events) |
| `POST` | `/api/jobs/:jobId/apply` | Atomic apply `{ name, email }` → `ApplicationStatus` |
| `GET` | `/api/applications/:id` | Applicant status (state, queue position, ack deadline) |
| `POST` | `/api/applications/:id/acknowledge` | Confirm active promotion |
| `POST` | `/api/applications/:id/exit` | Leave the pipeline (cascades) |
| `GET` | `/api/jobs/:jobId/events` | Full event log for a job |

All inputs validated with generated Zod schemas (`@workspace/api-zod`). All responses match the OpenAPI contract verbatim.

---

## 8. Frontend

Minimal but deliberate React (Vite, wouter, TanStack Query, shadcn/ui). Three surfaces:

- **`/`** — list of jobs with live counts, create-job form.
- **`/jobs/:jobId`** — company dashboard: active panel, ordered waitlist, applicant entry form, recent event stream.
- **`/apply/:applicationId`** — applicant view: current state, queue position, live countdown to deadline, acknowledge / exit buttons.

**Polling, not websockets.** Justification: the system's whole identity is *deterministic, observable state*. Polling at 1–2s is dead-simple, survives reconnects, and matches the human cadence of hiring decisions. Websockets would add machinery for sub-second latency we don't need. The countdown timer is driven client-side from `ackDeadline` to avoid a 1Hz refetch storm.

---

## 9. Project Layout

```
artifacts/
  api-server/             Express 5 backend
    src/
      routes/             Thin controllers
        jobs.ts
        applications.ts
        health.ts
      services/
        queueEngine.ts    ★ The core state machine
        dto.ts            Row → contract mappers
      scheduler/
        decayLoop.ts      Internal polling decay trigger
  pipeline/               React + Vite frontend
    src/
      pages/
        home.tsx
        job-dashboard.tsx
        application.tsx
lib/
  api-spec/openapi.yaml   Single source of truth
  api-zod/                Generated server-side Zod validators
  api-client-react/       Generated React Query hooks
  db/src/schema/          Drizzle schema
    jobs.ts
    applicants.ts
    applications.ts
    eventLogs.ts
```

---

## 10. Running Locally

```bash
pnpm install
pnpm --filter @workspace/db run push           # apply schema
# then start workflows: api-server + pipeline
```

Dev URLs are routed through the shared proxy on port 80 (`/api`, `/`).

---

## 11. Known Limitations

- **Single-writer scheduler.** `decayLoop` runs in-process. If the API runs on N replicas, every replica polls — fine for correctness (every decay is its own transaction, race-safe), but wastes work. A leader election or a `pg_advisory_lock("decay-loop")` would fix it.
- **No authentication.** Applicant IDs are unguessable UUIDs but anyone with the link can act as that applicant. Designed as an internal tool.
- **No pagination on event log.** Recent-events query caps at 50 in the dashboard; full `/jobs/:id/events` returns the full history.
- **Decay tick is 1s.** Worst-case decay latency = 1s. If sub-second decays mattered, switch to PG `LISTEN/NOTIFY` driven by a deadline trigger.
- **Email isn't validated for uniqueness.** A person can apply twice to the same job; treated as two distinct applicants by design (re-applies after exit are explicitly allowed).

---

## 12. What I'd Improve With More Time

- **Tests.** A vitest suite for: (a) two parallel applies for the last slot, (b) decay-then-cascade with three waitlist depths, (c) gap-free invariant after random exit/apply/decay sequences, (d) reconstruction from `event_logs` matches current state.
- **`pg_advisory_xact_lock(hashtext(job_id))`** instead of `SELECT ... FOR UPDATE jobs` — slightly cheaper, doesn't hold a row lock that an unrelated DDL might bump into.
- **Per-job decay tick optimisation.** Skip the poll entirely when the soonest `ack_deadline` is far away (driven by a `min(ack_deadline)` query at startup of each tick).
- **WebSocket push for the dashboard.** Polling is fine; push would feel snappier without changing the model.
- **Audit "replay" endpoint.** `GET /jobs/:id/replay?at=<timestamp>` that reconstructs the full queue state purely from `event_logs` — proof that the log is a true source of truth.
- **Concurrency stress test in CI.** Hammer `apply` 1000× with `Promise.all` on a capacity-1 job, assert exactly one `ACTIVE` and 999 `WAITLISTED`.
