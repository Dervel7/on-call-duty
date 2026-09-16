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
</script>

<template>
  <RouterView />
</template>
