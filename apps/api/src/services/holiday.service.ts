import type { AuthUser, Holiday, SetMonthHolidaysRequest } from '@oncall/shared'
import { query, withTransaction } from '../db/client'
import type { ClinicScope } from '../lib/scope'
import { recordActivity } from './activity.service'

type Actor = Pick<AuthUser, 'id' | 'role' | 'clinicId'>

interface HolidayRow {
  id: number
  clinic_id: number
  holiday_date: string
}

function toHoliday(row: HolidayRow): Holiday {
  return {
    id: row.id,
    clinicId: row.clinic_id,
    date: row.holiday_date,
  }
}

export async function list(year: number, scope: ClinicScope): Promise<Holiday[]> {
  const res = await query<HolidayRow>(
    `SELECT id, clinic_id, holiday_date FROM holidays
     WHERE clinic_id = $1 AND EXTRACT(YEAR FROM holiday_date) = $2
     ORDER BY holiday_date`,
    [scope.clinicId, year],
  )
  return res.rows.map(toHoliday)
}

/**
 * Replaces the marked holidays of one (clinic, year, month) with `dates`:
 * removed dates are deleted, added dates inserted, all inside one
 * transaction together with the audit write.
 */
export async function setMonth(
  input: SetMonthHolidaysRequest,
  actor: Actor,
  scope: ClinicScope,
): Promise<Holiday[]> {
  return withTransaction(async (client) => {
    await client.query(
      `DELETE FROM holidays
       WHERE clinic_id = $1 AND date_trunc('month', holiday_date) = MAKE_DATE($2, $3, 1)`,
      [scope.clinicId, input.year, input.month],
    )
    if (input.dates.length > 0) {
      const values = input.dates.map((_, i) => `($1, $${i + 2})`).join(', ')
      await client.query(
        `INSERT INTO holidays (clinic_id, holiday_date) VALUES ${values}
         ON CONFLICT (clinic_id, holiday_date) DO NOTHING`,
        [scope.clinicId, ...input.dates],
      )
    }
    const res = await client.query<HolidayRow>(
      `SELECT id, clinic_id, holiday_date FROM holidays
       WHERE clinic_id = $1
         AND EXTRACT(YEAR FROM holiday_date) = $2
         AND EXTRACT(MONTH FROM holiday_date) = $3
       ORDER BY holiday_date`,
      [scope.clinicId, input.year, input.month],
    )
    await recordActivity(client, {
      userId: actor.id,
      action: 'holidays.updated',
      entityType: 'holidays',
      entityId: null,
      clinicId: scope.clinicId,
      detail: { year: input.year, month: input.month, dates: input.dates },
    })
    return res.rows.map(toHoliday)
  })
}
