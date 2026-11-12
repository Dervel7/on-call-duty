import type { Actor } from '@oncall/shared'
import { query } from '../db/client.ts'
import { HttpError } from './http-error.ts'

/** Fixed to one clinic (from the JWT) for administrator/doctor. */
export interface ClinicScope {
  clinicId: number
}

/**
 * The single way every clinic-scoped endpoint resolves its clinic:
 * administrator/doctor are pinned to their JWT clinic (a different
 * `clinicId` is 403); manager must name the clinic explicitly via the
 * `?clinicId=` query parameter (missing is 400); superadmin defaults to
 * the sole clinic of a single-clinic deployment and only has to name the
 * clinic explicitly when more than one exists.
 */
export async function resolveClinicScope(
  user: Actor,
  requestedClinicId: number | undefined,
): Promise<ClinicScope> {
  if (user.role === 'administrator' || user.role === 'doctor') {
    if (requestedClinicId !== undefined && requestedClinicId !== user.clinicId) {
      throw new HttpError(403, 'Forbidden')
    }
    return { clinicId: user.clinicId as number }
  }
  if (user.role === 'manager') {
    if (requestedClinicId === undefined) {
      throw new HttpError(400, 'clinicId query parameter is required')
    }
    return { clinicId: requestedClinicId }
  }
  if (user.role === 'superadmin') {
    const clinicId = requestedClinicId ?? (await soleClinicId())
    if (clinicId === undefined) {
      throw new HttpError(400, 'clinicId query parameter is required')
    }
    return { clinicId }
  }
  throw new HttpError(403, 'Forbidden')
}

/** Single-clinic deployments: the one existing clinic is the superadmin's implicit scope. */
async function soleClinicId(): Promise<number | undefined> {
  const res = await query<{ id: number }>('SELECT id FROM clinics ORDER BY id LIMIT 2')
  const sole = res.rows.length === 1 ? res.rows[0] : undefined
  return sole?.id
}
