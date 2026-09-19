<script setup lang="ts">
import { onMounted, ref } from 'vue'
import type { Clinic } from '@oncall/shared'
import Select from '@/components/ui/Select.vue'
import { useClinicSelection } from '@/composables/useClinicSelection'
import { useAuthStore } from '@/stores/auth'
import { list as listClinics } from '@/services/clinics'

const auth = useAuthStore()
const clinics = ref<Clinic[]>([])
const loading = ref(false)
const errorMsg = ref('')
const { selectedClinicId, setClinic } = useClinicSelection()

onMounted(async () => {
  if (!auth.isManager) return
  loading.value = true
  try {
    clinics.value = await listClinics()
  } catch (err) {
    errorMsg.value = err instanceof Error ? err.message : 'Failed to load clinics'
  } finally {
    loading.value = false
  }
})

function onSelect(value: string | number): void {
  setClinic(Number(value))
}
</script>

<template>
  <!-- Drill-down control: managers only; other roles are already pinned to their clinic. -->
  <div v-if="auth.isManager" class="w-56" data-testid="clinic-selector">
    <p v-if="errorMsg" class="text-sm text-destructive">{{ errorMsg }}</p>
    <Select v-else :disabled="loading" :model-value="selectedClinicId ?? ''" @update:model-value="onSelect">
      <option value="" disabled>Select a clinic</option>
      <option v-for="c in clinics" :key="c.id" :value="c.id">{{ c.name }}</option>
    </Select>
  </div>
</template>
