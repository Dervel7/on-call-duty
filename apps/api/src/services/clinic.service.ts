import type { Clinic, CreateClinicRequest, UpdateClinicRequest } from '@oncall/shared'
import { query } from '../db/client'
import { HttpError } from '../lib/http-error'

interface ClinicRow {
  id: number
  name: string
  is_active: boolean
  doctor_count: number
  admin_count: number
  created_at: Date
}

// doctorCount/adminCount are "live" members: users not soft-deleted.
const SELECT = `SELECT c.id, c.name, c.is_active, c.created_at,
  (SELECT COUNT(*)::int FROM doctors d JOIN users u ON u.id = d.user_id
     WHERE d.clinic_id = c.id AND u.is_deleted = FALSE) AS doctor_count,
  (SELECT COUNT(*)::int FROM users u
     WHERE u.clinic_id = c.id AND u.role = 'administrator' AND u.is_deleted = FALSE) AS admin_count
  FROM clinics c`

function toClinic(row: ClinicRow): Clinic {
  return {
    id: row.id,
    name: row.name,
    isActive: row.is_active,
    doctorCount: row.doctor_count,
    adminCount: row.admin_count,
    createdAt: row.created_at.toISOString(),
  }
}

export async function list(): Promise<Clinic[]> {
  const res = await query<ClinicRow>(`${SELECT} ORDER BY c.name`)
  return res.rows.map(toClinic)
}

export async function getById(id: number): Promise<Clinic> {
  const res = await query<ClinicRow>(`${SELECT} WHERE c.id = $1`, [id])
  const row = res.rows[0]
  if (!row) throw new HttpError(404, 'Clinic not found')
  return toClinic(row)
}

async function nameTaken(name: string, excludeId?: number): Promise<boolean> {
  const res = await query<{ id: number }>(
    `SELECT id FROM clinics WHERE LOWER(name) = LOWER($1) AND id <> COALESCE($2, 0)`,
    [name, excludeId ?? null],
  )
  return res.rows.length > 0
}

export async function create(input: CreateClinicRequest): Promise<Clinic> {
  if (await nameTaken(input.name)) throw new HttpError(409, 'Clinic name already exists')
  const res = await query<{ id: number }>(`INSERT INTO clinics (name) VALUES ($1) RETURNING id`, [
    input.name,
  ])
  const created = res.rows[0]
  if (!created) throw new HttpError(500, 'Clinic creation failed')
  return getById(created.id)
}

export async function update(id: number, input: UpdateClinicRequest): Promise<Clinic> {
  await getById(id) // 404 on unknown clinic
  if (input.name !== undefined && (await nameTaken(input.name, id))) {
    throw new HttpError(409, 'Clinic name already exists')
  }
  await query(
    `UPDATE clinics SET
       name       = COALESCE($2, name),
       is_active  = COALESCE($3, is_active),
       updated_at = NOW()
     WHERE id = $1`,
    [id, input.name ?? null, input.isActive ?? null],
  )
  return getById(id)
}
