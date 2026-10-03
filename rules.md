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

Fill order:

1. Critical days, up to the minimum
2. Regular days, up to the minimum
3. Critical days, extra slots
4. Regular days, extra slots

## 3. Holiday cap (fairness cap)

A doctor may take at most **2** duties per month on holiday days (Saturdays, Sundays and dates marked as holidays).

- It does not apply on critical days.
- It gives way to minimum coverage. If a regular day would otherwise stay below its minimum, the cap is lifted for that day. The duty's reason then says "day-fill guarantee overrode fairness caps".

## 4. Fair workload distribution (scoring)

Among the doctors who pass the rules above, the engine picks the one with the highest score:

| Factor | Weight | Meaning |
|---|---|---|
| Workload | 3 | Doctors with more of their monthly cap left score higher |
| Weekend | 4 | On weekend days, doctors below their fair share of weekend duties score higher |
| Friday | 2 | On Fridays, doctors below their fair share of Friday duties score higher |
| Fri/Sat/Sun | 5 | On a Friday, Saturday or Sunday, doctors with no duty yet on that weekday this month score higher |

A doctor's fair share is the total weekend (or Friday) slots divided by the number of active doctors, rounded up.

The Fri/Sat/Sun factor is a soft goal: each doctor gets one Friday, one Saturday and one Sunday per month. It only ranks doctors who already passed every rule above, so it never overrides a hard constraint, minimum coverage or the holiday cap. When there are fewer slots than doctors, or availability prevents it, some doctors get fewer.

## 5. Tie-breakers

If scores are equal, the engine picks, in order:

1. The doctor with the fewest total duties
2. The doctor with the fewest weekend duties
3. The doctor with the lowest id

## Explainability

Every assigned duty stores a `reason` with its score breakdown and any tie-break or override that applied. Conflicts are detected before a schedule is created (`POST /schedules/preview`).
