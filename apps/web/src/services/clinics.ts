import type { Clinic, CreateClinicRequest, UpdateClinicRequest } from '@oncall/shared'
import { apiGet, apiPatch, apiPost } from '@/lib/http'

export async function list(): Promise<Clinic[]> {
  const { clinics } = await apiGet<{ clinics: Clinic[] }>('/clinics')
  return clinics
}

export async function create(input: CreateClinicRequest): Promise<Clinic> {
  const { clinic } = await apiPost<{ clinic: Clinic }>('/clinics', input)
  return clinic
}

export async function update(id: number, input: UpdateClinicRequest): Promise<Clinic> {
  const { clinic } = await apiPatch<{ clinic: Clinic }>(`/clinics/${id}`, input)
  return clinic
}
