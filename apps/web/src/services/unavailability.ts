import type {
  CreateUnavailabilitySelfRequest,
  Unavailability,
  UnavailabilityQuery,
  UpdateUnavailabilityRequest,
} from '@oncall/shared'
import { apiDelete, apiGet, apiPatch, apiPost } from '@/lib/http'

function toQuery(query?: UnavailabilityQuery): string {
  if (!query) return ''
  const parts: string[] = []
  if (query.doctorId !== undefined) parts.push(`doctorId=${query.doctorId}`)
  if (query.from !== undefined) parts.push(`from=${query.from}`)
  if (query.to !== undefined) parts.push(`to=${query.to}`)
  return parts.length > 0 ? `?${parts.join('&')}` : ''
}

export async function listAll(query?: UnavailabilityQuery): Promise<Unavailability[]> {
  const { unavailability } = await apiGet<{ unavailability: Unavailability[] }>(
    `/unavailability${toQuery(query)}`,
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
export async function remove(id: number): Promise<void> {
  await apiDelete<void>(`/unavailability/${id}`)
}
