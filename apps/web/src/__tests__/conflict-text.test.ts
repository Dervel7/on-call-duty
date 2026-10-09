import { describe, expect, it } from 'vitest'
import type { ConflictPlan } from '@oncall/shared'

import { explainConflict } from '../lib/conflict-text'
import { createAppI18n } from '../lib/i18n'

const openDay: ConflictPlan = {
  date: '2026-10-02',
  critical: true,
  required: 3,
  assigned: 2,
  activeDoctors: 9,
  tally: { unavailable: 3, atMonthlyCap: 3, atOpenDutyCap: 1, atHolidayCap: 0, backToBack: 0, alreadyOnDuty: 2 },
}

const regularDay: ConflictPlan = {
  date: '2026-10-05',
  critical: false,
  required: 1,
  assigned: 0,
  activeDoctors: 2,
  tally: { unavailable: 1, atMonthlyCap: 0, atOpenDutyCap: 0, atHolidayCap: 0, backToBack: 1, alreadyOnDuty: 0 },
}

describe('explainConflict', () => {
  it('explains an open on-call day in English', () => {
    const { t } = createAppI18n('en').global
    expect(explainConflict(openDay, t)).toBe(
      'requires 3 doctors (open on-call rule); only 2 of 3 doctors assigned; of 9 active doctor(s): 3 unavailable, 3 at monthly cap, 1 at open on-call cap, 0 at holiday cap, 0 back-to-back, 2 already on duty',
    )
  })

  it('explains an open on-call day in Greek', () => {
    const { t } = createAppI18n('el').global
    expect(explainConflict(openDay, t)).toBe(
      'απαιτούνται 3 ιατροί (κανόνας ανοιχτής εφημερίας); ανατέθηκαν μόνο 2 από 3 ιατρούς; από 9 ενεργούς ιατρούς: 3 μη διαθέσιμοι, 3 στο μηνιαίο όριο, 1 στο όριο ανοιχτής εφημερίας, 0 στο όριο αργιών, 0 σε συνεχόμενες ημέρες, 2 ήδη σε εφημερία',
    )
  })

  it('omits the open on-call rule and the on-duty count when they do not apply', () => {
    const { t } = createAppI18n('el').global
    expect(explainConflict(regularDay, t)).toBe(
      'ανατέθηκαν μόνο 0 από 1 ιατρούς; από 2 ενεργούς ιατρούς: 1 μη διαθέσιμοι, 0 στο μηνιαίο όριο, 0 στο όριο ανοιχτής εφημερίας, 0 στο όριο αργιών, 1 σε συνεχόμενες ημέρες',
    )
  })
})
