import type { CreateDoctorRequest, Doctor, UpdateDoctorRequest } from '@oncall/shared'
import { apiDelete, apiGet, apiPatch, apiPost } from '@/lib/http'

export async function list(): Promise<Doctor[]> {
  const { doctors } = await apiGet<{ doctors: Doctor[] }>('/doctors')
  return doctors
}
export async function get(id: number): Promise<Doctor> {
  const { doctor } = await apiGet<{ doctor: Doctor }>(`/doctors/${id}`)
  return doctor
}
export async function me(): Promise<Doctor> {
  const { doctor } = await apiGet<{ doctor: Doctor }>('/doctors/me')
  return doctor
}
export async function create(input: CreateDoctorRequest): Promise<Doctor> {
  const { doctor } = await apiPost<{ doctor: Doctor }>('/doctors', input)
  return doctor
}
export async function update(id: number, input: UpdateDoctorRequest): Promise<Doctor> {
  const { doctor } = await apiPatch<{ doctor: Doctor }>(`/doctors/${id}`, input)
  return doctor
}
export async function remove(id: number): Promise<void> {
  await apiDelete<void>(`/doctors/${id}`)
}
