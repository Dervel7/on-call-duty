<script setup lang="ts">
import { computed, type Component } from 'vue'
import { RouterLink, useRoute, useRouter } from 'vue-router'
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
  ScrollText,
  UserRound,
  Users,
} from 'lucide-vue-next'
import { useI18n } from 'vue-i18n'
import { useAuthStore } from '@/stores/auth'
import Avatar from '@/components/ui/Avatar.vue'
import Badge from '@/components/ui/Badge.vue'
import Button from '@/components/ui/Button.vue'

const { t } = useI18n()
const auth = useAuthStore()
const router = useRouter()
const route = useRoute()

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
  <header
    class="sticky top-0 z-40 w-full border-b border-border/60 bg-background/70 shadow-header backdrop-blur-xl"
  >
    <div class="flex min-h-16 w-full items-center gap-3 px-4 py-2 sm:gap-4 sm:px-6 lg:px-8">
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
          <span class="font-display text-[15px] font-bold tracking-tight text-foreground">{{ t('app.name') }}</span>
          <span class="hud-label mt-1">
            {{ t('app.tagline') }}
          </span>
        </span>
      </RouterLink>

      <nav
        v-if="auth.isAuthenticated"
        :aria-label="t('nav.main')"
        class="hidden lg:flex min-w-0 flex-1 flex-wrap items-center gap-0.5 lg:gap-1"
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
            class="hidden items-center gap-2.5 rounded-full border border-border/70 bg-card/60 py-1 pl-1 pr-3 shadow-card backdrop-blur sm:flex"
          >
            <Avatar :name="`${auth.user.firstName} ${auth.user.lastName}`" size="sm" />
            <span class="hidden text-sm text-foreground xl:inline">
              {{ auth.user.firstName }} {{ auth.user.lastName }}
            </span>
            <Badge variant="outline">{{ t(`roles.${auth.user.role}`) }}</Badge>
          </div>
          <Button size="sm" variant="outline" :aria-label="t('nav.logout')" @click="onLogout">
            <LogOut class="h-4 w-4" aria-hidden="true" />
            <span class="hidden sm:inline">{{ t('nav.logout') }}</span>
          </Button>
        </template>
      </div>
    </div>
    <nav
      v-if="auth.isAuthenticated"
      :aria-label="t('nav.mainMobile')"
      class="lg:hidden flex flex-wrap items-center gap-1 border-t border-border/60 px-3 py-2"
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
