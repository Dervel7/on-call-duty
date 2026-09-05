import type { GenerationEvent, OperatorAlert } from '@oncall/shared'
import { apiGet, apiPatch } from '@/lib/http'

export async function generations(): Promise<GenerationEvent[]> {
  const { generations } = await apiGet<{ generations: GenerationEvent[] }>('/usage/generations')
  return generations
}
export async function alerts(): Promise<OperatorAlert[]> {
  const { alerts } = await apiGet<{ alerts: OperatorAlert[] }>('/usage/alerts')
  return alerts
}
export async function resolveAlert(id: number): Promise<OperatorAlert> {
  const { alert } = await apiPatch<{ alert: OperatorAlert }>(`/usage/alerts/${id}/resolve`)
  return alert
}
