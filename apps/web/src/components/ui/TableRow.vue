<script setup lang="ts">
import type { HTMLAttributes } from 'vue'
import { cn } from '@/lib/utils'
const props = defineProps<{ class?: HTMLAttributes['class'] }>()
</script>
<template>
  <tr
    :class="cn('border-b border-border/50 transition-colors hover:bg-primary/[0.05]', props.class)"
  >
    <slot />
  </tr>
</template>
