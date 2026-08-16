<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import type { ActivityLogEntry, ActivityQuery, PaginatedActivity, User } from '@oncall/shared'
import { ACTIVITY_ACTIONS } from '@oncall/shared'
import * as activityService from '@/services/activity'
import * as userService from '@/services/user'
import Button from '@/components/ui/Button.vue'
import Card from '@/components/ui/Card.vue'
import CardContent from '@/components/ui/CardContent.vue'
import Input from '@/components/ui/Input.vue'
import Label from '@/components/ui/Label.vue'
import Select from '@/components/ui/Select.vue'
import Table from '@/components/ui/Table.vue'
import TableBody from '@/components/ui/TableBody.vue'
import TableCell from '@/components/ui/TableCell.vue'
import TableHead from '@/components/ui/TableHead.vue'
import TableHeader from '@/components/ui/TableHeader.vue'
import TableRow from '@/components/ui/TableRow.vue'

const PAGE_SIZE = 50

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

async function load() {
  loading.value = true
  errorMsg.value = ''
  try {
    const query: ActivityQuery = { page: page.value, limit: PAGE_SIZE }
    if (filters.value.action) query.action = filters.value.action as ActivityQuery['action']
    if (filters.value.userId) query.userId = Number(filters.value.userId)
    if (filters.value.from) query.from = filters.value.from
    if (filters.value.to) query.to = filters.value.to
    data.value = await activityService.getActivity(query)
  } catch (e) {
    errorMsg.value = e instanceof Error ? e.message : 'Failed to load activity'
  } finally {
    loading.value = false
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
  if (!entry.actor) return 'Deleted user'
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
  return new Date(iso).toLocaleString()
}

const rangeText = computed(() => {
  if (!data.value || data.value.items.length === 0) return ''
  const first = (data.value.page - 1) * data.value.limit + 1
  const last = first + data.value.items.length - 1
  return `Showing ${first}–${last} of ${data.value.total}`
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
  <div class="flex flex-col gap-4">
    <h1 class="text-xl font-semibold text-foreground">User Activity</h1>

    <Card>
      <CardContent class="grid gap-4 p-6 pt-6 sm:grid-cols-2 lg:grid-cols-5 lg:items-end">
        <div class="flex flex-col gap-1">
          <Label for="f-action">Action</Label>
          <Select id="f-action" v-model="filters.action">
            <option value="">All actions</option>
            <optgroup v-for="[domain, verbs] in actionGroups" :key="domain" :label="domain">
              <option v-for="verb in verbs" :key="verb" :value="`${domain}.${verb}`">
                {{ verb }}
              </option>
            </optgroup>
          </Select>
        </div>
        <div class="flex flex-col gap-1">
          <Label for="f-user">User</Label>
          <Select id="f-user" v-model="filters.userId">
            <option value="">All users</option>
            <option v-for="u in users" :key="u.id" :value="String(u.id)">
              {{ u.firstName }} {{ u.lastName }} ({{ u.username }})
            </option>
          </Select>
        </div>
        <div class="flex flex-col gap-1">
          <Label for="f-from">From</Label>
          <Input id="f-from" v-model="filters.from" type="date" />
        </div>
        <div class="flex flex-col gap-1">
          <Label for="f-to">To</Label>
          <Input id="f-to" v-model="filters.to" type="date" />
        </div>
        <Button variant="outline" @click="clearFilters">Clear filters</Button>
      </CardContent>
    </Card>

    <p v-if="loading" class="text-sm text-muted-foreground">Loading…</p>
    <p v-if="errorMsg" class="text-sm text-destructive" role="alert">{{ errorMsg }}</p>

    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Time</TableHead>
          <TableHead>User</TableHead>
          <TableHead>Action</TableHead>
          <TableHead>Entity</TableHead>
          <TableHead>Details</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        <TableRow v-for="x in data?.items ?? []" :key="x.id">
          <TableCell class="whitespace-nowrap">{{ formatTime(x.createdAt) }}</TableCell>
          <TableCell>
            <span>{{ actorName(x) }}</span>
            <span
              v-if="x.actor"
              class="ml-2 rounded-full bg-muted px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground"
            >
              {{ x.actor.role }}
            </span>
          </TableCell>
          <TableCell>
            <span
              class="rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-semibold text-primary"
            >
              {{ x.action }}
            </span>
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

    <p v-if="data && data.items.length === 0 && !loading" class="text-sm text-muted-foreground">
      No activity found.
    </p>

    <div v-if="data && data.total > 0" class="flex items-center justify-between">
      <span class="text-sm text-muted-foreground">{{ rangeText }}</span>
      <div class="inline-flex gap-2">
        <Button size="sm" variant="outline" :disabled="page <= 1" @click="prevPage">Prev</Button>
        <Button
          size="sm"
          variant="outline"
          :disabled="page * PAGE_SIZE >= data.total"
          @click="nextPage"
        >
          Next
        </Button>
      </div>
    </div>
  </div>
</template>
