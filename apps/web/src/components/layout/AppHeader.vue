<script setup lang="ts">
import { Stethoscope } from 'lucide-vue-next'
</script>

<template>
  <header class="sticky top-0 z-40 w-full border-b border-border bg-background">
    <div class="container mx-auto flex h-16 items-center gap-2 px-6">
      <Stethoscope class="h-6 w-6 text-primary" />
      <span class="text-lg font-semibold text-primary">On-Call Duty</span>
    </div>
  </header>
</template>
