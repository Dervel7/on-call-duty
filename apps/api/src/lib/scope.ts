import type { AuthUser } from '@oncall/shared'
import { HttpError } from './http-error'

/** Fixed to one clinic (from the JWT) for administrator/doctor. */
export interface ClinicScope {
  kind: 'clinic'
  clinicId: number
}

/**
 * The single way every clinic-scoped endpoint resolves its clinic:
 * administrator/doctor are pinned to their JWT clinic (a different
 * `clinicId` is 403); manager/superadmin must name the clinic explicitly
 * via the `?clinicId=` query parameter (missing is 400).
 */
export function resolveClinicScope(
  user: Pick<AuthUser, 'id' | 'role' | 'clinicId'>,
  requestedClinicId: number | undefined,
): ClinicScope {
  if (user.role === 'administrator' || user.role === 'doctor') {
    if (requestedClinicId !== undefined && requestedClinicId !== user.clinicId) {
      throw new HttpError(403, 'Forbidden')
    }
    return { kind: 'clinic', clinicId: user.clinicId as number }
  }
  if (user.role === 'manager' || user.role === 'superadmin') {
    if (requestedClinicId === undefined) {
      throw new HttpError(400, 'clinicId query parameter is required')
    }
    return { kind: 'clinic', clinicId: requestedClinicId }
  }
  throw new HttpError(403, 'Forbidden')
}
