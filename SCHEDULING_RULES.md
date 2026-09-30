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

Days before the anchor are always closed. A date needs **double coverage**
when it is an open day **or the calendar day right after one**
(`requiresDoubleCoverage`) — the day after is protected because a duty hands
over at 15:00 the next day, but it is **not** itself an open day and does not
count toward the one-open-duty cap.

## 3. Hard rules (never broken — engine, manual plans, and single-duty edits)

Checked per candidate doctor, per day, in this order (`fillDay` in
`apps/api/src/scheduling/engine.ts`):

1. **One slot per doctor per day** — a doctor cannot hold both slots of a date.
2. **Max 2 doctors per day** — a third duty on a date is rejected (409).
3. **Availability** — no assignment on a date covered by one of the doctor's
   unavailability ranges (disabled ranges are ignored).
4. **Monthly cap** — `doctors.max_monthly_duties` (1–7) per schedule month.
5. **One open on-call duty per doctor** *(strict)* — at most 1 duty on open
   on-call days per doctor per schedule (`OPEN_DUTY_DUTY_CAP = 1`). A second
   open-day duty is refused everywhere: engine assignment, manual plans
   (`validatePlan` → 409), and add/reassign (`validateAssignment` → 409). It
   is never relaxed to complete an open day's double coverage.
6. **No back-to-back** — a doctor cannot be on duty the day immediately after
   (or, for later slots, the day before) a day they are already on duty.
   Checked across month boundaries via the previous month's last-day duties.
7. **Double coverage on open on-call days** *(strict)* — an open on-call day
   and the day right after it always carry **2 doctors**. They are filled
   first (both slots before any regular day gets a single one), and fairness
   caps never block them — only rules 3–6 above can leave a slot unfilled,
   which surfaces as a conflict.
8. **Active doctors only** — disabled doctors are skipped entirely.
9. **Every day needs at least one doctor** *(strict)* — before a regular day
   is left empty, the fairness caps (§4) are relaxed for its first slot; the
   hard rules above never relax. A day filled this way keeps exactly one
   doctor and its duty `reason` records
   `day-fill guarantee overrode fairness caps`. If even the relaxed pass finds
   nobody, the day surfaces as a conflict: generating with it returns 422 and
   publishing an incomplete schedule returns 409.

### Strictness ordering

`Double coverage (7) > fairness caps (§4)` — weekend/holiday balancing is
skipped on open days and the day after them.
`Day-fill guarantee (9) > fairness caps (§4)` — balancing yields before a day
is left empty (first slot of a regular day only; critical days skip fairness
anyway).
`Rules 3–6` are absolute: they can leave even a double-coverage day short,
reported as a conflict with the exact breakdown (e.g.
`requires 2 doctors (open on-call rule); only 1 of 2 doctors assigned; …
1 at open on-call cap, …`).

## 4. Fairness rules (soft — enforced everywhere except critical days)

| Rule | Cap | Where |
|---|---|---|
| Saturday balance | nobody takes more than ±1 above an even split of Saturday slots: `floor(2 × Saturdays ÷ active doctors) + 1` | `balanceCap` in `constraints.ts` |
| Sunday balance | same formula over Sunday slots | `balanceCap` |
| Holiday duty cap | max 2 duties on holiday days (weekends + admin-marked dates) per month | `HOLIDAY_DUTY_CAP` |

These never block a duty on an open on-call day or the day right after one.

They also yield to the day-fill guarantee (§3 rule 9): when a regular day's
first slot has no eligible doctor, the balance/holiday caps are skipped for
that slot. They still block every second slot, and single-duty edits
(`validateAssignment`) enforce them without exception.

## 5. Scoring (how the engine picks among eligible doctors)

Per candidate, `apps/api/src/scheduling/scoring.ts`:

- **Workload +3** × remaining headroom under the doctor's monthly cap
- **Weekend +4** × headroom under the weekend budget `ceil(2 × weekend days ÷ active doctors)` (weekend days only)
- **Friday +2** × headroom under the Friday budget `ceil(2 × Fridays ÷ active doctors)` (Fridays only)

Ties break deterministically: fewest total duties → fewest weekend duties →
lower doctor id. Same inputs always yield the same roster.

## 6. Fill order

1. All open on-call days and the days right after them (critical days),
   slot 0 across all of them, then slot 1.
2. All remaining days, slot 0, then slot 1.

If a regular day's slot-0 pass finds no eligible doctor, the fairness caps
are relaxed once for that slot (§3 rule 9) before the day is recorded as a
conflict; eligibility only shrinks afterwards, so such a day never gains a
second doctor.

Every assignment persists a human-readable `reason`
(`score N (workload +x, weekend +y, friday +z)…`); manual edits persist
`manual override by admin #<id>`.

## 7. Where each rule is enforced

| Operation | Rules enforced |
|---|---|
| `POST /schedules/preview` | Engine runs cold; conflicts listed per day with the full breakdown; nothing persisted |
| `POST /schedules` (auto) | Engine must produce zero conflicts, else 422; then persist |
| `POST /schedules` (manual plan) | `validatePlan`: date in month, active doctor, availability, no dup per date, ≤2/day, every day ≥1, double coverage complete, monthly cap, open-duty cap, Sat/Sun/holiday balance (relaxed on critical days and for a day's sole doctor — day-fill guarantee), no back-to-back |
| `POST /schedules/:id/duties` | `validateAssignment`: active, available, monthly cap, no dup, open-duty cap, balance caps (relaxed on critical days), holiday cap, no back-to-back; max 2/day |
| `PATCH /duties/:id` | Same as add, excluding the reassigned duty itself |
| `DELETE /duties/:id` | Refused (409) on an open day or the day after one — those slots must be reassigned, not removed |
| `POST /schedules/:id/publish` | Every day ≥1 duty and double coverage complete, else 409 |
| Published schedules | All duty edits and deletion refused (409) until reverted to draft |
| `GET /schedules/:id` (admin) | Per-day eligibility recomputes every hard/fairness rule against the persisted duties (swap-aware: a doctor's own duty on the day doesn't count against them) |

All checks are per clinic: another clinic's doctors, duties, and holidays
never constrain this clinic's schedule.
