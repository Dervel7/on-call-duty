<script setup lang="ts">
import { useAuthStore } from '@/stores/auth'
import AdminDashboard from '@/components/dashboard/AdminDashboard.vue'
import DoctorDashboard from '@/components/dashboard/DoctorDashboard.vue'

const auth = useAuthStore()
</script>

<template>
  <AdminDashboard v-if="auth.isAdmin" />
  <DoctorDashboard v-else />
</template>
