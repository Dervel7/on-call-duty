<script setup lang="ts">
import type { HTMLAttributes } from 'vue'
import { cn } from '@/lib/utils'

const props = defineProps<{
  modelValue?: string | number
  disabled?: boolean
  class?: HTMLAttributes['class']
}>()

const emit = defineEmits<{
  'update:modelValue': [value: string | number]
}>()

function onChange(event: Event) {
  emit('update:modelValue', (event.target as HTMLSelectElement).value)
}
</script>

<template>
  <select
    :value="props.modelValue"
    :disabled="props.disabled"
    :class="cn(
      'flex h-10 w-full rounded-md border border-input bg-card px-3 py-2 text-sm text-foreground shadow-sm transition-colors hover:border-input/80 focus-visible:border-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40 disabled:opacity-50',
      props.class,
    )"
    @change="onChange"
  >
    <slot />
  </select>
</template>
