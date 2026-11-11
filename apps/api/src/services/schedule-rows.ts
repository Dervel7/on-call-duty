import type { Actor, Duty, ScheduleSummary, ScheduleStatus } from '@oncall/shared'
import { query } from '../db/client.ts'
import { HttpError } from '../lib/http-error.ts'

export interface ScheduleRow {
  id: number
  year: number
  month: number
  status: string
  clinic_id: number
  clinic_name: string
  created_by: number | null
  created_at: Date
  updated_at: Date
}

export interface DutyRow {
  id: number
  schedule_id: number
  schedule_year: number
  schedule_month: number
  schedule_clinic_id: number
  duty_date: string
  doctor_id: number
  first_name: string
  last_name: string
  is_weekend: boolean
  reason: string
  created_at: Date
  schedule_status: string
}

export const SELECT_SCHEDULE = `SELECT s.id, s.year, s.month, s.status, s.clinic_id, c.name AS clinic_name,
  s.created_by, s.created_at, s.updated_at
  FROM schedules s JOIN clinics c ON c.id = s.clinic_id`
export const SELECT_DUTY = `SELECT du.id, du.schedule_id, du.duty_date, du.doctor_id, du.is_weekend,
  du.reason, du.created_at, u.first_name, u.last_name,
  s.status AS schedule_status, s.year AS schedule_year, s.month AS schedule_month,
  s.clinic_id AS schedule_clinic_id
  FROM duties du JOIN doctors d ON d.id = du.doctor_id JOIN users u ON u.id = d.user_id
  JOIN schedules s ON s.id = du.schedule_id`

/**
 * Object-level access: administrator/doctor may only reach schedules of their
 * own clinic (mismatch → 404, existence hidden); manager and superadmin pass.
 */
export function assertScheduleVisible(clinicId: number, actor: Actor): void {
  if ((actor.role === 'administrator' || actor.role === 'doctor') && clinicId !== actor.clinicId) {
    throw new HttpError(404, 'Schedule not found')
  }
}

export async function selectScheduleRow(id: number): Promise<ScheduleRow> {
  const res = await query<ScheduleRow>(`${SELECT_SCHEDULE} WHERE s.id = $1`, [id])
  const row = res.rows[0]
  if (!row) throw new HttpError(404, 'Schedule not found')
  return row
}

export function toSchedule(row: ScheduleRow): ScheduleSummary {
  return {
    id: row.id,
    year: row.year,
    month: row.month,
    status: row.status as ScheduleStatus,
    clinicId: row.clinic_id,
    clinicName: row.clinic_name,
    createdBy: row.created_by,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  }
}

export function toDuty(row: DutyRow): Duty {
  return {
    id: row.id,
    scheduleId: row.schedule_id,
    dutyDate: row.duty_date,
    doctorId: row.doctor_id,
    doctorFirstName: row.first_name,
    doctorLastName: row.last_name,
    isWeekend: row.is_weekend,
    reason: row.reason,
    createdAt: row.created_at.toISOString(),
  }
}

/** Uniqueness is per clinic (D6): another clinic's schedule for the same month must not block this one. */
export async function assertNoSchedule(year: number, month: number, clinicId: number): Promise<void> {
  const exists = await query(
    'SELECT id FROM schedules WHERE year = $1 AND month = $2 AND clinic_id = $3',
    [year, month, clinicId],
  )
  if (exists.rows.length > 0)
    throw new HttpError(409, 'Schedule already exists for this month; delete it first')
}
