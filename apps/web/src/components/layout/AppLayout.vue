<script setup lang="ts">
import { ref } from 'vue'
import { useStorage } from '@vueuse/core'
import { Menu } from 'lucide-vue-next'
import { useI18n } from 'vue-i18n'
import AppBrand from './AppBrand.vue'
import AppSidebar from './AppSidebar.vue'

const { t } = useI18n()
const sidebarOpen = ref(false)
// UI preference only (no session data), so localStorage is acceptable here.
const sidebarCollapsed = useStorage('oncall:sidebar-collapsed', false)
</script>

<template>
  <div class="min-h-screen">
    <AppSidebar v-model:open="sidebarOpen" v-model:collapsed="sidebarCollapsed" />
    <div
      :class="[
        'transition-[padding] duration-300 ease-out print:pl-0',
        sidebarCollapsed ? 'xl:pl-[4.5rem]' : 'xl:pl-64',
      ]"
    >
      <header
        class="sticky top-0 z-30 flex h-14 items-center gap-3 border-b border-border/60 bg-background/70 px-4 shadow-header backdrop-blur-xl sm:px-6 xl:hidden"
      >
        <button
          type="button"
          :aria-label="t('nav.openMenu')"
          :aria-expanded="sidebarOpen"
          aria-controls="app-sidebar"
          class="grid h-9 w-9 place-items-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          @click="sidebarOpen = true"
        >
          <Menu class="h-5 w-5" aria-hidden="true" />
        </button>
        <AppBrand />
      </header>
      <main class="mx-auto w-full max-w-[1440px] px-4 py-8 sm:px-6 lg:px-8 lg:py-10">
        <slot />
      </main>
    </div>
  </div>
</template>
