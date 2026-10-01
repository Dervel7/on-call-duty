import { computed, type ComputedRef } from 'vue'
import { useI18n } from 'vue-i18n'
import type { Language } from '@oncall/shared'

// Region-qualified tags: plain 'en' would format dates the US way
// ("Monday, September 7, 2026") instead of "Monday, 7 September 2026".
const INTL_LOCALES: Record<Language, string> = { en: 'en-GB', el: 'el-GR' }

/** BCP 47 locale for `Intl` formatting that follows the active UI language. */
export function useIntlLocale(): ComputedRef<string> {
  const { locale } = useI18n()
  return computed(() => INTL_LOCALES[locale.value as Language])
}
