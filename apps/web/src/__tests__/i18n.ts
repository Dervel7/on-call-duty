import { afterEach } from 'vitest'
import { config } from '@vue/test-utils'
import type { Language } from '@oncall/shared'
import { createAppI18n } from '../lib/i18n'

/**
 * Vitest setup file: every app mounted by @vue/test-utils gets the i18n plugin,
 * in English unless a test calls `setTestLocale`. Each app needs its own
 * instance because vue-i18n disposes its instance when the app unmounts.
 */
let testLocale: Language = 'en'

/** Locale for apps mounted after this call; resets to English after each test. */
export function setTestLocale(locale: Language): void {
  testLocale = locale
}

config.global.plugins.push({
  install(app) {
    app.use(createAppI18n(testLocale))
  },
})

afterEach(() => {
  testLocale = 'en'
})
