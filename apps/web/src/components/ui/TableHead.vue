<script setup lang="ts">
import type { HTMLAttributes } from 'vue'
import { cn } from '@/lib/utils'
const props = defineProps<{ class?: HTMLAttributes['class'] }>()
</script>
<template>
  <th
    :class="cn(
      'h-11 px-3 text-left text-[11px] font-semibold uppercase tracking-wide text-muted-foreground/80',
      props.class,
    )"
  >
    <slot />
  </th>
</template>
