<script setup lang="ts">
import AppHeader from './AppHeader.vue'
</script>

<template>
  <div class="min-h-screen">
    <AppHeader />
    <main class="container mx-auto px-4 py-8 sm:px-6 lg:py-10">
      <slot />
    </main>
  </div>
</template>
