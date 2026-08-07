import { afterEach, describe, expect, it, vi } from 'vitest'
import { downloadCsv } from '../lib/download'

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
