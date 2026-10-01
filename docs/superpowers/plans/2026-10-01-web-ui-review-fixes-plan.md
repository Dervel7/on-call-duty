# Web UI Review — Findings to Fix (`apps/web`)

Review date: 2026-10-01. Scope: `apps/web` (Vue 3 SPA), plus contract checks against `packages/shared` and `apps/api` where needed.
Every finding was checked against the code. Line numbers refer to the files as they were at review time, so re-read each file before editing.

## Instructions for the fixing agent

- Read `AGENTS.md` first. In particular: no Prettier, do not change lint rules, use `@oncall/shared` types instead of local copies, keep changes minimal and simple, add or update tests (Vitest, `apps/web/src/__tests__/<Name>.test.ts`) for every bug fix.
- `pnpm typecheck`, `pnpm lint` and `pnpm test` must all pass at the end.
- If a fix touches `database/schema.sql`, update `docs/database.md` in the same change. If it adds or changes an API endpoint, follow `routes → controllers → services`.
- Reuse patterns that already exist. Do not invent new ones:
  - Stale-response guard: `loadSeq` in `apps/web/src/pages/SchedulePreviewPage.vue:141-175`.
  - Confirmation: `useConfirm()` (`apps/web/src/composables/useConfirm.ts`).
  - Empty states: `<EmptyState>` (`apps/web/src/components/ui/EmptyState.vue`).
  - Double-submit guard: `billingSaving` in `apps/web/src/pages/UsagePage.vue`.
- Work in priority order: Critical/High → Medium → Low. Findings marked **[needs decision]** have a product trade-off. Pick the conservative option described and say which one you picked.

Severity: **High** = security exposure, or data loss/corruption, or users can't see failures. **Medium** = wrong behavior users will hit. **Low** = edge cases, a11y polish, maintainability.

---

## High

### H1 — The access token survives logout, account lock and a failed refresh [security]
- **Where:** `apps/web/src/services/auth.ts:16-19`, `apps/web/src/stores/auth.ts:24-35, 37-45, 69-75`, `apps/web/src/lib/http.ts:16-19`.
- **Problem:** The token that actually gets sent is the module variable in `http.ts`. `authService.logout()` clears it only if `POST /auth/logout` succeeds. The store's `logout()` swallows the error and clears only its own `accessToken` ref. The locked handler and the refresh `catch` don't clear the http token either. The UI then says "logged out" while later requests still send `Authorization: Bearer <old token>` until it expires (on a shared ward PC, the next person inherits the session).
- **Fix:** Wrap the logout call in `try { … } finally { setAccessToken(null) }` in `services/auth.ts`, and call `setAccessToken(null)` in the store's refresh `catch` and in the locked handler. Better: make `http.ts` the only owner of the token (the store derives `isAuthenticated` from data the http module exposes, or every store mutation goes through one `clearSession()` helper) so the two copies can't drift.
- **Verify:** `auth.store.test.ts`: after a logout whose service call throws, `apiGet` must not send an `Authorization` header (stub `fetch`).

### H2 — Duty edit errors (409/422) are wiped before the user sees them [bug]
- **Where:** `apps/web/src/pages/ScheduleDetailPage.vue:75-85` (`load()` resets `errorMsg`), used in the `finally` blocks at `:164-167`, `:182-185`, `:198-201`.
- **Problem:** Each remove/reassign/add sets `errorMsg` in `catch` and then runs `await load()` in `finally`, which clears it. Constraint violations (back-to-back, monthly cap, slots full) and the published-schedule 409 never appear, and the select just snaps back.
- **Fix:** Stop clearing `errorMsg` in `load()`. Clear it at the start of each user action instead, or save the caught message and assign it after `await load()`.
- **Verify:** `ScheduleDetailPage.test.ts`: mock `addDuty` to reject with `ApiError('Constraint violation…', 409)` and check that the message is rendered.

### H3 — Splitting an exclusion is non-atomic and can silently drop excluded days [bug / data integrity]
- **Where:** `apps/web/src/pages/AvailabilityPage.vue:270-279` (`toggleDisabledCurrent`), `:205-218` (`save` when a chip day is unmarked).
- **Problem:** The record is first shrunk with `update(...)`, then the remaining days are re-created one request at a time. If any later request fails, those days are gone, the dialog still holds stale `originDays`, and a retry computes from outdated data. The doctor becomes schedulable on days they had excluded, with no warning.
- **Fix (conservative):** Add one transactional API endpoint (e.g. `POST /unavailability/:id/split` taking the resulting segments and the `isDisabled` flag) and call it from both places. If the endpoint isn't added: on any failure, call `load()`, close the dialog, and show an error listing the days that must be re-entered.
- **Verify:** Page test: make the second `createForDoctor` reject and check that the page reloads and the error lists the missing days. API test for the new endpoint's rollback, if added.

### H4 — A stacked ConfirmDialog closes the parent edit Dialog [bug]
- **Where:** `apps/web/src/components/ui/Dialog.vue:15-20`. Triggered from `AvailabilityPage.vue:238-247` and `MyAvailabilityPage.vue:171-178` (`removeCurrent` calls `confirm()` while the edit dialog is open). `UsersPage.vue:203-209` has a manual workaround for the same bug.
- **Problem:** `onClickOutside` and the window-level Escape listener fire for every open dialog. A click inside the teleported ConfirmDialog counts as "outside" for the edit dialog, so Cancel throws away the unsaved form. If the delete then fails, the error is written to a dialog that's already closed.
- **Fix:** Keep a module-level stack of open dialogs; only the top one reacts to Escape and outside clicks. Treat every open dialog's overlay as an ignored layer (e.g. add `data-popover-layer` to the overlay root at `:33`). Then remove the workaround in `UsersPage.vue`.
- **Verify:** `Dialog.test.ts`/`AvailabilityPage.test.ts`: open the edit dialog, then the confirm, then click Cancel; the edit dialog stays open with its form intact.

---

## Medium

### M1 — Stale responses overwrite newer ones when filters/months change quickly [bug, cross-cutting]
- **Where:**
  - `apps/web/src/pages/AvailabilityPage.vue:102-121`
  - `apps/web/src/pages/HolidaysPage.vue:73-90`
  - `apps/web/src/pages/ReportsPage.vue:118-140` (report and the nested calendar fetch)
  - `apps/web/src/pages/ActivityPage.vue:45-84` (filters + pagination)
  - `apps/web/src/components/dashboard/AdminDashboard.vue:82` (`watch(month, load)`)
- **Problem:** Whichever response comes back last wins, so data from month A can appear under the month B label (and in Reports, end up in the printed/CSV output). `loading` is also cleared by the first request that finishes.
- **Fix:** Use the same `loadSeq` pattern as `SchedulePreviewPage.vue:141-175` in each `load()`: `const seq = ++loadSeq`, and after every `await` do `if (seq !== loadSeq) return`. Only clear `loading` when `seq === loadSeq`. Don't add a new abstraction unless the same code is being copied into 5+ places; if it is, extract one small composable and use it everywhere, including SchedulePreviewPage.
- **Verify:** One test per page: resolve two deferred promises out of order and check that the newer data is shown.

### M2 — The session ends with no redirect to login [bug]
- **Where:** `apps/web/src/stores/auth.ts:24-35`, `apps/web/src/lib/http.ts:69-79`.
- **Problem:** When the refresh token expires or is revoked mid-session (also see M3), `refresh()` sets the store to null but nothing navigates. The header nav disappears (`v-if="auth.isAuthenticated"` in `AppHeader.vue:89,122`) while the page stays put and shows generic request errors.
- **Fix:** When a refresh fails during a request (not during the bootstrap refresh in `main.ts`), clear the session (see H2) and `router.push({ name: 'login', query: { redirect: currentRoute.fullPath } })`, using the same lazy `import('@/router')` approach as the locked handler.
- **Verify:** `auth.store.test.ts` / `http.test.ts`: a 401 followed by a failed refresh ends on the `login` route.

### M3 — Changing the password says "signed out of all sessions" but leaves this session open [bug]
- **Where:** `apps/web/src/pages/ProfilePage.vue:80-86`. The API revokes all refresh tokens (`apps/api/src/services/auth.service.ts:138`).
- **Fix:** After `auth.changePassword` resolves, call `await auth.logout()` and then `router.push({ name: 'login' })`, showing a short "Password changed, please sign in again" message on the login page (e.g. via a query flag).
- **Verify:** Update `ProfilePage.test.ts`.

### M4 — Hardcoded "1 of 2" ignores the configurable slot count (1–7) [bug]
- **Where:** `apps/web/src/components/schedule/DutyCalendar.vue:224-228`, `apps/web/src/pages/ReportsPage.vue:262-270` (`r.duties.length < 2`).
- **Problem:** With 1 slot, every fully staffed day is flagged. With 3 slots, a day with only 2 doctors isn't flagged. This contradicts the colors and `report.coverage.gaps`.
- **Fix:** Show `${filled} of ${slotsRequired}` when `0 < filled < slotsRequired`, using `ScheduleDay.slotsRequired` (Reports: look it up from `calendar.value.days` by date).
- **Verify:** Tests with `slotsRequired` = 1 and 3.

### M5 — The preview says "Ready to generate" for plans the server rejects with 422 [bug]
- **Where:** `apps/web/src/pages/SchedulePreviewPage.vue:125-133`, `:263`. Server rule: `apps/api/src/services/schedule.service.ts:511-523` (`validatePlan`).
- **Problem:** Only empty days block. The server also rejects any `open` day, and the day after it, that is below `slotsRequired`.
- **Fix:** Apply the same rule on the client: critical days = days with `dutyType === 'open'` plus the following date. If any of them is below `slotsRequired`, count it in `errorCount` and block Generate. Partial non-critical days stay warnings.
- **Verify:** `SchedulePreviewPage.test.ts` with a partially filled open day.

### M6 — Doctor-side split of a disabled exclusion creates enabled records [bug]
- **Where:** `apps/web/src/pages/MyAvailabilityPage.vue:146-156`. `PATCH /unavailability/:id/disabled` is admin-only (`apps/api/src/routes/unavailability.routes.ts:23`).
- **Problem:** If a doctor unmarks a middle day of an admin-disabled record, the tail is created as enabled, so the scheduler suddenly treats those days as unavailable.
- **Fix:** If H4's split endpoint is added, use it here too (it carries `isDisabled` over from the original). Otherwise, when the record is `isDisabled`, block edits that produce more than one range and show "Ask an administrator to change a disabled exclusion".

### M7 — Holidays: changing month silently discards unsaved marks [bug]
- **Where:** `apps/web/src/pages/HolidaysPage.vue:73-90, 104-105`.
- **Fix:** If `dirty`, ask with `useConfirm()` before changing month, and put the picker back if the user cancels. Disable the MonthPicker while `saving`. Capture year/month in local variables inside `load()`/`save()` instead of reading `month.value` after an `await`. Add the M1 guard.

### M8 — Roster page shows "No published schedules yet" when the request failed [bug]
- **Where:** `apps/web/src/pages/ScheduleRosterPage.vue:38` (sets `errorMsg`), `:55-77` (never renders it).
- **Fix:** Render `<p v-if="errorMsg" role="alert" class="text-sm text-destructive">`, and change the EmptyState condition to `!loading && !errorMsg && records.length === 0`.

### M9 — Reports label and CSV filename come from unapplied inputs; stale data is kept after a failed load [bug]
- **Where:** `apps/web/src/pages/ReportsPage.vue:47` (`monthLabel`), `:144-148` (filename).
- **Fix:** Build the label and filename from `report.value.year/month`. Set `report.value = null` (which disables export/print) when a load fails. Validate the year (1970–2100) before sending; an empty input currently becomes `0`.

### M10 — Generated username can't be overridden; some names can't be created at all [bug]
- **Where:** `apps/web/src/pages/UsersPage.vue:87-92, 143, 326-329`.
- **Problem:** Shared prefixes (`marpap`) cause a 409. Accented, apostrophe or Greek names fail `usernameSchema` (`/^[A-Za-z0-9._-]{3,32}$/`). Either way the admin is stuck.
- **Fix:** Add an editable username input on create, pre-filled with the generated value (normalize with `normalize('NFD')`, then strip characters that aren't allowed), and validate it with `usernameSchema` from `@oncall/shared`.

### M11 — Setting a past paid-through date locks the whole hospital out, with no confirmation [bug / safety]
- **Where:** `apps/web/src/pages/UsagePage.vue:73-85`. The server locks when `CURRENT_DATE > paidThrough` (`apps/api/src/services/billing.service.ts:15`).
- **Fix:** Validate with `updateBillingSchema.safeParse` (from `@oncall/shared`) before sending, and don't send `''`. If the date is before today, call `useConfirm()` with text explaining that this locks every user out.

### M12 — `manager` role isn't handled in the UI [bug] [needs decision]
- **Where:** `packages/shared/src/types/auth.ts:1` (Role includes `'manager'`; the API issues manager tokens), `apps/web/src/pages/HomePage.vue:9-12`, `apps/web/src/components/layout/AppHeader.vue:33-39`, `apps/web/src/router/index.ts:98-102`.
- **Problem:** `isAdmin` doesn't include manager, so a manager gets DoctorDashboard (which calls doctor-only `statsService.me()` and errors) and the doctor nav links. `/my-availability` has no `meta.roles`, so admins and managers who open it directly get "Doctor profile not found". Note that `AGENTS.md` lists only three roles; the docs and the code disagree.
- **Fix:** Use explicit role checks: doctor UI only when `auth.user?.role === 'doctor'`. For any other role, render a neutral home/empty state rather than doctor components. Add `meta: { roles: ['doctor'] }` to `my-availability`. Ask the user whether `manager` needs its own screens, and don't build them without an answer.

### M13 — Dialog accessibility: no dialog semantics, focus trap or focus restore [a11y]
- **Where:** `apps/web/src/components/ui/Dialog.vue:33-41`, `apps/web/src/components/ui/CalendarDialog.vue:129-138` (has `role="dialog"` but no `aria-modal`, initial focus or trap).
- **Fix:** Add `role="dialog"`, `aria-modal="true"`, and `aria-labelledby` pointing to the title (`useId()`). Remember `document.activeElement` on open, focus the first focusable element on `nextTick`, trap Tab/Shift+Tab inside, and restore focus on close. Put this in one shared place for both components. Do it together with H5.

### M14 — Dialog scroll lock isn't stack-safe and leaks on unmount [bug]
- **Where:** `apps/web/src/components/ui/Dialog.vue:22-28`.
- **Problem:** Closing the top dialog of a stack re-enables scrolling under the remaining one. If a page unmounts with a dialog open (route change, session redirect), `overflow:hidden` stays on `body` and the next page can't scroll.
- **Fix:** Use a shared counter (increment on open, decrement on close), release in `onBeforeUnmount`, and add `{ immediate: true }` to the watcher.

### M15 — Tall dialogs are cut off on short viewports [bug]
- **Where:** `apps/web/src/components/ui/Dialog.vue:33,40`, `apps/web/src/components/ui/CalendarDialog.vue:129`.
- **Fix:** Add `overflow-y-auto` to the overlay and `max-h-[calc(100dvh-2rem)] overflow-y-auto` to the panel.

### M16 — Select loses keyboard focus on close [a11y]
- **Where:** `apps/web/src/components/ui/Select.vue:136-153, 186-188, ~234-244`.
- **Problem:** The focused panel is teleported to `body` and removed on choose/Escape/Tab, so focus falls back to `body` (and out of any open Dialog).
- **Fix:** Keep a ref to the trigger and `trigger.value?.focus()` after choose or Escape. On Tab, refocus the trigger before the default action so the normal tab order continues.

### M17 — Calendar slot selects have no accessible name [a11y]
- **Where:** `apps/web/src/components/schedule/DutyCalendar.vue:189-193`, `apps/web/src/components/ui/Select.vue` (fallthrough attributes land on the wrapper div, not the `role="combobox"` button).
- **Fix:** Add an `ariaLabel` prop to Select that is bound to the inner button, and pass e.g. `` `${c.date} slot ${sIdx + 1}` ``.

### M18 — Holiday day toggles convey state only by color [a11y]
- **Where:** `apps/web/src/pages/HolidaysPage.vue:152-175`.
- **Fix:** Add `:aria-pressed="c.holiday"`, an `aria-label` with the full date and its state, and a visible marker that isn't just color (a check icon) on marked days.

### M19 — No security headers on the SPA nginx; fonts come from a third party [security]
- **Where:** `apps/web/nginx.conf`, `apps/web/index.html:8-13`.
- **Problem:** No `Content-Security-Policy`, `X-Frame-Options`/`frame-ancestors` (clickjacking on admin actions), `X-Content-Type-Options`, `Referrer-Policy` or `Permissions-Policy`. Google Fonts sends every clinician's IP to Google (a GDPR concern for a hospital), and it means a strict CSP would have to allow Google domains.
- **Fix:** Add the headers in `nginx.conf`. Careful: nginx `add_header` inside a `location` replaces the server-level headers, so repeat them in the `location = /index.html` and static-asset blocks (or `include` a shared snippet). Starting CSP: `default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'`. Self-host the three font families (e.g. `@fontsource/*` packages imported in `main.ts`) and remove the Google `<link>` tags. Check the built app in the docker image for CSP violations in the console.

---

## Low

### L1 — Login `redirect` query is not validated [security/bug]
- **Where:** `apps/web/src/pages/LoginPage.vue:40-41`.
- **Problem:** `route.query.redirect as string` may actually be an array or an external/protocol-relative value (`//evil.com`). Vue Router won't navigate cross-origin, but `router.push` throws, and the `catch` then shows "Login failed" even though the login worked.
- **Fix:** Accept the value only if it's a string that starts with `/` and not `//`; otherwise use `/`. Navigate outside the login `try/catch`, or handle navigation errors separately.

### L2 — Dates computed in UTC instead of local time [bug]
- **Where:** `apps/web/src/components/schedule/DutyCalendar.vue:30` (`toISOString().slice(0,10)` for "today"), `apps/web/src/components/dashboard/AdminDashboard.vue:31-33` (`getUTCFullYear/getUTCMonth`), `apps/web/src/pages/SchedulesPage.vue:151` (`createdAt.slice(0,10)`).
- **Problem:** In Greece (UTC+2/+3), between local midnight and 02:00/03:00 the app shows yesterday or last month.
- **Fix:** Use local date parts. Use `toIsoDate` from `@oncall/utils` (`packages/utils/src/date.ts`) for "today", and `Intl.DateTimeFormat` for displaying timestamps.

### L3 — Month filter lists days outside the selected month [bug]
- **Where:** `apps/web/src/pages/MyAvailabilityPage.vue:59-70`, `apps/web/src/pages/AvailabilityPage.vue:93-95` (inflated "N day(s)").
- **Fix:** When a month is selected, skip days `< from` or `> to`.

### L4 — The edit calendar shows the record's own other days as free [bug]
- **Where:** `apps/web/src/pages/AvailabilityPage.vue:124-158, 205`.
- **Fix:** Pass `originDays` minus the chip day as reserved/locked days so they show as already excluded and can't be selected.

### L5 — Double-submit possible [bug]
- **Where:** `apps/web/src/pages/AvailabilityPage.vue:398-416` (Save/Delete enabled while the toggle is running; `openUpdate` can be re-entered), `apps/web/src/pages/UsersPage.vue:138, 215, 344-349, 364` (`save`, `savePassword`, `toggleActive`, `remove` have no in-flight flag).
- **Fix:** Use one `busy` ref per dialog or row that disables all of its action buttons, and return early from handlers when it's set (same as `billingSaving` in UsagePage).

### L6 — Rules form can be edited before load and is overwritten when load finishes [bug]
- **Where:** `apps/web/src/pages/RulesPage.vue:31-47`.
- **Fix:** Add a `loading` flag that disables the inputs and buttons. Load the two settings with `Promise.allSettled` so one failure doesn't empty both cards.

### L7 — A pending confirm survives route changes [bug]
- **Where:** `apps/web/src/composables/useConfirm.ts:21-35`; ConfirmDialog is mounted once in `layouts/DefaultLayout.vue:13`.
- **Problem:** Navigating away with e.g. "Delete schedule" open leaves the dialog on the new page. Clicking Delete then runs the old page's destructive call.
- **Fix:** Resolve the pending request with `false` on navigation (`router.afterEach` registered in ConfirmDialog).

### L8 — CSV export: Excel mojibake and formula injection [security/bug]
- **Where:** `apps/web/src/lib/download.ts:1-11`, `packages/utils/src/csv.ts:10-13` (`escapeCsvField`).
- **Fix:** Prepend `'\uFEFF'` to the Blob content. In `escapeCsvField`, prefix fields that start with `=`, `+`, `-`, `@`, `\t` or `\r` with `'` (and quote them). Defer `URL.revokeObjectURL` with `setTimeout(…, 0)` so Safari/Firefox don't cancel the download. Add a test in `packages/utils`.

### L9 — Select ArrowUp skips the last option when nothing is active [bug]
- **Where:** `apps/web/src/components/ui/Select.vue:155-164`.
- **Fix:** If `i === -1`, start from `delta > 0 ? -1 : opts.length`. If no enabled option is found, leave `activeValue` unchanged.

### L10 — Pickers: focus not restored on close; cells lack full-date labels and selected state [a11y]
- **Where:** `apps/web/src/components/ui/DatePicker.vue:86-106, 194-214`, `apps/web/src/components/ui/MonthPicker.vue:54-64, 151-168`, `apps/web/src/components/ui/CalendarDialog.vue` (day labels).
- **Fix:** Focus the trigger after pick, clear or Escape. Add an `aria-label` with the full date (or month + year) and `aria-pressed` for the selected cell.

### L11 — Header a11y: icon-only mobile Logout button, unlabeled navs [a11y]
- **Where:** `apps/web/src/components/layout/AppHeader.vue:88, 114-117, 121`.
- **Fix:** Add `aria-label="Logout"` to the button and `aria-hidden="true"` to the icon. Label the two `<nav>` elements (`aria-label="Main"` and `aria-label="Main (mobile)"`).

### L12 — Login inputs lack `autocomplete` [a11y]
- **Where:** `apps/web/src/pages/LoginPage.vue:140-147`.
- **Fix:** `autocomplete="username"` on the identifier field and `autocomplete="current-password"` on the password field.

### L13 — Usage page: no empty or loading states; index used as key [bug]
- **Where:** `apps/web/src/pages/UsagePage.vue:111-116, 157, 184`.
- **Fix:** Add `<EmptyState>` for empty generations and alerts. Don't show "Not set" until `billing` has loaded, and show the error separately. Key rows by a stable composite (`` `${e.generatedAt}-${e.year}-${e.month}` ``).

### L14 — Schedules table has no empty state [bug]
- **Where:** `apps/web/src/pages/SchedulesPage.vue` (table around `:151`).
- **Fix:** `<EmptyState v-if="!loading && !errorMsg && records.length === 0">`.

### L15 — Print stylesheet keeps dark-theme text colors on a white page [bug]
- **Where:** `apps/web/src/style.css:547-566`.
- **Fix:** Inside `@media print`, redefine `.dark` custom properties (`--foreground`, `--muted-foreground`, `--border`, …) to the `:root` light values.

### L16 — LockedPage hardcodes a different variant of `SYSTEM_LOCKED_MESSAGE` [improvement]
- **Where:** `apps/web/src/pages/LockedPage.vue:21-22`.
- **Fix:** Import and render `SYSTEM_LOCKED_MESSAGE` from `@oncall/shared`.

### L17 — Dead `conflictsByDate` in the detail page [improvement]
- **Where:** `apps/web/src/pages/ScheduleDetailPage.vue:72` (always an empty `Map`).
- **Fix:** Remove it and make the `DutyCalendar` prop optional (preferred; simplest).

### L18 — Duplicated helpers [improvement]
- **Where:**
  - `MONTHS`/`monthLabel` is copied into SchedulesPage, ScheduleDetailPage, SchedulePreviewPage, ScheduleRosterPage, AdminDashboard and ReportsPage.
  - `toQuery(year, month)` is defined in both `services/schedule.ts` and `services/stats.ts`.
  - `pad`/`toIso`/`WEEKDAYS`/month-grid building is repeated in `DatePicker.vue:33-72`, `CalendarDialog.vue:44-66` and `MonthPicker.vue`.
  - `formatRange` and the day-expansion logic exist in both `AvailabilityPage.vue` and `MyAvailabilityPage.vue`.
- **Fix:** Move pure date/month helpers to `@oncall/utils` (`toIsoDate` already exists; add `monthLabel` and a Monday-first `monthGrid(year, month0)`), and move `toQuery` into one services helper. Do this last, after the bug fixes, and keep behavior identical.

---

## Checked, no issue found
- No `v-html`, `innerHTML` or user-data `:href` bindings in `apps/web/src` (no XSS sinks).
- Access token is not written to `localStorage`/`sessionStorage`; refresh uses the httpOnly cookie with `credentials: 'include'`.
- No `console.*` logging of tokens or PII.
- Single-flight refresh in `lib/http.ts:53-72` is correct.
