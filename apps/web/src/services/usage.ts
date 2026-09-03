import type { GenerationEvent, GeneratePressCounts, OperatorAlert, UsageSummary } from '@oncall/shared'
import { apiGet, apiPatch, apiPost } from '@/lib/http'

export async function summary(): Promise<UsageSummary> {
  const { summary } = await apiGet<{ summary: UsageSummary }>('/usage/summary')
  return summary
}
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
export async function recordGeneratePress(): Promise<void> {
  await apiPost<void>('/usage/generate-presses', {})
}
export async function generatePresses(): Promise<GeneratePressCounts> {
  const data = await apiGet<GeneratePressCounts>('/usage/generate-presses')
  return data
}
