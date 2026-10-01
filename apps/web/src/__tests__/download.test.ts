import { afterEach, describe, expect, it, vi } from 'vitest'
import { downloadCsv } from '../lib/download'

describe('downloadCsv', () => {
  const origCreate = URL.createObjectURL
  const origRevoke = URL.revokeObjectURL

  afterEach(() => {
    URL.createObjectURL = origCreate
    URL.revokeObjectURL = origRevoke
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('creates a BOM-prefixed blob URL, clicks an anchor, and revokes the URL after the click task', async () => {
    vi.useFakeTimers()
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
    // jsdom Blob has no text()/arrayBuffer(); the UTF-8 BOM adds exactly 3 bytes.
    const blob = createUrl.mock.calls[0]![0] as Blob
    expect(blob.size).toBe('Date,Weekday\n2026-08-01,Friday'.length + 3)
    expect(clickSpy).toHaveBeenCalledTimes(1)
    expect(revokeUrl).not.toHaveBeenCalled()
    vi.runAllTimers()
    expect(revokeUrl).toHaveBeenCalledWith('blob:fake')
    createSpy.mockRestore()
  })
})
