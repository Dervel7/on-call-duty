# Web review fixes: all 10 batches

Source: `docs/superpowers/plans/2026-11-09-web-review-fixes-plan.md`

Each finding has an ID (for example `CORE-01`). Findings in the same batch touch the same files, so each file is edited once.

## Status

| Batch | Topic | Status |
|---|---|---|
| 1 | Deployment and session | Not done by me |
| 2 | High-severity UI/data bugs | Not done by me |
| 3 | Schedule detail and options | Not done by me |
| 4 | Dashboards and reports | Not done by me |
| 5 | Availability pages | Not done by me |
| 6 | Other admin pages | Not done by me |
| 7 | i18n | Not done by me |
| 8 | UI primitives | Not done by me |
| 9 | Dead code and simplification | Not done by me |
| 10 | Config | **Done** |

Batch 1 note: when I read `apps/web/nginx.conf`, the CORE-01 line (`proxy_cookie_path /auth /api/auth;`) was already there. I did not add it.

---

## Batch 1: Deployment and session

- **CORE-01** nginx did not rewrite the refresh-cookie path. Reload and token refresh failed in Docker.
- **CORE-02 + CORE-09** (done together, same file `stores/auth.ts`)
  - CORE-02: a lock found during token refresh sent the user to /login instead of /locked.
  - CORE-09: the access token was managed in two places (services and store). Make the store the only owner.
- **CORE-03** two tabs refreshing at once signed all tabs out.
- **CORE-05** (web half only) a wrong password on login triggered an extra refresh and replay.
- **CORE-04** unknown URLs showed a blank page.
- **CORE-06** stale lazy chunks after a deploy made navigation silently fail.
- **CORE-07** network failures showed raw English browser text.

## Batch 2: High-severity UI/data bugs

- **UI-01** the sidebar trapped Tab focus on desktop. The drawer focus trap leaked on mobile.
- **SCH-01** DutyCalendar hid duties beyond the day's current slot count.
- **ADM-01** every new doctor got the same hard-coded password. Needs a user decision first.

## Batch 3: Schedule detail and options

- **SCH-02** duty edits re-enabled the cell before the refetch landed. Refetches were unordered.
- **SCH-03** Publish, Revert and Delete had no in-flight guard. No resync after a failed (409) change.
- **SCH-06** saving a plan or deleting a schedule used `push`, so Back landed on an error page.
- **SCH-07** the detail page always fetched `/doctors` (403 for doctors).
- **SCH-11** tests for schedule-level and duty-level actions (covers SCH-02, SCH-03 and SCH-06).
- **SCH-08** option tabs did not follow the ARIA tabs keyboard pattern.
- **SCH-09** dead props and duplicated grouping around DutyCalendar.

## Batch 4: Dashboards and reports

- **SCH-04** the admin dashboard showed the previous month's figures after a failed load.
- **ADM-10 + ADM-16** (same file, `ReportsPage.vue`)
  - ADM-10: the default month was computed in UTC.
  - ADM-16: roster day labels formatted a UTC date in local time.

## Batch 5: Availability pages

- **ADM-15** shared helper for "remove one day from a record". Do this first.
- **ADM-03** MyAvailability: Delete had no in-flight guard.
- **ADM-02** MyAvailability: a save that failed halfway left the list stale.
- **ADM-12** a failed doctor-list load was swallowed, leaving empty selects.

## Batch 6: Other admin pages

- **ADM-06** Usage: double-clicking Resolve showed a wrong error.
- **ADM-07** Users: enabling or disabling a doctor was logged as `user.*` instead of `doctor.*`.
- **ADM-08** Holidays: a failed month load after discarding edits left old marks.
- **ADM-09** Holidays: unsaved marks were lost when leaving the page.
- **ADM-11** Login: spaces around the identifier caused "Invalid credentials".
- **ADM-13** Usage: generation history had no clinic column.
- **ADM-04** Activity: some filters could never match, and logins were invisible. The web part is first. The API part needs a decision.

## Batch 7: i18n

- **ADM-05** validation errors showed raw English Zod messages in the Greek UI.

## Batch 8: UI primitives

- **UI-02** `dark:` classes followed the OS theme, not the app theme.
- **UI-15** CalendarDialog re-implemented the Dialog shell.
- **UI-05** ConfirmDialog message was never announced to screen readers.
- **UI-16** popover code was copy-pasted across Select, DatePicker and MonthPicker. It includes the fixes for UI-03, UI-04 and UI-07.
  - UI-03: clicking outside a Select also closed the Dialog.
  - UI-04: Tab out of DatePicker or MonthPicker left the popover open.
  - UI-07: the Select list was not kept inside the screen horizontally.
- **UI-06** DatePicker and MonthPicker triggers hid the selected value from screen readers.
- **UI-08** Select was missing `aria-controls` and arrow-key opening.
- **UI-09** Avatar initials were read aloud next to the full name.
- **UI-11** sidebar breakpoint in px could disagree with Tailwind's rem breakpoint.
- **UI-10** no nav item was active while a doctor viewed a schedule. Skip it if SCH-10 is done.

## Batch 9: Dead code and simplification

- **ADM-14** remove `clinicId` arguments that never change what the server does. Do this first.
- **CORE-10** one shared query-string helper instead of four hand-rolled ones.
- **CORE-08** remove unused functions, the types barrel and the zod dependency. Keep zod if ADM-05 is done.
- **UI-12** remove dead Dialog `onClickOutside`.
- **UI-13** remove the unused component, variants and theme tokens.
- **UI-14** the print palette duplicated the light theme.
- **SCH-05** delete the unreachable Schedule Preview page. Needs a decision.
- **SCH-10** merge `/roster` into `/schedules`. Needs a decision.

## Batch 10: Config (DONE)

- **CORE-11** removed `COPY apps/api ./apps/api` from `apps/web/Dockerfile`. API-only changes no longer rebuild the web image.
- **CORE-12** in `apps/web/nginx.conf`:
  - Turned on gzip.
  - `/assets/` now has one `Cache-Control` header (one year, immutable) and returns 404 for missing files.
  - Added a `no-cache` rule for non-fingerprinted static files (png, jpg, gif, svg, ico, fonts). This was not in the plan.
- **CORE-13** deleted the unused `apps/web/tsconfig.node.json`.

Not run for batch 10: `pnpm typecheck`, `pnpm lint`, `pnpm test`, Docker build. Nothing was committed.

---

## Decisions still needed from you

| ID | Question |
|---|---|
| SCH-05 | Delete the unreachable Schedule Preview page, or restore a link to it? |
| SCH-10 | Merge the doctor "Duty roster" page into `/schedules`? |
| ADM-01 | Should admins type each new doctor's initial password? |
| ADM-04, CORE-05 | Are `apps/api` changes in scope? |
