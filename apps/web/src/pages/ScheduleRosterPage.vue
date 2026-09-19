<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import type { ScheduleQuery, ScheduleSummary } from '@oncall/shared'
import * as scheduleService from '@/services/schedule'
import ClinicSelector from '@/components/layout/ClinicSelector.vue'
import { useClinicSelection } from '@/composables/useClinicSelection'
import { useAuthStore } from '@/stores/auth'
import Button from '@/components/ui/Button.vue'
import Table from '@/components/ui/Table.vue'
import TableBody from '@/components/ui/TableBody.vue'
import TableCell from '@/components/ui/TableCell.vue'
import TableHead from '@/components/ui/TableHead.vue'
import TableHeader from '@/components/ui/TableHeader.vue'
import TableRow from '@/components/ui/TableRow.vue'

const router = useRouter()
const auth = useAuthStore()
const { selectedClinicId } = useClinicSelection()
const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]

const needsClinic = computed(() => auth.isManager && selectedClinicId.value === undefined)

const records = ref<ScheduleSummary[]>([])
const loading = ref(false)
const errorMsg = ref('')

function monthLabel(year: number, month: number): string {
  return `${MONTHS[month - 1]} ${year}`
}

async function load() {
  if (needsClinic.value) {
    records.value = []
    return
  }
  loading.value = true
  errorMsg.value = ''
  try {
    const query: ScheduleQuery = {}
    if (auth.isManager) query.clinicId = selectedClinicId.value
    records.value = await scheduleService.list(query)
  } catch (e) {
    errorMsg.value = e instanceof Error ? e.message : 'Failed to load schedules'
  } finally {
    loading.value = false
  }
}

watch(selectedClinicId, () => {
  if (auth.isManager) void load()
})

function view(scheduleId: number) {
  router.push(`/schedules/${scheduleId}`)
}

onMounted(load)
</script>

<template>
  <div class="flex flex-col gap-4">
    <div class="flex items-center justify-between">
      <h1 class="text-xl font-semibold text-foreground">Duty roster</h1>
      <ClinicSelector />
    </div>

    <p v-if="needsClinic" class="text-sm text-muted-foreground">Select a clinic above to view its duty roster.</p>

    <p v-if="loading" class="text-sm text-muted-foreground">Loading…</p>
    <p v-if="errorMsg" class="text-sm text-destructive" role="alert">{{ errorMsg }}</p>

    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Month</TableHead>
          <TableHead class="text-right">Actions</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        <TableRow v-for="s in records" :key="s.id">
          <TableCell>{{ monthLabel(s.year, s.month) }}</TableCell>
          <TableCell class="text-right">
            <Button size="sm" variant="outline" @click="view(s.id)">View</Button>
          </TableCell>
        </TableRow>
      </TableBody>
    </Table>

    <p v-if="!loading && records.length === 0" class="text-sm text-muted-foreground">
      No published schedules yet.
    </p>
  </div>
</template>
