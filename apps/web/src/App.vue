<script setup lang="ts">
import { computed, watch } from 'vue'
import { useRoute } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { useAuthStore } from '@/stores/auth'

const route = useRoute()
const auth = useAuthStore()
const { locale, t } = useI18n()

// Public pages (login, locked) always render light; inside the app the theme
// follows the signed-in user's stored preference.
const darkMode = computed(() => !route.meta.public && (auth.user?.darkMode ?? false))

watch(
  darkMode,
  (dark) => {
    document.documentElement.classList.toggle('dark', dark)
  },
  { immediate: true },
)

// Public pages (login, locked) always render in English — the user is not
// known yet; inside the app the language follows the stored preference.
// index.html carries the English lang/title until this first runs.
const language = computed(() => (route.meta.public ? 'en' : (auth.user?.language ?? 'en')))

watch(
  language,
  (lang) => {
    document.documentElement.lang = lang
    locale.value = lang
    document.title = t('app.title')
  },
  { immediate: true },
)
</script>

<template>
  <RouterView />
</template>
