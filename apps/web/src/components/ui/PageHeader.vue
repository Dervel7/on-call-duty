<script setup lang="ts">
import type { Component, HTMLAttributes } from 'vue'
import { cn } from '@/lib/utils'

const props = defineProps<{
  title: string
  subtitle?: string
  icon?: Component
  class?: HTMLAttributes['class']
}>()
</script>

<template>
  <div :class="cn('flex flex-wrap items-start justify-between gap-4', props.class)">
    <div class="flex items-center gap-3">
      <span
        v-if="icon"
        class="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary"
      >
        <component :is="icon" class="h-5 w-5" aria-hidden="true" />
      </span>
      <div>
        <h1 class="text-2xl font-bold tracking-tight text-foreground">{{ title }}</h1>
        <p v-if="subtitle" class="mt-0.5 text-sm text-muted-foreground">{{ subtitle }}</p>
      </div>
    </div>
    <div v-if="$slots.actions" class="flex flex-wrap items-center gap-2">
      <slot name="actions" />
    </div>
  </div>
</template>
