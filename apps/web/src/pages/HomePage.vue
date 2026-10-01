<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import { useAuthStore } from '@/stores/auth'
import AdminDashboard from '@/components/dashboard/AdminDashboard.vue'
import DoctorDashboard from '@/components/dashboard/DoctorDashboard.vue'
import EmptyState from '@/components/ui/EmptyState.vue'

const { t } = useI18n()
const auth = useAuthStore()
</script>

<template>
  <AdminDashboard v-if="auth.isAdmin" />
  <DoctorDashboard v-else-if="auth.user?.role === 'doctor'" />
  <EmptyState v-else :title="t('home.welcome')" :description="t('home.emptyDescription')" />
</template>
