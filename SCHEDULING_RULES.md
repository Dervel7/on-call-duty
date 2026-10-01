# Scheduling Rules

Complete reference of every rule processed when schedules are calculated, in
the order they matter. Source of truth: `apps/api/src/scheduling/` (pure
engine) and `apps/api/src/services/schedule.service.ts` (persistence-side
enforcement). The end-user wording lives in `docs/admin-manual/manual.html` §9.

## 1. Shift timing (fixed system rules)

| Rule | Detail |
|---|---|
| Regular weekday shift | 07:00–15:00 |
| On-call duty | 07:00 on the duty day → 15:00 the **next** day (overnight handover) |
| Duties on any day | Weekends and holidays included |

## 2. Open on-call cycle (input to the rules below)

A date is an **open on-call day** when it is the anchor date or a whole
multiple of the interval after it (`isOpenDutyDate` in
`apps/api/src/scheduling/dates.ts`):

- `open_duty_anchor_date` — first open day (seeded `2026-10-02`), fixed
- `open_duty_interval_days` — spacing between open days (seeded `8`),
  editable by administrators via `PATCH /settings/open-duty`
- `open_duty_slots` — on-call doctors per **open** on-call day (seeded `2`,
  editable 1–7 via `PATCH /settings/duty-slots`)
- `post_open_duty_slots` — on-call doctors per **post-open** day, the
  calendar day right after an open day (seeded `2`, editable 1–7 via
  `PATCH /settings/duty-slots`)
- `closed_duty_slots` — on-call doctors per **closed** on-call day (seeded
  `2`, editable 1–7 via `PATCH /settings/duty-slots`)
- `open_duty_minimum` — minimum on-call doctors per **open** on-call day
  (seeded `2`, editable 1–7 via `PATCH /settings/duty-minimums`; must be ≤
  `open_duty_slots`, missing/corrupt → the slot count, stored values above
  the slot count are clamped to it)
- `post_open_duty_minimum` — minimum on-call doctors per post-open day
  (seeded `2`, editable 1–7 via `PATCH /settings/duty-minimums`; must be ≤
  `post_open_duty_slots`, same fallback)
- `closed_duty_minimum` — minimum on-call doctors per every other day
  (seeded `2`, editable 1–7 via `PATCH /settings/duty-minimums`; must be ≤
  `closed_duty_slots`, same fallback)

Example: open days have 4 slots and the open minimum is 2 → 2 or 3 doctors
are acceptable, 4 is preferred, fewer than 2 is a hard violation.

Days before the anchor are always closed. A date needs **critical fill**
when it is an open day **or the calendar day right after one**
(`requiresDoubleCoverage`) — the day after (post-open day,
`isPostOpenDutyDate`) is protected because a duty hands over at 15:00 the
next day, but it is **not** itself an open day and does not count toward the
one-open-duty cap. When the interval is 1 every day is open, so no day is
post-open. Critical days must reach their type's **minimum** (open minimum on
open days, post-open minimum on the day after) first; their remaining slots
are filled best effort.

## 3. Hard rules (never broken — engine, manual plans, and single-duty edits)

Checked per candidate doctor, per day, in this order (`fillDay` in
`apps/api/src/scheduling/engine.ts`):

1. **One slot per doctor per day** — a doctor cannot hold two slots of a date.
2. **Per-day slot count** — a date holds `open_duty_slots` doctors when it is
   an open on-call day, `post_open_duty_slots` on the day right after one,
   and `closed_duty_slots` otherwise (`slotsForDate`).
   One duty above the day's count is rejected (409).
3. **Availability** — no assignment on a date covered by one of the doctor's
   unavailability ranges (disabled ranges are ignored).
4. **Monthly cap** — `doctors.max_monthly_duties` (1–7) per schedule month.
5. **One open on-call duty per doctor** *(strict)* — at most 1 duty on open
   on-call days per doctor per schedule (`OPEN_DUTY_DUTY_CAP = 1`). A second
   open-day duty is refused everywhere: engine assignment, manual plans
   (`validatePlan` → 409), and add/reassign (`validateAssignment` → 409). It
   is never relaxed to complete an open day's full coverage.
6. **No back-to-back** — a doctor cannot be on duty the day immediately after
   (or, for later slots, the day before) a day they are already on duty.
   Checked across month boundaries via the previous month's last-day duties.
7. **Minimum coverage on critical days** *(strict)* — an open on-call day and
   the day right after it always carry **at least their minimum** (open
   minimum on the open day, post-open minimum on the day after). Their minimum
   slots are filled first (before any regular day), and fairness caps never
   block them — only rules 3–6 can leave a minimum slot unfilled, which
   surfaces as a conflict. Slots above the minimum are best effort.
8. **Active doctors only** — disabled doctors are skipped entirely.
9. **Every day reaches its minimum** *(strict)* — every date must hold at
   least `open_duty_minimum` (open days), `post_open_duty_minimum` (the day
   after an open day), or `closed_duty_minimum` (all other days) doctors. On
   regular days the fairness caps (§4) are relaxed for
   slots below the minimum; the hard rules above never relax. A duty filled
   this way records a `reason` ending with
   `day-fill guarantee overrode fairness caps`. If even the relaxed pass finds
   nobody, the day surfaces as a conflict: generating with it returns 422 and
   publishing a schedule with a day below its minimum returns 409. Slots
   above the minimum (up to the slot count) are best effort: left empty
   silently, no conflict.

### Strictness ordering

`Minimum coverage (7, 9) > fairness caps (§4)` — holiday balancing is
skipped on open days and the day after them, and on regular days it yields
for every slot below the day's minimum.
`Fairness caps (§4) > extra slots` — slots above the minimum on regular days
stay empty rather than break balancing.
`Rules 3–6` are absolute: they can leave even a critical day short,
reported as a conflict with the exact breakdown (e.g.
`requires 3 doctors (open on-call rule); only 2 of 3 doctors assigned; …
1 at open on-call cap, …`).

## 4. Fairness rules (soft — enforced everywhere except critical days)

| Rule | Cap | Where |
|---|---|---|
| Holiday duty cap | max 2 duties on holiday days (Saturdays, Sundays + admin-marked dates) per month — the only weekend limit | `HOLIDAY_DUTY_CAP` in `constraints.ts` |

These never block a duty on an open on-call day or the day right after one.

They also yield to the day-fill guarantee (§3 rule 9): when a regular day's
slot below its minimum has no eligible doctor, the holiday cap is skipped
for that slot. It still blocks every slot above the minimum, and single-duty edits
(`validateAssignment`) enforce it without exception.

## 5. Scoring (how the engine picks among eligible doctors)

Per candidate, `apps/api/src/scheduling/scoring.ts`:

- **Workload +3** × remaining headroom under the doctor's monthly cap
- **Weekend +4** × headroom under the weekend budget `ceil(total weekend slots ÷ active doctors)` (weekend days only)
- **Friday +2** × headroom under the Friday budget `ceil(total Friday slots ÷ active doctors)` (Fridays only)

Ties break deterministically: fewest total duties → fewest weekend duties →
lower doctor id. Same inputs always yield the same roster.

## 6. Fill order

1. Critical days (open on-call days and the days right after them), slot 0
   across all of them, then slot 1, and so on up to each day's **minimum**.
2. Regular days, the same slot-by-slot order up to each day's minimum.
3. Critical days, extra slots above the minimum up to the slot count.
4. Regular days, extra slots up to the slot count.

Phases 1–2 are hard: an unfillable minimum slot is a conflict (on regular
days only after fairness caps are relaxed for it, §3 rule 9). Phases 3–4 are
best effort: an unfillable extra slot is left empty without a conflict.

Every assignment persists a human-readable `reason`
(`score N (workload +x, weekend +y, friday +z)…`); manual edits persist
`manual override by admin #<id>`.

## 7. Where each rule is enforced

| Operation | Rules enforced |
|---|---|
| `POST /schedules/preview` | Engine runs cold; unfilled minimum slots listed per day as conflicts with the full breakdown; empty extra slots are not conflicts; nothing persisted |
| `POST /schedules` (auto) | Engine must produce zero conflicts (every day at its minimum), else 422; then persist |
| `POST /schedules` (manual plan) | `validatePlan`: date in month, active doctor, availability, no dup per date, ≤ the day's slot count, every day ≥ its minimum (422), monthly cap, open-duty cap, holiday cap (relaxed on critical days and for a duty whose day holds ≤ its minimum — day-fill guarantee), no back-to-back |
| `POST /schedules/:id/duties` | `validateAssignment`: active, available, monthly cap, no dup, open-duty cap, holiday cap (relaxed on critical days), no back-to-back; max the day's slot count |
| `PATCH /duties/:id` | Same as add, excluding the reassigned duty itself |
| `DELETE /duties/:id` | On an open day or the day after one, refused (409) only when removal would leave fewer doctors than the day's minimum; regular days unrestricted |
| `POST /schedules/:id/publish` | Every day holds ≥ its minimum, else 409 |
| `PATCH /settings/duty-slots` | Admin only; 1–7; 409 when a new slot count is below the stored minimum for that day type |
| `PATCH /settings/duty-minimums` | Admin only; 1–7; 409 when a minimum exceeds the matching current slot count; audited as `duty_minimums_settings.updated` |
| Published schedules | All duty edits and deletion refused (409) until reverted to draft |
| `GET /schedules/:id` (admin) | Per-day eligibility recomputes every hard/fairness rule against the persisted duties (swap-aware: a doctor's own duty on the day doesn't count against them) |

All checks are per clinic: another clinic's doctors, duties, and holidays
never constrain this clinic's schedule.
