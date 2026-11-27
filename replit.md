# NoteToPlan

A personal productivity workspace that converts messy notes into editable tasks and shows a truthful record of its backend operations.

## Run & Operate

- Managed workflows: `artifacts/notetoplan: web` and `artifacts/api-server: API Server`.
- `pnpm run typecheck` — full workspace TypeScript check.
- `pnpm --filter @workspace/api-server test` — focused processor tests with controlled failure fixtures. Test workspaces are isolated and removed afterward.
- `pnpm run test:notetoplan` is the root alias for the same focused tests.
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API clients and Zod schemas.
- `pnpm --filter @workspace/db run push` — apply additive schema changes in development only.
- `scripts/post-merge.sh` installs locked dependencies and applies the development schema after merge.
- The API uses the existing `DATABASE_URL` and the preconfigured Replit OpenAI integration. Never expose credentials in browser code.

## Product and scope

- Root web dashboard: editable device draft, sample notes, processing, live execution graph/mobile timeline, run history, immutable generated output, editable tasks, and event replay.
- Tasks support title, priority, category, nullable calendar due date, completion/reopening, deletion, and filters.
- Anonymous browser workspaces only. Clearing cookies loses access to that workspace; there is no account recovery or login in this challenge version.
- Notes submitted for processing are sent to OpenAI through Replit AI Integrations; usage is billed to Replit credits.
- Do not add collaboration, integrations, notifications, uploads, recurrence, payments or a native mobile app without a new request.
- Do not publish without separate authorization.

## Where things live

- `artifacts/notetoplan/src` — React dashboard, React Flow diagram, cursor stream and replay controls.
- `lib/api-spec/openapi.yaml` — API contract; generated packages provide typed hooks and validators.
- `lib/db/src/schema` — PostgreSQL/Drizzle tables for workspaces, runs, append-only events and mutable tasks.
- `artifacts/api-server/src/routes/notetoplan.ts` — session ownership and API handlers.
- `artifacts/api-server/src/lib/processor.ts` — leased database queue worker and stage instrumentation.
- `artifacts/api-server/src/lib/planning.ts` — deterministic extraction, date handling and organization.

## Architecture decisions

- **Transparency is operational, not private AI reasoning.** Persist actual operations, safe summaries, attempts and measured timings. Never create fake events or let frontend timers imply backend success.
- **Historical output is independent of editable tasks.** Commit task rows, immutable output, terminal metadata and completion events atomically; later edits/deletion never rewrite history.
- **Replay is read-only.** Use recorded event order and timestamp gaps. Explicit reruns create new linked runs and are the only replay-adjacent action allowed to process notes.
- **Anonymous ownership uses an opaque HTTP-only cookie.** Store its hash, not the token, in PostgreSQL. Scope every run/event/task request to the server-derived workspace. Bootstrap the summary request before parallel first-load queries to prevent cookie initialization races.
- **Preserve submission context when retrying uncertain requests.** Reuse the same idempotency key, notes, parent, timezone and reference date, even if the retry occurs after midnight. Distinguish device draft storage from server persistence.
- **Conservative dates.** Resolve explicit ISO dates, today and tomorrow against the submitted local reference date. Leave ambiguous dates unset rather than guessing.
- **Bounded processing.** Disable SDK retries; record at most two transient retries after the initial call, one schema repair, and at most four AI calls across recovery. Use a 60-second lease, 10-second heartbeat, and at most two lease recoveries. Expired owners cannot commit.

## Gotchas

- Use generated hooks from `@workspace/api-client-react`; hooks return the response directly.
- `@workspace/api-zod` explicitly chooses the generated `GetRunEventsParams` validator over Orval's same-named query interface. Preserve that barrel export after codegen.
- Generated declarations can be stale after shared schema edits; run the root typecheck before leaf checks.
- Failure injection belongs in isolated tests, never public request flags or fake production telemetry.
- Retain the legacy event table and cookie compatibility when editing storage: existing browser workspaces and measured history must stay accessible. Never drop them during schema push.
- Backend tests run with `tsx`, not ad-hoc bundles: Pino's development transport needs its worker files.
- Start services through managed workflows, not manually bound ports. The shared proxy routes `/api` to Express and `/` to Vite.
- Schema pushes belong to development/post-merge setup, never API startup or a production deploy hook.
