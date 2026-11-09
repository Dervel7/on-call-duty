# Low-resource server simplifications: findings in batches

Target: one server with **4 GB RAM and 2 CPU cores** running the whole `docker-compose.yml` stack (PostgreSQL + API + nginx/web) for **about 5000 users** (doctors and administrators across clinics).

How this list was made: a read-only review of `apps/api`, `apps/web`, `packages/*`, `database/schema.sql`, both Dockerfiles, `apps/web/nginx.conf` and `docker-compose.yml`. Nothing was built, run or measured. Numbers marked `[INFERENCE]` are estimates from the code, not measurements.

Each finding has an ID (for example `INF-01`) and a severity (**High**, **Medium**, **Low**). Findings in the same batch touch the same files, so each file is edited once per batch. Batches are ordered by how much RAM/CPU they save on the shared box.

---

## Where the resources go

| Consumer | Today | Why it matters on 4 GB / 2 cores |
|---|---|---|
| HiGHS solver (`POST /schedules/options`) | Up to 40 s of one full core per request; WASM memory can grow to 2 GiB | One request takes half the CPU; two requests degrade each other |
| bcrypt cost 12 (login, change-password, user create) | About 250 ms of one core per hash `[INFERENCE]`, up to 4 in parallel (libuv pool) | 1-hour hard session cap forces a fresh login every hour for every active user |
| PostgreSQL | Stock settings (`shared_buffers=128MB`, `max_connections=100`), no container limit | Either under-uses RAM or competes with Node without limits |
| Per-request DB overhead | Billing-lock query on every authenticated request; settings re-read 2–3× per schedule/stats request | Most frequent queries in the system, all with constant answers |
| Tables that never shrink | `refresh_tokens`, `activity_log`, `schedule_generation_log` | Disk, index maintenance and slower queries grow forever |
| Container logs | No rotation; every request logged by pino-http and nginx | Disk fills slowly on an unattended box |

### Target memory budget (starting point, then measure) `[INFERENCE]`

| Service | `mem_limit` | Notes |
|---|---|---|
| `db` | 1.25 GB | `shared_buffers=512MB`, `work_mem=4MB`, `max_connections=20` |
| `api` | 1.5 GB | Node main heap capped at 384 MB; the rest is headroom for one HiGHS solve |
| `web` (nginx) | 64 MB | Static files + reverse proxy |
| OS + page cache | ~1.2 GB | Postgres relies on it (`effective_cache_size`) |

---

## Batch 1: Deployment and runtime limits

Files: `docker-compose.yml`, `apps/api/Dockerfile`, `apps/web/Dockerfile`, `apps/api/package.json`, `.env.example`, `render.env.example`.

- **INF-01 (High)** No container resource limits. `docker-compose.yml:17-87` sets no `mem_limit` / `cpus` on `db`, `api` or `web`. One runaway solve or query can push the whole box into swap or the OOM killer, and the kernel may pick Postgres.
  - Simplification: add `mem_limit` per service using the budget table above. Optionally `cpus: "1.5"` on `api` so Postgres always keeps some CPU.
- **INF-02 (High)** PostgreSQL runs with stock settings. `docker-compose.yml:17-37` has no `command:`.
  - Simplification: `command: postgres -c shared_buffers=512MB -c effective_cache_size=1536MB -c work_mem=4MB -c maintenance_work_mem=128MB -c max_connections=20 -c random_page_cost=1.1` (the last one assumes SSD storage).
- **INF-03 (High)** Images are built on the production box. `docker-compose.yml:10` documents `docker compose up -d --build`, and both services have `build:` blocks. The web build runs a whole-workspace `pnpm install` plus `vue-tsc --noEmit && vite build` (`apps/web/Dockerfile:26,37`, `apps/web/package.json:8`). That can use 1 GB+ of RAM and both cores for minutes `[INFERENCE]`, next to live Postgres.
  - Simplification: production uses only the prebuilt GHCR images (`docker compose pull && docker compose up -d`). Move `build:` to a separate `docker-compose.build.yml` used by CI/dev only.
- **INF-04 (High)** Node heap and libuv pool are not sized for the box. `apps/api/Dockerfile:46` runs `node src/server.ts` with no `--max-old-space-size`, so V8 sizes its heap from host RAM. bcrypt and other async work run on the default 4 libuv threads on a 2-core CPU.
  - Simplification: `ENV NODE_OPTIONS=--max-old-space-size=384` and `ENV UV_THREADPOOL_SIZE=2` in the API image.
- **INF-05 (Medium)** The API image is a single stage that keeps the C++ toolchain and web dependencies.
  - `apps/api/Dockerfile:23-25` installs `python3 make g++` and never removes them.
  - `:32,35,40` copy `apps/web/package.json` and `apps/web` source, so the workspace install pulls web runtime packages (`vue`, `vue-i18n`, `lucide-vue-next`, three `@fontsource` packages) into the API image.
  - `apps/api/package.json:28` lists `pino-pretty` as a runtime dependency although `src/logger.ts:6` uses it only in development.
  - Simplification: multi-stage build: install with `pnpm install --frozen-lockfile --prod --filter @oncall/api...` in a builder stage (toolchain only there), then copy the result into a clean `node:24-slim`. Drop the `apps/web` copies. Move `pino-pretty` to `devDependencies`.
- **INF-06 (Medium)** The web image installs the whole workspace and type-checks during the image build. `apps/web/Dockerfile:22-26` copies `apps/api/package.json` (pulls `highs`, `pg`, `bcrypt`), `:37` runs `vue-tsc`.
  - Simplification: `pnpm install --frozen-lockfile --filter @oncall/web...`, run `vite build` only (type-checking already runs in CI via `pnpm typecheck`), and add `RUN --mount=type=cache,target=/pnpm/store`.
- **INF-07 (Medium)** Container logs never rotate. No `logging:` options in `docker-compose.yml`, the Docker json-file driver keeps everything. pino-http (`apps/api/src/middleware/request-logger.ts:4-10`) logs every request at `info`, nginx logs every asset and API call.
  - Simplification: per service `logging: { driver: json-file, options: { max-size: "10m", max-file: "3" } }`. Set pino-http `autoLogging.ignore` for `/health` and log successful requests at `debug` (or set `LOG_LEVEL=warn` in production).
- **INF-08 (Low)** The API healthcheck starts a new Node process every 30 s. `docker-compose.yml:59-68` runs `node -e "fetch(...)"`, about 40 MB and a CPU spike per run `[INFERENCE]` (`node:24-slim` has no `wget`/`curl`).
  - Simplification: raise `interval` to `60s`, or let `web` depend on `api` with `condition: service_started` and drop the API healthcheck.

## Batch 2: Scheduling solver (largest single CPU/RAM consumer)

Files: `apps/api/src/scheduling/solver.ts`, `highs.ts`, `solver-model.ts`, `apps/api/src/services/schedule.service.ts`, `apps/api/src/routes/schedule.routes.ts`, `apps/api/src/validators/schedule.ts`, `apps/web/src/pages/ScheduleOptionsPage.vue`.

What is already lean: one HiGHS worker per process, created on first use, `threads: 1`, one solve at a time, retired after 60 s idle (`highs.ts:22-29,63-65`, `solver.ts:26`). Keep that design.

- **SOL-01 (High)** The queue serializes single solves, not requests. One options request runs about 11 HiGHS solves (capacity + cover stages + 5 more + 2 alternatives). With two admins, the solves alternate and use up each other's time budget, because the deadline starts before queueing (`solver.ts:69`). The second admin silently gets `time limit`, fewer options or the greedy fallback.
  - Simplification: one module-level semaphore around the whole `generateOptions` call. A second caller gets `409/503 "Solver busy, try again shortly"` (simplest), or waits in a queue of depth 1 with its deadline starting when it gets the slot.
- **SOL-02 (High)** Each request can hold one core for up to 40 s and nothing limits callers. `SOLVER_BUDGET_MS = 30_000` (`solver.ts:20`) plus `ALTERNATIVE_BUDGET_MS = 5_000` × 2 (`:23,116`). `/preview`, `/options` and `POST /schedules` have no rate limit (`schedule.routes.ts:35-55`), although `middleware/rate-limit.ts` exists.
  - Simplification: lower `SOLVER_BUDGET_MS` to 10 s (the original plan value) and update `ESTIMATED_OPTIONS_MS` (`ScheduleOptionsPage.vue:22`). Add `rateLimit({ windowMs: 60_000, limit: 3 })` to the solver routes.
- **SOL-03 (High)** Abandoned requests keep solving and the UI starts new ones. `ScheduleOptionsPage.vue:132-133` re-runs `load()` on every mount and month change; `lib/http.ts` has no `AbortController`. The API never listens for `req.on('close')`. nginx's default 60 s `proxy_read_timeout` (`nginx.conf:21-29`) can return 504 while the server keeps computing, and the user retries.
  - Simplification: pass an abort flag from `req.on('close')` into `generateOptions` and drop queued jobs for it in `highs.ts` `dispatch` (same path as an expired deadline). In the web page, abort the request in `onScopeDispose` and block month navigation while a solve runs. Set `proxy_read_timeout 90s` for `/api/schedules/options` (see NGX-03).
- **SOL-04 (High)** WASM memory has no cap. The `highs` build allows growth to 2 GiB (`getHeapMax`), and `highs.ts:24-29` notes over 200 MB for a 60-doctor clinic. Memory never shrinks until the worker retires.
  - Simplification: SOL-01 guarantees only one solve's memory at a time; INF-01 caps the container. Lower `SOLVER_IDLE_MS` from 60 s to 15 s to return the memory sooner. Use `mip_rel_gap` > 0 only for the last stages (`holidays`, `fill`) where the exact optimum is not worth the search tree.
- **SOL-05 (Medium)** Two unused endpoints still run the full solver. `preview` calls `runEngine` when no plan is sent (`schedule.service.ts:384-422`), and `generate` calls it when `assignments` is empty (`:485-488`). The SPA only calls `/schedules/options` and `POST /schedules` with assignments.
  - Simplification: remove the engine branch from `preview` (or the route if nothing else uses it) and make `assignments` required in `POST /schedules`. `/options` becomes the single solver entry point.
- **SOL-06 (Medium)** Three options means two extra MIP solves on every request (`SCHEDULE_OPTION_COUNT = 3`, `schedule.service.ts:424`).
  - Simplification: return option A, and compute B/C only when the admin opens those tabs (`count` parameter), or drop them. Saves up to 10 s of CPU per request. Needs a product decision.
- **SOL-07 (Medium)** The model is rebuilt and re-parsed from scratch for every stage. `buildModel` (`solver-model.ts:296-362`) regenerates all rows as text for each of ~11 solves, which are then copied to the worker and parsed again.
  - Simplification: build the shared rows once per request and append only the objective and `bound_*` rows per stage.
- **SOL-08 (Medium)** Identical requests are never shared. The solver is deterministic (`random_seed: 0`, `threads: 1`), yet two admins of the same clinic, or a page reload, start a new chain.
  - Simplification: an in-flight map keyed by `${clinicId}:${year}-${month}` so concurrent identical calls await the same promise.
- **SOL-09 (Low)** The worker posts the full HiGHS solution (every column's Primal/Dual/bounds plus all rows) back to the main thread (`highs.ts:42-43`); only `Columns[x_*].Primal > 0.5` is used.
  - Simplification: return `{ Status, ObjectiveValue, chosen: string[] }` from the worker.
- **SOL-10 (Low)** `eligibilityFor` runs the same `seedAdjacentDuties` query once per option (`schedule.service.ts:455-462`, `:313-327`).
  - Simplification: run it once in `generateOptions` and pass the result in.

## Batch 3: Authentication, sessions and bcrypt

Files: `apps/api/src/config/env.ts`, `apps/api/src/services/token.service.ts`, `auth.service.ts`, `doctor.service.ts`, `user.service.ts`, `activity.service.ts`, `apps/api/src/routes/auth.routes.ts`, `apps/api/src/middleware/rate-limit.ts`, `apps/web/src/lib/http.ts`, `docker-compose.yml`, `.env.example`, `render.env.example`.

- **AUTH-01 (High)** A 1-hour hard session cap forces a password login (bcrypt cost 12) every hour for every active user. `JWT_REFRESH_EXPIRES_IN` defaults to `1h` (`env.ts:20`, `docker-compose.yml:56`), and rotation never extends the login deadline (`token.service.ts:93-94`). At a shift change, ~1000 logins in 15 minutes is ~25–30 % of one core spent on password checks alone `[INFERENCE]`, plus one new `refresh_tokens` row per login and per refresh.
  - Simplification: set the default to `12h` (one shift). No code change, only the env default and the two example files. Security tradeoff: needs a decision.
- **AUTH-02 (High)** The refresh limit is keyed on IP only: `rateLimit({ windowMs: 15 min, limit: 60 })` (`auth.routes.ts:22`). Behind one hospital NAT, all users share 60 refreshes per 15 minutes; with 15-minute access tokens any group above ~60 active users gets 429, is sent to login, and pays a bcrypt hash. The limiter creates the load it should prevent.
  - Simplification: key the refresh limiter on a hash of the refresh cookie (or IP + cookie hash).
- **AUTH-03 (High)** bcrypt is an unbounded CPU sink.
  - The login limiter key is `ip:identifier` (`auth.routes.ts:15-19`), so changing the identifier gives a fresh bucket, and unknown identifiers still run `bcrypt.compare` against the dummy hash (`auth.service.ts:83-84`).
  - `/auth/change-password` (`auth.routes.ts:25`) has no limit and runs two bcrypt operations (`auth.service.ts:146-148`).
  - Simplification: add a second IP-only login limiter (for example 30 per 15 minutes), rate-limit change-password, and cap concurrent bcrypt work (`UV_THREADPOOL_SIZE=2`, INF-04). Put the cost `12` in one shared constant (now repeated in `auth.service.ts:148`, `doctor.service.ts:121`, `user.service.ts:163,362`).
- **AUTH-04 (Medium)** bcrypt runs inside an open transaction. `doctor.service.ts:110-121` hashes inside `withTransaction`, holding a pool connection and transaction for ~250 ms.
  - Simplification: hash before `withTransaction`, as `user.service.ts:163` already does.
- **AUTH-05 (Medium)** `logActivity` wraps one INSERT in BEGIN/COMMIT (`activity.service.ts:38-40`): 3 round trips and a dedicated connection on every login and logout.
  - Simplification: a plain `query()` INSERT.
- **AUTH-06 (Medium)** The rate-limiter sweep can run on every request. Once `buckets.size > 10_000` (`rate-limit.ts:16,28-33`), each request walks all buckets, and buckets live 15 minutes, so the sweep often frees nothing.
  - Simplification: sweep at most once per window (track `lastSweep`).
- **AUTH-07 (Low)** The web client refreshes only after a 401 (`apps/web/src/lib/http.ts:76-79`), so every access-token expiry costs a failed request + refresh + retry per active user.
  - Simplification: refresh shortly before `exp`.

## Batch 4: Per-request database overhead and the pool

Files: `apps/api/src/db/client.ts`, `apps/api/src/middleware/authenticate.ts`, `apps/api/src/services/billing.service.ts`, `settings.service.ts`, `schedule.service.ts`, `stats.service.ts`, `user.service.ts`, `apps/api/src/lib/scope.ts`.

- **DB-01 (High)** The pool uses all pg defaults. `client.ts:8` is `new Pool({ connectionString })`: `max: 10`, `connectionTimeoutMillis: 0` (waits forever), no `statement_timeout`, no `idle_in_transaction_session_timeout`. 10 busy backends on 2 cores is more parallelism than the CPU can serve, and a slow query has no time cap.
  - Simplification: `max: 5`, `idleTimeoutMillis: 30_000`, `connectionTimeoutMillis: 5_000`, `statement_timeout: 10_000`, `idle_in_transaction_session_timeout: 15_000`. Pairs with `max_connections=20` (INF-02).
- **DB-02 (High)** A billing-lock query runs on every authenticated request. `authenticate.ts:23` → `billing.service.ts:13-19` (`SELECT ... FROM app_meta`). The answer changes only when `setPaidThrough` runs or the date changes.
  - Simplification: in-process cache `{ locked, until }` (until next midnight or 60 s, whichever comes first), cleared in `setPaidThrough`. Safe: the deployment is a single API process (`rate-limit.ts:19` already assumes this).
- **DB-03 (Medium)** Clinic settings are re-read on every schedule/stats request, in 2–3 parallel queries. `getDutySlots` and `getDutyMinimums` read the same `clinics` row separately, and `getOpenDutySettings` reads `app_meta` (`settings.service.ts:30-45,73-90,189-214`), called via `Promise.all` in `schedule.service.ts:155-159,726-730,967,1056,1092` and `stats.service.ts:84-87`. Each such request takes 3 pool connections at once.
  - Simplification: one `getClinicRules(clinicId)` that reads all columns in one SELECT, plus an in-process cache cleared by the setters.
- **DB-04 (Low)** Superadmin requests without `clinicId` run `SELECT id FROM clinics ORDER BY id LIMIT 2` each time (`scope.ts:46-50`).
  - Simplification: cache it, cleared in `clinic.service.create`.
- **DB-05 (Low)** `password_hash` is selected on every user list and lookup (`user.service.ts:36-37` `COLUMNS`) and then thrown away by `toUser`.
  - Simplification: remove it from `COLUMNS`; only `auth.service.ts` needs it.

## Batch 5: Table growth, retention and indexes

Files: `database/schema.sql`, `docs/database.md` (must change together), `apps/api/src/server.ts`, `apps/api/src/services/token.service.ts`, `activity.service.ts`.

- **DATA-01 (High)** `refresh_tokens` grows forever. No `DELETE FROM refresh_tokens` exists outside tests; `docs/database.md` states rows are removed only on user hard-delete, which never happens. With today's defaults that is ~20k rows/day, ~7M rows/year, each row maintained in 4 indexes `[INFERENCE]`. The recursive family walk (`token.service.ts:48-59`) gets riskier as the table grows.
  - Simplification: a periodic cleanup (`setInterval(...).unref()` in `server.ts`, every 6 hours, batched) running `DELETE FROM refresh_tokens WHERE expires_at < NOW() - INTERVAL '1 day'`, plus `idx_refresh_tokens_expires_at`. Safe: expired rows are already rejected (`token.service.ts:82-86`).
- **DATA-02 (Medium)** `activity_log` grows forever and maintains 4 indexes per insert (`schema.sql:203-221`). Every login/logout adds a row. Reads always filter by `clinic_id` (`activity.service.ts:91-92`), so `idx_activity_log_clinic_created` serves them; `idx_activity_log_action` (~30 distinct values) and `idx_activity_log_user` add write cost.
  - Simplification: drop the two weak indexes (or replace them with `(clinic_id, user_id, created_at)` if the user filter must stay fast). Add retention, for example delete `auth.login`/`auth.logout` rows after 90 days. Needs a decision on audit retention.
- **DATA-03 (Medium)** The activity page counts the whole history and uses `OFFSET` on every page (`activity.service.ts:107-110,118`). Both get slower as the log grows.
  - Simplification: a capped count (`SELECT COUNT(*) FROM (SELECT 1 ... LIMIT 10001) t`) and keyset pagination on `(created_at, id)`.
- **DATA-04 (Low)** Indexes that only add write cost: `idx_unavailability_dates` (`schema.sql:93`, every query filters by doctor) and `idx_schedule_generation_log_doctor` (`schema.sql:160-161`, no query filters by `doctor_id`).
  - Simplification: drop both (`DROP INDEX IF EXISTS` keeps `schema.sql` idempotent).
- **DATA-05 (Low)** Holiday date filters cannot use the index: `EXTRACT(YEAR FROM holiday_date)` and `date_trunc('month', ...)` (`holiday.service.ts:25,43-46,58-60`).
  - Simplification: rewrite as ranges (`holiday_date >= make_date($2,1,1) AND holiday_date < make_date($2+1,1,1)`).

## Batch 6: Query shape in services

Files: `apps/api/src/services/usage.service.ts`, `schedule.service.ts`, `stats.service.ts`, `reports.service.ts`, `unavailability.service.ts`, matching validators in `packages/shared`.

- **QRY-01 (Medium)** `usage.generations()` is N+1 with an O(n²) JS lookup and no limit (`usage.service.ts:128-182`): 1–2 queries per batch in a loop plus `batches.rows.find(...)` per batch, over the append-only `schedule_generation_log`.
  - Simplification: one query grouping by batch with `array_agg` and `LAG()` for the previous batch, plus `limit`/`page` like the activity list.
- **QRY-02 (Medium)** One INSERT per row inside transactions: duties (`schedule.service.ts:498-504`, ~60 per save) and generation-log rows (`usage.service.ts:29-34`, one per doctor). 100+ sequential round trips while holding a connection.
  - Simplification: one `INSERT ... SELECT * FROM unnest($1::date[], $2::int[], ...)` per table.
- **QRY-03 (Medium)** A published schedule is fully recomputed on every view. The doctor path runs the schedule row, a 4-table duties join and 3 settings queries; the admin path adds `buildContext` (~7 queries) and an O(days × doctors) eligibility loop (`schedule.service.ts:718-779`). The doctor-facing result is identical for every doctor of a clinic until a write.
  - Simplification: cache the non-admin result per `scheduleId`, cleared in `addDuty`, `reassignDuty`, `removeDuty`, `publish`, `unpublish`, `remove` and the settings setters.
- **QRY-04 (Medium)** The doctor dashboard runs 5 sequential queries per load (`stats.service.ts:191-233`); the 7-day on-call list is the same for every doctor of a clinic.
  - Simplification: run the independent queries together (or merge them) and cache the on-call list per clinic per day, cleared on schedule writes.
- **QRY-05 (Low)** Duplicate reads: `reports.monthlyReport` selects the schedule row twice (`reports.service.ts:15-23` → `schedule.service.ts:706`); `validateAssignment` makes up to ~9 sequential queries (`schedule.service.ts:820-940`).
  - Simplification: pass the already-loaded schedule row; reuse DB-03's single settings read inside validation.
- **QRY-06 (Low)** Lists without a server-side window: `unavailability.listAll` / `listOwn` return a doctor's full history (`unavailability.service.ts:84-116`); `usage.listAlerts` (`usage.service.ts:185-191`) is unbounded.
  - Simplification: a `from` filter defaulting to the current month start (past days cannot be edited); `limit`/`page` for alerts.

## Batch 7: nginx reverse proxy

Files: `apps/web/nginx.conf`, `apps/web/vite.config.ts` (pre-compression only).

- **NGX-01 (Medium)** No keepalive to the API: `nginx.conf:22-24` sets `proxy_http_version 1.1` but has no `upstream` with `keepalive` and no `proxy_set_header Connection ""`, so every API call opens a new TCP connection.
  - Simplification: `upstream api_up { server api:3000; keepalive 16; }`, `proxy_pass http://api_up/;`, `proxy_set_header Connection "";`. Keep the API's `server.keepAliveTimeout` (Node default 5 s) above nginx's upstream `keepalive_timeout` (set it to 4 s), or raise Node's to 65 s.
- **NGX-02 (Medium)** Access logs for static assets: every hashed asset and font request is logged (see INF-07).
  - Simplification: `access_log off;` in `location ^~ /assets/`.
- **NGX-03 (Medium)** The default 60 s `proxy_read_timeout` is shorter than a queued solve (SOL-03).
  - Simplification: `location /api/schedules/options { proxy_read_timeout 90s; ... }`, matched to the new solver budget.
- **NGX-04 (Low)** No pre-compression: `gzip on` compresses the entry JS/CSS again on each first visit; no `gzip_vary`.
  - Simplification: emit `.gz` files at build time and add `gzip_static on; gzip_vary on;`. Do not add `compression()` to Express; nginx stays the only compressor.
- **NGX-05 (Low)** Default proxy buffers (8 × 4k/8k) spill schedule-detail and options responses to temp files on disk `[INFERENCE]`.
  - Simplification: `proxy_buffer_size 16k; proxy_buffers 16 16k;` in `location /api/`.

## Batch 8: Web data fetching (less API and DB load)

Files: `apps/web/src/pages/UsersPage.vue`, `ScheduleDetailPage.vue`, `MyAvailabilityPage.vue`, `AvailabilityPage.vue`, `ReportsPage.vue`, `HolidaysPage.vue`, `UsagePage.vue`, `apps/web/src/components/dashboard/AdminDashboard.vue`, `apps/web/src/services/*.ts`, `apps/web/src/stores/auth.ts`.

- **WEB-01 (Medium)** Schedule detail reloads the whole schedule after every cell edit (`ScheduleDetailPage.vue:146-158`, `finally { await load() }`), although `addDuty`/`reassignDuty` return the `Duty`. Filling a month means 60–90 full detail rebuilds on the server.
  - Simplification: apply the returned duty locally; reload only on error or 409. If eligibility of neighbouring days changes, have the mutation return the affected `days` entries.
- **WEB-02 (Medium)** My Availability (the doctor hot path) loads the doctor's entire history and refetches it on calendar open and after each save/delete (`MyAvailabilityPage.vue:72-82,99-111,176,186,216`), and posts ranges one by one in a loop (`:154-165`). The admin page fetches the full history on every chip click (`AvailabilityPage.vue:138-140`) and runs its two initial loads one after the other (`:328-335`).
  - Simplification: use the `from` filter (QRY-06); accept several ranges in one POST; run the admin loads with `Promise.all`.
- **WEB-03 (Medium)** Users page fetches `/users` and `/doctors`, filters and sorts in the browser, and reloads both after every save/toggle/delete (`UsersPage.vue:65-74,123,229,269,289`). `/doctors` already has every rendered field and is sorted by the server.
  - Simplification: fetch only `/doctors`; patch the changed row from the response instead of reloading.
- **WEB-04 (Medium)** Admin pages refetch the same lists on every visit: `doctorService.list()` in UsersPage, AvailabilityPage and ScheduleDetailPage; `userService.list()` in ActivityPage; `billing.paymentAlert` on every Home visit (`AdminDashboard.vue:82-88,100-101`).
  - Simplification: a short in-memory cache (30–60 s, cleared on mutation) in those service functions; keep the payment alert in the auth store for the session.
- **WEB-05 (Medium)** Reports page waits for `/reports/monthly`, then fetches the full `/schedules/:id` detail (with per-day eligibility) (`ReportsPage.vue:136-141`).
  - Simplification: let `/reports/monthly` include the calendar data it needs.
- **WEB-06 (Low)** Usage lists render every row unpaginated and `JSON.stringify` each detail (`UsagePage.vue:190,219-222`); Holidays refetches a whole year on each month change (`HolidaysPage.vue:99,128-130`).
  - Simplification: server pagination for usage (QRY-01); cache holidays per year.

## Batch 9: Web bundle and browser cost

Files: `apps/web/src/lib/i18n.ts`, `App.vue`, `vite.config.ts`, `main.ts`, `style.css`, `pages/HomePage.vue`, `lib/http.ts`, `packages/shared/src/schemas/settings.ts`, `packages/shared/src/index.ts`, `components/ui/Select.vue`, `composables/usePopover.ts`, `apps/web/package.json`.

These mainly help low-end hospital PCs and reduce the bytes nginx serves after each deploy.

- **BUN-01 (Medium)** Both locales and the vue-i18n runtime compiler are in the entry chunk. `i18n.ts:3-4,19` statically imports `en.json` (18.9 KB) and `el.json` (32.2 KB); `vite.config.ts:19-23` sets `__VUE_I18N_FULL_INSTALL__: true` although no `<i18n-t>`/`v-t` is used.
  - Simplification: keep `en` static as fallback and load `el` with `import()` in the language watcher (`setLocaleMessage`); set `__VUE_I18N_FULL_INSTALL__: false`; optionally precompile messages and use the runtime-only build.
- **BUN-02 (Medium)** Fonts: 11 weight imports (`main.ts:7-17`), weight 800 is never used, and each fontsource CSS declares every subset (cyrillic, vietnamese, latin-ext...), about 47 `@font-face` rules in render-blocking CSS. Plus Jakarta Sans and Space Grotesk have no Greek subset, so Greek text uses the system font anyway.
  - Simplification: delete the 800 import and import only Latin subsets (`@fontsource/plus-jakarta-sans/latin-400.css`, ...). Consider the `system-ui` stack already in `style.css:134-135` instead of the two sans families.
- **BUN-03 (Medium)** zod lands in the entry chunk through one string constant: `lib/http.ts:1` imports `SYSTEM_LOCKED_MESSAGE`, defined in `packages/shared/src/schemas/settings.ts:5` next to top-level `z.object(...)` calls.
  - Simplification: move the constant to a zod-free module (for example `packages/shared/src/constants.ts`) re-exported from the index. `zod` in `apps/web/package.json:29` is used only as a type (`lib/validation.ts:1`).
- **BUN-04 (Low)** `HomePage.vue:4-5` statically imports both dashboards, so doctors download admin code.
  - Simplification: `defineAsyncComponent(() => import(...))` per role.
- **BUN-05 (Low)** Constant GPU work from CSS: infinite `aurora-drift`, `bar-shimmer`, `pulse-ring` animations (`style.css:195,401,498`) and `backdrop-filter: blur(14px/24px)` on every card and popover (`:309,337`).
  - Simplification: remove the infinite animations (or run them on hover/focus only) and use a solid card background.
- **BUN-06 (Low)** Every dropdown keeps three capture-phase document/window listeners even while closed (`usePopover.ts:83-120`) and re-parses its slot on every render (`Select.vue:74-98`). Edit mode in `DutyCalendar.vue:190-204` renders 62–93 Selects, so ~190–280 global listeners.
  - Simplification: attach listeners only while open (`useEventListener(() => open.value ? document : null, ...)`) and parse options only when the panel opens.

---

## Already lean (keep as is)

- Single HiGHS worker, one solve at a time, idle retirement (`scheduling/highs.ts`).
- No `SELECT *` in `apps/api/src`; activity list is paginated (max 100).
- CSV built in the browser (`packages/utils/src/csv.ts`), never in API memory.
- Every route is lazy-loaded with stale-chunk reload (`apps/web/src/router/index.ts`).
- No polling, no refetch-on-focus, no WebSockets in the web app.
- Correct cache headers: `/assets/` immutable for one year, `index.html` `no-cache` (`nginx.conf:32-42`).
- Lean web runtime image: `nginx:1.27-alpine` with only `dist` and config.
- nginx `worker_processes auto` (2 on 2 cores) is right for this box.

## Decisions needed before implementing

| ID | Question |
|---|---|
| AUTH-01 | Raise the session cap from 1 hour to 12 hours (one shift)? |
| AUTH-03 | Keep bcrypt cost 12, or lower to 10 (about 4× cheaper per hash) for new hashes? |
| SOL-06 | Keep three schedule options, compute B/C on demand, or return one option? |
| SOL-01 | Second concurrent solve: reject with "busy", or queue one request? |
| DATA-02 | Retention period for `activity_log` login/logout rows and for other audit rows? |
| BUN-02 | Keep the custom fonts (Latin subsets only) or switch to the system font stack? |
