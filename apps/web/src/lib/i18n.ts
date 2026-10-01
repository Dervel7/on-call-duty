import { createI18n } from 'vue-i18n'
import type { Language } from '@oncall/shared'
import en from '@/locales/en.json'
import el from '@/locales/el.json'

/** English is the source of truth: el.json must have exactly the same keys. */
type MessageSchema = typeof en

/**
 * Creates the app's i18n instance. App.vue keeps the active locale in sync
 * with the signed-in user's language preference.
 */
export function createAppI18n(locale: Language = 'en') {
  return createI18n<[MessageSchema], Language, false>({
    legacy: false,
    locale,
    fallbackLocale: 'en',
    messages: { en, el },
  })
}

/**
 * The running app's instance (installed in main.ts). Modules outside
 * components, such as lib/http.ts, translate through `i18n.global.t`.
 */
export const i18n = createAppI18n()
