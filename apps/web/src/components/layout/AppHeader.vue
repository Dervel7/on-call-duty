<script setup lang="ts">
import { computed } from 'vue'
import { RouterLink, useRoute, useRouter } from 'vue-router'
import { LogOut } from 'lucide-vue-next'
import { useAuthStore } from '@/stores/auth'
import Button from '@/components/ui/Button.vue'

const auth = useAuthStore()
const router = useRouter()
const route = useRoute()

async function onLogout() {
  await auth.logout()
  await router.push('/login')
}

const navItems = computed(() => {
  const items: { to: string; label: string }[] = [{ to: '/', label: 'Home' }]
  if (auth.isAuthenticated && !auth.isAdmin) {
    items.push({ to: '/roster', label: 'Duty roster' })
    items.push({ to: '/my-availability', label: 'My availability' })
  }
  if (auth.isAdmin) {
    items.push(
      { to: '/users', label: 'Users' },
      { to: '/doctors', label: 'Doctors' },
      { to: '/availability', label: 'Availability' },
      { to: '/schedules', label: 'Schedules' },
      { to: '/holidays', label: 'Holidays' },
      { to: '/reports', label: 'Reports' },
    )
  }
  items.push({ to: '/profile', label: 'Profile' })
  return items
})

function isActive(to: string): boolean {
  if (to === '/') return route.path === '/'
  return route.path === to || route.path.startsWith(to + '/')
}

const initials = computed(() => {
  if (!auth.user) return ''
  return `${auth.user.firstName.charAt(0)}${auth.user.lastName.charAt(0)}`.toUpperCase()
})
</script>

<template>
  <header class="sticky top-0 z-40 w-full border-b border-border bg-background/85 backdrop-blur-md">
    <div class="container mx-auto flex h-16 items-center gap-6 px-4 sm:px-6">
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
        class="flex flex-1 flex-wrap items-center gap-x-4 gap-y-1 overflow-x-auto"
      >
        <RouterLink
          v-for="item in navItems"
          :key="item.to"
          :to="item.to"
          :class="['nav-link', { 'is-active': isActive(item.to) }]"
        >
          {{ item.label }}
        </RouterLink>
      </nav>

      <div class="ml-auto flex items-center gap-3">
        <template v-if="auth.user">
          <div
            class="hidden items-center gap-2.5 rounded-full border border-border bg-card py-1 pl-1 pr-3 shadow-card sm:flex"
          >
            <span
              class="grid h-7 w-7 place-items-center rounded-full bg-primary/10 text-xs font-semibold text-primary"
            >
              {{ initials }}
            </span>
            <span class="text-sm text-foreground">
              {{ auth.user.firstName }} {{ auth.user.lastName }}
            </span>
            <span
              class="rounded-full bg-muted px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground"
            >
              {{ auth.user.role }}
            </span>
          </div>
          <Button size="sm" variant="outline" @click="onLogout">
            <LogOut class="h-4 w-4" />
            <span class="hidden sm:inline">Logout</span>
          </Button>
        </template>
      </div>
    </div>
  </header>
</template>
