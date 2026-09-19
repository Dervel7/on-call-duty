import { afterEach, describe, expect, it, vi } from 'vitest'
import { csvFilename, downloadCsv } from '../lib/download'

describe('downloadCsv', () => {
  const origCreate = URL.createObjectURL
  const origRevoke = URL.revokeObjectURL

  afterEach(() => {
    URL.createObjectURL = origCreate
    URL.revokeObjectURL = origRevoke
    vi.restoreAllMocks()
  })

  it('creates a blob URL, sets the filename, clicks an anchor, and revokes the URL', () => {
    const createUrl = vi.fn().mockReturnValue('blob:fake')
    const revokeUrl = vi.fn()
    URL.createObjectURL = createUrl
    URL.revokeObjectURL = revokeUrl

    const clickSpy = vi.fn()
    const origCreateEl = document.createElement.bind(document)
    const createSpy = vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
      const el = origCreateEl(tag) as HTMLAnchorElement
      if (tag === 'a') el.click = clickSpy
      return el
    })

    downloadCsv('oncall-2026-08.csv', 'Date,Weekday\n2026-08-01,Friday')

    expect(createUrl).toHaveBeenCalledTimes(1)
    expect(clickSpy).toHaveBeenCalledTimes(1)
    expect(revokeUrl).toHaveBeenCalledWith('blob:fake')
    createSpy.mockRestore()
  })
})

describe('csvFilename', () => {
  it('slugs the clinic name into the filename', () => {
    expect(csvFilename(2026, 8, 'Cardiology')).toBe('oncall-cardiology-2026-08.csv')
    expect(csvFilename(2027, 3, 'St. Mary & Bones (West)')).toBe('oncall-st-mary-bones-west-2027-03.csv')
    expect(csvFilename(2026, 12, '  --Neurology--  ')).toBe('oncall-neurology-2026-12.csv')
  })

  it('falls back to the bare filename without a clinic name', () => {
    expect(csvFilename(2026, 8, null)).toBe('oncall-2026-08.csv')
    expect(csvFilename(2026, 8, undefined)).toBe('oncall-2026-08.csv')
    expect(csvFilename(2026, 8, '***')).toBe('oncall-2026-08.csv')
  })
})
