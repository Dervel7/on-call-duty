import type {
  CreateUnavailabilitySelfRequest,
  SplitUnavailabilityRequest,
  Unavailability,
  UnavailabilityQuery,
  UpdateUnavailabilityRequest,
} from '@oncall/shared'
import { eachDay, groupConsecutiveDays } from '@oncall/utils'
import { apiDelete, apiGet, apiPatch, apiPost } from '@/lib/http'
import { toQuery } from './query'

export async function listAll(query?: UnavailabilityQuery): Promise<Unavailability[]> {
  const { unavailability } = await apiGet<{ unavailability: Unavailability[] }>(
    `/unavailability${toQuery({ ...query })}`,
  )
  return unavailability
}
export async function listMine(): Promise<Unavailability[]> {
  const { unavailability } = await apiGet<{ unavailability: Unavailability[] }>(
    '/unavailability/me',
  )
  return unavailability
}
export async function createForDoctor(
  doctorId: number,
  input: CreateUnavailabilitySelfRequest,
): Promise<Unavailability> {
  const { unavailability } = await apiPost<{ unavailability: Unavailability }>('/unavailability', {
    doctorId,
    ...input,
  })
  return unavailability
}
export async function createMine(input: CreateUnavailabilitySelfRequest): Promise<Unavailability> {
  const { unavailability } = await apiPost<{ unavailability: Unavailability }>(
    '/unavailability/me',
    input,
  )
  return unavailability
}
export async function update(
  id: number,
  input: UpdateUnavailabilityRequest,
): Promise<Unavailability> {
  const { unavailability } = await apiPatch<{ unavailability: Unavailability }>(
    `/unavailability/${id}`,
    input,
  )
  return unavailability
}
export async function setDisabled(id: number, isDisabled: boolean): Promise<Unavailability> {
  const { unavailability } = await apiPatch<{ unavailability: Unavailability }>(
    `/unavailability/${id}/disabled`,
    { isDisabled },
  )
  return unavailability
}
/**
 * Atomically splits a record: it keeps the first segment, the others become
 * new records with its disabled flag. `isDisabled` (admin only) re-flags the
 * record that keeps the id.
 */
export async function split(
  id: number,
  input: SplitUnavailabilityRequest,
): Promise<Unavailability[]> {
  const { unavailability } = await apiPost<{ unavailability: Unavailability[] }>(
    `/unavailability/${id}/split`,
    input,
  )
  return unavailability
}
export async function remove(id: number): Promise<void> {
  await apiDelete<void>(`/unavailability/${id}`)
}
/** Removes one day from a record: splits around it, or deletes the record when it was its only day. */
export async function removeDay(record: Unavailability, day: string): Promise<void> {
  const others = eachDay(record.startDate, record.endDate).filter((d) => d !== day)
  if (others.length > 0) await split(record.id, { segments: groupConsecutiveDays(others) })
  else await remove(record.id)
}
