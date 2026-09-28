<script setup lang="ts">
import { computed, type Component } from 'vue'
import { RouterLink, useRoute, useRouter } from 'vue-router'
import {
  BarChart3,
  CalendarCheck2,
  CalendarClock,
  CalendarDays,
  CalendarOff,
  Gauge,
  History,
  House,
  LogOut,
  UserRound,
  Users,
} from 'lucide-vue-next'
import { useAuthStore } from '@/stores/auth'
import Avatar from '@/components/ui/Avatar.vue'
import Badge from '@/components/ui/Badge.vue'
import Button from '@/components/ui/Button.vue'

const auth = useAuthStore()
const router = useRouter()
const route = useRoute()

async function onLogout() {
  await auth.logout()
  await router.push('/login')
}

const navItems = computed(() => {
  const items: { to: string; label: string; icon: Component }[] = [{ to: '/', label: 'Home', icon: House }]
  if (auth.isAuthenticated && !auth.isAdmin) {
    items.push({ to: '/roster', label: 'Duty roster', icon: CalendarCheck2 })
    items.push({ to: '/my-availability', label: 'My availability', icon: CalendarClock })
  }
  if (auth.isAdmin) {
    items.push(
      { to: '/users', label: 'Users', icon: Users },
      { to: '/availability', label: 'Availability', icon: CalendarOff },
      { to: '/schedules', label: 'Schedules', icon: CalendarDays },
      { to: '/reports', label: 'Reports', icon: BarChart3 },
    )
  }
  if (auth.isSuperadmin) {
    items.push(
      { to: '/activity', label: 'Activity', icon: History },
      { to: '/usage', label: 'Usage', icon: Gauge },
    )
  }
  items.push({ to: '/profile', label: 'Profile', icon: UserRound })
  return items
})

function isActive(to: string): boolean {
  if (to === '/') return route.path === '/'
  return route.path === to || route.path.startsWith(to + '/')
}
</script>

<template>
  <header
    class="sticky top-0 z-40 w-full border-b border-border/70 bg-background/80 shadow-header backdrop-blur-xl"
  >
    <div class="mx-auto flex h-16 w-full max-w-[1440px] items-center gap-4 px-4 sm:px-6 lg:px-8">
      <RouterLink to="/" class="group flex shrink-0 items-center gap-2.5">
        <span class="brand-tile transition-transform duration-200 group-hover:scale-105">
          <svg viewBox="0 0 24 24" class="h-4 w-4" fill="none" aria-hidden="true">
            <path
              d="M10.5 3h3v5.5H19v3h-5.5V21h-3v-9.5H5v-3h5.5z"
              fill="currentColor"
              class="text-primary-foreground"
            />
          </svg>
        </span>
        <span class="flex flex-col leading-none">
          <span class="text-[15px] font-semibold tracking-tight text-foreground">On-Call Duty</span>
          <span
            class="mt-0.5 text-[9px] font-semibold uppercase tracking-[0.18em] text-muted-foreground/80"
          >
            Hospital Scheduling
          </span>
        </span>
      </RouterLink>

      <nav
        v-if="auth.isAuthenticated"
        class="hidden md:flex flex-1 items-center gap-1 overflow-x-auto no-scrollbar"
      >
        <RouterLink
          v-for="item in navItems"
          :key="item.to"
          :to="item.to"
          :class="['nav-link', { 'is-active': isActive(item.to) }]"
        >
          <component :is="item.icon" class="size-4 shrink-0" aria-hidden="true" />
          {{ item.label }}
        </RouterLink>
      </nav>

      <div class="ml-auto flex items-center gap-3">
        <template v-if="auth.user">
          <div
            class="hidden items-center gap-2.5 rounded-full border border-border bg-card py-1 pl-1 pr-3 shadow-card sm:flex"
          >
            <Avatar :name="`${auth.user.firstName} ${auth.user.lastName}`" size="sm" />
            <span class="text-sm text-foreground">
              {{ auth.user.firstName }} {{ auth.user.lastName }}
            </span>
            <Badge variant="outline">{{ auth.user.role }}</Badge>
          </div>
          <Button size="sm" variant="outline" @click="onLogout">
            <LogOut class="h-4 w-4" />
            <span class="hidden sm:inline">Logout</span>
          </Button>
        </template>
      </div>
    </div>
    <nav
      v-if="auth.isAuthenticated"
      class="md:hidden flex items-center gap-1 overflow-x-auto no-scrollbar border-t border-border/60 px-3 py-2"
    >
      <RouterLink
        v-for="item in navItems"
        :key="item.to"
        :to="item.to"
        :class="['nav-link', { 'is-active': isActive(item.to) }]"
      >
        <component :is="item.icon" class="size-4 shrink-0" aria-hidden="true" />
        {{ item.label }}
      </RouterLink>
    </nav>
  </header>
</template>
