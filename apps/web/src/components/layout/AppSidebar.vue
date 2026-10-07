<script setup lang="ts">
import { computed, ref, watch, type Component } from 'vue'
import { RouterLink, useRoute, useRouter } from 'vue-router'
import { useEventListener, useMediaQuery } from '@vueuse/core'
import {
  BarChart3,
  CalendarCheck2,
  CalendarClock,
  CalendarDays,
  CalendarHeart,
  CalendarOff,
  Gauge,
  History,
  House,
  LogOut,
  PanelLeftClose,
  PanelLeftOpen,
  ScrollText,
  UserRound,
  Users,
  X,
} from 'lucide-vue-next'
import { useI18n } from 'vue-i18n'
import { useAuthStore } from '@/stores/auth'
import { useModal } from '@/composables/useModal'
import Avatar from '@/components/ui/Avatar.vue'
import Badge from '@/components/ui/Badge.vue'
import Button from '@/components/ui/Button.vue'
import AppBrand from './AppBrand.vue'

/**
 * Left navigation. From xl up it is docked and `collapsed` turns it into an
 * icon rail; below xl it is an off-canvas modal drawer controlled by `open`.
 */
const open = defineModel<boolean>('open', { default: false })
const collapsed = defineModel<boolean>('collapsed', { default: false })

const { t } = useI18n()
const auth = useAuthStore()
const router = useRouter()
const route = useRoute()

const panel = ref<HTMLElement | null>(null)
const isDesktop = useMediaQuery('(min-width: 1280px)')
const drawerOpen = computed(() => open.value && !isDesktop.value)

useModal(() => drawerOpen.value, panel)
useEventListener(window, 'keydown', (e: KeyboardEvent) => {
  if (e.key === 'Escape' && drawerOpen.value) close()
})
// Without this, shrinking the window back below xl would reopen a stale drawer.
watch(isDesktop, (desktop) => {
  if (desktop) close()
})

function close() {
  open.value = false
}

async function onLogout() {
  await auth.logout()
  await router.push('/login')
}

const navItems = computed(() => {
  const items: { to: string; label: string; icon: Component }[] = [{ to: '/', label: t('nav.home'), icon: House }]
  if (auth.user?.role === 'doctor') {
    items.push({ to: '/roster', label: t('nav.dutyRoster'), icon: CalendarCheck2 })
    items.push({ to: '/my-availability', label: t('nav.myAvailability'), icon: CalendarClock })
  }
  if (auth.isAdmin) {
    items.push(
      { to: '/users', label: t('nav.users'), icon: Users },
      { to: '/availability', label: t('nav.availability'), icon: CalendarOff },
      { to: '/schedules', label: t('nav.schedules'), icon: CalendarDays },
      { to: '/holidays', label: t('nav.holidays'), icon: CalendarHeart },
      { to: '/rules', label: t('nav.rules'), icon: ScrollText },
      { to: '/reports', label: t('nav.reports'), icon: BarChart3 },
    )
  }
  if (auth.isSuperadmin) {
    items.push(
      { to: '/activity', label: t('nav.activity'), icon: History },
      { to: '/usage', label: t('nav.usage'), icon: Gauge },
    )
  }
  items.push({ to: '/profile', label: t('nav.profile'), icon: UserRound })
  return items
})

function isActive(to: string): boolean {
  if (to === '/') return route.path === '/'
  return route.path === to || route.path.startsWith(to + '/')
}
</script>

<template>
  <Transition
    enter-active-class="transition-opacity duration-300"
    leave-active-class="transition-opacity duration-300"
    enter-from-class="opacity-0"
    leave-to-class="opacity-0"
  >
    <div
      v-if="drawerOpen"
      class="fixed inset-0 z-40 bg-foreground/40 backdrop-blur-sm"
      aria-hidden="true"
      @click="close"
    />
  </Transition>
  <!-- Visibility transitions only on close: an opening panel must be visible at once so useModal can move focus into it. -->
  <aside
    id="app-sidebar"
    ref="panel"
    :role="drawerOpen ? 'dialog' : undefined"
    :aria-modal="drawerOpen ? 'true' : undefined"
    :aria-label="drawerOpen ? t('nav.main') : undefined"
    :class="[
      'no-print fixed inset-y-0 left-0 z-40 flex w-64 flex-col border-r border-border/60 bg-background/85 shadow-header backdrop-blur-xl duration-300 ease-out xl:visible xl:translate-x-0',
      open
        ? 'visible translate-x-0 transition-[transform,width]'
        : 'invisible -translate-x-full transition-[transform,width,visibility]',
      collapsed && 'xl:w-[4.5rem]',
    ]"
  >
    <div :class="['flex h-16 shrink-0 items-center gap-2 border-b border-border/60 px-4', collapsed && 'xl:justify-center xl:px-0']">
      <AppBrand :compact="collapsed" @click="close" />
      <button
        type="button"
        :aria-label="t('nav.closeMenu')"
        class="ml-auto grid h-9 w-9 place-items-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground xl:hidden"
        @click="close"
      >
        <X class="h-4 w-4" aria-hidden="true" />
      </button>
    </div>

    <nav v-if="auth.isAuthenticated" :aria-label="t('nav.main')" class="flex-1 overflow-x-hidden overflow-y-auto px-3 py-4">
      <ul class="flex flex-col gap-1">
        <li v-for="item in navItems" :key="item.to">
          <RouterLink
            :to="item.to"
            :title="collapsed ? item.label : undefined"
            :class="['nav-link', { 'is-active': isActive(item.to), 'xl:justify-center xl:px-0': collapsed }]"
            @click="close"
          >
            <component :is="item.icon" class="size-4 shrink-0" aria-hidden="true" />
            <span :class="['truncate', collapsed && 'xl:sr-only']">{{ item.label }}</span>
          </RouterLink>
        </li>
      </ul>
    </nav>

    <div class="mt-auto shrink-0 space-y-2 border-t border-border/60 p-3">
      <div v-if="auth.user" :class="['flex items-center gap-3 px-2 py-1.5', collapsed && 'xl:justify-center xl:px-0']">
        <Avatar :name="`${auth.user.firstName} ${auth.user.lastName}`" size="sm" />
        <div :class="['min-w-0 flex-1', collapsed && 'xl:hidden']">
          <p class="truncate text-sm font-medium text-foreground">{{ auth.user.firstName }} {{ auth.user.lastName }}</p>
          <Badge variant="outline" class="mt-1">{{ t(`roles.${auth.user.role}`) }}</Badge>
        </div>
      </div>
      <Button
        size="sm"
        variant="outline"
        :aria-label="t('nav.logout')"
        :class="['w-full', collapsed && 'xl:px-0']"
        @click="onLogout"
      >
        <LogOut class="h-4 w-4" aria-hidden="true" />
        <span :class="collapsed && 'xl:sr-only'">{{ t('nav.logout') }}</span>
      </Button>
      <button
        type="button"
        :aria-expanded="!collapsed"
        aria-controls="app-sidebar"
        :class="[
          'hidden w-full items-center gap-2 rounded-lg px-2 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground xl:flex',
          collapsed && 'xl:justify-center',
        ]"
        @click="collapsed = !collapsed"
      >
        <component :is="collapsed ? PanelLeftOpen : PanelLeftClose" class="h-4 w-4" aria-hidden="true" />
        <span :class="collapsed && 'xl:sr-only'">{{ collapsed ? t('nav.expandSidebar') : t('nav.collapseSidebar') }}</span>
      </button>
    </div>
  </aside>
</template>
