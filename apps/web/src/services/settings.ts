import type { DutySlotsSettings, OpenDutySettings } from '@oncall/shared'
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

export async function getDutySlots(): Promise<DutySlotsSettings> {
  const { dutySlots } = await apiGet<{ dutySlots: DutySlotsSettings }>('/settings/duty-slots')
  return dutySlots
}

export async function updateDutySlots(
  openDutySlots: number,
  closedDutySlots: number,
): Promise<DutySlotsSettings> {
  const { dutySlots } = await apiPatch<{ dutySlots: DutySlotsSettings }>('/settings/duty-slots', {
    openDutySlots,
    closedDutySlots,
  })
  return dutySlots
}
