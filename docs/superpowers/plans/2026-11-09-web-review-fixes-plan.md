# Web app (`apps/web`) review — findings and fixes

Date: 2026-11-09. Scope: everything under `apps/web/` (source, tests, locales, Vite/TS config, Dockerfile, nginx). Contracts were checked against `apps/api/src` and `packages/shared`.

This file is the hand-off for the agent that implements the fixes. Every finding names the files and lines, explains the triggering scenario, and gives the exact fix and the tests to add or change. Line numbers are from the review snapshot; re-read each file before editing.

## Rules for the implementing agent

- Follow `AGENTS.md`. Do not commit on `main` (leave commits to the user). No Prettier, no lint-rule changes, no GitHub Action version changes.
- Implement **one finding per change**, in the batch order below. Do not add improvements that are not listed here.
- Every bugfix needs a test (see each finding's *Fix*). Delete tests that only pin behaviour a finding removes.
- Findings marked **Needs decision** must be confirmed with the user before you implement them. Findings with a **Scope note** touch `apps/api`; implement the API part only if the user confirms.
- Keep `en.json` and `el.json` in sync: every key you add or remove must change in both files.
- When done, run from the repo root: `pnpm typecheck`, `pnpm lint`, `pnpm test`. All three must pass.

## Summary

56 findings: 1 Critical, 3 High, 16 Medium, 36 Low.

| ID | Severity | Category | Title |
|---|---|---|---|
| [CORE-01](#core-01) | Critical | Bug | Production nginx does not rewrite the refresh-cookie path: reload and token refresh always fail in Docker |
| [UI-01](#ui-01) | High | A11y | Docked sidebar traps Tab focus on desktop; drawer focus trap leaks on mobile |
| [SCH-01](#sch-01) | High | Bug | DutyCalendar hides duties beyond the day's *current* slot count |
| [ADM-01](#adm-01) | High | Security | Every new doctor account gets the same hard-coded, publicly shown password, and nothing forces a change |
| [CORE-02](#core-02) | Medium | Bug | A lock detected during token refresh sends the user to /login instead of /locked |
| [CORE-03](#core-03) | Medium | Bug | Two tabs refreshing at the same time revoke the whole session family (all tabs signed out) |
| [CORE-04](#core-04) | Medium | UX | Unknown URLs render a blank page (no catch-all route) |
| [UI-02](#ui-02) | Medium | Bug | `dark:` utilities follow the OS theme, not the app `.dark` class |
| [UI-03](#ui-03) | Medium | UX | Clicking the backdrop to dismiss an open Select also closes the enclosing Dialog |
| [UI-04](#ui-04) | Medium | A11y | Tab out of DatePicker/MonthPicker popover leaves it open and strands focus |
| [UI-05](#ui-05) | Medium | A11y | ConfirmDialog message is never announced to screen readers |
| [UI-06](#ui-06) | Medium | A11y | Labelled DatePicker/MonthPicker triggers hide the selected value from assistive tech |
| [SCH-02](#sch-02) | Medium | Bug | Duty edits re-enable the cell before the refetch lands, and refetches are unordered |
| [SCH-03](#sch-03) | Medium | Bug | Publish / Revert / Delete: no in-flight guard and no resync after a failed (409) state change |
| [SCH-04](#sch-04) | Medium | Correctness | Admin dashboard shows the previous month's figures after a failed load, labelled with the unapplied selection |
| [SCH-05](#sch-05) | Medium | Dead code | `SchedulePreviewPage` is unreachable dead code since the options flow replaced it |
| [ADM-02](#adm-02) | Medium | Bug | MyAvailability: a save that fails halfway leaves the list stale, and using the stale list undoes or breaks the edit |
| [ADM-03](#adm-03) | Medium | Bug | MyAvailability: Delete has no in-flight guard, so Delete/Save can run twice or concurrently |
| [ADM-04](#adm-04) | Medium | Correctness | Activity page offers action filters that can never match; logins and password changes are invisible in the audit log |
| [ADM-05](#adm-05) | Medium | i18n | Validation errors show raw English Zod messages in the Greek UI |
| [CORE-05](#core-05) | Low | Correctness | 401 business errors from /auth/login and /auth/change-password trigger a refresh and replay |
| [CORE-06](#core-06) | Low | Bug | Stale lazy chunks after a deploy make navigation silently fail |
| [CORE-07](#core-07) | Low | i18n | Network failures surface raw, untranslated browser text |
| [CORE-08](#core-08) | Low | Dead code | Dead code: unused service/store functions, types barrel, zod dependency |
| [CORE-09](#core-09) | Low | Simplification | Access-token ownership split between services and store |
| [CORE-10](#core-10) | Low | Simplification | Four hand-rolled query-string builders |
| [CORE-11](#core-11) | Low | Config | Web Docker build copies the API sources |
| [CORE-12](#core-12) | Low | Performance | nginx serves assets uncompressed; hashed assets cached only 7 days |
| [CORE-13](#core-13) | Low | Config | tsconfig.node.json is orphaned; vite.config.ts is never type-checked |
| [UI-07](#ui-07) | Low | UX | Select listbox is not clamped to the viewport horizontally |
| [UI-08](#ui-08) | Low | A11y | Select combobox misses `aria-controls` and arrow-key opening |
| [UI-09](#ui-09) | Low | A11y | Avatar initials are read aloud next to the full name |
| [UI-10](#ui-10) | Low | UX | No nav item is active while a doctor views a schedule |
| [UI-11](#ui-11) | Low | Bug | Sidebar JS breakpoint (px) can disagree with the Tailwind `xl` breakpoint (rem) |
| [UI-12](#ui-12) | Low | Dead code | Dialog `onClickOutside` is dead code |
| [UI-13](#ui-13) | Low | Dead code | Unused component, variants and theme tokens |
| [UI-14](#ui-14) | Low | Simplification | Print palette duplicates the whole light theme |
| [UI-15](#ui-15) | Low | Simplification | CalendarDialog re-implements the Dialog shell outside the dialog stack |
| [UI-16](#ui-16) | Low | Simplification | Popover plumbing is copy-pasted across Select, DatePicker and MonthPicker |
| [SCH-06](#sch-06) | Low | UX | Saving a plan / deleting a schedule uses `push`, so Back lands on a 409 / 404 page |
| [SCH-07](#sch-07) | Low | Performance | Detail page always fetches `/doctors` (403 for doctors) and serialises it before the schedule load |
| [SCH-08](#sch-08) | Low | A11y | Option tabs don't implement the ARIA tabs keyboard pattern |
| [SCH-09](#sch-09) | Low | Dead code | Dead props/fields and duplicated assignment grouping around DutyCalendar; stale options constant |
| [SCH-10](#sch-10) | Low | Simplification | Two list pages for the same doctor data (`/roster` vs `/schedules`) |
| [SCH-11](#sch-11) | Low | Test gap | Schedule-level and duty-level actions on the detail page are untested |
| [ADM-06](#adm-06) | Low | Bug | Usage: double-clicking Resolve reports "Alert already resolved" for an action that succeeded |
| [ADM-07](#adm-07) | Low | Correctness | Users: enabling/disabling a doctor goes through `/users`, so the audit log records `user.*` instead of `doctor.*` |
| [ADM-08](#adm-08) | Low | Bug | Holidays: after discarding edits, a failed month load leaves the old month's marks; Save then sends them and gets 400 |
| [ADM-09](#adm-09) | Low | UX | Holidays: unsaved marks are silently lost when leaving the page |
| [ADM-10](#adm-10) | Low | Bug | Reports: the default month is computed in UTC, so it shows the previous month shortly after midnight local time |
| [ADM-11](#adm-11) | Low | Bug | Login: leading/trailing spaces in the identifier cause "Invalid credentials" |
| [ADM-12](#adm-12) | Low | UX | Availability: a failed doctor-list load is swallowed, leaving empty doctor selects with no explanation |
| [ADM-13](#adm-13) | Low | UX | Usage: generation history has no clinic column, though the data is cross-clinic and overlap is per clinic |
| [ADM-14](#adm-14) | Low | Simplification | Holidays/Rules pass a `clinicId` that never changes what the server does |
| [ADM-15](#adm-15) | Low | Simplification | Duplicated "remove one day from a record" logic in both availability pages |
| [ADM-16](#adm-16) | Low | Bug | Reports: roster weekday/day labels format a UTC date in the browser's local zone |

## Decisions needed from the user

| ID | Question |
|---|---|
| SCH-05 | Delete the unreachable Schedule Preview page and update the admin manual, or restore an entry point to it? |
| SCH-10 | Merge the doctor "Duty roster" page into `/schedules`? |
| ADM-01 | Should admins type each new doctor's initial password (replacing the hard-coded `changeme123`)? |
| ADM-04, CORE-05 | Are `apps/api` changes in scope for this work? |

## Implementation order

Batches group findings that touch the same files, so each file is edited in one pass. Within a batch, follow the listed order.

1. **Deployment and session (critical path):** CORE-01, CORE-02 + CORE-09 (both `stores/auth.ts`), CORE-03, CORE-05 (web half), CORE-04, CORE-06, CORE-07.
2. **High-severity UI/data bugs:** UI-01, SCH-01, ADM-01 (after decision).
3. **Schedule detail and options:** SCH-02, SCH-03, SCH-06, SCH-07, SCH-11 (tests for SCH-02/03/06), SCH-08, SCH-09.
4. **Dashboards and reports:** SCH-04, ADM-10 + ADM-16 (`ReportsPage.vue`, same pass as SCH-09's Reports change).
5. **Availability pages:** ADM-15 first (shared helper), then ADM-03, ADM-02, ADM-12.
6. **Other admin pages:** ADM-06, ADM-07, ADM-08, ADM-09, ADM-11, ADM-13, ADM-04 (web part; API part after decision).
7. **i18n:** ADM-05.
8. **UI primitives:** UI-02, UI-15 then UI-05, UI-16 with UI-03 + UI-04 + UI-07 (or the three alone), UI-06, UI-08, UI-09, UI-11, UI-10 (skip if SCH-10 is done).
9. **Dead code and simplification:** ADM-14 then CORE-10, CORE-08, UI-12, UI-13, UI-14, SCH-05 and SCH-10 (after decision).
10. **Config:** CORE-11, CORE-12, CORE-13.

## Cross-finding dependencies and conflicts

- **CORE-08 vs ADM-05:** ADM-05 needs `zod` in `apps/web/package.json`; if both are done, keep the dependency.
- **ADM-14 → CORE-10:** remove the `clinicId` arguments first, then add the shared query helper.
- **CORE-02 + CORE-09:** both rewrite parts of `stores/auth.ts`; do them together.
- **UI-16 ⊃ UI-03, UI-04, UI-07:** the composable should contain those three fixes.
- **UI-15 → UI-05:** once CalendarDialog uses Dialog, the a11y fix is made once.
- **SCH-10 ⇒ skip UI-10.**
- **SCH-09, ADM-10, ADM-16** all edit `ReportsPage.vue`.
- **SCH-05** moves four `schedulePreview.*` strings that `ScheduleOptionsPage.vue` uses into `scheduleOptions.*`; do this before deleting the `schedulePreview` locale block.

## Verified as correct (do not change)

- Every service endpoint (path, method, body, response shape) matches the API routes and shared types.
- `lib/http.ts`: envelope parsing, 204 handling, single retry after refresh (no loop), per-tab refresh dedup; access token kept in memory only.
- `LoginPage` `redirect` query is sanitised (same-origin paths only; `//host`, absolute URLs and arrays rejected).
- Login 429 messages reach the page; CSV export escapes formula injection and writes a BOM.
- `useLatestRequest` guards in Availability, Holidays, Reports, Activity; double-submit guards in Rules, Profile, Holidays and the Users dialogs.
- Locale parity: 397 keys in both `en.json` and `el.json`, identical placeholders, every literal `t()` key exists.
- Role-based nav matches `meta.roles`; superadmin passes `administrator` routes.
- DatePicker/CalendarDialog/MonthPicker build `YYYY-MM-DD` in local time; `shiftMonth` uses day 1 (no month overflow); scroll-lock ref counting and focus restore in `useModal` are correct.


## A. Core: bootstrap, auth, HTTP, router, services, config

<a id="core-01"></a>
### CORE-01 — Production nginx does not rewrite the refresh-cookie path: reload and token refresh always fail in Docker
- Severity: Critical
- Category: Bug
- Location: `apps/web/nginx.conf:15-22`; related `apps/api/src/controllers/auth.controller.ts:10-18`, `apps/web/Dockerfile:28-31`, `docker-compose.yml` (web `args: VITE_API_URL: /api`), `apps/web/vite.config.ts:37-43`
- Problem: The API sets the refresh cookie with `path: "/auth"` (`cookieOptions()` in auth.controller.ts) and mounts the router at `/auth` (`apps/api/src/app.ts:37`). The Docker image bakes `VITE_API_URL=/api`, so the browser calls `/api/auth/refresh`; nginx strips the prefix (`proxy_pass ${API_UPSTREAM}/;`) but never rewrites `Set-Cookie`. The cookie is stored with `Path=/auth`, which does not path-match `/api/auth/refresh`, so it is never sent. Result in every Docker/compose deployment: `POST /api/auth/refresh` always returns 401, so (1) every page reload logs the user out (bootstrap `refresh()` in `main.ts` fails), (2) ~15 min after login (`JWT_ACCESS_EXPIRES_IN` default) the first 401 triggers a failed refresh and the user is bounced to /login, (3) logout never revokes the server-side token (cookie not sent to `/api/auth/logout`). Dev works only because the Vite proxy has `cookiePathRewrite: { "/auth": "/api/auth" }` with the comment "Mirrors the production nginx /api proxy" - nginx has no equivalent.
- Fix: in `location /api/ { ... }` add `proxy_cookie_path /auth /api/auth;` right after `proxy_pass`. Extend the comment above the block to mention the cookie path rewrite (mirrors vite.config.ts). Manual check after `docker compose up --build`: login response has `Set-Cookie: refresh_token=...; Path=/api/auth`, reloading the page keeps the session.
- Confidence: High - read cookieOptions (`path: "/auth"`), app.ts mounts (`app.use("/auth", authRouter)`, no /api prefix), Dockerfile/docker-compose bake `/api`; repo-wide grep for `proxy_cookie_path` returns nothing.

<a id="core-02"></a>
### CORE-02 — A lock detected during token refresh sends the user to /login instead of /locked
- Severity: Medium
- Category: Bug
- Location: `apps/web/src/stores/auth.ts:80-99`, `apps/web/src/lib/http.ts:71-81`, `apps/web/src/router/guard.ts:4-27`, `apps/web/src/main.ts:25-27`
- Problem: `authenticate` (apps/api/src/middleware/authenticate.ts) checks the JWT before the lock, so a doctor returning to an idle tab (access token expired) gets 401, not 403. Flow: request -> 401 -> refresh handler -> `refresh()` -> `POST /auth/refresh` -> 403 `SYSTEM_LOCKED_MESSAGE` (auth.service.ts `refresh`). In `request()` that calls `lockedHandler()`, which queues `router.push({ name: "locked" })` via `import("@/router").then(...)`; the ApiError then makes `refresh()` return `null`, so the refresh handler queues a second `router.push({ name: "login", query: { redirect } })`. The locked navigation is still pending (LockedPage is a lazy chunk), `currentRoute.name` is not yet `locked`, so the `current.name === "login"` check does not stop it, and vue-router cancels the earlier navigation. The user lands on /login and only learns about the lock after trying to sign in. On reload the same 403 comes from the bootstrap refresh: the `push(locked)` races the initial navigation that `app.use(router)` starts (last push wins; the initial one redirects to /login) - timing dependent.
- Fix: make the lock store state that the guard reads, instead of two racing imperative pushes.
  - `stores/auth.ts`: `const locked = ref(false)`; in `setLockedHandler`: `clearSession(); locked.value = true;` then push `locked` as today; in the refresh handler only redirect when `token === null && !locked.value`; in `login()` after success set `locked.value = false`; return `locked`.
  - `router/guard.ts`: add `locked: boolean` to `GuardAuth`; when `!auth.isAuthenticated` return `auth.locked ? { name: "locked" } : { name: "login", query: { redirect: to.fullPath } }`.
  - Tests: `auth.store.test.ts` - a 401 request whose refresh returns 403 `SYSTEM_LOCKED_MESSAGE` (fetch mock) ends on route `locked`, not `login`; guard unit test - unauthenticated + `locked: true` on a private route returns `{ name: "locked" }`; add `locked: false` to existing guard test fixtures.
- Confidence: High for the mid-session path (traced http.ts -> store handlers -> vue-router pending-navigation cancellation; API ordering checked in authenticate.ts and auth.service.ts). Medium for the reload path (microtask ordering).

<a id="core-03"></a>
### CORE-03 — Two tabs refreshing at the same time revoke the whole session family (all tabs signed out)
- Severity: Medium
- Category: Bug
- Location: `apps/web/src/services/auth.ts:10-14`, `apps/web/src/stores/auth.ts:31-41`, `apps/web/src/lib/http.ts:55,71-74`
- Problem: Refresh dedup (`refreshing ??= ...`) is per-tab module state, but all tabs share one refresh cookie. The API treats any second use of a rotated token as reuse and revokes the entire rotation family (`apps/api/src/services/token.service.ts` `rotateRefreshToken`: revoked row -> `revokeFamily`; lost atomic claim -> `revokeFamily`). When two tabs send `POST /auth/refresh` with the same cookie concurrently - browser session restore with several app tabs, or middle-clicking two sidebar links quickly (each new tab runs the bootstrap refresh in main.ts) - the loser gets 401 and the server also revokes the token the winner just received. The loser tab shows /login immediately; the winner is signed out at its next refresh (within the access-token lifetime).
- Fix: serialise refreshes across tabs with the Web Locks API so the second tab waits and then sends the already-rotated cookie (Set-Cookie of the first response is applied before its fetch resolves). In `services/auth.ts` `refresh()`:
  ```ts
  const post = () => apiPost<LoginResponse>("/auth/refresh")
  const data = await (navigator.locks ? navigator.locks.request("oncall-auth-refresh", post) : post())
  ```
  Test: with `navigator.locks` stubbed, `refresh()` performs the POST inside `locks.request("oncall-auth-refresh", ...)`; without `navigator.locks` (jsdom default) it still posts.
- Confidence: Medium - server reuse detection verified in token.service.ts; the client race needs near-simultaneous refreshes.

<a id="core-04"></a>
### CORE-04 — Unknown URLs render a blank page (no catch-all route)
- Severity: Medium
- Category: UX
- Location: `apps/web/src/router/index.ts:13-112`, `apps/web/src/router/guard.ts:14-27`
- Problem: There is no `/:pathMatch(.*)*` route. For a mistyped or stale URL (e.g. `/foo`, `/schedule/5`), `to.matched` is empty and `to.meta` is `{}`: an authenticated user passes the guard (`return true`) and App.vue renders an empty `<RouterView />` - no layout, no sidebar, no message. An unauthenticated user goes to `/login?redirect=/foo` and after signing in LoginPage pushes back to the same blank page.
- Fix: add as the last top-level route `{ path: "/:pathMatch(.*)*", redirect: { name: "home" } }` (no new page or locale keys needed). Test: create the router with memory history, authenticate the store, `router.push("/does-not-exist")` ends on `home`.
- Confidence: High - grep for `pathMatch`/catch-all in apps/web/src returns nothing; App.vue template is only `<RouterView />`.

<a id="core-05"></a>
### CORE-05 — 401 business errors from /auth/login and /auth/change-password trigger a refresh and replay
- Severity: Low
- Category: Correctness
- Location: `apps/web/src/lib/http.ts:51-53,71-74`; related `apps/api/src/services/auth.service.ts` (`login`: 401 "Invalid credentials"; `changePassword`: 401 "Current password is incorrect"), `apps/web/src/__tests__/ProfilePage.test.ts:134`
- Problem: Only `/auth/refresh` is excluded from refresh-on-401, but the API returns 401 for wrong credentials. (a) Every failed sign-in fires an extra `POST /auth/refresh` (counts against the refresh rate limit, 60 per 15 min) and runs the refresh handler; if a valid refresh cookie exists while on /login (the guard lets authenticated users open /login), a wrong password silently restores the previous session into the store (`refresh()` sets `user`/`accessToken`) while the form shows "Invalid credentials". (b) Every wrong current password on Profile rotates the refresh token and replays the change-password request (second bcrypt compare, second 401). ProfilePage.test mocks this error with status 400, so the real 401 path is untested.
- Fix: in http.ts skip refresh for the login endpoint too: `function skipsRefresh(path: string): boolean { return path.startsWith("/auth/login") || path.startsWith("/auth/refresh") }` replacing `isRefreshPath`. For change-password do not skip in the client (an expired access token there must still refresh); instead change the API to `throw new HttpError(400, "Current password is incorrect")` in `apps/api/src/services/auth.service.ts` `changePassword` and update the API auth tests (401 should mean "not authenticated"). Tests: http.test.ts - a 401 on `/auth/login` calls fetch once and never calls the refresh handler; ProfilePage.test keeps status 400 (now matching the API).
- Confidence: High - API statuses read in auth.service.ts; http.ts exclusion list read.
- **Scope note:** the login half is web-only. The change-password half changes an API status code (401 → 400); implement it only if API changes are in scope.

<a id="core-06"></a>
### CORE-06 — Stale lazy chunks after a deploy make navigation silently fail
- Severity: Low
- Category: Bug
- Location: `apps/web/src/router/index.ts:114-119`; related `apps/web/nginx.conf:30-35`, `apps/web/Dockerfile:50`
- Problem: Every page is a lazy route chunk (`() => import("../pages/...")`). The runtime image contains only the new `dist`, so after a deploy a tab still running the old bundle requests old hashed chunk names -> nginx 404 (asset regex location, no fallback) -> the dynamic import rejects -> vue-router aborts the navigation. There is no `router.onError`, so clicking a sidebar link does nothing until the user reloads manually.
- Fix: in `router/index.ts` after `beforeEach`:
  ```ts
  router.onError((err, to) => {
    if (/dynamically imported module|Importing a module script failed/i.test(String(err))) window.location.assign(to.fullPath)
  })
  ```
  Test: with a router whose route component rejects with `new TypeError("Failed to fetch dynamically imported module")`, pushing to it calls a stubbed `window.location.assign` with the target path.
- Confidence: High - no `onError`/`vite:preloadError` handler in apps/web/src (grep); every page is lazy.

<a id="core-07"></a>
### CORE-07 — Network failures surface raw, untranslated browser text
- Severity: Low
- Category: i18n
- Location: `apps/web/src/lib/http.ts:58-69`; consumers e.g. `apps/web/src/pages/UsersPage.vue:125`, `apps/web/src/pages/ScheduleOptionsPage.vue:89`
- Problem: `fetch` rejects with a `TypeError` ("Failed to fetch" in Chromium, "NetworkError when attempting to fetch resource." in Firefox) when the API is unreachable or the connection drops. `request()` does not catch it and pages render `e instanceof Error ? e.message : t(...)`, so Greek users see an English browser string and the localized fallback is never reached.
- Fix: in `request()` wrap the fetch inside `send`: `try { return await fetch(...) } catch { throw new ApiError(i18n.global.t("http.networkError"), 0) }` (make `send` async). Add `http.networkError` to en.json ("Cannot reach the server. Check your connection and try again.") and el.json ("Δεν είναι δυνατή η σύνδεση με τον διακομιστή. Ελέγξτε τη σύνδεσή σας και δοκιμάστε ξανά."). Test in http.test.ts: fetch rejecting with `TypeError` -> `ApiError` with status 0 and the translated message.
- Confidence: High - read http.ts and page catch blocks.

<a id="core-08"></a>
### CORE-08 — Dead code: unused service/store functions, types barrel, zod dependency
- Severity: Low
- Category: Dead code
- Location: `apps/web/src/stores/auth.ts:52-54,110` (`fetchMe`) and `apps/web/src/services/auth.ts:24-27` (`fetchMe`, only caller is the store action); `apps/web/src/services/user.ts:8-15` (`get`, `create` - UsersPage creates accounts via `doctorService.create`); `apps/web/src/services/doctor.ts:8-11` (`get`); `apps/web/src/types/index.ts` (nothing imports `@/types`); `apps/web/package.json:29` (`zod` - no `from "zod"` in apps/web; schemas come from `@oncall/shared`, which declares its own zod)
- Problem: Unreferenced code and dependency kept alive only by test mocks. `UsersPage.test.ts:213,320` assert `expect(create).not.toHaveBeenCalled()` on the dead `userService.create` mock, so those assertions are vacuous.
- Fix: delete the functions, the `fetchMe` store action/return entry, `src/types/`, and the `zod` dependency (then `pnpm install` to update the lockfile). Remove `fetchMe` from the service mocks in `auth.store.test.ts`, `LoginPage.test.ts`, `ProfilePage.test.ts`; remove `get`/`create` from the `@/services/user` mock in `UsersPage.test.ts` and point the two `not.toHaveBeenCalled()` assertions at the `doctorService.create` mock instead.
- Confidence: High - import-aware node script over apps/web/src (excluding __tests__) found no callers; grep confirms.
- **Conflict:** if ADM-05 is implemented (it imports `type ZodIssue` from `zod`), **keep** the `zod` dependency in `apps/web/package.json`; delete only the dead functions and `src/types/`.

<a id="core-09"></a>
### CORE-09 — Access-token ownership split between services and store
- Severity: Low
- Category: Simplification
- Location: `apps/web/src/services/auth.ts:4-22`, `apps/web/src/stores/auth.ts:17-50`
- Problem: `services/auth.ts` calls `setAccessToken` in `login`/`refresh`/`logout`, while the store also clears it in `clearSession()` and keeps its own `accessToken` ref; logout has `try/finally` in the service plus `try/catch {}/finally` in the store. Two modules mutate the http token - exactly the drift the store comment ("so the two never drift") warns about.
- Fix: make the store the only owner. Services return data only (drop the `setAccessToken` import/calls and the try/finally in `services/auth.ts`). Store: `function setSession(data: LoginResponse): void { user.value = data.user; accessToken.value = data.accessToken; setAccessToken(data.accessToken) }` used by `login` and `refresh`; `logout` becomes `try { await authService.logout() } catch { /* best effort: the cookie is cleared server side when reachable */ } clearSession()`. Update `auth.store.test.ts` to assert the Authorization header after login/refresh and its absence after logout.
- Confidence: High - read both files.
- **Order:** implement together with CORE-02 (both edit `stores/auth.ts`).

<a id="core-10"></a>
### CORE-10 — Four hand-rolled query-string builders
- Severity: Low
- Category: Simplification
- Location: `apps/web/src/services/query.ts:1-8`, `apps/web/src/services/holiday.ts:4-8`, `apps/web/src/services/unavailability.ts:10-17`, `apps/web/src/services/activity.ts:5-13`, `apps/web/src/services/settings.ts:16-18,39-43`
- Problem: Each module builds query strings its own way (string concat in three, `URLSearchParams` in activity, ternary paths in settings); only activity encodes values.
- Fix: one helper in `services/query.ts`:
  ```ts
  export function toQuery(params: Record<string, string | number | undefined> = {}): string {
    const qs = new URLSearchParams()
    for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== "") qs.set(k, String(v))
    const s = qs.toString()
    return s ? `?${s}` : ""
  }
  ```
  Use it in holiday (`/holidays${toQuery({ year, clinicId })}`), unavailability (delete local `toQuery`), activity (`/activity${toQuery({ ...query })}`), settings (`/settings/duty-slots${toQuery({ clinicId })}`, same for duty-minimums), schedule/stats/reports (already use it). Existing service-level tests keep passing; add one unit test for `toQuery` (skips undefined/empty, encodes).
- Confidence: High - read all five services.
- **Order:** implement after ADM-14 (which removes the `clinicId` arguments from the holiday/settings services), so the helper is only applied to the parameters that remain.

<a id="core-11"></a>
### CORE-11 — Web Docker build copies the API sources
- Severity: Low
- Category: Config
- Location: `apps/web/Dockerfile:34`
- Problem: `COPY apps/api ./apps/api` is not needed for the SPA build (`vue-tsc`/`vite` read only `apps/web/src` and `packages/*`; `apps/api/package.json` is already copied for the frozen install). Any API-only change invalidates the web build layer and forces a full `vue-tsc --noEmit && vite build` in CI/release.
- Fix: delete line 34.
- Confidence: High - `apps/web/tsconfig.json` includes only `src/**`; no web import of apps/api (grep; ScheduleOptionsPage even notes "apps/api cannot be imported here").

<a id="core-12"></a>
### CORE-12 — nginx serves assets uncompressed; hashed assets cached only 7 days
- Severity: Low
- Category: Performance
- Location: `apps/web/nginx.conf:30-35`
- Problem: The template replaces only `conf.d/default.conf`; the stock `nginx:alpine` `/etc/nginx/nginx.conf` ships with `#gzip on;`, so JS/CSS/JSON go out uncompressed. Vite fingerprinted files under `/assets/` never change, yet get `expires 7d` plus a second `Cache-Control: public, immutable` header (two Cache-Control headers).
- Fix: in the `server` block add `gzip on; gzip_types text/css application/javascript application/json image/svg+xml; gzip_min_length 1024;`. Replace the regex asset location with `location ^~ /assets/ { include /etc/nginx/snippets/security-headers.conf; add_header Cache-Control "public, max-age=31536000, immutable"; try_files $uri =404; }` (no `expires`).
- Confidence: High for the missing gzip and header duplication (nginx official image defaults); impact is performance only.

<a id="core-13"></a>
### CORE-13 — tsconfig.node.json is orphaned; vite.config.ts is never type-checked
- Severity: Low
- Category: Config
- Location: `apps/web/tsconfig.node.json:1-8`, `apps/web/tsconfig.json:11`, `apps/web/package.json:8,11`
- Problem: `vue-tsc --noEmit` uses `tsconfig.json`, which includes only `src/**` and has no `references`; nothing (scripts, eslint config, CI) points at `tsconfig.node.json`, so it is dead config and `vite.config.ts` is never type-checked.
- Fix: delete `tsconfig.node.json` (simplest; matches current behaviour) - or, if config type-checking is wanted, drop `"composite": true`, add `"noEmit": true`, and append `&& vue-tsc --noEmit -p tsconfig.node.json` to the `typecheck` script.
- Confidence: High - grep for `tsconfig.node` across root/web package.json, eslint.config.mjs and CI returns nothing.


## B. UI primitives, layout, styles

<a id="ui-01"></a>
### UI-01 — Docked sidebar traps Tab focus on desktop; drawer focus trap leaks on mobile
- Severity: High
- Category: A11y
- Location: `apps/web/src/composables/useModal.ts:4-5`, `apps/web/src/composables/useModal.ts:20-22`, `apps/web/src/composables/useModal.ts:50-67`, `apps/web/src/components/layout/AppSidebar.vue:47`, `apps/web/src/components/layout/AppSidebar.vue:128-135`, `apps/web/src/components/layout/AppSidebar.vue:172-184`
- Problem: `AppSidebar` calls `useModal(() => drawerOpen.value, panel)` on an `<aside>` that is **always mounted** (it is the docked sidebar from `xl` up). `useModal` registers its Tab-trap with `useEventListener(panel, "keydown", …)` and the handler never checks `open()` — it only does `if (e.key !== "Tab") return`. Two concrete failures:
  1. Desktop (≥1280px, drawer closed): the sidebar is first in DOM order. A keyboard user tabbing from the top enters the sidebar, reaches the last focusable (the "Collapse sidebar" button) and the handler does `current === last → e.preventDefault(); first.focus()` — focus wraps back to the brand link. Shift+Tab on the brand link wraps to the collapse button. **Main content is unreachable by keyboard** on every page.
  2. Mobile drawer open: `focusables()` uses a pure selector list (`button:not([disabled])`, …) with no visibility filter, so `last` is the collapse button, which is `hidden … xl:flex` (display:none below xl). Tab on the real last visible control (Logout) is not `=== last`, so default Tab moves focus out of the modal drawer into the page behind the backdrop; Shift+Tab on the first item calls `last.focus()` on a display:none element (no-op) after `preventDefault`, so focus gets stuck. The close button (`xl:hidden`) has the mirror problem on desktop.
- Fix: in `useModal.ts`, gate the trap on the open state and only count rendered elements:
  ```ts
  function focusables(): HTMLElement[] {
    return Array.from(panel.value?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? []).filter(
      // jsdom has no checkVisibility; treat everything as visible there
      (el) => el.checkVisibility?.({ visibilityProperty: true }) ?? true,
    )
  }
  …
  useEventListener(panel, "keydown", (e: KeyboardEvent) => {
    if (e.key !== "Tab" || !open()) return
    …
  })
  ```
  Tests (`src/__tests__/AppSidebar.test.ts`): mount with `open: false`, focus the last button inside `<aside>`, dispatch a cancelable Tab keydown on it and assert `defaultPrevented === false` (trap inactive when closed). Keep the existing Dialog trap test green (`Dialog.test.ts:72-85`).
- Confidence: High (read `useModal.ts` listener — no `open()` guard; `AppSidebar.vue` keeps `<aside>` mounted with `xl:visible`; collapse button classes `hidden … xl:flex`, close button `xl:hidden`).

<a id="ui-02"></a>
### UI-02 — `dark:` utilities follow the OS theme, not the app `.dark` class
- Severity: Medium
- Category: Bug
- Location: `apps/web/src/style.css:1`, `apps/web/src/components/ui/Avatar.vue:6-15`
- Problem: The app themes by toggling `.dark` on `<html>` (`App.vue` watch, `style.css:67`). Tailwind v4 (`tailwindcss ^4.0.0`) defaults the `dark:` variant to `@media (prefers-color-scheme: dark)`, and `style.css` declares no `@custom-variant dark`. Avatar is the only `dark:` consumer: `"bg-violet-500/15 text-violet-700 dark:text-violet-300"` etc. A user with OS dark mode but app light mode gets `text-*-300` initials on a light card (poor contrast); app dark mode on a light OS gets `text-*-700` on a near-black background. Visible in the sidebar, Users table, Admin dashboard, Profile header.
- Fix: add right after `@import "tailwindcss";` in `style.css`:
  ```css
  @custom-variant dark (&:where(.dark, .dark *));
  ```
  No component change needed.
- Confidence: High (grep: no `custom-variant`/`@variant` anywhere in `apps/web`; only one CSS file; Tailwind v4 in `package.json`).

<a id="ui-03"></a>
### UI-03 — Clicking the backdrop to dismiss an open Select also closes the enclosing Dialog
- Severity: Medium
- Category: UX
- Location: `apps/web/src/components/ui/Select.vue:213-218`, `apps/web/src/components/ui/Dialog.vue:72-75`; reachable in `apps/web/src/pages/AvailabilityPage.vue:415-422` (doctor `<Select>` inside the exclusion `<Dialog>`)
- Problem: Select dismisses on outside clicks with a bubble-phase `document` click listener and lets the click continue. When the Select lives in a Dialog, the area outside the listbox is the Dialog backdrop, whose own handler `@click="closeIfTop"` runs first (Dialog is still top — Select is not in `openStack`). One click intended to close the dropdown closes the dropdown **and** the dialog, discarding the unsaved form. Escape already has the correct popover-first semantics (capture + `stopPropagation`), so the click path is inconsistent with the intent.
- Fix: make the outside-click dismissal consume the click, mirroring the Escape handler:
  ```ts
  useEventListener(
    document,
    "click",
    (e: MouseEvent) => {
      if (!open.value) return
      const t = e.target as Node
      if (root.value?.contains(t) || panel.value?.contains(t)) return
      open.value = false
      // The dismissing click must not also activate what is underneath (e.g. a Dialog backdrop).
      e.stopPropagation()
    },
    { capture: true },
  )
  ```
  Test (`src/__tests__/Select.test.ts` or `Dialog.test.ts`): mount a Dialog containing a Select, open the listbox, click the backdrop (`.animate-dialog-backdrop`), assert listbox removed and Dialog did not emit `update:open`.
- Confidence: High (read both handlers; Dialog backdrop handler is an element listener so it runs before the document bubble listener).

<a id="ui-04"></a>
### UI-04 — Tab out of DatePicker/MonthPicker popover leaves it open and strands focus
- Severity: Medium
- Category: A11y
- Location: `apps/web/src/components/ui/DatePicker.vue:184-193`, `apps/web/src/components/ui/MonthPicker.vue:165-174` (panels), `apps/web/src/components/ui/DatePicker.vue:101-104` / `apps/web/src/components/ui/MonthPicker.vue:86-89` (`close()`)
- Problem: Both panels are teleported to the end of `<body>`, focus is moved into them on open, and the only dismissals are pointer outside-click, Escape and picking. There is no Tab handling. Tab from the last button (DatePicker "Today", MonthPicker "Dec") moves focus past the end of the document (browser chrome) while the fixed panel stays open; Shift+Tab from the first button jumps to the last focusable element of the page (e.g. a pagination button at the bottom of ActivityPage), again with the panel floating open and far from the trigger in tab order. Select already solves this (`onKeydown` Tab → `closeToTrigger()`).
- Fix: add a panel keydown handler in both components that closes back to the trigger when Tab would leave the panel; `close()` refocuses the trigger synchronously, so the default Tab then continues from the trigger:
  ```ts
  function onPanelKeydown(e: KeyboardEvent) {
    if (e.key !== "Tab" || !panel.value) return
    const items = panel.value.querySelectorAll<HTMLElement>("button:not([disabled])")
    const active = document.activeElement
    const leaving = e.shiftKey
      ? active === panel.value || active === items[0]
      : active === items[items.length - 1]
    if (leaving) close()
  }
  ```
  and `@keydown="onPanelKeydown"` on the `role="dialog"` panel div. Tests in `DatePicker.test.ts` / `MonthPicker.test.ts`: open, focus last button, dispatch Tab keydown, assert panel removed and `document.activeElement === trigger`.
- Confidence: High (read both components: no keydown/focusout handling on the panel).

<a id="ui-05"></a>
### UI-05 — ConfirmDialog message is never announced to screen readers
- Severity: Medium
- Category: A11y
- Location: `apps/web/src/components/ui/ConfirmDialog.vue:34`, `apps/web/src/components/ui/ConfirmDialog.vue:43`, `apps/web/src/components/ui/Dialog.vue:76-83`
- Problem: Dialog exposes only `aria-labelledby` (the title). ConfirmDialog renders the actual question in `<p class="pt-2 …">{{ request.message }}</p>` with no id, and its watcher moves focus straight to a footer button. A screen-reader user hears "Delete user, dialog, Cancel, button" but never the message that explains what is being confirmed (e.g. which user, "cannot be undone"). For destructive confirmations this is the critical content. The APG alert-dialog pattern requires `role="alertdialog"` + `aria-describedby` for exactly this case.
- Fix: in `Dialog.vue` add two optional props and bind them on the panel:
  ```ts
  const props = defineProps<{ open: boolean; title?: string; describedby?: string; alert?: boolean }>()
  ```
  ```html
  :role="alert ? 'alertdialog' : 'dialog'"
  :aria-describedby="describedby"
  ```
  In `ConfirmDialog.vue`: `const messageId = useId()`, `<Dialog alert :describedby="messageId" …>` and `<p :id="messageId" …>`. Test in `ConfirmDialog.test.ts`: panel has `role="alertdialog"` and `document.getElementById(panel.getAttribute("aria-describedby")).textContent === "m"`.
- Confidence: High (read Dialog panel attributes and ConfirmDialog template).

<a id="ui-06"></a>
### UI-06 — Labelled DatePicker/MonthPicker triggers hide the selected value from assistive tech
- Severity: Medium
- Category: A11y
- Location: `apps/web/src/components/ui/DatePicker.vue:151-166`, `apps/web/src/components/ui/MonthPicker.vue:131-147`; call sites `apps/web/src/pages/ActivityPage.vue:167-172`, `apps/web/src/pages/UsagePage.vue:147-148`, `apps/web/src/pages/AvailabilityPage.vue:361-362`, `apps/web/src/pages/HolidaysPage.vue:167-168`, `apps/web/src/pages/MyAvailabilityPage.vue:209-210`
- Problem: Every caller labels the trigger with `<Label for="…">` + `id`, which is the intended usage. For a `<button>`, HTML-AAM computes the accessible name from an associated `<label>` **before** falling back to the button subtree, so the name becomes just "From" / "Month" / "Paid through"; the selected value rendered in `<span class="truncate">{{ triggerLabel || … }}</span>` is dropped. The trigger is a plain button (not a combobox), so there is no value channel either: a screen-reader user cannot tell which date/month is currently set without opening the popover. (Select is unaffected in practice because `role="combobox"` exposes its text as the value.)
- Fix: give the value span an id and reference it as the description on the trigger, in both components:
  ```ts
  const valueId = useId()
  ```
  ```html
  <button … :aria-describedby="valueId">
    <Calendar … aria-hidden="true" />
    <span :id="valueId" class="truncate">{{ triggerLabel || props.placeholder || t("datePicker.selectDate") }}</span>
  ```
  Tests (`DatePicker.test.ts`, `MonthPicker.test.ts`): with a model value set, the element referenced by the trigger `aria-describedby` contains the formatted date/month.
- Confidence: Medium (accessible-name rule per HTML-AAM button computation; verified every call site uses `Label for` + `id`; not checked with a live screen reader).

<a id="ui-07"></a>
### UI-07 — Select listbox is not clamped to the viewport horizontally
- Severity: Low
- Category: UX
- Location: `apps/web/src/components/ui/Select.vue:112-136`; triggered from `apps/web/src/components/schedule/DutyCalendar.vue:196-209`
- Problem: `positionPanel()` sets `p.style.left = r.left` and `p.style.width = max(r.width, 176)` with no right-edge clamp (DatePicker/MonthPicker clamp with `Math.min(r.left, window.innerWidth - p.offsetWidth - margin)`). DutyCalendar renders a Select per slot in a 7-column grid (`min-w-[760px]`, cells ≈100–130px wide). Opening a Saturday/Sunday slot near the right edge (e.g. xl viewport with the 256px sidebar, or a phone after horizontally scrolling the calendar) puts a 176px fixed panel partly off-screen; the fixed panel cannot be scrolled into view, so doctor names are cut off.
- Fix:
  ```ts
  const width = Math.max(r.width, 176)
  p.style.width = `${width}px`
  p.style.left = `${Math.max(margin, Math.min(r.left, window.innerWidth - width - margin))}px`
  ```
  Test in `Select.test.ts`: stub `getBoundingClientRect` on the trigger with `left: window.innerWidth - 50, width: 40`, open, assert `parseFloat(panel.style.left) + 176 <= window.innerWidth`.
- Confidence: High (read `positionPanel`; DutyCalendar uses `<Select>` in grid cells).

<a id="ui-08"></a>
### UI-08 — Select combobox misses `aria-controls` and arrow-key opening
- Severity: Low
- Category: A11y
- Location: `apps/web/src/components/ui/Select.vue:249-262`, `apps/web/src/components/ui/Select.vue:275-284`
- Problem: The trigger is `role="combobox"` with `aria-haspopup="listbox"` / `aria-expanded`, but has no `aria-controls` pointing at the listbox (required by ARIA 1.2 combobox when the popup is shown), and the listbox has no id to point to. The trigger also only reacts to click (Enter/Space); ArrowDown/ArrowUp on the focused closed combobox do nothing, unlike the APG select-only combobox and the native `<select>` this component claims to replace.
- Fix: `const listboxId = uid + "-listbox"`; on the panel `:id="listboxId"`; on the trigger `:aria-controls="open ? listboxId : undefined"` and
  ```ts
  function onTriggerKeydown(e: KeyboardEvent) {
    if (!open.value && (e.key === "ArrowDown" || e.key === "ArrowUp")) {
      e.preventDefault()
      toggle()
    }
  }
  ```
  bound with `@keydown="onTriggerKeydown"`. Test: ArrowDown on trigger opens the listbox and `trigger.getAttribute("aria-controls") === panel.id`.
- Confidence: High (read template).

<a id="ui-09"></a>
### UI-09 — Avatar initials are read aloud next to the full name
- Severity: Low
- Category: A11y
- Location: `apps/web/src/components/ui/Avatar.vue:43-47`; call sites `apps/web/src/components/layout/AppSidebar.vue:156`, `apps/web/src/pages/UsersPage.vue:334`, `apps/web/src/components/dashboard/AdminDashboard.vue:208`, `apps/web/src/pages/ProfilePage.vue:130`
- Problem: Avatar renders initials as plain text in a `<span>`. Every call site places the full name immediately next to it, so screen readers announce "US U Ser", "JD John Doe" in table cells and the sidebar. The avatar is purely decorative.
- Fix: add `aria-hidden="true"` to the root `<span>` in `Avatar.vue`. Update `Avatar.test.ts` to assert the attribute.
- Confidence: High (checked all 4 call sites render the name adjacent).

<a id="ui-10"></a>
### UI-10 — No nav item is active while a doctor views a schedule
- Severity: Low
- Category: UX
- Location: `apps/web/src/components/layout/AppSidebar.vue:66-70`, `apps/web/src/components/layout/AppSidebar.vue:91-94`
- Problem: Doctors get "Duty roster" (`/roster`) but not "Schedules". The roster "View" button navigates to `/schedules/:id` (`ScheduleRosterPage.vue:41-43`). `isActive("/roster")` only matches `/roster` and `/roster/…`, so on the schedule detail page the sidebar highlights nothing and the user loses their place.
- Fix: let nav items declare extra active prefixes and use them in `isActive`:
  ```ts
  const items: { to: string; label: string; icon: Component; activeAlso?: string[] }[] = …
  items.push({ to: "/roster", label: t("nav.dutyRoster"), icon: CalendarCheck2, activeAlso: ["/schedules"] })
  …
  function isActive(item: { to: string; activeAlso?: string[] }): boolean {
    if (item.to === "/") return route.path === "/"
    return [item.to, ...(item.activeAlso ?? [])].some((p) => route.path === p || route.path.startsWith(p + "/"))
  }
  ```
  and `isActive(item)` in the template. Test in `AppSidebar.test.ts`: mock `useRoute` to `{ path: "/schedules/5" }` for a doctor and assert the roster link has `is-active`.
- Confidence: High (read router, roster navigation, `isActive`).
- **Dependency:** skip this finding if SCH-10 is implemented (the doctor link then points at `/schedules`, which `isActive` already matches for `/schedules/:id`).

<a id="ui-11"></a>
### UI-11 — Sidebar JS breakpoint (px) can disagree with the Tailwind `xl` breakpoint (rem)
- Severity: Low
- Category: Bug
- Location: `apps/web/src/components/layout/AppSidebar.vue:44`
- Problem: `useMediaQuery("(min-width: 1280px)")` decides whether the drawer is modal, while every layout class (`xl:visible`, `xl:translate-x-0`, `xl:hidden` on the AppLayout header, `xl:pl-64`) uses Tailwind v4 `xl` = `80rem`. In media queries `rem` is the browser default font size, so a user who raised it (e.g. 20px for accessibility) gets `xl` = 1600px. Between 1280px and 1600px the CSS shows the mobile header + off-canvas sidebar, but `isDesktop` is true: tapping the hamburger slides the sidebar in with `drawerOpen === false` — no backdrop, no scroll lock, no focus move/trap, no Escape — and `watch(isDesktop)` never closes it.
- Fix: `const isDesktop = useMediaQuery("(min-width: 80rem)")` so JS and CSS share one unit.
- Confidence: High (Tailwind v4 default `--breakpoint-xl: 80rem`; read AppSidebar/AppLayout classes).

<a id="ui-12"></a>
### UI-12 — Dialog `onClickOutside` is dead code
- Severity: Low
- Category: Dead code
- Location: `apps/web/src/components/ui/Dialog.vue:13`, `apps/web/src/components/ui/Dialog.vue:37-39`
- Problem: The Dialog overlay is `fixed inset-0` and carries `data-popover-layer`; the panel sits inside it. Any pointer event outside the panel therefore lands on the overlay/backdrop, which matches the `ignore: ["[data-popover-layer]"]` selector, so the `onClickOutside(panel, closeIfTop, …)` callback can never fire (there is no higher, non-popover layer in the app — checked: no toast/other `z-50+` surfaces). Backdrop dismissal is entirely handled by the backdrop `@click="closeIfTop"`. The comment above it describes behaviour that the handler does not provide.
- Fix: delete the `onClickOutside` call and its comment, and drop `onClickOutside` from the `@vueuse/core` import. Existing Dialog/ConfirmDialog tests that click the backdrop keep passing.
- Confidence: High (read Dialog template/handlers; grep for other overlay layers).

<a id="ui-13"></a>
### UI-13 — Unused component, variants and theme tokens
- Severity: Low
- Category: Dead code
- Location: `apps/web/src/components/ui/CardFooter.vue` (whole file); `apps/web/src/components/ui/Button.vue:19-20` (`accent` variant), `apps/web/src/components/ui/Button.vue:25-26` (`lg`, `icon` sizes); `apps/web/src/style.css:34-35`, `apps/web/src/style.css:37`, `apps/web/src/style.css:39`, `apps/web/src/style.css:90-91`, `apps/web/src/style.css:94`, `apps/web/src/style.css:97`, `apps/web/src/style.css:130-131`, `apps/web/src/style.css:135`, `apps/web/src/style.css:137`, and the matching lines in the print block (`style.css:558-563`); `apps/web/src/style.css:574-576` (`.container`)
- Problem: Verified by grep over `apps/web/src` (pages, components, tests):
  - `CardFooter.vue` is imported nowhere.
  - `<Button>` is never rendered with `variant="accent"`, `size="lg"` or `size="icon"` (the only `variant="accent"` / `size="lg"` hits are on `<Badge>` and `<Avatar>`; the only dynamic `:variant` on Button yields `default|destructive`).
  - Tokens `--info`, `--info-foreground`, `--success-foreground`, `--warning-foreground` and their `--color-*` mappings are never consumed (no `*-info`, `success-foreground`, `warning-foreground` utilities anywhere).
  - The print rule `.container { max-width: 100% }` targets a class that is not used in any template.
- Fix: delete `CardFooter.vue`; remove the `accent` variant and `lg`/`icon` sizes from `buttonVariants`; remove the four tokens from `:root`, `.dark`, the print `.dark` block and `@theme inline`; delete the `.container` print rule.
- Confidence: High (grep results listed above).

<a id="ui-14"></a>
### UI-14 — Print palette duplicates the whole light theme
- Severity: Low
- Category: Simplification
- Location: `apps/web/src/style.css:67-112`, `apps/web/src/style.css:539-569`
- Problem: `@media print { .dark { … } }` re-declares 27 light-theme token values copied from `:root` so print ignores dark mode. Any future token change must be made in two places (the copy already omits `--brand-gradient`, `--grid-line` and the aurora tokens, so those still use dark values in print).
- Fix: scope the dark theme to screens instead of undoing it for print: wrap the existing `.dark { … }` block (lines 67-112) in `@media screen { … }` and delete the `.dark { … }` block inside `@media print` (lines 541-569). Print then falls back to `:root` automatically.
- Confidence: High (diffed the two blocks: values match `:root`).

<a id="ui-15"></a>
### UI-15 — CalendarDialog re-implements the Dialog shell outside the dialog stack
- Severity: Low
- Category: Simplification
- Location: `apps/web/src/components/ui/CalendarDialog.vue:94-108`, `apps/web/src/components/ui/CalendarDialog.vue:111-143`; `apps/web/src/components/ui/Dialog.vue:65-101`
- Problem: CalendarDialog copies the Dialog overlay, backdrop, panel, close button, title/`useId` wiring, `useModal` call and its own document-capture Escape handler, and hard-codes `z-[60]` instead of joining Dialog's `openStack` (whose stated purpose is ordering stacked dialogs). Two copies of the same modal shell must be kept in sync (a11y fixes such as UI-05 have to be applied twice).
- Fix: add to `Dialog.vue` the two props CalendarDialog needs — `panelClass?: string` (merged into the panel classes via `cn`, to pass `max-w-sm p-3`) and `ariaLabel?: string` (used when `title` is absent) — then render CalendarDialog as `<Dialog :open="open" :title="title" :aria-label="title ? undefined : t('calendarDialog.pickDays')" panel-class="max-w-sm p-3" @update:open="emit('update:open', $event)">` containing only the month header, grid, counter and the Cancel/Confirm footer. Remove CalendarDialog's Teleport/overlay markup, `useModal`, the Escape listener and `panel`/`titleId` refs (the stack makes it top-most, so the parent Dialog ignores Escape/backdrop automatically). Keep `CalendarDialog.test.ts` assertions (`aria-labelledby`, focus in panel, focus restore) passing.
- Confidence: High (side-by-side read of both files).
- **Order:** implement before or together with UI-05 so the a11y fix only has to be made in `Dialog.vue`.

<a id="ui-16"></a>
### UI-16 — Popover plumbing is copy-pasted across Select, DatePicker and MonthPicker
- Severity: Low
- Category: Simplification
- Location: `apps/web/src/components/ui/DatePicker.vue:69-86`, `apps/web/src/components/ui/DatePicker.vue:88-104`, `apps/web/src/components/ui/DatePicker.vue:121-146`; `apps/web/src/components/ui/MonthPicker.vue:54-71`, `apps/web/src/components/ui/MonthPicker.vue:73-89`, `apps/web/src/components/ui/MonthPicker.vue:101-126`; `apps/web/src/components/ui/Select.vue:112-157`, `apps/web/src/components/ui/Select.vue:213-244`
- Problem: DatePicker and MonthPicker `positionPanel()` are byte-identical; all three components duplicate the same open/toggle-then-focus-panel, close-to-trigger, scroll-closes, Escape capture-and-stop, and outside-click logic (Select with a hand-rolled document listener, the pickers with `onClickOutside`). The duplicates have already drifted: only DatePicker/MonthPicker clamp horizontally (UI-07), only Select handles Tab (UI-04).
- Fix: extract `src/composables/usePopover.ts` that owns `open`, `toggle(beforeOpen?)`, `close()` (refocus trigger), a single `positionPanel()` (horizontal clamp + flip; Select passes its min width and max-height option), the outside-click (capture + stopPropagation, see UI-03), scroll-close, Escape and Tab-leaves-panel handlers; use it from all three components. Do this together with UI-03/UI-04/UI-07 so the fixes land once. Existing `Select.test.ts`, `DatePicker.test.ts`, `MonthPicker.test.ts` cover the behaviour.
- Confidence: High (side-by-side read).
- **Order:** implement together with UI-03, UI-04 and UI-07 (land those fixes once, inside the new composable), or skip UI-16 and apply the three fixes per component.


## C. Schedule pages, calendar, dashboards

<a id="sch-01"></a>
### SCH-01 — DutyCalendar hides duties beyond the day's *current* slot count
- Severity: High
- Category: Bug
- Location: `apps/web/src/components/schedule/DutyCalendar.vue:78-82` (also affects every consumer: `apps/web/src/pages/ScheduleDetailPage.vue:240-242`, `apps/web/src/pages/ScheduleOptionsPage.vue`, `apps/web/src/pages/ReportsPage.vue` roster calendar)
- Problem: The calendar builds exactly `slotsRequired` slots per day and drops any extra assignment:
  ```ts
  const required = day.slotsRequired
  const slotsArr = props.assignmentByDate.get(day.date) ?? []
  const slots = Array.from({ length: required }, (_, i) => slotsArr[i] ?? null)
  ```
  For a saved schedule, `slotsRequired` is **not** a property of the schedule — `getById` recomputes it from the clinic's current settings (`apps/api/src/services/schedule.service.ts:726-741` for doctors, `buildContext` at `:155-159` / `computeEligibility` at `:290` for admins). `setDutySlots` (`apps/api/src/services/settings.service.ts:115-172`) and the open-day cycle settings change those values without touching existing duties. Trigger: a schedule has 2 doctors on a closed day, then an admin lowers "closed slots" to 1 on the Rules page (or moves the open-day anchor so a former open day becomes closed). Opening that schedule now shows only the first doctor; the second doctor's duty is invisible to admins (who cannot clear it either — there is no select for it) and to doctors in the read-only published view (a doctor can't see they're on call). Fill hints/colours also count only the visible slice, so the day looks "full" while silently over-staffed.
- Fix: never render fewer slots than stored assignments; keep `required` for the hints:
  ```ts
  const required = day.slotsRequired
  const slotsArr = props.assignmentByDate.get(day.date) ?? []
  const slots: (CalendarAssignment | null)[] = Array.from(
    { length: Math.max(required, slotsArr.length) },
    (_, i) => slotsArr[i] ?? null,
  )
  ```
  (`slotOptions`, `filledCount`, `cellBg` work unchanged; in editable mode the extra slot gets a select whose "Unassigned" option lets the admin clear it because the detail page passes `allow-clear`.) Add a `DutyCalendar.test.ts` case: `slotsRequired: 1` with two assignments in `readonly` mode renders both names; in `editable` mode renders two comboboxes.
- Confidence: High (verified API recomputes `slotsRequired` from live settings on every `GET /schedules/:id`, and settings updates don't touch duties).

<a id="sch-02"></a>
### SCH-02 — Duty edits re-enable the cell before the refetch lands, and refetches are unordered
- Severity: Medium
- Category: Bug
- Location: `apps/web/src/pages/ScheduleDetailPage.vue:74-85` (`load`), `:166-170`, `:184-188`, `:200-204` (the three `finally` blocks); secondary: `apps/web/src/pages/SchedulesPage.vue:44-55` (same unguarded `load`)
- Problem: Each duty action does
  ```ts
  } finally {
    savingDates.value.delete(date)
    await load()
  }
  ```
  1) The day's select is re-enabled *before* `load()` resolves, so for the whole refetch (which is the expensive admin `getById` with full eligibility computation) the cell is interactive but still shows the pre-mutation slots and `dutyIdsByDate`. E.g. after removing a duty the slot still shows the removed doctor; picking another doctor there sends `PATCH /duties/<deleted id>` → 404 "Duty not found"; after adding a duty the slot still looks empty and a second pick sends a duplicate `POST` → 409. 2) `load()` has no `useLatestRequest` guard: editing two different dates in quick succession issues two `GET /schedules/:id`; if the first (issued before the second mutation committed) resolves last, `detail` is overwritten with data missing the second edit, and `loading` is cleared by whichever finishes first. The composable already exists and is used for exactly this in `ScheduleOptionsPage`/`SchedulePreviewPage`/`AdminDashboard`. `SchedulesPage.load` has the same unguarded pattern (Apply with year A, then year B; A's response arriving last shows A's list under filter B).
- Fix: guard `load` and release the cell only after the reload; collapse the three copies into one helper:
  ```ts
  const latest = useLatestRequest()
  async function load() {
    const isCurrent = latest.start()
    loading.value = true
    try {
      const res = await scheduleService.get(id)
      if (isCurrent()) detail.value = res
    } catch (e) {
      if (isCurrent()) errorMsg.value = e instanceof Error ? e.message : t('scheduleDetail.loadFailed')
    } finally {
      if (isCurrent()) loading.value = false
    }
  }

  async function runDutyAction(date: string, action: () => Promise<unknown>, failKey: string) {
    savingDates.value = new Set(savingDates.value).add(date)
    try {
      await action()
    } catch (e) {
      errorMsg.value = e instanceof Error ? e.message : t(failKey)
    } finally {
      await load()
      const next = new Set(savingDates.value)
      next.delete(date)
      savingDates.value = next
    }
  }
  ```
  and call `runDutyAction(date, () => scheduleService.removeDuty(dutyId), 'scheduleDetail.removeFailed')` etc. from `onSelect`. Apply the same `useLatestRequest` guard to `SchedulesPage.load`. Tests (ScheduleDetailPage.test.ts): (a) after `addDuty` resolves but before the reload resolves, the day's combobox is still `disabled`; (b) two edits whose reloads resolve out of order → calendar shows the newer response.
- Confidence: High (read both pages; `getById` admin path recomputes eligibility, so the window is non-trivial).

<a id="sch-03"></a>
### SCH-03 — Publish / Revert / Delete: no in-flight guard and no resync after a failed (409) state change
- Severity: Medium
- Category: Bug
- Location: `apps/web/src/pages/ScheduleDetailPage.vue:87-140`, buttons at `:227-231`
- Problem: (1) After confirming, the request runs with the header buttons still enabled; clicking Publish again opens a second confirm and fires a second `POST /publish`, which the API rejects with 409 "Schedule is already published" (`schedule.service.ts:1102`) — the page then shows an error alert although the publish succeeded. (2) On any failure the page keeps its stale `detail`. If another admin published/reverted/deleted the schedule meanwhile, the API answers 409 ("Schedule is already published" / "already draft" / "revert to draft before deleting") but the page still shows the old badge, the wrong primary action and (for a now-published schedule) editable selects; every further click fails the same way. The duty actions already reload after a failure; the schedule-level actions don't.
- Fix: add `const busy = ref(false)`; set it around the three requests and bind `:disabled="busy"` on Publish/Revert (and `busy || isPublished` on Delete). In each `catch`, after setting `errorMsg`, `await load()` (it intentionally does not clear `errorMsg`) so status/mode resync with the server. Tests: publish rejecting with `new ApiError('Schedule is already published', 409)` → `get` called a second time and the badge shows "Published"; publish button disabled while the promise is pending.
- Confidence: High (checked API 409 paths in `apps/api/src/services/schedule.service.ts:785,1102,1143`).

<a id="sch-04"></a>
### SCH-04 — Admin dashboard shows the previous month's figures after a failed load, labelled with the unapplied selection
- Severity: Medium
- Category: Correctness
- Location: `apps/web/src/components/dashboard/AdminDashboard.vue:48`, `:64-78`, `:131`
- Problem: `load()` never clears `stats` on error, and the month label is derived from the *input fields* rather than the loaded data:
  ```ts
  const monthLabel = computed(() => formatMonth(year.value, Number(month.value), intlLocale.value))
  ```
  Changing the month auto-reloads (`watch(month)`); if that request fails (network, or a half-typed year like `202` → 400), the error shows but the coverage/fairness/workload cards keep rendering the previous month's numbers under a month selector that now says the new month — the admin reads stale data as current. Separately, typing a new year without pressing Apply immediately re-labels the "No schedule for {month}" card with a year that was never loaded (and `''` renders as "… 1900" because `Date.UTC(0, …)` maps to 1900).
- Fix: in the `catch` (inside the `isCurrent()` branch) set `stats.value = null`; derive the label from the response: `const monthLabel = computed(() => stats.value ? formatMonth(stats.value.year, stats.value.month, intlLocale.value) : '')` (`AdminStats` already carries `year`/`month`, `packages/shared/src/types/stats.ts:33-36`). Test: first load OK, month change rejects → no coverage card rendered; typing a year without Apply doesn't change the no-schedule title.
- Confidence: High.

<a id="sch-05"></a>
### SCH-05 — `SchedulePreviewPage` is unreachable dead code since the options flow replaced it
- Severity: Medium
- Category: Dead code
- Location: `apps/web/src/pages/SchedulePreviewPage.vue` (whole file, 375 lines), route `apps/web/src/router/index.ts:62-67`, `apps/web/src/__tests__/SchedulePreviewPage.test.ts`, `apps/web/src/services/schedule.ts:22-28` (`preview`, only caller is this page), `apps/web/src/locales/en.json:224-246` + matching `el.json` block
- Problem: The only entry point (`SchedulesPage.runGenerate` pushing `/schedules/preview` on a 422) was removed in commit 4f2e576 ("Generate opens the options page"); nothing in `src/` links to `/schedules/preview` or the `schedule-preview` route any more (grep). The page, its test, the `preview` service function and most `schedulePreview.*` strings are maintained for a URL users can only reach by typing it. It also leaks into the live options page: `ScheduleOptionsPage.vue:160-163` reuses `schedulePreview.invalidMonth/invalidMonthHint/backToSchedules` and `:227` `schedulePreview.openOnCall`, so the options page tells users "Open this **preview** from the schedules list…".
- Fix: delete `SchedulePreviewPage.vue`, its route record, its test, and `scheduleService.preview`. Move the four strings the options page uses into `scheduleOptions` (`invalidMonth`, `invalidMonthHint` reworded to "Open schedule options from the schedules list to choose a valid month.", `backToSchedules`, `openOnCall`) in both `en.json` and `el.json`, update `ScheduleOptionsPage.vue` references, and delete the rest of the `schedulePreview` block. (`POST /schedules/preview` on the API becomes unused by the web; leave API changes to the API owner.)
- Confidence: High (grep for `schedules/preview|schedule-preview` in `apps/web/src` returns only the route and the service; git history confirms the entry point removal).
- **Needs decision before implementing:** `docs/admin-manual/manual.html` §6.2–6.3 and `AGENTS.md` ("Detect conflicts before schedule creation (`POST /schedules/preview`)") still describe a *Preview → resolve conflicts → Generate* workflow. Either (a) delete the page as described above **and** update the manual §6 to the options flow, or (b) restore an entry point to the preview page from `SchedulesPage`. Ask the user which; do not do both.

<a id="sch-06"></a>
### SCH-06 — Saving a plan / deleting a schedule uses `push`, so Back lands on a 409 / 404 page
- Severity: Low
- Category: UX
- Location: `apps/web/src/pages/ScheduleOptionsPage.vue:119`, `apps/web/src/pages/ScheduleDetailPage.vue:137`
- Problem: After "Use Plan X" the app `router.push`es `/schedules/:id`. Pressing browser Back returns to `/schedules/options?year&month`, which re-runs `POST /schedules/options`; `generateOptions` starts with `assertNoSchedule` (`schedule.service.ts:450`) so the page shows "Schedule already exists for this month; delete it first". Likewise after deleting a schedule, Back returns to the deleted `/schedules/:id` → "Schedule not found".
- Fix: use `router.replace(...)` in both places. Update `ScheduleOptionsPage.test.ts` ("Use Plan B" saves…) to expect `replace('/schedules/42')` (the mock already exposes `replace`), and add a delete test expecting `replace('/schedules')`.
- Confidence: High.

<a id="sch-07"></a>
### SCH-07 — Detail page always fetches `/doctors` (403 for doctors) and serialises it before the schedule load
- Severity: Low
- Category: Performance
- Location: `apps/web/src/pages/ScheduleDetailPage.vue:207-214`; test pinning it: `apps/web/src/__tests__/ScheduleDetailPage.test.ts` ("doctor sees read-only names even when doctor list is forbidden")
- Problem: `GET /doctors` is `authorize('administrator','manager')` (`apps/api/src/routes/doctor.routes.ts:14`), so for every doctor opening a schedule the page fires a request that is guaranteed to 403 and swallows it. For admins, `load()` only starts after the doctors request finishes, doubling time-to-calendar. The doctor list is only needed for the editable selects (`mode === 'editable'` requires `auth.isAdmin`).
- Fix:
  ```ts
  async function loadDoctors() {
    try { doctors.value = await doctorService.list() } catch { doctors.value = [] }
  }
  onMounted(() => Promise.all([auth.isAdmin ? loadDoctors() : undefined, load()]))
  ```
  Update the doctor test to assert `doctorList` is not called (drop the forbidden mock).
- Confidence: High.

<a id="sch-08"></a>
### SCH-08 — Option tabs don't implement the ARIA tabs keyboard pattern
- Severity: Low
- Category: A11y
- Location: `apps/web/src/pages/ScheduleOptionsPage.vue:178-198`
- Problem: The plan switcher declares `role="tablist"`/`role="tab"`, which tells screen readers to use Left/Right arrows, but there is no `@keydown` handling and every tab stays in the Tab order (no roving `tabindex`). Keyboard/screen-reader users get the tab semantics without the expected behaviour.
- Fix: on each tab add `:tabindex="i === selected ? 0 : -1"` and `@keydown.right.prevent="focusTab(i + 1)" @keydown.left.prevent="focusTab(i - 1)"` (plus Home/End), where `focusTab(n)` wraps `n` into range, sets `selected.value = n`, and focuses `#option-tab-${options.value[n].index}` after `nextTick`. Test: ArrowRight on tab A selects and focuses tab B.
- Confidence: High.

<a id="sch-09"></a>
### SCH-09 — Dead props/fields and duplicated assignment grouping around DutyCalendar; stale options constant
- Severity: Low
- Category: Dead code
- Location: `apps/web/src/components/schedule/DutyCalendar.vue:9-18` (`reason` field, `year`/`month` props); builders at `apps/web/src/pages/ScheduleDetailPage.vue:55-71`, `apps/web/src/pages/ScheduleOptionsPage.vue:58-66`, `apps/web/src/pages/ReportsPage.vue:~104-110`; `apps/web/src/pages/ScheduleOptionsPage.vue:18-22`
- Problem: DutyCalendar never reads `props.year`, `props.month` (the grid is derived from `days`) or `CalendarAssignment.reason` (grep), yet every caller passes year/month and copies `reason` into its `assignmentByDate` map; each page re-implements the same "group duties by date into `{doctorId, firstName, lastName}`" loop. In the options page, the comment says the estimate mirrors `SOLVER_BUDGET_MS (30 s)` but the constant uses `25_000`, and a commented-out alternative (`//const ESTIMATED_OPTIONS_MS = 60_000`) is left behind.
- Fix: remove `year`, `month` and `reason` from DutyCalendar's props/interface and from all `<DutyCalendar>` usages/tests; export the `CalendarAssignment` type (e.g. from a small `src/lib/calendar.ts` with `groupByDate(items, key)`) and use it in Detail/Options/Reports instead of the hand-rolled loops. In ScheduleOptionsPage delete line 22 and make the comment match the value (e.g. "~25 s typical primary solve (budget SOLVER_BUDGET_MS = 30 s) plus ALTERNATIVE_BUDGET_MS (5 s) per alternative").
- Confidence: High (grep of DutyCalendar shows no use of `year`, `month`, `reason`).
- **Note:** touches `ReportsPage.vue`, which ADM-10/ADM-16 also edit; do them in the same pass.

<a id="sch-10"></a>
### SCH-10 — Two list pages for the same doctor data (`/roster` vs `/schedules`)
- Severity: Low
- Category: Simplification
- Location: `apps/web/src/pages/ScheduleRosterPage.vue`, `apps/web/src/router/index.ts:31-36,74-79`, `apps/web/src/components/layout/AppSidebar.vue:68`
- Problem: `/schedules` is open to doctors (`meta.roles: ['administrator','doctor']`, and `SchedulesPage.test.ts` explicitly tests the doctor view) and the API already limits doctors to published schedules (`schedule.service.ts:685-688`). `ScheduleRosterPage` is a copy of the same list (same service call, table, empty/error handling) minus the year filter and status column, reached via the doctor sidebar link. Two pages, two tests and two locale blocks for one view.
- Fix: delete `ScheduleRosterPage.vue`, its test and the `roster` route; point the doctor sidebar entry to `/schedules` (keep the `nav.dutyRoster` label), and in `SchedulesPage.vue` hide the Status column when `!auth.isAdmin` (all rows are published) and use `scheduleRoster.empty` for the doctor empty state if desired. Update `AppSidebar.test.ts`/`guard.test.ts` references to `/roster`.
- Confidence: Medium (behaviour verified; product may want the separate entry — the fix keeps the sidebar label).
- **Needs decision before implementing:** product choice. If implemented, UI-10 becomes unnecessary (skip it).

<a id="sch-11"></a>
### SCH-11 — Schedule-level and duty-level actions on the detail page are untested
- Severity: Low
- Category: Test gap
- Location: `apps/web/src/__tests__/ScheduleDetailPage.test.ts`
- Problem: Only render/lock/add-duty paths are covered. Publish, revert, delete, reassign, remove (including the 409 "open on-call rule" remove rejection) and the cancelled-confirm paths have no tests, so regressions in SCH-02/SCH-03 fixes would go unnoticed.
- Fix: add tests: publish confirm → `publish(1)` called, badge "Published", selects gone; revert → selects return; delete → `remove(1)` + `replace('/schedules')`; reassign via combobox → `reassignDuty(10, { doctorId })`; clear slot → confirm → `removeDuty(10)`; `removeDuty` rejecting with 409 keeps the alert after reload; plus the tests listed under SCH-02/03.
- Confidence: High.


## D. Admin, doctor and auth pages

<a id="adm-01"></a>
### ADM-01 — Every new doctor account gets the same hard-coded, publicly shown password, and nothing forces a change
- Severity: High
- Category: Security
- Location: `apps/web/src/pages/UsersPage.vue:38-40`, `apps/web/src/pages/UsersPage.vue:172`, `apps/web/src/pages/UsersPage.vue:392-394`, `apps/web/src/locales/en.json:365`, `apps/web/src/locales/el.json:365`, `apps/web/src/__tests__/UsersPage.test.ts:186-212`
- Problem: `const INITIAL_PASSWORD = 'changeme123'` is sent as `password` for every doctor created (`password: INITIAL_PASSWORD`) and printed in the create dialog (`users.initialPassword`). This string is also the password of every seeded account (`apps/api/src/__tests__/auth.routes.test.ts:57,135,151`). The code comment says "the user must change it on first login", but nothing enforces that. No `mustChange` flag exists anywhere in the API or shared code, and `auth.service.ts login()` issues tokens without any such check. The locale text even says only "should". Usernames and emails show up on schedules and in the Users table, so anyone who knows the convention can sign in as any freshly created doctor until that doctor changes the password. That gives them the doctor's schedule and lets them edit the doctor's availability.
- Fix: Let the admin set the initial password, reusing the reset-dialog pattern. Add `password: string` to `EditState`/`emptyEdit()`. In the create dialog only (`v-if="edit.id === null"`), render `<Input id="e-password" v-model="edit.password" type="password" autocomplete="new-password" />` with a label. Use `password: edit.value.password` in the `CreateDoctorRequest` payload; `createDoctorSchema` already applies `passwordSchema` (min 6, max 72 bytes). Delete `INITIAL_PASSWORD` and the `users.initialPassword` key in both locale files, and add a label key (e.g. `users.initialPasswordLabel`) in en/el. Tests: update "creates a doctor with the typed username…" to type a password and assert it is in the payload. Add "rejects a short initial password without calling the service". (Forcing a change at first login would need API support that does not exist; this fix doesn't depend on it.)
- Confidence: High (searched the whole repo for `mustChange|must_change|changeme`; read `auth.service.ts` login and `doctor.service.ts` create)
- **Needs decision before implementing:** confirm with the user that admins should type the initial password (the fix below). A forced-change-on-first-login flag would need API + schema work and is out of scope here.

<a id="adm-02"></a>
### ADM-02 — MyAvailability: a save that fails halfway leaves the list stale, and using the stale list undoes or breaks the edit
- Severity: Medium
- Category: Bug
- Location: `apps/web/src/pages/MyAvailabilityPage.vue:121-163` (catch at `155-157`)
- Problem: When editing, `save()` sends several non-atomic requests in a row: `remove`, `update` or `split`, then one `createMine` per added range. `records` is refreshed once before the writes (`await refreshRecords()`) and never again on failure. If a later `createMine` fails (409 from a concurrent session, network error) after `update`/`split` already succeeded, the catch only sets `st.errorMsg` and returns. Once the dialog is closed, the chip list still shows the record's old range. Two things can then go wrong:
  - Clicking a chip for a day that was already removed runs `openUpdate` with the stale record, which re-marks all its old days (`days: eachDay(x.startDate, x.endDate)`). Saving then re-creates the days the doctor had just removed.
  - **Delete** builds split segments from the stale range, and the API rejects them with 400 "Every segment must lie within the original record range" (`unavailability.service.ts` split).

  `AvailabilityPage.vue:224-256` already handles this case: it tracks a `wrote` flag, closes the dialog, reloads, and names the unsaved ranges.
- Fix: Copy the AvailabilityPage pattern. Add `let wrote = false` and `let unsaved: {startDate:string;endDate:string}[] = []`, and set `wrote = true` after each successful write (shifting `unsaved` for creates). In the catch:
  ```ts
  const message = e instanceof Error ? e.message : t('availability.saveFailed')
  if (!wrote) { st.errorMsg = message; return }
  edit.value = emptyEdit()
  await load()
  errorMsg.value = unsaved.length > 0
    ? t('availability.unsavedDays', { message, ranges: unsaved.map(formatRange).join(', ') })
    : message
  return
  ```
  Test: `update` resolves and `createMine` rejects → `listMine` is called again, the dialog closes, and the page-level alert contains the error and the unsaved range.
- Confidence: High (traced `save()` against `unavailability.service.ts` split/update; compared with AvailabilityPage)

<a id="adm-03"></a>
### ADM-03 — MyAvailability: Delete has no in-flight guard, so Delete/Save can run twice or concurrently
- Severity: Medium
- Category: Bug
- Location: `apps/web/src/pages/MyAvailabilityPage.vue:169-194`, `apps/web/src/pages/MyAvailabilityPage.vue:266-274`
- Problem: `removeCurrent()` never sets `saving`, so after the confirm both the **Delete** and **Save** buttons stay enabled while the `split`/`remove` request runs, and neither function checks a flag on entry. Each failure mode below is confirmed against the API code:
  - A second Delete confirmation runs `split` with segments computed from the same stale `x`, because `records` is only reloaded after success. The API returns 400 "Every segment must lie within the original record range", or 404 on a second `remove`.
  - Clicking **Save** during the delete runs `refreshRecords()` plus `update`/`split`/`createMine` against a record that is being split, which can re-create the deleted day.

  The admin page guards all of these with `busy` (`AvailabilityPage.vue:199,268,283,307`).
- Fix: Add `if (saving.value) return` at the top of `removeCurrent` and `save`. In `removeCurrent`, after the confirm, set `saving.value = true` and reset it in a `finally` around the request, as `AvailabilityPage.removeCurrent` does. Test: a deferred `split`, click Delete → confirm → click Delete again → `split` is called once and Save is disabled while it is pending.
- Confidence: High

<a id="adm-04"></a>
### ADM-04 — Activity page offers action filters that can never match; logins and password changes are invisible in the audit log
- Severity: Medium
- Category: Correctness
- Location: `apps/web/src/pages/ActivityPage.vue:33-43`, `apps/api/src/services/activity.service.ts:84-87`, `apps/api/src/services/auth.service.ts:97`, `apps/api/src/services/auth.service.ts:117-118`, `apps/api/src/services/auth.service.ts:141-146`, `apps/api/src/services/settings.service.ts:20`, `apps/api/src/services/settings.service.ts:56-62`, `apps/api/src/services/billing.service.ts:56-62`
- Problem: The audit list is always limited to one clinic (`where.push('a.clinic_id = $1')`; documented in `docs/database.md:293`). `recordActivity` stores `input.clinicId ?? null`. These events are logged without a `clinicId`: `auth.login`, `auth.logout`, `auth.password_changed`, `open_duty_settings.updated` and `billing.updated`. The page builds its action dropdown from every entry in `ACTIVITY_ACTIONS`, so choosing any of those five always shows "No activity". The superadmin also can never see clinic users signing in or changing passwords. Nor can they see an administrator changing the global open-duty interval, which `settings.routes.ts` allows administrators to do.
- Fix:
  - API: record the clinic on user-scoped events. In `login`, use `logActivity({ ..., clinicId: row.clinic_id })`. In `changePassword`, add `clinicId: row.clinic_id`. In `logout`, look the user up first (`const row = await findUserById(userId)`) and pass `clinicId: row?.clinic_id ?? null`. In `setOpenDutyInterval`, widen `Actor` to `Pick<AuthUser, 'id' | 'role' | 'clinicId'>` and pass `clinicId: actor.clinicId`.
  - Web: leave out the hospital-only action that can never be clinic-scoped. In `ActivityPage.vue`, skip `'billing.updated'` when building `actionGroups`.
  - Tests: in `auth.service.test.ts` / `settings.service.test.ts`, assert `clinicId` is passed to `logActivity`. In `ActivityPage.test.ts`, assert the action select has no `billing.updated` option.
- Confidence: High (read `activity.service.ts list/recordActivity`, every `logActivity` call above, and `docs/database.md`)
- **Scope note:** the main part of this fix is in `apps/api`. Implement the API part only if the user confirms API changes are in scope; the web-only part (hide `billing.updated`) is safe on its own. Any API change must keep `docs/database.md` accurate (no schema change is needed).

<a id="adm-05"></a>
### ADM-05 — Validation errors show raw English Zod messages in the Greek UI
- Severity: Medium
- Category: i18n
- Location: `apps/web/src/pages/LoginPage.vue:37`, `apps/web/src/pages/ProfilePage.vue:91`, `apps/web/src/pages/ProfilePage.vue:112`, `apps/web/src/pages/UsersPage.vue:179`, `apps/web/src/pages/UsersPage.vue:198`, `apps/web/src/pages/UsersPage.vue:217`, `apps/web/src/pages/UsersPage.vue:239`, `apps/web/src/pages/RulesPage.vue:96`, `apps/web/src/pages/RulesPage.vue:120`, `apps/web/src/pages/RulesPage.vue:160` (the same pattern appears in `ScheduleDetailPage.vue:177,193` and `SchedulesPage.vue:86`, which are outside this slice)
- Problem: Each form shows `parsed.error.issues[0]?.message`. The shared schemas mostly rely on Zod's default English messages: `passwordSchema` `.min(6)` gives "String must contain at least 6 character(s)", `z.string().email()` gives "Invalid email", `updateDutySlotsSchema` `.min(1)` gives "Number must be greater than or equal to 1", and the `changePasswordSchema` refine gives "New password must differ". No `z.setErrorMap` is set in the web app. Example: a Greek user who types a 5-character password on Login, or `0` in a Rules field, gets an English sentence. The app otherwise covers everything with Greek tests, e.g. `LoginPage.test.ts:121`.
- Fix: Add one small helper and use it in every listed spot:
  ```ts
  // src/lib/validation.ts
  import type { ZodIssue } from 'zod'
  type T = (key: string, named?: Record<string, unknown>) => string
  export function issueText(issue: ZodIssue | undefined, t: T): string {
    if (!issue) return t('common.invalidInput')
    if (issue.code === 'too_small') return t(issue.type === 'string' ? 'validation.minLength' : 'validation.min', { min: Number(issue.minimum) })
    if (issue.code === 'too_big') return t(issue.type === 'string' ? 'validation.maxLength' : 'validation.max', { max: Number(issue.maximum) })
    if (issue.code === 'invalid_string' && issue.validation === 'email') return t('validation.email')
    return t('common.invalidInput')
  }
  ```
  Add `validation.{minLength,min,maxLength,max,email}` to en.json and el.json. The ProfilePage refine ("must differ") needs a dedicated key (`profile.passwordMustDiffer`) chosen by `issue.code === 'custom'`. Test: one Greek-locale test per page (Login short password, Rules `0`) asserting the translated text.
- Confidence: High (read `packages/shared/src/schemas/{common,auth,doctor,settings}.ts`; searched for an error map)
- **Scope note:** also apply the helper in `ScheduleDetailPage.vue:177,193` and `SchedulesPage.vue:86` (same pattern). Keeps the `zod` dependency (see CORE-08).

<a id="adm-06"></a>
### ADM-06 — Usage: double-clicking Resolve reports "Alert already resolved" for an action that succeeded
- Severity: Low
- Category: Bug
- Location: `apps/web/src/pages/UsagePage.vue:62-70`, `apps/web/src/pages/UsagePage.vue:218`
- Problem: `resolve()` has no in-flight guard, and the button stays enabled (`:disabled="a.resolvedAt !== null"`) until the reload finishes. A double click sends two `PATCH /usage/alerts/:id/resolve`; the second gets 409 "Alert already resolved" (`usage.service.ts:193-206`). The first call's `load()` clears `errorMsg` when it starts, and the second call's catch then sets it, so the page shows an error even though the alert was resolved.
- Fix: Add `const resolvingId = ref<number | null>(null)`. In `resolve`, `if (resolvingId.value !== null) return`, set the id, and reset it in `finally`. Change the button to `:disabled="a.resolvedAt !== null || resolvingId === a.id"`. Test: a deferred `resolveAlert`; clicking twice → called once.
- Confidence: High

<a id="adm-07"></a>
### ADM-07 — Users: enabling/disabling a doctor goes through `/users`, so the audit log records `user.*` instead of `doctor.*`
- Severity: Low
- Category: Correctness
- Location: `apps/web/src/pages/UsersPage.vue:254-266`, `apps/web/src/__tests__/UsersPage.test.ts:326-338`
- Problem: Editing and deleting a doctor both go through `doctorService` (`doctor.updated`/`doctor.deleted`, entity `doctor`). `toggleActive` instead calls `userService.update(u.id, { isActive })`, which logs `user.deactivated`/`user.reactivated` with entity `user` (`user.service.ts` update). `doctor.service.update` accepts `isActive` and logs `doctor.deactivated`/`doctor.reactivated` (`doctor.service.ts:239-253`). This page is the only UI that enables or disables doctors, so the `doctor.deactivated`/`doctor.reactivated` options in the Activity filter never match, and a doctor's history is split across two entity types.
- Fix:
  ```ts
  const d = doctorByUserId.value.get(u.id)
  if (d) await doctorService.update(d.id, { isActive: !u.isActive })
  else await userService.update(u.id, { isActive: !u.isActive })
  ```
  Update the test at `UsersPage.test.ts:326` to make `doctorUpdate` reject, and add a success test asserting `doctorUpdate(…, { isActive: false })`.
- Confidence: High

<a id="adm-08"></a>
### ADM-08 — Holidays: after discarding edits, a failed month load leaves the old month's marks; Save then sends them and gets 400
- Severity: Low
- Category: Bug
- Location: `apps/web/src/pages/HolidaysPage.vue:91-108`, `apps/web/src/pages/HolidaysPage.vue:110-122`, `apps/web/src/pages/HolidaysPage.vue:137-151`
- Problem: Steps to reproduce:
  1. Make the month dirty, change month, and confirm the discard.
  2. `listHolidays` fails.
  3. `marked` still holds the previous month's dates and `dirty` stays `true`, because both are only reset on success.
  4. The Save button stays visible. `save()` sends `setMonthHolidays(newYear, newMonth, [...previousMonthDates])`, which `setMonthHolidaysSchema` rejects ("dates must fall inside the given year and month").
- Fix: Reset the state when the month actually changes. In `load()`, before the request: `marked.value = new Set(); dirty.value = false`. Test: dirty → change month → confirm → `listHolidays` rejects → no Save button, and `setMonthHolidays` is not called.
- Confidence: High (read `packages/shared/src/schemas/holiday.ts`)

<a id="adm-09"></a>
### ADM-09 — Holidays: unsaved marks are silently lost when leaving the page
- Severity: Low
- Category: UX
- Location: `apps/web/src/pages/HolidaysPage.vue:110-122`
- Problem: Changing month asks before discarding unsaved marks (`holidays.discardTitle`), but navigating to another route drops them with no prompt. No `onBeforeRouteLeave` exists anywhere in the app.
- Fix: Add:
  ```ts
  onBeforeRouteLeave(async () =>
    !dirty.value || (await confirm({ title: t('holidays.discardTitle'), message: t('holidays.discardMessage'), confirmText: t('holidays.discard') })),
  )
  ```
  (import from `vue-router`). Test: mount with a router, mark a day, push another route, cancel the confirm → the route is unchanged.
- Confidence: High

<a id="adm-10"></a>
### ADM-10 — Reports: the default month is computed in UTC, so it shows the previous month shortly after midnight local time
- Severity: Low
- Category: Bug
- Location: `apps/web/src/pages/ReportsPage.vue:39-41`
- Problem: `year`/`month` start from `now.getUTCFullYear()` / `now.getUTCMonth() + 1`. In Greece (UTC+2/+3), between 00:00 and 02:00/03:00 on the 1st, the page opens on the previous month. HolidaysPage (`toIsoDate(new Date())`) and the availability pages use local time.
- Fix: `const year = ref(String(now.getFullYear()))` and `const month = ref(String(now.getMonth() + 1))`. (A unit test only makes sense if Vitest runs with a non-UTC `TZ`; otherwise none is needed.)
- Confidence: High

<a id="adm-11"></a>
### ADM-11 — Login: leading/trailing spaces in the identifier cause "Invalid credentials"
- Severity: Low
- Category: Bug
- Location: `apps/web/src/pages/LoginPage.vue:31-35`
- Problem: The empty check uses `identifier.value.trim()`, but the untrimmed value is what gets sent (`loginSchema.safeParse({ identifier: identifier.value, … })`). The API matches `u.username = $1` / email exactly (`auth.service.ts` `findUserByUsername`), so a trailing space from mobile autocomplete or paste fails the login.
- Fix: `loginSchema.safeParse({ identifier: identifier.value.trim(), password: password.value })`. Test: typing `'  a@b.com '` → `login` is called with `'a@b.com'`.
- Confidence: High

<a id="adm-12"></a>
### ADM-12 — Availability: a failed doctor-list load is swallowed, leaving empty doctor selects with no explanation
- Severity: Low
- Category: UX
- Location: `apps/web/src/pages/AvailabilityPage.vue:332-339`
- Problem: `catch { doctors.value = [] }` hides the error. The doctor filter offers only "All doctors", the create dialog's doctor select has no options, and Save just repeats "Select a doctor". The admin is never told the list failed to load. `errorMsg` can't simply be reused, because `load()` clears it on every filter change.
- Fix: Add `const doctorsError = ref('')`. In the catch, set `doctorsError.value = e instanceof Error ? e.message : t('availability.loadDoctorsFailed')` and render `<p v-if="doctorsError" class="text-sm text-destructive" role="alert">{{ doctorsError }}</p>` near the filters. Add the en/el key. Test: `doctorService.list` rejects → the alert is shown.
- Confidence: High

<a id="adm-13"></a>
### ADM-13 — Usage: generation history has no clinic column, though the data is cross-clinic and overlap is per clinic
- Severity: Low
- Category: UX
- Location: `apps/web/src/pages/UsagePage.vue:176-196`
- Problem: `GET /usage/generations` returns events from every clinic. Each has `clinicId`/`clinicName` (`packages/shared/src/types/usage.ts`), and `overlapPercent` is computed per clinic (`usage.service.ts` generations). The table shows only time, month, doctors and overlap, so in a multi-clinic deployment two clinics' events for the same month can't be told apart and the overlap figures read as one chain. The row key `${e.generatedAt}-${e.year}-${e.month}` also leaves out the clinic.
- Fix: Add a `<TableHead>{{ t('usage.clinic') }}</TableHead>` / `<TableCell>{{ e.clinicName }}</TableCell>` column (en/el key) and use `:key="`${e.clinicId}-${e.generatedAt}`"`. Extend the UsagePage fixture/test to assert the clinic name renders.
- Confidence: High

<a id="adm-14"></a>
### ADM-14 — Holidays/Rules pass a `clinicId` that never changes what the server does
- Severity: Low
- Category: Simplification
- Location: `apps/web/src/pages/HolidaysPage.vue:7,18,98`, `apps/web/src/pages/RulesPage.vue:8,15-16,63-64,138,169`, `apps/web/src/services/holiday.ts:4-13`, `apps/web/src/services/settings.ts:16-63`, `apps/web/src/__tests__/RulesPage.test.ts:72` (and any `toHaveBeenCalledWith(…, 1)` in `HolidaysPage.test.ts`)
- Problem: Both pages send `auth.user?.clinicId ?? undefined`. For an administrator, `resolveClinicScope` (`apps/api/src/lib/scope.ts`) ignores a matching id and pins the JWT clinic anyway. For a superadmin, `AuthUser.clinicId` is `null`, so the value is `undefined`. The argument therefore never changes the request's effect. Meanwhile `setMonthHolidays` already omits it, which is inconsistent. The parameter adds a store dependency and path-building code (`dutySlotsPath`, `dutyMinimumsPath`, `toQuery`) for nothing.
- Fix: Drop the `clinicId` parameter from `listHolidays`, `getDutySlots`, `updateDutySlots`, `getDutyMinimums` and `updateDutyMinimums`, and inline the fixed paths. Remove `useAuthStore` and `clinicId()` from both pages. Update the test assertions to expect no clinic argument.
- Confidence: High (read `scope.ts`, the holiday/settings controllers, and the router guard; superadmin `clinicId: null` is confirmed in `activity.routes.test.ts:31`)
- **Order:** implement before CORE-10.

<a id="adm-15"></a>
### ADM-15 — Duplicated "remove one day from a record" logic in both availability pages
- Severity: Low
- Category: Simplification
- Location: `apps/web/src/pages/AvailabilityPage.vue:283-290`, `apps/web/src/pages/MyAvailabilityPage.vue:180-187`
- Problem: Both `removeCurrent()` functions contain the same split-or-remove block:
  ```ts
  const others = eachDay(x.startDate, x.endDate).filter((d) => d !== day)
  if (others.length > 0) await unavailabilityService.split(x.id, { segments: groupConsecutiveDays(others) })
  else await unavailabilityService.remove(x.id)
  ```
  A fix to one page (e.g. ADM-03) can easily miss the other.
- Fix: Move it into `src/services/unavailability.ts`:
  ```ts
  /** Removes one day from a record: splits around it, or deletes the record when it was its only day. */
  export async function removeDay(record: Unavailability, day: string): Promise<void> {
    const others = eachDay(record.startDate, record.endDate).filter((d) => d !== day)
    if (others.length > 0) await split(record.id, { segments: groupConsecutiveDays(others) })
    else await remove(record.id)
  }
  ```
  Call `await unavailabilityService.removeDay(x, day)` from both pages. Calls inside a module bypass `vi.mock`, so add `removeDay: vi.fn()` to the page tests' mock factory and assert `removeDay(record, day)` instead of `split`/`remove`. Move the split-vs-remove assertions into a new service unit test that mocks `@/lib/http`: single-day record → `DELETE /unavailability/:id`, middle day → `POST /unavailability/:id/split` with two segments.
- Confidence: High

<a id="adm-16"></a>
### ADM-16 — Reports: roster weekday/day labels format a UTC date in the browser's local zone
- Severity: Low
- Category: Bug
- Location: `apps/web/src/pages/ReportsPage.vue:36-37`, `apps/web/src/pages/ReportsPage.vue:76-81`
- Problem: Each roster row is built from `new Date(`${iso}T00:00:00Z`)` (UTC midnight) and `isWeekend` uses `getUTCDay()`, but the labels use `weekdayFmt`/`dayFmt` = `new Intl.DateTimeFormat(locale, { weekday: 'short' })` / `{ day: '2-digit' }` with **no** `timeZone`. In any browser west of UTC (UTC−1 and beyond), UTC midnight is the previous local day, so every row shows the previous day's weekday and day number while `isWeekend` (UTC) highlights the correct dates — the labels and the weekend shading disagree. Greek users (UTC+2/+3) are unaffected today; the multi-hospital requirement makes it reachable. `DoctorDashboard.vue:54` already does this correctly with `timeZone: 'UTC'`.
- Fix: add `timeZone: 'UTC'` to both formatters:
  ```ts
  const weekdayFmt = computed(() => new Intl.DateTimeFormat(intlLocale.value, { weekday: 'short', timeZone: 'UTC' }))
  const dayFmt = computed(() => new Intl.DateTimeFormat(intlLocale.value, { day: '2-digit', timeZone: 'UTC' }))
  ```
  No test needed unless Vitest runs with a non-UTC `TZ` (same as ADM-10).
- Confidence: High (read `ReportsPage.vue:36-37,62-88`; compared with `DoctorDashboard.vue:54`).
