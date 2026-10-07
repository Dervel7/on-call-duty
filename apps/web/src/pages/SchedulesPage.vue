<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import type { ScheduleSummary } from '@oncall/shared'
import { createScheduleSchema } from '@oncall/shared'
import { monthLabel, monthNames } from '@oncall/utils'
import { useAuthStore } from '@/stores/auth'
import { useIntlLocale } from '@/composables/useIntlLocale'
import * as scheduleService from '@/services/schedule'
import { CalendarDays, CalendarOff } from 'lucide-vue-next'
import Badge from '@/components/ui/Badge.vue'
import Button from '@/components/ui/Button.vue'
import Dialog from '@/components/ui/Dialog.vue'
import EmptyState from '@/components/ui/EmptyState.vue'
import Input from '@/components/ui/Input.vue'
import Label from '@/components/ui/Label.vue'
import PageHeader from '@/components/ui/PageHeader.vue'
import Spinner from '@/components/ui/Spinner.vue'
import Select from '@/components/ui/Select.vue'
import Table from '@/components/ui/Table.vue'
import TableBody from '@/components/ui/TableBody.vue'
import TableCell from '@/components/ui/TableCell.vue'
import TableHead from '@/components/ui/TableHead.vue'
import TableHeader from '@/components/ui/TableHeader.vue'
import TableRow from '@/components/ui/TableRow.vue'

const { t } = useI18n()
const router = useRouter()
const auth = useAuthStore()
const intlLocale = useIntlLocale()
const months = computed(() => monthNames(intlLocale.value))
const createdFormat = computed(() => new Intl.DateTimeFormat(intlLocale.value, { dateStyle: 'medium' }))
function createdLabel(iso: string): string {
  return createdFormat.value.format(new Date(iso))
}

const records = ref<ScheduleSummary[]>([])
const loading = ref(false)
const errorMsg = ref('')
const filterYear = ref(String(new Date().getFullYear()))

async function load() {
  loading.value = true
  errorMsg.value = ''
  try {
    const query = filterYear.value ? { year: Number(filterYear.value) } : undefined
    records.value = await scheduleService.list(query)
  } catch (e) {
    errorMsg.value = e instanceof Error ? e.message : t('schedules.loadFailed')
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
}
const emptyGen = (): GenState => ({
  open: false,
  year: String(new Date().getFullYear()),
  month: String(new Date().getMonth() + 1),
  errorMsg: '',
})
const gen = ref<GenState>(emptyGen())

function openGenerate() {
  gen.value = emptyGen()
  gen.value.open = true
}

function runGenerate() {
  gen.value.errorMsg = ''
  const parsed = createScheduleSchema.safeParse({
    year: Number(gen.value.year),
    month: Number(gen.value.month),
  })
  if (!parsed.success) {
    gen.value.errorMsg = parsed.error.issues[0]?.message ?? t('common.invalidInput')
    return
  }
  gen.value.open = false
  router.push({
    path: '/schedules/options',
    query: { year: String(parsed.data.year), month: String(parsed.data.month) },
  })
}

onMounted(load)
</script>

<template>
  <div class="flex flex-col gap-4 animate-rise">
    <PageHeader :icon="CalendarDays" :title="t('nav.schedules')" :subtitle="t('schedules.subtitle')">
      <template #actions>
        <Button v-if="auth.isAdmin" @click="openGenerate">{{ t('schedules.newSchedule') }}</Button>
      </template>
    </PageHeader>

    <div class="flex flex-wrap items-end gap-3">
      <div class="flex flex-col gap-1">
        <Label for="f-year">{{ t('common.year') }}</Label>
        <Input id="f-year" v-model="filterYear" type="number" />
      </div>
      <Button variant="outline" @click="load">{{ t('common.apply') }}</Button>
    </div>

    <div v-if="loading" class="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground">
      <Spinner :size="16" />
      {{ t('common.loading') }}
    </div>
    <p v-if="errorMsg" class="text-sm text-destructive" role="alert">{{ errorMsg }}</p>

    <p class="hud-label mb-2">{{ t('schedules.rostersKicker') }}</p>
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>{{ t('common.month') }}</TableHead>
          <TableHead>{{ t('schedules.status') }}</TableHead>
          <TableHead>{{ t('schedules.created') }}</TableHead>
          <TableHead class="text-right">{{ t('common.actions') }}</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        <TableRow v-for="s in records" :key="s.id">
          <TableCell>{{ monthLabel(s.year, s.month, intlLocale) }}</TableCell>
          <TableCell>
            <Badge :variant="s.status === 'published' ? 'success' : 'neutral'" dot>
              {{ s.status === 'published' ? t('scheduleStatus.published') : t('scheduleStatus.draft') }}
            </Badge>
          </TableCell>
          <TableCell class="font-mono text-sm">{{ createdLabel(s.createdAt) }}</TableCell>
          <TableCell class="text-right">
            <Button size="sm" variant="outline" @click="view(s.id)">{{ t('common.view') }}</Button>
          </TableCell>
        </TableRow>
      </TableBody>
    </Table>

    <EmptyState v-if="!loading && !errorMsg && records.length === 0" :icon="CalendarOff"
      :title="t('schedules.empty')" />

    <Dialog v-model:open="gen.open" :title="t('schedules.newSchedule')">
      <form class="flex flex-col gap-3" novalidate @submit.prevent="runGenerate">
        <div class="flex flex-col gap-1">
          <Label for="g-year">{{ t('common.year') }}</Label>
          <Input id="g-year" v-model="gen.year" type="number" />
        </div>
        <div class="flex flex-col gap-1">
          <Label for="g-month">{{ t('common.month') }}</Label>
          <Select id="g-month" v-model="gen.month">
            <option v-for="(m, i) in months" :key="i" :value="String(i + 1)">{{ m }}</option>
          </Select>
        </div>

        <div class="flex items-center gap-2">
          <Button type="submit">{{ t('schedules.generate') }}</Button>
        </div>

        <p v-if="gen.errorMsg" class="text-sm text-destructive" role="alert">{{ gen.errorMsg }}</p>
      </form>
    </Dialog>
  </div>
</template>
