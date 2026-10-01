<script setup lang="ts">
import { useAuthStore } from '@/stores/auth'
import AdminDashboard from '@/components/dashboard/AdminDashboard.vue'
import DoctorDashboard from '@/components/dashboard/DoctorDashboard.vue'
import EmptyState from '@/components/ui/EmptyState.vue'

const auth = useAuthStore()
</script>

<template>
  <AdminDashboard v-if="auth.isAdmin" />
  <DoctorDashboard v-else-if="auth.user?.role === 'doctor'" />
  <EmptyState v-else title="Welcome" description="There is nothing to show for your role yet." />
</template>
