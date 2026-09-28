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
  <div :class="cn('flex flex-col gap-4', props.class)">
    <div class="flex flex-wrap items-start justify-between gap-4">
      <div class="flex items-center gap-3.5">
        <span
          v-if="icon"
          class="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary ring-1 ring-inset ring-primary/25 shadow-glow"
        >
          <component :is="icon" class="h-5 w-5" aria-hidden="true" />
        </span>
        <div>
          <h1 class="font-display text-3xl font-bold tracking-tight text-foreground">{{ title }}</h1>
          <p v-if="subtitle" class="mt-1 text-sm text-muted-foreground">{{ subtitle }}</p>
        </div>
      </div>
      <div v-if="$slots.actions" class="flex flex-wrap items-center gap-2">
        <slot name="actions" />
      </div>
    </div>
    <div class="hud-scan" aria-hidden="true"></div>
  </div>
</template>
