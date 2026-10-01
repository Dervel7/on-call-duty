import type { ClinicDutySlots, OpenDutySettings } from '@oncall/shared'
import { apiGet, apiPatch } from '@/lib/http'

export async function getOpenDuty(): Promise<OpenDutySettings> {
  const { openDuty } = await apiGet<{ openDuty: OpenDutySettings }>('/settings/open-duty')
  return openDuty
}

export async function updateOpenDutyInterval(intervalDays: number): Promise<OpenDutySettings> {
  const { openDuty } = await apiPatch<{ openDuty: OpenDutySettings }>('/settings/open-duty', {
    intervalDays,
  })
  return openDuty
}

function dutySlotsPath(clinicId?: number): string {
  return clinicId === undefined ? '/settings/duty-slots' : `/settings/duty-slots?clinicId=${clinicId}`
}

export async function getDutySlots(clinicId?: number): Promise<ClinicDutySlots> {
  const { dutySlots } = await apiGet<{ dutySlots: ClinicDutySlots }>(dutySlotsPath(clinicId))
  return dutySlots
}

export async function updateDutySlots(
  openDutySlots: number,
  closedDutySlots: number,
  clinicId?: number,
): Promise<ClinicDutySlots> {
  const { dutySlots } = await apiPatch<{ dutySlots: ClinicDutySlots }>(dutySlotsPath(clinicId), {
    openDutySlots,
    closedDutySlots,
  })
  return dutySlots
}
