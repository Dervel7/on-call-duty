import { afterEach, describe, expect, it, vi } from 'vitest'
import { isDevKeyRefusedInProduction, license } from '../license'

describe('isDevKeyRefusedInProduction', () => {
  it('refuses the dev key in production', () => {
    expect(isDevKeyRefusedInProduction('production', true)).toBe(true)
  })

  it('allows a replaced key in production', () => {
    expect(isDevKeyRefusedInProduction('production', false)).toBe(false)
  })

  it('allows the dev key outside production', () => {
    expect(isDevKeyRefusedInProduction('development', true)).toBe(false)
    expect(isDevKeyRefusedInProduction('test', true)).toBe(false)
  })
})

describe('loadLicense', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    vi.doUnmock('../env')
    vi.doUnmock('../license-public-key')
    vi.resetModules()
  })

  it('exits before any other logic when production runs with the dev key', async () => {
    vi.resetModules()
    vi.doMock('../env', () => ({ env: { NODE_ENV: 'production', LICENSE_FILE: '' } }))
    // The guard exits before the key value is ever read, so a placeholder is enough.
    vi.doMock('../license-public-key', () => ({
      LICENSE_PUBLIC_KEY: 'unused',
      LICENSE_PUBLIC_KEY_IS_DEV: true,
    }))

    const exit = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never)
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})

    await import('../license')

    expect(exit).toHaveBeenCalledWith(1)
    expect(error).toHaveBeenCalledWith(
      expect.stringContaining('built-in dev license public key'),
    )
  })

  it('falls back to the development license outside production', () => {
    expect(license.licensee).toBe('development')
    expect(license.doctorAllowance).toBe(25)
  })
})
