# i18n Translation Batches (English + Greek) — Plan

Splits every file that renders user-facing web text (`apps/web`, plus the
`packages/utils` helpers it renders) into batches of 5, so the English → Greek
translation can be done and reviewed 5 files at a time.

- Languages: English (`en`, default) and Greek (`el`).
- Scope: web UI strings only. API error messages (`json.error`, shown as-is by
  `lib/http.ts`) are still English after these batches.
- Each batch also updates its listed test files, because the tests assert on
  English text.

## Prerequisite (before Batch 1)

You need these before any batch can start:

1. Add an i18n library to `apps/web`. `vue-i18n` is the usual choice for Vue 3.
2. Create the locale files `apps/web/src/locales/en.json` and `apps/web/src/locales/el.json`.
   Each batch adds its keys to both files.
3. Register the plugin in `apps/web/src/main.ts`. Set the i18n locale from the same
   rule `App.vue` already uses for `<html lang>`: `en` on public routes (login,
   locked), otherwise `auth.user.language`. The language picker on the Profile
   page already saves the choice to `users.language` (`PATCH /users/me/language`).
4. Add a test helper that mounts components with the i18n plugin in `en`.
   Existing English assertions then keep working.

## Batch 1: Shared UI dialogs and pickers

Every page uses these, so they go first.

| # | File | Strings / notes | Tests |
|---|---|---|---|
| 1 | `src/components/ui/Dialog.vue` | `aria-label="Close"` | `Dialog.test.ts` |
| 2 | `src/components/ui/ConfirmDialog.vue` | Renders `useConfirm` title/message/buttons | `ConfirmDialog.test.ts` |
| 3 | `src/components/ui/CalendarDialog.vue` | `Confirm`, `Cancel`, `Close`, `Pick days`, `Previous/Next month`, `Already excluded`; `Intl` `'en-GB'` | `CalendarDialog.test.ts` |
| 4 | `src/components/ui/DatePicker.vue` | `Select date`, `Clear date`, `Choose date`, `Previous/Next month`; `Intl` `'en-GB'` (×2) | `DatePicker.test.ts` |
| 5 | `src/components/ui/MonthPicker.vue` | `Select month`, `Clear month`, `Choose month`, `Previous/Next year` | `MonthPicker.test.ts` |

## Batch 2: Strings outside components

| # | File | Strings / notes | Tests |
|---|---|---|---|
| 1 | `src/composables/useConfirm.ts` | Default `confirmText: 'Confirm'`, `cancelText: 'Cancel'` | — |
| 2 | `src/lib/http.ts` | Fallback `'Request failed'`. Keep comparing against the English `SYSTEM_LOCKED_MESSAGE` constant; translate it only where it is displayed. | `http.test.ts` |
| 3 | `src/lib/duty-reason.ts` | All explanation sentences and the `TIE_BREAK` labels | `duty-reason.test.ts` |
| 4 | `packages/utils/src/date.ts` | Hardcoded `MONTHS`, `WEEKDAYS`, `monthLabel()`. This package has zero dependencies, so take a locale parameter and use `Intl`; do not import i18n here. | `packages/utils/src/__tests__/utils.test.ts` |
| 5 | `apps/web/index.html` | `<title>`, `<html lang="en">` | — |

## Batch 3: App shell and account

| # | File | Strings / notes | Tests |
|---|---|---|---|
| 1 | `src/components/layout/AppHeader.vue` | Navigation labels, user menu. The language switcher can go here. | `AppHeader.test.ts` |
| 2 | `src/pages/HomePage.vue` | `Welcome`, empty-state description | `HomePage.test.ts` |
| 3 | `src/pages/LockedPage.vue` | `System locked`, `SYSTEM_LOCKED_MESSAGE` display | `LockedPage.test.ts` |
| 4 | `src/pages/LoginPage.vue` | Form labels, errors, buttons | `LoginPage.test.ts` |
| 5 | `src/pages/ProfilePage.vue` | Profile and password form | `ProfilePage.test.ts` |

## Batch 4: Dashboards and schedule views

| # | File | Strings / notes | Tests |
|---|---|---|---|
| 1 | `src/components/dashboard/AdminDashboard.vue` | Stat labels; uses `MONTHS` / `monthLabel` | `AdminDashboard.test.ts` |
| 2 | `src/components/dashboard/DoctorDashboard.vue` | Stat labels; `Intl` `'en-GB'` | `DoctorDashboard.test.ts` |
| 3 | `src/components/schedule/DutyCalendar.vue` | Calendar labels, weekday headers | `DutyCalendar.test.ts` |
| 4 | `src/pages/SchedulesPage.vue` | List, status labels, actions; `Intl` with an undefined locale | `SchedulesPage.test.ts` |
| 5 | `src/pages/ScheduleRosterPage.vue` | Roster labels | `ScheduleRosterPage.test.ts` |

## Batch 5: Scheduling workflow and rules

| # | File | Strings / notes | Tests |
|---|---|---|---|
| 1 | `src/pages/SchedulePreviewPage.vue` | Preview, conflicts, actions; `'Preview'` fallback label | `SchedulePreviewPage.test.ts` |
| 2 | `src/pages/ScheduleDetailPage.vue` | Duty edit, publish/revert, confirm dialogs | `ScheduleDetailPage.test.ts` |
| 3 | `src/pages/ReportsPage.vue` | Report labels, CSV actions; `Intl` `'en'` (×2) and `'en-GB'` | `ReportsPage.test.ts` |
| 4 | `src/pages/RulesPage.vue` | Rule labels and help text | `RulesPage.test.ts` |
| 5 | `src/pages/HolidaysPage.vue` | Holiday labels; `Intl` `'en-GB'` | `HolidaysPage.test.ts` |

## Batch 6: Users, availability, superadmin

| # | File | Strings / notes | Tests |
|---|---|---|---|
| 1 | `src/pages/UsersPage.vue` | User/doctor forms, roles, confirm dialogs | `UsersPage.test.ts` |
| 2 | `src/pages/AvailabilityPage.vue` | Availability forms, reasons, confirm dialogs | `AvailabilityPage.test.ts` (asserts an `'en-GB'` month label) |
| 3 | `src/pages/MyAvailabilityPage.vue` | Doctor availability view | `MyAvailabilityPage.test.ts` |
| 4 | `src/pages/ActivityPage.vue` | Activity log labels; `toLocaleString()` | `ActivityPage.test.ts` |
| 5 | `src/pages/UsagePage.vue` | Usage tables, `resolved` / `open` badges; `toLocaleString()` (×2) | `UsagePage.test.ts` |

## Batch 7: Remainder

| # | File | Strings / notes | Tests |
|---|---|---|---|
| 1 | `packages/utils/src/csv.ts` | `CSV_HEADERS` (`Date`, `Weekday`, `Doctor`, `Weekend`, `Reason`), full weekday names, `Yes` / `No`. All of these end up in the roster CSV that `ReportsPage` downloads through `dutiesToCsv`. Zero-dependency package: pass the labels in, do not import i18n. | `packages/utils/src/__tests__/csv.test.ts` |

## Not batched: files with no hardcoded text

These files only pass through text from props or slots, so there is nothing to translate:

`App.vue`, `layouts/DefaultLayout.vue`, `components/layout/AppLayout.vue`,
`components/ui/` → `Avatar`, `Badge`, `Button`, `Card*` (6), `EmptyState`,
`Input`, `Label`, `PageHeader`, `Select`, `Spinner`, `Switch`, `Table*` (6).

## Per-batch checklist

- [ ] Replace every hardcoded string with a key in both `en.json` and `el.json`.
- [ ] Replace hardcoded `Intl` / `toLocale*` locales with the active locale.
- [ ] Translate `aria-label`, `title`, and `placeholder` text too, not only the visible text.
- [ ] Update the listed tests.
- [ ] `pnpm typecheck`, `pnpm lint`, `pnpm test` pass.
