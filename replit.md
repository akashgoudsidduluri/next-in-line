# Hiring Pipeline

## Overview

Internal hiring pipeline tool — deterministic state machine with bounded active queue,
ordered waitlist, automatic promotion + cascading decay, and full event-sourced audit log.
See README.md for architecture, concurrency strategy, and design rationale.

Artifacts:
- `artifacts/api-server` — Express 5 API; queue engine in `src/services/queueEngine.ts`,
  internal decay scheduler in `src/scheduler/decayLoop.ts`.
- `artifacts/pipeline` — React + Vite frontend (recruiter dashboard + applicant view).

## Stack

- **Monorepo tool**: pnpm workspaces
- **Node.js version**: 24
- **Package manager**: pnpm
- **TypeScript version**: 5.9
- **API framework**: Express 5
- **Database**: PostgreSQL + Drizzle ORM
- **Validation**: Zod (`zod/v4`), `drizzle-zod`
- **API codegen**: Orval (from OpenAPI spec)
- **Build**: esbuild (CJS bundle)

## Key Commands

- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- `pnpm --filter @workspace/api-server run dev` — run API server locally

See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details.
