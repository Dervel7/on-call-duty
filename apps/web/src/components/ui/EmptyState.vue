<script setup lang="ts">
import type { Component, HTMLAttributes } from 'vue'
import { Inbox } from 'lucide-vue-next'
import { cn } from '@/lib/utils'

const props = defineProps<{
  title: string
  description?: string
  icon?: Component
  class?: HTMLAttributes['class']
}>()
</script>

<template>
  <div
    :class="cn('flex flex-col items-center gap-2 rounded-2xl border border-dashed border-border/80 bg-card/30 px-6 py-10 text-center backdrop-blur-sm', props.class)"
  >
    <div class="grid h-12 w-12 place-items-center rounded-2xl bg-muted ring-1 ring-inset ring-border">
      <component :is="props.icon ?? Inbox" class="h-6 w-6 text-muted-foreground" aria-hidden="true" />
    </div>
    <p class="font-display font-semibold text-foreground">{{ title }}</p>
    <p v-if="description" class="text-sm text-muted-foreground">{{ description }}</p>
    <slot />
  </div>
</template>
