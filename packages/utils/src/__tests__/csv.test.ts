import { describe, expect, it } from 'vitest'
import { dutiesToCsv, escapeCsvField } from '../csv'

describe('escapeCsvField', () => {
  it('passes a clean field through unchanged', () => {
    expect(escapeCsvField('Jane Roe')).toBe('Jane Roe')
  })

  it('quotes a field containing a comma', () => {
    expect(escapeCsvField('a,b')).toBe('"a,b"')
  })

  it('quotes a field containing a double quote and doubles it', () => {
    expect(escapeCsvField('say "hi"')).toBe('"say ""hi"""')
  })

  it('quotes a field containing CR or LF', () => {
    expect(escapeCsvField('line\nbreak')).toBe('"line\nbreak"')
    expect(escapeCsvField('carriage\rreturn')).toBe('"carriage\rreturn"')
  })
})

describe('dutiesToCsv', () => {
  it('emits only the header row for empty input', () => {
    expect(dutiesToCsv([])).toBe('Date,Weekday,Doctor,Weekend,Holiday,Reason')
  })

  it('emits one CRLF-terminated line per row in the right column order', () => {
    const csv = dutiesToCsv([
      {
        dutyDate: '2026-08-07',
        doctorFirstName: 'Jane',
        doctorLastName: 'Roe',
        isWeekend: false,
        isHoliday: false,
        reason: 'engine',
      },
    ])
    const lines = csv.split('\r\n')
    expect(lines[0]).toBe('Date,Weekday,Doctor,Weekend,Holiday,Reason')
    expect(lines[1]).toBe('2026-08-07,Friday,Jane Roe,No,No,engine')
    expect(lines).toHaveLength(2)
  })

  it('computes the weekday in UTC from dutyDate', () => {
    const csv = dutiesToCsv([
      {
        dutyDate: '2026-08-09',
        doctorFirstName: 'A',
        doctorLastName: 'B',
        isWeekend: true,
        isHoliday: false,
        reason: 'x',
      },
    ])
    // 2026-08-09 is a Sunday
    expect(csv.split('\r\n')[1]).toBe('2026-08-09,Sunday,A B,Yes,No,x')
  })

  it('quotes a reason that contains a comma', () => {
    const csv = dutiesToCsv([
      {
        dutyDate: '2026-08-07',
        doctorFirstName: 'Jane',
        doctorLastName: 'Roe',
        isWeekend: false,
        isHoliday: false,
        reason: 'manual override, admin #2',
      },
    ])
    expect(csv.split('\r\n')[1]).toBe('2026-08-07,Friday,Jane Roe,No,No,"manual override, admin #2"')
  })
})
