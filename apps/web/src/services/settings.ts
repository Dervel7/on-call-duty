import type { DutyMinimumSettings, DutySlotsSettings, OpenDutySettings } from '@oncall/shared'
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
  postOpenDutySlots: number,
  closedDutySlots: number,
): Promise<DutySlotsSettings> {
  const { dutySlots } = await apiPatch<{ dutySlots: DutySlotsSettings }>('/settings/duty-slots', {
    openDutySlots,
    postOpenDutySlots,
    closedDutySlots,
  })
  return dutySlots
}

export async function getDutyMinimums(): Promise<DutyMinimumSettings> {
  const { dutyMinimums } = await apiGet<{ dutyMinimums: DutyMinimumSettings }>(
    '/settings/duty-minimums',
  )
  return dutyMinimums
}

export async function updateDutyMinimums(
  openDutyMinimum: number,
  postOpenDutyMinimum: number,
  closedDutyMinimum: number,
): Promise<DutyMinimumSettings> {
  const { dutyMinimums } = await apiPatch<{ dutyMinimums: DutyMinimumSettings }>(
    '/settings/duty-minimums',
    { openDutyMinimum, postOpenDutyMinimum, closedDutyMinimum },
  )
  return dutyMinimums
}
