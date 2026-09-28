<script setup lang="ts">
import type { HTMLAttributes } from 'vue'
import { cn } from '@/lib/utils'

const props = defineProps<{
  size?: number
  class?: HTMLAttributes['class']
}>()
</script>

<template>
  <svg
    :width="props.size ?? 16"
    :height="props.size ?? 16"
    viewBox="0 0 24 24"
    fill="none"
    :class="cn('animate-spin', props.class)"
    aria-hidden="true"
  >
    <circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="3" class="opacity-20" />
    <path d="M12 2a10 10 0 0 1 10 10" stroke="currentColor" stroke-width="3" stroke-linecap="round" />
  </svg>
</template>
