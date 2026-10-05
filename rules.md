# Schedule Generation Rules

Rules the scheduling engine applies when a schedule is generated (`apps/api/src/scheduling/`).
Rules are listed from highest to lowest priority. A lower rule never overrides a higher one.

## 1. Hard constraints (never broken)

A doctor is never assigned to a day if any of these is true:

1. **Unavailable** – the doctor has a vacation or availability exclusion covering that day.
2. **Monthly cap reached** – the doctor already has their maximum monthly duties (`max_monthly_duties`, 1–7).
3. **Back-to-back duty** – the doctor is on duty the day before or the day after. This also checks the last day of the previous month.
4. **Open on-call cap** – a doctor may take only **1** open on-call day per schedule.
5. **Already on duty that day** – a doctor holds at most one slot per day.

If these rules leave a day below its minimum, the day is reported as a **conflict**. The engine never breaks a hard constraint to avoid one.

## 2. Minimum coverage (strict)

Every day must reach its minimum number of doctors. The minimum depends on the day type:

- **Open on-call day** – open-day minimum.
- **Day right after an open on-call day** – post-open minimum.
- **Any other day** – closed-day minimum.

Open on-call days and the day after them are **critical days**. They are filled first, and fairness caps never block them.

Slots above the minimum, up to the day's slot count, are filled afterwards on a best-effort basis. An optional slot is left empty if nobody qualifies. It is never a conflict.

Coverage priority:

1. Critical days, up to the minimum (position by position)
2. Regular days, up to the minimum: every regular day gets its first doctor before any regular day gets a second, and so on
3. Extra slots above the minimum, after all fairness goals (see section 4)

## 3. Holiday cap (fairness cap)

A doctor may take at most **2** duties per month on holiday days (Saturdays, Sundays and dates marked as holidays).

- It does not apply on critical days.
- It gives way to minimum coverage. If a regular day would otherwise stay below its minimum, the cap is lifted for that day. The duty's reason then says "day-fill guarantee overrode fairness caps".

## 4. Objective stages

The engine is an exact solver (HiGHS). It solves the whole month at once, one goal (stage) at a time, in the order below. Each later stage keeps the best result of every earlier stage, so a lower goal never makes a higher one worse. Hard constraints (section 1) hold in every stage.

| Stage | Goal |
|---|---|
| 1. Coverage | Reach every day's minimum in the priority order of section 2. Days left short become conflicts. |
| 2. Relax | Use the holiday-cap override and a repeated Friday/Saturday/Sunday as rarely as possible. Both are allowed only where coverage needs them. |
| 3. Weekdays | Each doctor gets one Friday, one Saturday and one Sunday where possible. |
| 4. Share | Each doctor's total stays less than one duty away from their fair share. |
| 5. Holidays | Holiday duty counts (weekends and marked holidays) stay within 1 of each other where possible. |
| 6. Fill | Fill as many extra slots above each day's minimum as possible. |

**Fair share.** First the engine works out each doctor's capacity: the most duties they could take alone under every per-doctor rule. A doctor's fair share is the month's total duties x their capacity / the sum of all capacities. A lower monthly cap or a long absence lowers that doctor's share instead of pulling everyone else down.

**Extra slots and weekdays.** An extra slot stays empty rather than give a doctor a second Friday, Saturday or Sunday.

## 5. Reasons, time limit and fallback

Every assigned duty stores a reason. It starts with the solver status, followed by optional notes joined with `; `.

| Part | Meaning |
|---|---|
| `solver optimal` | Every stage was solved to the proven best result |
| `solver time limit` | A stage hit the time limit; the best solution found so far is used |
| `first friday` / `first saturday` / `first sunday` | The doctor's only duty on that weekday this month |
| `day-fill guarantee overrode fairness caps` | The holiday cap was exceeded to reach a day's minimum (on the doctor's chronologically last such duties) |
| `repeat weekday to reach minimum` | A second duty on the same Friday, Saturday or Sunday weekday, needed for coverage (on the later ones) |

Example: `solver optimal; first saturday`.

The time budget is 10 seconds per generation. If the solver fails or finds no solution in time, the earlier greedy engine generates the schedule instead, and every reason ends with `; fallback`. The same input always gives the same schedule, unless the time limit is hit.

## Explainability

Every assigned duty stores a `reason` in the format of section 5, including any override that applied. Conflicts are detected before a schedule is created (`POST /schedules/preview`) and are listed in date order.
