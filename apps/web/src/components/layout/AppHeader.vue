<script setup lang="ts">
import { RouterLink, useRouter } from 'vue-router'
import { LogOut, Stethoscope } from 'lucide-vue-next'
import { useAuthStore } from '@/stores/auth'
import Button from '@/components/ui/Button.vue'

const auth = useAuthStore()
const router = useRouter()

async function onLogout() {
  await auth.logout()
  await router.push('/login')
}
</script>

<template>
  <header class="sticky top-0 z-40 w-full border-b border-border bg-background">
    <div class="container mx-auto flex h-16 items-center gap-6 px-6">
      <div class="flex items-center gap-2">
        <Stethoscope class="h-6 w-6 text-primary" />
        <span class="text-lg font-semibold text-primary">On-Call Duty</span>
      </div>
      <nav v-if="auth.isAuthenticated" class="flex items-center gap-4 text-sm">
        <RouterLink class="text-muted-foreground hover:text-foreground" to="/">Home</RouterLink>
        <RouterLink v-if="auth.isAdmin" class="text-muted-foreground hover:text-foreground" to="/users">Users</RouterLink>
        <RouterLink v-if="auth.isAdmin" class="text-muted-foreground hover:text-foreground" to="/doctors">Doctors</RouterLink>
        <RouterLink v-if="auth.isAdmin" class="text-muted-foreground hover:text-foreground" to="/availability">Availability</RouterLink>
        <RouterLink class="text-muted-foreground hover:text-foreground" to="/profile">Profile</RouterLink>
      </nav>
      <div class="ml-auto flex items-center gap-3">
        <template v-if="auth.user">
          <span class="text-sm text-muted-foreground">
            {{ auth.user.firstName }} {{ auth.user.lastName }} · {{ auth.user.role }}
          </span>
          <Button size="sm" variant="outline" @click="onLogout">
            <LogOut class="h-4 w-4" /> Logout
          </Button>
        </template>
      </div>
    </div>
  </header>
</template>
