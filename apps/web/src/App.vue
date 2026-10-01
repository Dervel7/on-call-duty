<script setup lang="ts">
import { computed, watch } from 'vue'
import { useRoute } from 'vue-router'
import { useAuthStore } from '@/stores/auth'

const route = useRoute()
const auth = useAuthStore()

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
const language = computed(() => (route.meta.public ? 'en' : (auth.user?.language ?? 'en')))

watch(
  language,
  (lang) => {
    document.documentElement.lang = lang
  },
  { immediate: true },
)
</script>

<template>
  <RouterView />
</template>
