import { describe, expect, it } from 'vitest'

import { explainDutyReason as explainWith } from '../lib/duty-reason'
import { createAppI18n } from '../lib/i18n'

const { t } = createAppI18n('en').global
const explainDutyReason = (reason: string): string => explainWith(reason, t)

describe('explainDutyReason', () => {
  it('explains workload-driven picks', () => {
    expect(explainDutyReason('score 30 (workload +30, weekend +0, friday +0)')).toBe(
      'Picked for fair workload — most room left under their monthly duty limit',
    )
  })

  it('explains weekend balance picks', () => {
    expect(explainDutyReason('score 11 (workload +3, weekend +8, friday +0)')).toBe(
      'Picked to balance weekends — furthest behind on their fair share of weekend duties',
    )
  })

  it('explains Friday balance picks', () => {
    expect(explainDutyReason('score 9 (workload +3, weekend +0, friday +6)')).toBe(
      'Picked to balance Fridays — furthest behind on their fair share of Friday duties',
    )
  })

  it('appends tie-break notes', () => {
    expect(
      explainDutyReason('score 30 (workload +30, weekend +0, friday +0); tie-break: fewer duties'),
    ).toBe('Picked for fair workload — most room left under their monthly duty limit; tie-break: fewer duties so far')
    expect(
      explainDutyReason(
        'score 11 (workload +3, weekend +8, friday +0); tie-break: fewer weekend duties',
      ),
    ).toBe(
      'Picked to balance weekends — furthest behind on their fair share of weekend duties; tie-break: fewer weekend duties',
    )
    expect(
      explainDutyReason('score 30 (workload +30, weekend +0, friday +0); tie-break: lower id'),
    ).toBe('Picked for fair workload — most room left under their monthly duty limit; tie-break: roster order')
  })

  it('explains relaxed day-fill assignments', () => {
    expect(
      explainDutyReason(
        'score 6 (workload +6, weekend +0, friday +0); tie-break: lower id; day-fill guarantee overrode fairness caps',
      ),
    ).toBe(
      'Picked for fair workload — most room left under their monthly duty limit; tie-break: roster order; assigned to guarantee the day was covered, usual fairness caps were relaxed',
    )
  })

  it('maps manual overrides to plain text', () => {
    expect(explainDutyReason('manual override by admin #3')).toBe(
      'Assigned manually by an administrator',
    )
    expect(explainDutyReason('plan')).toBe('Assigned manually')
  })

  it('passes unknown reasons through unchanged', () => {
    expect(explainDutyReason('engine')).toBe('engine')
    expect(explainDutyReason('custom note from a draft plan')).toBe('custom note from a draft plan')
  })
})
