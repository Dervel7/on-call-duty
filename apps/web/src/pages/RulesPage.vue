<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { ChevronDown, ScrollText } from 'lucide-vue-next'
import { useI18n } from 'vue-i18n'
import type { DutyMinimumSettings, DutySlotsSettings, OpenDutySettings } from '@oncall/shared'
import { updateDutyMinimumsSchema, updateDutySlotsSchema, updateOpenDutySchema } from '@oncall/shared'
import * as settingsService from '@/services/settings'
import Button from '@/components/ui/Button.vue'
import Input from '@/components/ui/Input.vue'
import Label from '@/components/ui/Label.vue'
import PageHeader from '@/components/ui/PageHeader.vue'

const { t } = useI18n()

type RuleKey = 'cycle' | 'slots' | 'minimums'

/** The rule whose form is open; only one rule is expanded at a time. */
const expandedRule = ref<RuleKey | null>(null)

function toggleRule(key: RuleKey): void {
  expandedRule.value = expandedRule.value === key ? null : key
}

const openDuty = ref<OpenDutySettings | null>(null)
const intervalInput = ref('')
const intervalError = ref('')
const intervalSuccess = ref(false)
const intervalSubmitting = ref(false)

const dutySlots = ref<DutySlotsSettings | null>(null)
const openSlotsInput = ref('')
const postOpenSlotsInput = ref('')
const closedSlotsInput = ref('')
const slotsError = ref('')
const slotsSuccess = ref(false)
const slotsSubmitting = ref(false)

const dutyMinimums = ref<DutyMinimumSettings | null>(null)
const openMinimumInput = ref('')
const postOpenMinimumInput = ref('')
const closedMinimumInput = ref('')
const minimumsError = ref('')
const minimumsSuccess = ref(false)
const minimumsSubmitting = ref(false)
const loading = ref(true)

function errorText(r: PromiseSettledResult<unknown>): string {
  return r.status === 'rejected' && r.reason instanceof Error ? r.reason.message : t('rules.loadFailed')
}

async function loadSettings() {
  intervalError.value = ''
  slotsError.value = ''
  minimumsError.value = ''
  loading.value = true
  const [cycle, slots, minimums] = await Promise.allSettled([
    settingsService.getOpenDuty(),
    settingsService.getDutySlots(),
    settingsService.getDutyMinimums(),
  ])
  if (cycle.status === 'fulfilled') {
    openDuty.value = cycle.value
    intervalInput.value = String(cycle.value.intervalDays)
  } else {
    intervalError.value = errorText(cycle)
  }
  if (slots.status === 'fulfilled') {
    dutySlots.value = slots.value
    openSlotsInput.value = String(slots.value.openDutySlots)
    postOpenSlotsInput.value = String(slots.value.postOpenDutySlots)
    closedSlotsInput.value = String(slots.value.closedDutySlots)
  } else {
    slotsError.value = errorText(slots)
  }
  if (minimums.status === 'fulfilled') {
    dutyMinimums.value = minimums.value
    openMinimumInput.value = String(minimums.value.openDutyMinimum)
    postOpenMinimumInput.value = String(minimums.value.postOpenDutyMinimum)
    closedMinimumInput.value = String(minimums.value.closedDutyMinimum)
  } else {
    minimumsError.value = errorText(minimums)
  }
  loading.value = false
}

async function onSubmitInterval() {
  intervalError.value = ''
  intervalSuccess.value = false
  const parsed = updateOpenDutySchema.safeParse({ intervalDays: intervalInput.value })
  if (!parsed.success) {
    intervalError.value = parsed.error.issues[0]?.message ?? t('common.invalidInput')
    return
  }
  intervalSubmitting.value = true
  try {
    openDuty.value = await settingsService.updateOpenDutyInterval(parsed.data.intervalDays)
    intervalInput.value = String(openDuty.value.intervalDays)
    intervalSuccess.value = true
  } catch (e) {
    intervalError.value = e instanceof Error ? e.message : t('rules.cycle.saveFailed')
  } finally {
    intervalSubmitting.value = false
  }
}

async function onSubmitSlots() {
  slotsError.value = ''
  slotsSuccess.value = false
  const parsed = updateDutySlotsSchema.safeParse({
    openDutySlots: openSlotsInput.value,
    postOpenDutySlots: postOpenSlotsInput.value,
    closedDutySlots: closedSlotsInput.value,
  })
  if (!parsed.success) {
    slotsError.value = parsed.error.issues[0]?.message ?? t('common.invalidInput')
    return
  }
  slotsSubmitting.value = true
  try {
    dutySlots.value = await settingsService.updateDutySlots(
      parsed.data.openDutySlots,
      parsed.data.postOpenDutySlots,
      parsed.data.closedDutySlots,
    )
    openSlotsInput.value = String(dutySlots.value.openDutySlots)
    postOpenSlotsInput.value = String(dutySlots.value.postOpenDutySlots)
    closedSlotsInput.value = String(dutySlots.value.closedDutySlots)
    slotsSuccess.value = true
  } catch (e) {
    slotsError.value = e instanceof Error ? e.message : t('rules.slots.saveFailed')
  } finally {
    slotsSubmitting.value = false
  }
}

async function onSubmitMinimums() {
  minimumsError.value = ''
  minimumsSuccess.value = false
  const parsed = updateDutyMinimumsSchema.safeParse({
    openDutyMinimum: openMinimumInput.value,
    postOpenDutyMinimum: postOpenMinimumInput.value,
    closedDutyMinimum: closedMinimumInput.value,
  })
  if (!parsed.success) {
    minimumsError.value = parsed.error.issues[0]?.message ?? t('common.invalidInput')
    return
  }
  minimumsSubmitting.value = true
  try {
    dutyMinimums.value = await settingsService.updateDutyMinimums(
      parsed.data.openDutyMinimum,
      parsed.data.postOpenDutyMinimum,
      parsed.data.closedDutyMinimum,
    )
    openMinimumInput.value = String(dutyMinimums.value.openDutyMinimum)
    postOpenMinimumInput.value = String(dutyMinimums.value.postOpenDutyMinimum)
    closedMinimumInput.value = String(dutyMinimums.value.closedDutyMinimum)
    minimumsSuccess.value = true
  } catch (e) {
    minimumsError.value = e instanceof Error ? e.message : t('rules.minimums.saveFailed')
  } finally {
    minimumsSubmitting.value = false
  }
}

onMounted(loadSettings)
</script>

<template>
  <div class="flex flex-col gap-4 animate-rise">
    <PageHeader
      :icon="ScrollText"
      :title="t('nav.rules')"
      :subtitle="t('rules.subtitle')"
    />

    <ul class="overflow-hidden rounded-lg border border-border/70">
      <li class="border-b border-border/70 last:border-b-0">
        <button
          id="rule-cycle-toggle"
          type="button"
          class="flex w-full items-center justify-between gap-3 bg-card px-4 py-3 text-left transition-colors hover:bg-primary/[0.035]"
          aria-controls="rule-cycle-panel"
          :aria-expanded="expandedRule === 'cycle'"
          @click="toggleRule('cycle')"
        >
          <span class="font-display font-semibold text-foreground">{{ t('rules.cycle.title') }}</span>
          <span class="inline-flex items-center gap-2 font-mono text-sm text-muted-foreground">
            <span v-if="intervalError" class="text-destructive">{{ t('rules.error') }}</span>
            <template v-else-if="openDuty">{{ t('rules.cycle.summary', { n: openDuty.intervalDays }, openDuty.intervalDays) }}</template>
            <ChevronDown class="size-4 transition-transform" :class="{ 'rotate-180': expandedRule === 'cycle' }" />
          </span>
        </button>
        <div v-if="expandedRule === 'cycle'" id="rule-cycle-panel" class="flex flex-col gap-3 px-4 pb-4">
          <p class="text-xs text-muted-foreground">
            {{ t('rules.cycle.help', { date: openDuty?.anchorDate ?? '—' }) }}
          </p>
          <form class="flex max-w-sm flex-col gap-3" novalidate @submit.prevent="onSubmitInterval">
            <div class="flex flex-col gap-1.5">
              <Label for="open-duty-interval">{{ t('rules.cycle.intervalLabel') }}</Label>
              <Input
                id="open-duty-interval"
                v-model="intervalInput"
                type="number"
                min="1"
                max="365"
                inputmode="numeric"
                :disabled="loading"
              />
            </div>
            <p v-if="intervalError" class="text-xs text-destructive" role="alert">{{ intervalError }}</p>
            <p v-if="intervalSuccess" class="text-xs text-success" role="status">{{ t('rules.cycle.updated') }}</p>
            <Button class="self-start" type="submit" :disabled="loading || intervalSubmitting">{{ t('rules.cycle.save') }}</Button>
          </form>
        </div>
      </li>

      <li class="border-b border-border/70 last:border-b-0">
        <button
          id="rule-slots-toggle"
          type="button"
          class="flex w-full items-center justify-between gap-3 bg-card px-4 py-3 text-left transition-colors hover:bg-primary/[0.035]"
          aria-controls="rule-slots-panel"
          :aria-expanded="expandedRule === 'slots'"
          @click="toggleRule('slots')"
        >
          <span class="font-display font-semibold text-foreground">{{ t('rules.slots.title') }}</span>
          <span class="inline-flex items-center gap-2 font-mono text-sm text-muted-foreground">
            <span v-if="slotsError" class="text-destructive">{{ t('rules.error') }}</span>
            <template v-else-if="dutySlots"
              >{{
                t('rules.dayTypeSummary', {
                  open: dutySlots.openDutySlots,
                  postOpen: dutySlots.postOpenDutySlots,
                  closed: dutySlots.closedDutySlots,
                })
              }}</template
            >
            <ChevronDown class="size-4 transition-transform" :class="{ 'rotate-180': expandedRule === 'slots' }" />
          </span>
        </button>
        <div v-if="expandedRule === 'slots'" id="rule-slots-panel" class="flex flex-col gap-3 px-4 pb-4">
          <p class="text-xs text-muted-foreground">
            {{ t('rules.slots.help') }}
          </p>
          <form class="flex max-w-sm flex-col gap-3" novalidate @submit.prevent="onSubmitSlots">
            <div class="flex flex-col gap-1.5">
              <Label for="open-duty-slots">{{ t('rules.openDaysLabel') }}</Label>
              <Input
                id="open-duty-slots"
                v-model="openSlotsInput"
                type="number"
                min="1"
                max="7"
                inputmode="numeric"
                :disabled="loading"
              />
            </div>
            <div class="flex flex-col gap-1.5">
              <Label for="post-open-duty-slots">{{ t('rules.postOpenDaysLabel') }}</Label>
              <Input
                id="post-open-duty-slots"
                v-model="postOpenSlotsInput"
                type="number"
                min="1"
                max="7"
                inputmode="numeric"
                :disabled="loading"
              />
            </div>
            <div class="flex flex-col gap-1.5">
              <Label for="closed-duty-slots">{{ t('rules.closedDaysLabel') }}</Label>
              <Input
                id="closed-duty-slots"
                v-model="closedSlotsInput"
                type="number"
                min="1"
                max="7"
                inputmode="numeric"
                :disabled="loading"
              />
            </div>
            <p v-if="slotsError" class="text-xs text-destructive" role="alert">{{ slotsError }}</p>
            <p v-if="slotsSuccess" class="text-xs text-success" role="status">{{ t('rules.slots.updated') }}</p>
            <Button class="self-start" type="submit" :disabled="loading || slotsSubmitting">{{ t('rules.slots.save') }}</Button>
          </form>
        </div>
      </li>

      <li class="border-b border-border/70 last:border-b-0">
        <button
          id="rule-minimums-toggle"
          type="button"
          class="flex w-full items-center justify-between gap-3 bg-card px-4 py-3 text-left transition-colors hover:bg-primary/[0.035]"
          aria-controls="rule-minimums-panel"
          :aria-expanded="expandedRule === 'minimums'"
          @click="toggleRule('minimums')"
        >
          <span class="font-display font-semibold text-foreground">{{ t('rules.minimums.title') }}</span>
          <span class="inline-flex items-center gap-2 font-mono text-sm text-muted-foreground">
            <span v-if="minimumsError" class="text-destructive">{{ t('rules.error') }}</span>
            <template v-else-if="dutyMinimums"
              >{{
                t('rules.dayTypeSummary', {
                  open: dutyMinimums.openDutyMinimum,
                  postOpen: dutyMinimums.postOpenDutyMinimum,
                  closed: dutyMinimums.closedDutyMinimum,
                })
              }}</template
            >
            <ChevronDown
              class="size-4 transition-transform"
              :class="{ 'rotate-180': expandedRule === 'minimums' }"
            />
          </span>
        </button>
        <div v-if="expandedRule === 'minimums'" id="rule-minimums-panel" class="flex flex-col gap-3 px-4 pb-4">
          <p class="text-xs text-muted-foreground">
            {{ t('rules.minimums.help') }}
          </p>
          <form class="flex max-w-sm flex-col gap-3" novalidate @submit.prevent="onSubmitMinimums">
            <div class="flex flex-col gap-1.5">
              <Label for="open-duty-minimum">{{ t('rules.openDaysLabel') }}</Label>
              <Input
                id="open-duty-minimum"
                v-model="openMinimumInput"
                type="number"
                min="1"
                max="7"
                inputmode="numeric"
                :disabled="loading"
              />
            </div>
            <div class="flex flex-col gap-1.5">
              <Label for="post-open-duty-minimum">{{ t('rules.postOpenDaysLabel') }}</Label>
              <Input
                id="post-open-duty-minimum"
                v-model="postOpenMinimumInput"
                type="number"
                min="1"
                max="7"
                inputmode="numeric"
                :disabled="loading"
              />
            </div>
            <div class="flex flex-col gap-1.5">
              <Label for="closed-duty-minimum">{{ t('rules.closedDaysLabel') }}</Label>
              <Input
                id="closed-duty-minimum"
                v-model="closedMinimumInput"
                type="number"
                min="1"
                max="7"
                inputmode="numeric"
                :disabled="loading"
              />
            </div>
            <p v-if="minimumsError" class="text-xs text-destructive" role="alert">{{ minimumsError }}</p>
            <p v-if="minimumsSuccess" class="text-xs text-success" role="status">{{ t('rules.minimums.updated') }}</p>
            <Button class="self-start" type="submit" :disabled="loading || minimumsSubmitting">{{ t('rules.minimums.save') }}</Button>
          </form>
        </div>
      </li>
    </ul>
  </div>
</template>
