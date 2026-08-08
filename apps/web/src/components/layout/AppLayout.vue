<script setup lang="ts">
import AppHeader from './AppHeader.vue'
</script>

<template>
  <div class="min-h-screen">
    <AppHeader />
    <main class="w-full px-4 py-8 sm:px-6 lg:px-8 lg:py-10 xl:px-10 2xl:px-12">
      <slot />
    </main>
  </div>
</template>
