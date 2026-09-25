import type {
  AuthUser,
  CreateUnavailabilityAdminRequest,
  CreateUnavailabilitySelfRequest,
  Unavailability,
  UnavailabilityQuery,
  UpdateUnavailabilityRequest,
} from '@oncall/shared'
import { query, withTransaction } from '../db/client'
import { HttpError } from '../lib/http-error'
import type { ClinicScope } from '../lib/scope'
import { recordActivity } from './activity.service'

type Actor = Pick<AuthUser, 'id' | 'role' | 'clinicId'>

interface UnavailabilityRow {
  id: number
  doctor_id: number
  first_name: string
  last_name: string
  start_date: string
  end_date: string
  is_disabled: boolean
  created_at: Date
  updated_at: Date
}

const SELECT = `SELECT x.id, x.doctor_id, x.start_date, x.end_date, x.is_disabled,
  x.created_at, x.updated_at, u.first_name, u.last_name
  FROM unavailability x
  JOIN doctors d ON d.id = x.doctor_id
  JOIN users u ON u.id = d.user_id AND u.is_deleted = FALSE`

function toUnavailability(row: UnavailabilityRow): Unavailability {
  return {
    id: row.id,
    doctorId: row.doctor_id,
    doctorFirstName: row.first_name,
    doctorLastName: row.last_name,
    startDate: row.start_date,
    endDate: row.end_date,
    isDisabled: row.is_disabled,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  }
}

async function resolveDoctorId(userId: number): Promise<number> {
  const res = await query<{ id: number }>('SELECT id FROM doctors WHERE user_id = $1', [userId])
  const row = res.rows[0]
  if (!row) throw new HttpError(404, 'Doctor profile not found')
  return row.id
}

async function getById(id: number): Promise<Unavailability> {
  const res = await query<UnavailabilityRow>(`${SELECT} WHERE x.id = $1`, [id])
  const row = res.rows[0]
  if (!row) throw new HttpError(404, 'Unavailability record not found')
  return toUnavailability(row)
}

/**
 * Manager never modifies availability (403, D5). administrator must reach a
 * record of their own clinic (404, existence hidden). doctor owns the record.
 */
async function assertCanModify(recordDoctorId: number, actor: Actor): Promise<void> {
  if (actor.role === 'manager') throw new HttpError(403, 'Forbidden')
  if (actor.role === 'superadmin') return
  if (actor.role === 'administrator') {
    if (actor.clinicId === null) throw new HttpError(403, 'Forbidden')
    const res = await query(`SELECT 1 FROM doctors WHERE id = $1 AND clinic_id = $2`, [
      recordDoctorId,
      actor.clinicId,
    ])
    if (res.rows.length === 0) throw new HttpError(404, 'Unavailability record not found')
    return
  }
  const ownDoctorId = await resolveDoctorId(actor.id)
  if (ownDoctorId !== recordDoctorId) throw new HttpError(403, 'Forbidden')
}

export async function listAll(
  filters: UnavailabilityQuery = {},
  scope?: ClinicScope,
): Promise<Unavailability[]> {
  const where: string[] = []
  const params: unknown[] = []
  if (scope !== undefined) {
    params.push(scope.clinicId)
    where.push(`d.clinic_id = $${params.length}`)
  }
  if (filters.doctorId !== undefined) {
    params.push(filters.doctorId)
    where.push(`x.doctor_id = $${params.length}`)
  }
  if (filters.from !== undefined) {
    params.push(filters.from)
    where.push(`x.end_date >= $${params.length}`)
  }
  if (filters.to !== undefined) {
    params.push(filters.to)
    where.push(`x.start_date <= $${params.length}`)
  }
  const sql =
    where.length > 0
      ? `${SELECT} WHERE ${where.join(' AND ')} ORDER BY x.start_date DESC, u.last_name`
      : `${SELECT} ORDER BY x.start_date DESC, u.last_name`
  const res = await query<UnavailabilityRow>(sql, params)
  return res.rows.map(toUnavailability)
}

export async function listOwn(userId: number): Promise<Unavailability[]> {
  const doctorId = await resolveDoctorId(userId)
  return listAll({ doctorId })
}

type CreateInput = CreateUnavailabilityAdminRequest | CreateUnavailabilitySelfRequest

export async function create(
  doctorId: number,
  input: CreateInput,
  actor: Actor,
  scope?: ClinicScope,
): Promise<Unavailability> {
  const id = await withTransaction(async (client) => {
    // With a scope, the target doctor must belong to it (unknown and
    // cross-clinic doctors are the same 404).
    const lock = await client.query<{ clinic_id: number }>(
      `SELECT d.clinic_id FROM doctors d JOIN users u ON u.id = d.user_id
       WHERE d.id = $1 AND u.is_deleted = FALSE${scope !== undefined ? ' AND d.clinic_id = $2' : ''}
       FOR UPDATE OF d`,
      scope !== undefined ? [doctorId, scope.clinicId] : [doctorId],
    )
    const locked = lock.rows[0]
    if (!locked) throw new HttpError(404, 'Doctor not found')
    // Disabled records still count here: they keep reserving their days so a
    // later re-enable can never create an overlap.
    const overlap = await client.query(
      'SELECT id FROM unavailability WHERE doctor_id = $1 AND start_date <= $2 AND end_date >= $3',
      [doctorId, input.endDate, input.startDate],
    )
    if (overlap.rows.length > 0)
      throw new HttpError(409, 'Overlapping unavailability record exists')
    const ins = await client.query(
      'INSERT INTO unavailability (doctor_id, start_date, end_date) VALUES ($1, $2, $3) RETURNING id',
      [doctorId, input.startDate, input.endDate],
    )
    const newId = ins.rows[0]?.id
    if (newId === undefined) throw new HttpError(500, 'Failed to create unavailability record')
    await recordActivity(client, {
      userId: actor.id,
      action: 'availability.created',
      entityType: 'unavailability',
      entityId: newId,
      clinicId: locked.clinic_id,
      detail: {
        doctorId,
        startDate: input.startDate,
        endDate: input.endDate,
      },
    })
    return newId
  })
  return getById(id)
}

export async function createOwn(
  userId: number,
  input: CreateUnavailabilitySelfRequest,
): Promise<Unavailability> {
  const doctorId = await resolveDoctorId(userId)
  return create(doctorId, input, { id: userId, role: 'doctor', clinicId: null })
}

export async function update(
  id: number,
  input: UpdateUnavailabilityRequest,
  actor: Actor,
): Promise<Unavailability> {
  const existing = await query<{
    doctor_id: number
    clinic_id: number
    start_date: string
    end_date: string
  }>(
    `SELECT x.doctor_id, d.clinic_id, x.start_date, x.end_date
     FROM unavailability x JOIN doctors d ON d.id = x.doctor_id WHERE x.id = $1`,
    [id],
  )
  const existingRow = existing.rows[0]
  if (!existingRow) throw new HttpError(404, 'Unavailability record not found')
  await assertCanModify(existingRow.doctor_id, actor)

  await withTransaction(async (client) => {
    await client.query('SELECT 1 FROM doctors WHERE id = $1 FOR UPDATE', [existingRow.doctor_id])
    // Re-read under lock so concurrent PATCH/DELETE decisions use committed state.
    const locked = await client.query<{
      doctor_id: number
      start_date: string
      end_date: string
    }>('SELECT doctor_id, start_date, end_date FROM unavailability WHERE id = $1 FOR UPDATE', [id])
    if (locked.rows.length === 0) throw new HttpError(404, 'Unavailability record not found')
    const current = locked.rows[0]!
    const start = input.startDate ?? current.start_date
    const end = input.endDate ?? current.end_date
    // A partial patch merges with stored values; validate the merged range.
    if (end < start)
      throw new HttpError(400, 'endDate must be on or after startDate')
    if (input.startDate !== undefined || input.endDate !== undefined) {
      // Disabled records still count here: they keep reserving their days so
      // a later re-enable can never create an overlap.
      const overlap = await client.query(
        'SELECT id FROM unavailability WHERE doctor_id = $1 AND start_date <= $2 AND end_date >= $3 AND id <> $4',
        [current.doctor_id, end, start, id],
      )
      if (overlap.rows.length > 0)
        throw new HttpError(409, 'Overlapping unavailability record exists')
    }
    const sets: string[] = []
    const params: unknown[] = []
    const map: Array<[string, unknown]> = [
      ['start_date', input.startDate],
      ['end_date', input.endDate],
    ]
    for (const [col, value] of map) {
      if (value !== undefined) {
        params.push(value)
        sets.push(`${col} = $${params.length}`)
      }
    }
    if (sets.length > 0) {
      params.push(id)
      await client.query(
        `UPDATE unavailability SET ${sets.join(', ')}, updated_at = NOW() WHERE id = $${params.length}`,
        params,
      )
    }
    const before: Record<string, unknown> = {}
    const after: Record<string, unknown> = {}
    if (input.startDate !== undefined && input.startDate !== current.start_date) {
      before.startDate = current.start_date
      after.startDate = input.startDate
    }
    if (input.endDate !== undefined && input.endDate !== current.end_date) {
      before.endDate = current.end_date
      after.endDate = input.endDate
    }
    if (Object.keys(before).length > 0) {
      await recordActivity(client, {
        userId: actor.id,
        action: 'availability.updated',
        entityType: 'unavailability',
        entityId: id,
        clinicId: existingRow.clinic_id,
        detail: { doctorId: current.doctor_id, before, after },
      })
    }
  })
  return getById(id)
}

export async function setDisabled(
  id: number,
  isDisabled: boolean,
  actor: Actor,
): Promise<Unavailability> {
  // Only administrators (and superadmins) may toggle the flag — doctors
  // never, not even on their own records.
  if (actor.role !== 'administrator' && actor.role !== 'superadmin')
    throw new HttpError(403, 'Forbidden')
  const existing = await query<{
    doctor_id: number
    clinic_id: number
    is_disabled: boolean
  }>(
    `SELECT x.doctor_id, d.clinic_id, x.is_disabled
     FROM unavailability x JOIN doctors d ON d.id = x.doctor_id WHERE x.id = $1`,
    [id],
  )
  const existingRow = existing.rows[0]
  if (!existingRow) throw new HttpError(404, 'Unavailability record not found')
  await assertCanModify(existingRow.doctor_id, actor)

  await withTransaction(async (client) => {
    // Re-read under lock so concurrent toggle decisions use committed state.
    const locked = await client.query<{ doctor_id: number; is_disabled: boolean }>(
      'SELECT doctor_id, is_disabled FROM unavailability WHERE id = $1 FOR UPDATE',
      [id],
    )
    const current = locked.rows[0]
    if (!current) throw new HttpError(404, 'Unavailability record not found')
    if (current.is_disabled !== isDisabled) {
      await client.query(
        'UPDATE unavailability SET is_disabled = $1, updated_at = NOW() WHERE id = $2',
        [isDisabled, id],
      )
      await recordActivity(client, {
        userId: actor.id,
        action: 'availability.updated',
        entityType: 'unavailability',
        entityId: id,
        clinicId: existingRow.clinic_id,
        detail: {
          doctorId: current.doctor_id,
          before: { isDisabled: current.is_disabled },
          after: { isDisabled },
        },
      })
    }
  })
  return getById(id)
}

export async function remove(id: number, actor: Actor): Promise<void> {
  const existing = await query<{
    doctor_id: number
    clinic_id: number
    start_date: string
    end_date: string
  }>(
    `SELECT x.doctor_id, d.clinic_id, x.start_date, x.end_date
     FROM unavailability x JOIN doctors d ON d.id = x.doctor_id WHERE x.id = $1`,
    [id],
  )
  const existingRow = existing.rows[0]
  if (!existingRow) throw new HttpError(404, 'Unavailability record not found')
  await assertCanModify(existingRow.doctor_id, actor)
  await withTransaction(async (client) => {
    const deleted = await client.query('DELETE FROM unavailability WHERE id = $1 RETURNING id', [id])
    if (deleted.rows.length === 0) throw new HttpError(404, 'Unavailability record not found')
    await recordActivity(client, {
      userId: actor.id,
      action: 'availability.deleted',
      entityType: 'unavailability',
      entityId: id,
      clinicId: existingRow.clinic_id,
      detail: {
        doctorId: existingRow.doctor_id,
        startDate: existingRow.start_date,
        endDate: existingRow.end_date,
      },
    })
  })
}
