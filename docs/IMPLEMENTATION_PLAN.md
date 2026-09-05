# M2.5 and M3 implementation plan

Goal: preserve the migrated development data, then deliver a mock-only asynchronous monitoring pipeline.

Constraints: D:\dev\geo-platform only; Node 24.20.0 and pnpm 11.1.0; hoisted layout; no paid APIs, push, public deployment, volume deletion or destructive development migrations.

## M2.5

- [ ] Freeze runtime in package.json and .node-version; exclude API tests from the production TypeScript build so the standard start script runs dist/main.js.
- [ ] Preserve geolens; copy existing data into geo_dev and create geo_test. Configure DATABASE_URL / TEST_DATABASE_URL without exposing secrets.
- [ ] Preload a database-name guard before Prisma in verify, seed:test and Jest. Test rejection of absent/unsafe URLs. Clean only test-owned auth fixtures.
- [ ] Record every existing organization and evidence of its source in DATA_HYGIENE.md. Update current path docs and D-014.
- [ ] Clean generated directories, frozen install, generate, build, migration status, triple test seed, verify and auth tests. Compare geo_dev row fingerprints before/after. Start through package scripts and check HTTP health.
- [ ] Commit reviewed existing auth separately from infrastructure changes.

## M3 architecture

Use packages/queue for validated payload/result contracts and queue options; use a plain TypeScript apps/worker process with graceful shutdown. PostgreSQL Run rows are authoritative. API creates task/runs in a transaction, then enqueues deterministic job IDs. A periodic dispatcher republishes pending rows, closing the database/Redis commit gap. Worker writes final state and recalculates progress under a per-task database lock, avoiding duplicate counter increments. BullMQ retries/backoff and stalled-job recovery handle transient failures and worker death. Mock execution has a bounded timeout and supports deterministic transient/permanent failure engines. No real model provider is called.

- [ ] Add localhost Redis healthcheck, shared schemas/options and isolated queue prefix per database. Validate payloads with unit tests.
- [ ] Add additive Engine, MonitorTask and Run migration, with unique task/query/engine tuple and relations to project/query. Seed mock engines deterministically.
- [ ] Add authenticated POST/GET /monitor-tasks with project membership and query ownership validation, bounded fan-out, immediate accepted response, and recoverable enqueue failures.
- [ ] Add worker execution/reconciliation, attempts, timeout, backoff, bounded concurrency, structured metadata logs and SIGINT/SIGTERM shutdown.
- [ ] Add a small polling page using existing authentication and project selection.
- [ ] Run geo_test acceptance through real API, Redis, separate worker and PostgreSQL: 5 queries x 3 engines = 15 runs; success, retry, permanent failure, duplicate delivery and forced worker restart. Assert task totals and developer-data fingerprints.
- [ ] Update architecture/database/API/queue/decision/development docs. Build/test/review before each logical commit. Stop after M3.
