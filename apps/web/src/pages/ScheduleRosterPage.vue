<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { CalendarCheck2, CalendarOff } from 'lucide-vue-next'
import type { ScheduleSummary } from '@oncall/shared'
import { monthLabel } from '@oncall/utils'
import * as scheduleService from '@/services/schedule'
import { useIntlLocale } from '@/composables/useIntlLocale'
import Button from '@/components/ui/Button.vue'
import EmptyState from '@/components/ui/EmptyState.vue'
import PageHeader from '@/components/ui/PageHeader.vue'
import Spinner from '@/components/ui/Spinner.vue'
import Table from '@/components/ui/Table.vue'
import TableBody from '@/components/ui/TableBody.vue'
import TableCell from '@/components/ui/TableCell.vue'
import TableHead from '@/components/ui/TableHead.vue'
import TableHeader from '@/components/ui/TableHeader.vue'
import TableRow from '@/components/ui/TableRow.vue'

const router = useRouter()
const intlLocale = useIntlLocale()

const records = ref<ScheduleSummary[]>([])
const loading = ref(false)
const errorMsg = ref('')

async function load() {
  loading.value = true
  errorMsg.value = ''
  try {
    records.value = await scheduleService.list()
  } catch (e) {
    errorMsg.value = e instanceof Error ? e.message : 'Failed to load schedules'
  } finally {
    loading.value = false
  }
}

function view(scheduleId: number) {
  router.push(`/schedules/${scheduleId}`)
}

onMounted(load)
</script>

<template>
  <div class="flex flex-col gap-4 animate-rise">
    <PageHeader :icon="CalendarCheck2" title="Duty roster" subtitle="Published on-call schedules" />

    <div v-if="loading" class="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground">
      <Spinner :size="16" />
      Loading…
    </div>
    <p v-if="errorMsg" role="alert" class="text-sm text-destructive">{{ errorMsg }}</p>

    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Month</TableHead>
          <TableHead class="text-right">Actions</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        <TableRow v-for="s in records" :key="s.id">
          <TableCell class="font-mono text-sm">{{ monthLabel(s.year, s.month, intlLocale) }}</TableCell>
          <TableCell class="text-right">
            <Button size="sm" variant="outline" @click="view(s.id)">View</Button>
          </TableCell>
        </TableRow>
      </TableBody>
    </Table>

    <EmptyState v-if="!loading && !errorMsg && records.length === 0" :icon="CalendarOff" title="No published schedules yet." />
  </div>
</template>
