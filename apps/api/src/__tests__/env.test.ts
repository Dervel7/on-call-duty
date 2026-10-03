import { afterEach, vi } from 'vitest'

// env.ts validates process.env at import time and exits on invalid config, so
// each case re-imports it after resetting the module registry.
async function loadEnv(overrides: Record<string, string>) {
  vi.resetModules()
  for (const [key, value] of Object.entries(overrides)) vi.stubEnv(key, value)
  const exit = vi.spyOn(process, 'exit').mockImplementation((() => {
    throw new Error('process.exit')
  }) as never)
  vi.spyOn(console, 'error').mockImplementation(() => {})
  try {
    await import('../config/env')
    return { exited: false }
  } catch {
    return { exited: exit.mock.calls[0]?.[0] === 1 }
  }
}

afterEach(() => {
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
})

test('accepts a valid configuration', async () => {
  expect(await loadEnv({ LOG_LEVEL: 'debug', PORT: '3000' })).toEqual({ exited: false })
})

test('rejects an unknown LOG_LEVEL at boot instead of crashing in the logger', async () => {
  expect(await loadEnv({ LOG_LEVEL: 'verbose' })).toEqual({ exited: true })
})

test.each(['0', '70000', '3000.5'])('rejects PORT=%s', async (port) => {
  expect(await loadEnv({ PORT: port })).toEqual({ exited: true })
})
