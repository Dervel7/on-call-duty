<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import type { ActivityLogEntry, ActivityQuery, PaginatedActivity, User } from '@oncall/shared'
import { ACTIVITY_ACTIONS } from '@oncall/shared'
import { History } from 'lucide-vue-next'
import * as activityService from '@/services/activity'
import * as userService from '@/services/user'
import { useIntlLocale } from '@/composables/useIntlLocale'
import { useLatestRequest } from '@/composables/useLatestRequest'
import Badge from '@/components/ui/Badge.vue'
import Button from '@/components/ui/Button.vue'
import Card from '@/components/ui/Card.vue'
import CardContent from '@/components/ui/CardContent.vue'
import DatePicker from '@/components/ui/DatePicker.vue'
import EmptyState from '@/components/ui/EmptyState.vue'
import Label from '@/components/ui/Label.vue'
import PageHeader from '@/components/ui/PageHeader.vue'
import Select from '@/components/ui/Select.vue'
import Spinner from '@/components/ui/Spinner.vue'
import Table from '@/components/ui/Table.vue'
import TableBody from '@/components/ui/TableBody.vue'
import TableCell from '@/components/ui/TableCell.vue'
import TableHead from '@/components/ui/TableHead.vue'
import TableHeader from '@/components/ui/TableHeader.vue'
import TableRow from '@/components/ui/TableRow.vue'

const PAGE_SIZE = 50

const { t } = useI18n()
const intlLocale = useIntlLocale()

const actionGroups: Array<[string, string[]]> = (() => {
  const groups = new Map<string, string[]>()
  for (const action of ACTIVITY_ACTIONS) {
    const [domain = '', verb = ''] = action.split('.')
    const list = groups.get(domain) ?? []
    list.push(verb)
    groups.set(domain, list)
  }
  return [...groups.entries()]
})()

const filters = ref({ action: '', userId: '', from: '', to: '' })
const page = ref(1)
const data = ref<PaginatedActivity | null>(null)
const users = ref<User[]>([])
const loading = ref(false)
const errorMsg = ref('')

const latest = useLatestRequest()

async function load() {
  const isCurrent = latest.start()
  loading.value = true
  errorMsg.value = ''
  try {
    const query: ActivityQuery = { page: page.value, limit: PAGE_SIZE }
    if (filters.value.action) query.action = filters.value.action as ActivityQuery['action']
    if (filters.value.userId) query.userId = Number(filters.value.userId)
    if (filters.value.from) query.from = filters.value.from
    if (filters.value.to) query.to = filters.value.to
    const res = await activityService.getActivity(query)
    if (!isCurrent()) return
    data.value = res
  } catch (e) {
    if (!isCurrent()) return
    errorMsg.value = e instanceof Error ? e.message : t('activity.loadFailed')
  } finally {
    if (isCurrent()) loading.value = false
  }
}

watch(
  filters,
  () => {
    page.value = 1
    void load()
  },
  { deep: true },
)

function prevPage() {
  if (page.value > 1) {
    page.value--
    void load()
  }
}

function nextPage() {
  if (data.value && page.value * PAGE_SIZE < data.value.total) {
    page.value++
    void load()
  }
}

function clearFilters() {
  filters.value = { action: '', userId: '', from: '', to: '' }
}

function actorName(entry: ActivityLogEntry): string {
  if (!entry.actor) return t('activity.deletedUser')
  return `${entry.actor.firstName} ${entry.actor.lastName}`
}

function entityText(entry: ActivityLogEntry): string {
  return entry.entityId === null ? entry.entityType : `${entry.entityType} #${entry.entityId}`
}

function detailText(detail: Record<string, unknown>): string {
  const json = JSON.stringify(detail)
  if (json === '{}') return ''
  return json.length > 60 ? `${json.slice(0, 57)}…` : json
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleString(intlLocale.value)
}

const rangeText = computed(() => {
  if (!data.value || data.value.items.length === 0) return ''
  const first = (data.value.page - 1) * data.value.limit + 1
  const last = first + data.value.items.length - 1
  return t('activity.range', { first, last, total: data.value.total })
})

onMounted(() => {
  void load()
  void userService
    .list()
    .then((u) => {
      users.value = u
    })
    .catch(() => {
      // Filter dropdown stays empty; the log itself still loads.
    })
})
</script>

<template>
  <div class="flex flex-col gap-4 animate-rise">
    <PageHeader :icon="History" :title="t('activity.title')" :subtitle="t('activity.subtitle')" />

    <Card>
      <CardContent class="grid gap-4 p-6 pt-6 sm:grid-cols-2 lg:grid-cols-5 lg:items-end">
        <div class="flex flex-col gap-1">
          <Label for="f-action">{{ t('activity.action') }}</Label>
          <Select id="f-action" v-model="filters.action">
            <option value="">{{ t('activity.allActions') }}</option>
            <optgroup v-for="[domain, verbs] in actionGroups" :key="domain" :label="domain">
              <option v-for="verb in verbs" :key="verb" :value="`${domain}.${verb}`">
                {{ verb }}
              </option>
            </optgroup>
          </Select>
        </div>
        <div class="flex flex-col gap-1">
          <Label for="f-user">{{ t('activity.user') }}</Label>
          <Select id="f-user" v-model="filters.userId">
            <option value="">{{ t('activity.allUsers') }}</option>
            <option v-for="u in users" :key="u.id" :value="String(u.id)">
              {{ u.firstName }} {{ u.lastName }} ({{ u.username }})
            </option>
          </Select>
        </div>
        <div class="flex flex-col gap-1">
          <Label for="f-from">{{ t('activity.from') }}</Label>
          <DatePicker id="f-from" v-model="filters.from" :placeholder="t('activity.anyDate')" />
        </div>
        <div class="flex flex-col gap-1">
          <Label for="f-to">{{ t('activity.to') }}</Label>
          <DatePicker id="f-to" v-model="filters.to" :placeholder="t('activity.anyDate')" />
        </div>
        <Button variant="outline" @click="clearFilters">{{ t('activity.clearFilters') }}</Button>
      </CardContent>
    </Card>

    <div v-if="loading" class="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground"><Spinner :size="16" /> {{ t('common.loading') }}</div>
    <p v-if="errorMsg" class="text-sm text-destructive" role="alert">{{ errorMsg }}</p>

    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>{{ t('activity.time') }}</TableHead>
          <TableHead>{{ t('activity.user') }}</TableHead>
          <TableHead>{{ t('activity.action') }}</TableHead>
          <TableHead>{{ t('activity.entity') }}</TableHead>
          <TableHead>{{ t('activity.details') }}</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        <TableRow v-for="x in data?.items ?? []" :key="x.id">
          <TableCell class="whitespace-nowrap font-mono text-xs text-muted-foreground">{{ formatTime(x.createdAt) }}</TableCell>
          <TableCell>
            <span>{{ actorName(x) }}</span>
            <Badge v-if="x.actor" variant="outline" class="ml-2">{{ t(`roles.${x.actor.role}`) }}</Badge>
          </TableCell>
          <TableCell>
            <Badge variant="primary">{{ x.action }}</Badge>
          </TableCell>
          <TableCell class="whitespace-nowrap">{{ entityText(x) }}</TableCell>
          <TableCell>
            <code
              v-if="detailText(x.detail)"
              class="text-xs text-muted-foreground"
              :title="JSON.stringify(x.detail)"
            >
              {{ detailText(x.detail) }}
            </code>
          </TableCell>
        </TableRow>
      </TableBody>
    </Table>

    <EmptyState
      v-if="data && data.items.length === 0 && !loading"
      :title="t('activity.empty')"
    />

    <div v-if="data && data.total > 0" class="flex items-center justify-between">
      <span class="text-sm text-muted-foreground">{{ rangeText }}</span>
      <div class="inline-flex gap-2">
        <Button size="sm" variant="outline" :disabled="page <= 1" @click="prevPage">{{ t('activity.prev') }}</Button>
        <Button
          size="sm"
          variant="outline"
          :disabled="page * PAGE_SIZE >= data.total"
          @click="nextPage"
        >
          {{ t('activity.next') }}
        </Button>
      </div>
    </div>
  </div>
</template>
