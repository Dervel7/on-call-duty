<script setup lang="ts">
import { RouterLink } from 'vue-router'
import { useI18n } from 'vue-i18n'

defineProps<{ compact?: boolean }>()

const { t } = useI18n()
</script>

<template>
  <RouterLink to="/" class="group flex min-w-0 items-center gap-2.5">
    <span class="brand-tile shrink-0 transition-transform duration-200 group-hover:scale-105">
      <svg viewBox="0 0 24 24" class="h-4 w-4" fill="none" aria-hidden="true">
        <path
          d="M10.5 3h3v5.5H19v3h-5.5V21h-3v-9.5H5v-3h5.5z"
          fill="currentColor"
          class="text-primary-foreground"
        />
      </svg>
    </span>
    <span :class="['flex flex-col leading-none', compact && 'xl:sr-only']">
      <span class="font-display text-[15px] font-bold tracking-tight text-foreground">{{ t('app.name') }}</span>
      <span class="hud-label mt-1">{{ t('app.tagline') }}</span>
    </span>
  </RouterLink>
</template>
