import type { ConflictPlan } from '@oncall/shared'

/** The `t` function from `useI18n()`. */
type Translate = (key: string, named: Record<string, unknown>) => string

/**
 * Explains a day left below its minimum in the active UI language: the
 * shortfall, then how many active doctors each rule kept off the day.
 */
export function explainConflict(conflict: ConflictPlan, t: Translate): string {
  const { critical, required, assigned, activeDoctors, tally } = conflict
  return [
    critical ? t('conflict.openRule', { required }) : '',
    t('conflict.assigned', { assigned, required }),
    t(tally.alreadyOnDuty > 0 ? 'conflict.poolOnDuty' : 'conflict.pool', { active: activeDoctors, ...tally }),
  ]
    .filter(Boolean)
    .join('; ')
}
