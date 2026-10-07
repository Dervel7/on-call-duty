import { describe, expect, it } from 'vitest'

import { explainDutyReason as explainWith } from '../lib/duty-reason'
import { createAppI18n } from '../lib/i18n'
import el from '../locales/el.json'
import en from '../locales/en.json'

const LOCALES = [
  { lang: 'en', m: en.dutyReason },
  { lang: 'el', m: el.dutyReason },
] as const

describe.each(LOCALES)('explainDutyReason ($lang)', ({ lang, m }) => {
  const { t } = createAppI18n(lang).global
  const explainDutyReason = (reason: string): string => explainWith(reason, t)
  const join = (...parts: string[]): string => parts.join('; ')

  it('explains workload-driven picks', () => {
    expect(explainDutyReason('score 30 (workload +30, weekend +0, friday +0)')).toBe(m.workload)
  })

  it('explains weekend balance picks', () => {
    expect(explainDutyReason('score 11 (workload +3, weekend +8, friday +0)')).toBe(
      m.weekendBalance,
    )
  })

  it('explains Friday balance picks', () => {
    expect(explainDutyReason('score 9 (workload +3, weekend +0, friday +6)')).toBe(m.fridayBalance)
  })

  it('parses the current format with the first fri/sat/sun term', () => {
    expect(
      explainDutyReason('score 40 (workload +30, weekend +0, friday +0, first fri/sat/sun +10)'),
    ).toBe(m.workload)
    expect(
      explainDutyReason(
        'score 21 (workload +3, weekend +8, friday +0, first fri/sat/sun +10); tie-break: fewer weekend duties',
      ),
    ).toBe(join(m.weekendBalance, m.tieBreakFewerWeekendDuties))
    expect(
      explainDutyReason(
        'score 9 (workload +3, weekend +0, friday +6, first fri/sat/sun +0); tie-break: lower id; day-fill guarantee overrode fairness caps',
      ),
    ).toBe(join(m.fridayBalance, m.tieBreakRosterOrder, m.dayFillGuarantee))
  })

  it('appends tie-break notes', () => {
    expect(
      explainDutyReason('score 30 (workload +30, weekend +0, friday +0); tie-break: fewer duties'),
    ).toBe(join(m.workload, m.tieBreakFewerDuties))
    expect(
      explainDutyReason(
        'score 11 (workload +3, weekend +8, friday +0); tie-break: fewer weekend duties',
      ),
    ).toBe(join(m.weekendBalance, m.tieBreakFewerWeekendDuties))
    expect(
      explainDutyReason('score 30 (workload +30, weekend +0, friday +0); tie-break: lower id'),
    ).toBe(join(m.workload, m.tieBreakRosterOrder))
  })

  it('explains relaxed day-fill assignments', () => {
    expect(
      explainDutyReason(
        'score 6 (workload +6, weekend +0, friday +0); tie-break: lower id; day-fill guarantee overrode fairness caps',
      ),
    ).toBe(join(m.workload, m.tieBreakRosterOrder, m.dayFillGuarantee))
  })

  it('appends the fallback note', () => {
    expect(
      explainDutyReason('score 40 (workload +30, weekend +0, friday +0, first fri/sat/sun +10); fallback'),
    ).toBe(join(m.workload, m.fallback))
    expect(
      explainDutyReason(
        'score 11 (workload +3, weekend +8, friday +0); tie-break: fewer duties; fallback',
      ),
    ).toBe(join(m.weekendBalance, m.tieBreakFewerDuties, m.fallback))
    expect(
      explainDutyReason(
        'score 6 (workload +6, weekend +0, friday +0, first fri/sat/sun +0); tie-break: lower id; day-fill guarantee overrode fairness caps; fallback',
      ),
    ).toBe(join(m.workload, m.tieBreakRosterOrder, m.dayFillGuarantee, m.fallback))
  })

  it('explains each solver status', () => {
    expect(explainDutyReason('solver optimal')).toBe(m.solverOptimal)
    expect(explainDutyReason('solver time limit')).toBe(m.solverTimeLimit)
  })

  it('explains each solver note', () => {
    expect(explainDutyReason('solver optimal; first friday')).toBe(
      join(m.solverOptimal, m.solverFirstFriday),
    )
    expect(explainDutyReason('solver optimal; first saturday')).toBe(
      join(m.solverOptimal, m.solverFirstSaturday),
    )
    expect(explainDutyReason('solver time limit; first sunday')).toBe(
      join(m.solverTimeLimit, m.solverFirstSunday),
    )
    expect(explainDutyReason('solver optimal; day-fill guarantee overrode fairness caps')).toBe(
      join(m.solverOptimal, m.dayFillGuarantee),
    )
    expect(explainDutyReason('solver time limit; repeat weekday to reach minimum')).toBe(
      join(m.solverTimeLimit, m.solverRepeatWeekday),
    )
  })

  it('explains a solver reason combining notes', () => {
    expect(
      explainDutyReason(
        'solver optimal; first saturday; day-fill guarantee overrode fairness caps',
      ),
    ).toBe(join(m.solverOptimal, m.solverFirstSaturday, m.dayFillGuarantee))
  })

  it('maps manual overrides to plain text', () => {
    expect(explainDutyReason('manual override by admin #3')).toBe(m.manualOverride)
    expect(explainDutyReason('plan')).toBe(m.plan)
  })

  it('passes unknown reasons through unchanged', () => {
    expect(explainDutyReason('engine')).toBe('engine')
    expect(explainDutyReason('custom note from a draft plan')).toBe('custom note from a draft plan')
    expect(explainDutyReason('solver optimal; first monday')).toBe('solver optimal; first monday')
    expect(explainDutyReason('solver infeasible')).toBe('solver infeasible')
  })
})

describe('explainDutyReason (literal en text)', () => {
  const { t } = createAppI18n('en').global

  it('renders a combined solver reason', () => {
    expect(explainWith('solver optimal; first saturday', t)).toBe(
      'Best possible schedule under the fairness rules; their only Saturday duty this month',
    )
  })
})
