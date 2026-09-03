<script setup lang="ts">
import { onMounted, ref } from 'vue'
import type { GenerationEvent, OperatorAlert, UsageSummary } from '@oncall/shared'
import * as usageService from '@/services/usage'
import Button from '@/components/ui/Button.vue'
import Card from '@/components/ui/Card.vue'
import CardContent from '@/components/ui/CardContent.vue'
import CardHeader from '@/components/ui/CardHeader.vue'
import CardTitle from '@/components/ui/CardTitle.vue'
import Table from '@/components/ui/Table.vue'
import TableBody from '@/components/ui/TableBody.vue'
import TableCell from '@/components/ui/TableCell.vue'
import TableHead from '@/components/ui/TableHead.vue'
import TableHeader from '@/components/ui/TableHeader.vue'
import TableRow from '@/components/ui/TableRow.vue'

const summary = ref<UsageSummary | null>(null)
const generations = ref<GenerationEvent[]>([])
const alerts = ref<OperatorAlert[]>([])
const loading = ref(false)
const errorMsg = ref('')

async function load() {
  loading.value = true
  errorMsg.value = ''
  try {
    const [s, g, a] = await Promise.all([
      usageService.summary(),
      usageService.generations(),
      usageService.alerts(),
    ])
    summary.value = s
    generations.value = g
    alerts.value = a
  } catch (e) {
    errorMsg.value = e instanceof Error ? e.message : 'Failed to load usage data'
  } finally {
    loading.value = false
  }
}

async function resolve(a: OperatorAlert) {
  try {
    await usageService.resolveAlert(a.id)
  } catch (e) {
    errorMsg.value = e instanceof Error ? e.message : 'Failed to resolve alert'
    return
  }
  await load()
}

function monthLabel(e: GenerationEvent): string {
  return `${e.year}-${String(e.month).padStart(2, '0')}`
}

function overlapLabel(e: GenerationEvent): string {
  return e.overlapPercent === null ? '—' : e.overlapPercent + '%'
}

onMounted(load)
</script>

<template>
  <div class="flex flex-col gap-4">
    <h1 class="text-xl font-semibold text-foreground">Usage</h1>

    <p v-if="loading" class="text-sm text-muted-foreground">Loading…</p>
    <p v-if="errorMsg" class="text-sm text-destructive" role="alert">{{ errorMsg }}</p>

    <Card v-if="summary">
      <CardHeader>
        <CardTitle>License</CardTitle>
      </CardHeader>
      <CardContent class="flex flex-col gap-2">
        <p class="text-sm text-muted-foreground">
          Licensee:
          <span class="text-foreground">{{ summary.license.licensee }}</span>
        </p>
        <p class="text-sm text-muted-foreground">
          Expiry:
          <span class="text-foreground">{{ summary.license.expiresAt ?? 'no expiry (dev)' }}</span>
        </p>
        <p class="text-sm text-muted-foreground">
          Distinct doctors (rolling):
          <span
            :class="
              summary.rollingDistinctDoctors > summary.license.doctorAllowance
                ? 'font-semibold text-destructive'
                : 'text-foreground'
            "
          >
            {{ summary.rollingDistinctDoctors }} / {{ summary.license.doctorAllowance }}
          </span>
        </p>
        <p class="text-sm text-muted-foreground">
          Rolling window:
          <span class="text-foreground">{{ summary.license.rollingWindowDays }} days</span>
        </p>
        <p class="text-sm text-muted-foreground">
          Open alerts:
          <span class="text-foreground">{{ summary.openAlerts }}</span>
        </p>
      </CardContent>
    </Card>

    <Card>
      <CardHeader>
        <CardTitle>Generation history</CardTitle>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Generated at</TableHead>
              <TableHead>Month</TableHead>
              <TableHead>Doctors</TableHead>
              <TableHead>Overlap</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            <TableRow v-for="(e, i) in generations" :key="i">
              <TableCell>{{ new Date(e.generatedAt).toLocaleString() }}</TableCell>
              <TableCell>{{ monthLabel(e) }}</TableCell>
              <TableCell>{{ e.doctorNames.join(', ') }}</TableCell>
              <TableCell>{{ overlapLabel(e) }}</TableCell>
            </TableRow>
          </TableBody>
        </Table>
      </CardContent>
    </Card>

    <Card>
      <CardHeader>
        <CardTitle>Alerts</CardTitle>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Created</TableHead>
              <TableHead>Type</TableHead>
              <TableHead>Detail</TableHead>
              <TableHead>State</TableHead>
              <TableHead class="text-right">Action</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            <TableRow v-for="a in alerts" :key="a.id">
              <TableCell>{{ new Date(a.createdAt).toLocaleString() }}</TableCell>
              <TableCell>{{ a.type }}</TableCell>
              <TableCell>{{ JSON.stringify(a.detail) }}</TableCell>
              <TableCell>{{ a.resolvedAt ? 'resolved' : 'open' }}</TableCell>
              <TableCell class="text-right">
                <Button size="sm" variant="outline" :disabled="a.resolvedAt !== null" @click="resolve(a)">
                  Resolve
                </Button>
              </TableCell>
            </TableRow>
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  </div>
</template>
