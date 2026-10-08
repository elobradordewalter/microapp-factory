# MicroForge

50 browser utilities and a shared credit API. Node 20+; `npm test` runs catalog, security, HTTP and adapter tests.

## Billing release gate

Paid checkout and signed credit grants stay disabled until Supabase is configured and `PERSISTENCE_VERIFIED=true`. This flag must only be set after a deployed end-to-end test and persistence/restart check. Redis and local files remain legacy compatibility paths; they cannot enable billing.

Server-only variables: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `PADDLE_WEBHOOK_SECRET`, `ADMIN_TOKEN`. Public Paddle configuration uses `PADDLE_CLIENT_TOKEN` and `PADDLE_PRICE_MINI/BASIC/PRO/MONTHLY`; environment is `PADDLE_ENV`. Never place database credentials in browser code.

`db/schema.sql` is a draft deployment schema, not a record of a remote migration. It defines nine private, RLS-enabled tables and service-role-only invoker RPC functions. Payment, transaction/event deduplication, ledger and purchase analytics commit in one database transaction. API debit, ledger and usage analytics also commit together. Existing live users/balances must be inventoried and migrated before switching storage.

## Validation

- `npm test`: 230 automated tests at validation time, including all 50 tool fixtures.
- `scripts/validate-postgres.mjs`: isolated PostgreSQL/PGlite schema and signed HTTP payment-to-API integration. Install `@electric-sql/pglite` only in a developer scratch environment; set `PGLITE_MODULE` to its module path. It is not a production dependency.
- The isolated database tests verify account creation, zero balance, signed simulated webhook, 300-credit grant, one-credit API debit, ledger, event/transaction deduplication, analytics, negative API cases and role privileges. They do not prove Paddle LIVE delivery or remote Supabase persistence.
- Remote Supabase project, advisors, live domain approval, subscription lifecycle/refunds and restart persistence require verification before billing is released.

Public discovery: `/api/tools`, `/openapi.json`, `/llms.txt`, `/api-docs`, `/robots.txt`, `/sitemap.xml`. Tool pages support `/tools/{slug}` and existing `/{slug}` paths.

Render's primary services unpack `source.part*` during builds. Update these archives with source changes until the build commands are migrated; otherwise deployed source diverges from repository files.

No production load test or sales claim is made. Analytics' latest-event view is bounded to 10,000 events; purchase revenue is summed from durable purchases by currency. No MRR or retention claim is currently supported.

The prior `supabase/migrations/001_microforge.sql` is retained for review of concurrent work; its anon-key/shared-secret architecture is superseded by the private service-role schema in `db/schema.sql`. Do not apply both schemas to one project. Existing accounts from legacy `runtime/store.json` are read for compatibility; inventory both legacy paths before any remote migration.

API engines run in bounded workers (two-second timeout, eight concurrent executions, per-worker heap limits) to isolate expensive regex/input processing. This is an execution safeguard, not a production capacity measurement.
