# Administrator User Manual — Design

**Date:** 2026-08-07
**Status:** Approved
**Deliverable type:** End-user documentation (PDF)

## Goal

Produce a comprehensive, professional **Administrator User Manual** as a single PDF that
explains how a hospital administrator uses the On-Call Duty Scheduling System.

## Audience & scope

- **Audience:** hospital administrators (the `administrator` role). Not doctors, not developers.
- **Scope:** *usage only* — how to operate the running application. Deliberately excludes
  installation, deployment, database setup, and environment configuration.
- **Depth:** comprehensive — step-by-step for every administrator page, with worked examples,
  field references, and troubleshooting.

## Source of truth (verified against the codebase)

- Frontend admin pages: `apps/web/src/pages/` (Login, Home/AdminDashboard, Users, Doctors,
  Availability, Schedules, ScheduleDetail, Holidays, Reports, Profile).
- Router + role guards: `apps/web/src/router/index.ts`, `guard.ts`.
- Admin nav: `apps/web/src/components/layout/AppHeader.vue` →
  Home · Users · Doctors · Availability · Schedules · Holidays · Reports · Profile.
- Domain rules: `AGENTS.md` (Domain Rules + Scheduling Engine Requirements).
- Scheduling engine: `apps/api/src/scheduling/` (engine, constraints, scoring, types, dates).
- Reports: `apps/web/src/pages/ReportsPage.vue`, `apps/api/src/services/reports.service.ts`.
- Seeded admin: `admin@oncall.local` / `changeme123` (from `database/seed.sql`).
- Sample holidays seeded for **2026-09** (Sept 1, Sept 17) — used as the worked month.

## Deliverables

1. `docs/admin-manual/On-Call Duty - Administrator Manual.pdf` — the final manual.
2. `docs/admin-manual/manual.html` (+ `manual.css`) — the styled HTML source used to render it.
3. `docs/admin-manual/screenshots/*.png` — captured screenshots (referenced by the HTML).

> The repo's `package.json` is **not** modified. Playwright (used only for screenshot capture)
> is installed in a throwaway scratch directory outside the project.

## Production toolchain

1. **Capture** — start `pnpm dev` (API on :3000, web on :5174). Generate a September 2026
   schedule via the admin UI so Schedules, Schedule Detail, Dashboard, and Reports show real,
   populated data. Drive every admin page with Playwright (system Chrome via `channel: 'chrome'`)
   and capture full-page PNGs for both empty and populated states.
2. **Author** — a single HTML document with print CSS: cover page, auto-numbered table of
   contents, per-section page breaks, running header "On-Call Duty — Administrator Manual",
   and page numbers.
3. **Render** — `chrome --headless --print-to-pdf` → final PDF. Verify page count, image
   embedding, and that no content is clipped.

## Manual structure (chapters)

1. **Introduction** — purpose; the two roles; administrator responsibilities; conventions used.
2. **Signing in** — login screen; default admin credentials; first-login password change;
   session behaviour; logout.
3. **The Administrator Dashboard (Home)** — year/month selector; coverage card; fairness card;
   workload table; the "no schedule yet" shortcut.
4. **Managing Users** — administrator accounts: create (initial password = email), edit
   (incl. changing role to doctor/administrator), disable/enable, delete; confirmation dialogs.
5. **Managing Doctors** — create/edit; the **Max monthly duties (1–7)** cap; disable vs. delete
   (delete blocked when duties exist); the doctor–account link.
6. **Managing Availability (exclusions)** — types (vacation/sick/conference/other); inclusive
   date ranges; overlap rejection; filtering by doctor and date range.
7. **Managing Holidays** — create/edit/delete; how holidays feed the engine and reports.
8. **Building a Schedule** — the core workflow:
   **Preview → resolve conflicts → Generate → edit (add/reassign/remove duties) → Publish (lock)
   → Revert to draft**. Schedule Detail page in depth; weekend/holiday/gap badges; the per-duty
   "Reason" explanation.
9. **Reports** — monthly report layout (coverage, fairness, holidays, roster, workload);
   **Export CSV**; **Print / Save as PDF**; empty state.
10. **Your Profile** — changing your password (current + new, must differ; other sessions signed out).
11. **Domain Rules & Scheduling Engine Reference** — shift 07:00–15:00; on-call 07:00→next-day
    15:00; monthly cap (1–7); no back-to-back (incl. cross-month); availability/vacation
    exclusions; weekend/holiday balancing & fair-workload scoring; explainable assignment
    reasons; conflict detection and resolution.
12. **Troubleshooting & FAQ** — "a day is unfillable"; "can't delete a doctor"; "schedule is
    locked"; disabled-account login; CSV/print tips.
13. **Quick Reference & Glossary** — admin nav map; field reference; key terms.

## Screenshot list (planned captures)

- Login page (empty form + validation error).
- Admin dashboard — populated (Sept 2026) and empty ("no schedule") states.
- Users page — list + New user dialog + Edit user dialog.
- Doctors page — list + New/Edit doctor dialog (Max monthly duties field highlighted).
- Availability page — filtered list + New exclusion dialog.
- Holidays page — list + New/Edit holiday dialog.
- Schedules page — list + New schedule dialog showing **Preview** (assignments + conflict panel).
- Schedule Detail — draft (editable) and published (locked); add/reassign duty dialog;
  weekend/holiday/gap badges and a Reason tooltip.
- Reports page — full monthly report; CSV/print controls.
- Profile page — change password.

## Out of scope

- Installation, deployment, DB/env setup, and any developer/ops content.
- Doctor-facing pages (My Availability, doctor dashboard) beyond a brief mention.
- API reference (mentioned only where it aids understanding).

## Process note

This is a single-author documentation deliverable, so the chapter outline above *is* the
implementation plan. Per AGENTS.md's anti-over-engineering rule, the separate formal-plan /
subagent execution chain is intentionally skipped; the work proceeds directly:
spec → capture screenshots → author HTML → render PDF → verify.
