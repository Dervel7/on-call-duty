<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import type { ScheduleSummary } from '@oncall/shared'
import { createScheduleSchema } from '@oncall/shared'
import { useAuthStore } from '@/stores/auth'
import * as scheduleService from '@/services/schedule'
import { ApiError } from '@/lib/http'
import Button from '@/components/ui/Button.vue'
import Dialog from '@/components/ui/Dialog.vue'
import Input from '@/components/ui/Input.vue'
import Label from '@/components/ui/Label.vue'
import Select from '@/components/ui/Select.vue'
import Table from '@/components/ui/Table.vue'
import TableBody from '@/components/ui/TableBody.vue'
import TableCell from '@/components/ui/TableCell.vue'
import TableHead from '@/components/ui/TableHead.vue'
import TableHeader from '@/components/ui/TableHeader.vue'
import TableRow from '@/components/ui/TableRow.vue'

const router = useRouter()
const auth = useAuthStore()
const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]
function monthLabel(year: number, month: number): string {
  return `${MONTHS[month - 1]} ${year}`
}

const records = ref<ScheduleSummary[]>([])
const loading = ref(false)
const errorMsg = ref('')
const filterYear = ref('')

async function load() {
  loading.value = true
  errorMsg.value = ''
  try {
    const query = filterYear.value ? { year: Number(filterYear.value) } : undefined
    records.value = await scheduleService.list(query)
  } catch (e) {
    errorMsg.value = e instanceof Error ? e.message : 'Failed to load schedules'
  } finally {
    loading.value = false
  }
}

function view(id: number) {
  router.push(`/schedules/${id}`)
}

interface GenState {
  open: boolean
  year: string
  month: string
  errorMsg: string
  generating: boolean
}
const emptyGen = (): GenState => ({
  open: false,
  year: String(new Date().getFullYear()),
  month: String(new Date().getMonth() + 1),
  errorMsg: '',
  generating: false,
})
const gen = ref<GenState>(emptyGen())

function openGenerate() {
  gen.value = emptyGen()
  gen.value.open = true
}

async function runGenerate() {
  gen.value.errorMsg = ''
  const parsed = createScheduleSchema.safeParse({
    year: Number(gen.value.year),
    month: Number(gen.value.month),
  })
  if (!parsed.success) {
    gen.value.errorMsg = parsed.error.issues[0]?.message ?? 'Invalid input'
    return
  }
  gen.value.generating = true
  try {
    const detail = await scheduleService.generate(parsed.data.year, parsed.data.month)
    gen.value.open = false
    router.push(`/schedules/${detail.schedule.id}`)
  } catch (e) {
    if (e instanceof ApiError && e.status === 422) {
      gen.value.open = false
      router.push({
        path: '/schedules/preview',
        query: { year: gen.value.year, month: gen.value.month },
      })
      return
    }
    gen.value.errorMsg = e instanceof Error ? e.message : 'Failed to generate'
  } finally {
    gen.value.generating = false
  }
}

onMounted(load)
</script>

<template>
  <div class="flex flex-col gap-4">
    <div class="flex items-center justify-between">
      <h1 class="text-xl font-semibold text-foreground">Schedules</h1>
      <Button v-if="auth.isAdmin" @click="openGenerate">New schedule</Button>
    </div>

    <div class="flex flex-wrap items-end gap-3">
      <div class="flex flex-col gap-1">
        <Label for="f-year">Year</Label>
        <Input id="f-year" v-model="filterYear" type="number" />
      </div>
      <Button variant="outline" @click="load">Apply</Button>
    </div>

    <p v-if="loading" class="text-sm text-muted-foreground">Loading…</p>
    <p v-if="errorMsg" class="text-sm text-destructive" role="alert">{{ errorMsg }}</p>

    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Month</TableHead>
          <TableHead>Status</TableHead>
          <TableHead>Created</TableHead>
          <TableHead class="text-right">Actions</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        <TableRow v-for="s in records" :key="s.id">
          <TableCell>{{ monthLabel(s.year, s.month) }}</TableCell>
          <TableCell>
            <span
              :class="s.status === 'published'
                ? 'inline-flex items-center rounded-md bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary'
                : 'inline-flex items-center rounded-md bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground'">
              {{ s.status === 'published' ? 'Published' : 'Draft' }}
            </span>
          </TableCell>
          <TableCell>{{ s.createdAt.slice(0, 10) }}</TableCell>
          <TableCell class="text-right">
            <Button size="sm" variant="outline" @click="view(s.id)">View</Button>
          </TableCell>
        </TableRow>
      </TableBody>
    </Table>

    <Dialog v-model:open="gen.open" title="New schedule">
      <form class="flex flex-col gap-3" novalidate @submit.prevent="runGenerate">
        <div class="flex flex-col gap-1">
          <Label for="g-year">Year</Label>
          <Input id="g-year" v-model="gen.year" type="number" />
        </div>
        <div class="flex flex-col gap-1">
          <Label for="g-month">Month</Label>
          <Select id="g-month" v-model="gen.month">
            <option v-for="(m, i) in MONTHS" :key="m" :value="String(i + 1)">{{ m }}</option>
          </Select>
        </div>

        <div class="flex items-center gap-2">
          <Button type="submit" :disabled="gen.generating">
            {{ gen.generating ? 'Generating…' : 'Generate' }}
          </Button>
        </div>

        <p v-if="gen.errorMsg" class="text-sm text-destructive" role="alert">{{ gen.errorMsg }}</p>
      </form>
    </Dialog>
  </div>
</template>
