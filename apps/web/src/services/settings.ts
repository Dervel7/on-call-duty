import type { OpenDutySettings } from '@oncall/shared'
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
