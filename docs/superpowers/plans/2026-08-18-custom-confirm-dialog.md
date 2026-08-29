# Custom Confirm Dialog Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace all 9 native `window.confirm()` calls with a styled, app-consistent confirm dialog driven by a Promise-based composable.

**Architecture:** A module-state composable (`useConfirm`) holds one pending request; a single global host component (`ConfirmDialog.vue`) mounted in `DefaultLayout` renders it by reusing the existing `Dialog.vue`. Call sites keep their guard-style control flow (`if (!(await confirm(...))) return`).

**Tech Stack:** Vue 3 `<script setup>` + TS, Tailwind classes, `lucide-vue-next`, `@vue/test-utils` + jsdom (Vitest).

## Global Constraints

- Spec: `docs/superpowers/specs/2026-08-18-custom-confirm-dialog-design.md`
- Repo is on `main`: **do NOT run `git commit`** — the user commits. Every "Commit" step is replaced by "Stop and report".
- No code comments unless already present in copied code.
- Do not modify lint rules, do not add Prettier.
- All commands run from the repository root (`C:\Users\kalamata\Documents\GitHub\on-call-duty`).
- Web tests live flat in `apps/web/src/__tests__/<Name>.test.ts` (existing convention; overrides the spec's `components/ui/__tests__/` path).
- Existing uncommitted changes in the worktree (LoginPage, DoctorDashboard, DutyCalendar, and 3 test files) must be left untouched.
- Icons: named imports from `lucide-vue-next` (already a dependency). Use `TriangleAlert`.
- Existing confirmation message strings are preserved verbatim; only the call shape changes.

## File Structure

| File | Action | Responsibility |
|---|---|---|
| `apps/web/src/composables/useConfirm.ts` | Create | Module state + `confirm()` + `settle()` |
| `apps/web/src/components/ui/ConfirmDialog.vue` | Create | Global host rendering the pending request via `Dialog.vue` |
| `apps/web/src/layouts/DefaultLayout.vue` | Modify | Mount the host once |
| `apps/web/src/pages/ScheduleDetailPage.vue` | Modify | Migrate 4 confirms |
| `apps/web/src/pages/DoctorsPage.vue` | Modify | Migrate 1 confirm |
| `apps/web/src/__tests__/DoctorsPage.test.ts` | Modify | Replace `window.confirm` spy with composable settle |
| `apps/web/src/pages/UsersPage.vue` | Modify | Migrate 1 confirm |
| `apps/web/src/pages/HolidaysPage.vue` | Modify | Migrate 1 confirm |
| `apps/web/src/pages/AvailabilityPage.vue` | Modify | Migrate 1 confirm |
| `apps/web/src/pages/MyAvailabilityPage.vue` | Modify | Migrate 1 confirm |
| `apps/web/src/__tests__/ConfirmDialog.test.ts` | Create | Host + composable tests |

---

### Task 1: `useConfirm` composable

**Files:**
- Create: `apps/web/src/composables/useConfirm.ts` (new `composables/` directory)

**Interfaces:**
- Produces: `useConfirm(): { confirm(options: ConfirmOptions): Promise<boolean> }` and `useConfirmState(): { request: Ref<ConfirmRequest | null>; settle(value: boolean): void }`, where `ConfirmOptions = { title: string; message: string; confirmText?: string; cancelText?: string; variant?: 'destructive' | 'primary' }`.

- [ ] **Step 1: Create the file**

```ts
import { ref } from 'vue'

export interface ConfirmOptions {
  title: string
  message: string
  confirmText?: string
  cancelText?: string
  variant?: 'destructive' | 'primary'
}

export interface ConfirmRequest {
  title: string
  message: string
  confirmText: string
  cancelText: string
  variant: 'destructive' | 'primary'
  resolve: (value: boolean) => void
}

const request = ref<ConfirmRequest | null>(null)

function confirm(options: ConfirmOptions): Promise<boolean> {
  request.value?.resolve(false)
  return new Promise((resolve) => {
    request.value = {
      title: options.title,
      message: options.message,
      confirmText: options.confirmText ?? 'Confirm',
      cancelText: options.cancelText ?? 'Cancel',
      variant: options.variant ?? 'destructive',
      resolve,
    }
  })
}

function settle(value: boolean): void {
  request.value?.resolve(value)
  request.value = null
}

export function useConfirm(): { confirm: (options: ConfirmOptions) => Promise<boolean> } {
  return { confirm }
}

export function useConfirmState(): {
  request: typeof request
  settle: (value: boolean) => void
} {
  return { request, settle }
}
```

Semantics: `settle` nulls the state after resolving, so a second `settle` is a no-op (double-resolution guard). A second `confirm()` while one is pending resolves the first with `false`.

- [ ] **Step 2: Verify**

Run: `pnpm typecheck && pnpm lint`
Expected: PASS with no errors.

- [ ] **Step 3: Stop and report** (no commit — user commits on main)

---

### Task 2: `ConfirmDialog` host component + mount in layout

**Files:**
- Create: `apps/web/src/components/ui/ConfirmDialog.vue`
- Modify: `apps/web/src/layouts/DefaultLayout.vue`

**Interfaces:**
- Consumes: `useConfirmState()` from Task 1; existing `Dialog.vue` (`props: open, title?`; emit `update:open`) and `Button.vue` (`variant: 'default' | 'secondary' | 'destructive' | 'outline' | 'accent'`).
- Produces: a globally mounted host. Pages never import this component.

- [ ] **Step 1: Create `apps/web/src/components/ui/ConfirmDialog.vue`**

```vue
<script setup lang="ts">
import { nextTick, ref, watch } from 'vue'
import { TriangleAlert } from 'lucide-vue-next'
import Dialog from './Dialog.vue'
import Button from './Button.vue'
import { useConfirmState } from '@/composables/useConfirm'

const { request, settle } = useConfirmState()
const footer = ref<HTMLElement | null>(null)

watch(
  () => request.value,
  async (r) => {
    if (!r) return
    await nextTick()
    const buttons = footer.value?.querySelectorAll('button')
    if (!buttons || buttons.length === 0) return
    const target = r.variant === 'primary' ? buttons[buttons.length - 1] : buttons[0]
    target?.focus()
  },
)
</script>

<template>
  <Dialog :open="request !== null" :title="request?.title" @update:open="settle(false)">
    <div v-if="request" class="flex items-start gap-4">
      <span
        :class="request.variant === 'primary'
          ? 'flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary'
          : 'flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-destructive/10 text-destructive'"
      >
        <TriangleAlert class="h-5 w-5" />
      </span>
      <p class="pt-2 text-sm text-muted-foreground">{{ request.message }}</p>
    </div>
    <template #footer>
      <div ref="footer" class="contents">
        <Button variant="outline" @click="settle(false)">{{ request?.cancelText }}</Button>
        <Button
          :variant="request?.variant === 'primary' ? 'default' : 'destructive'"
          @click="settle(true)"
        >
          {{ request?.confirmText }}
        </Button>
      </div>
    </template>
  </Dialog>
</template>
```

Notes for the implementer:
- `:open="request !== null"` (not `v-if` on the host) is deliberate: `Dialog.vue` resets `document.body.style.overflow` in a `watch` on its `open` prop, so the prop must transition to `false` for cleanup to run.
- Autofocus targets the least destructive button: Cancel (first footer button) for `destructive`, Confirm (last) for `primary`.
- The focus query is rooted at the footer wrapper (`ref="footer"`), because the buttons live in Dialog's `#footer` slot — a sibling of the default slot. `class="contents"` keeps the wrapper invisible to Dialog's flex layout.

- [ ] **Step 2: Mount the host in `DefaultLayout.vue`**

Replace the entire file content with:

```vue
<script setup lang="ts">
import AppLayout from '@/components/layout/AppLayout.vue'
import ConfirmDialog from '@/components/ui/ConfirmDialog.vue'
</script>

<template>
  <AppLayout>
    <RouterView v-slot="{ Component }">
      <Transition name="page" mode="out-in">
        <component :is="Component" />
      </Transition>
    </RouterView>
    <ConfirmDialog />
  </AppLayout>
</template>
```

- [ ] **Step 3: Verify**

Run: `pnpm typecheck && pnpm lint`
Expected: PASS with no errors.

- [ ] **Step 4: Stop and report** (no commit — user commits on main)

---

### Task 3: Migrate `ScheduleDetailPage.vue` (4 call sites)

**Files:**
- Modify: `apps/web/src/pages/ScheduleDetailPage.vue`

**Interfaces:**
- Consumes: `useConfirm()` from Task 1.

- [ ] **Step 1: Add import and instance**

After line 16 (`import DutyCalendar from '@/components/schedule/DutyCalendar.vue'`) add:

```ts
import { useConfirm } from '@/composables/useConfirm'
```

After line 20 (`const auth = useAuthStore()`) add:

```ts
const { confirm } = useConfirm()
```

- [ ] **Step 2: Replace the four confirm guards**

2a. In `publish()` (line 83), replace:

```ts
  if (!confirm('Publish this schedule? Editing will be locked.')) return
```

with:

```ts
  if (
    !(await confirm({
      title: 'Publish schedule',
      message: 'Publish this schedule? Editing will be locked.',
      confirmText: 'Publish',
      variant: 'primary',
    }))
  )
    return
```

2b. In `unpublish()` (line 94), replace:

```ts
  if (!confirm('Revert this schedule to draft? Editing will be re-enabled.')) return
```

with:

```ts
  if (
    !(await confirm({
      title: 'Revert to draft',
      message: 'Revert this schedule to draft? Editing will be re-enabled.',
      confirmText: 'Revert',
      variant: 'primary',
    }))
  )
    return
```

2c. In `deleteSchedule()` (line 105), replace:

```ts
  if (!confirm('Delete this schedule and all its duties?')) return
```

with:

```ts
  if (
    !(await confirm({
      title: 'Delete schedule',
      message: 'Delete this schedule and all its duties?',
      confirmText: 'Delete',
    }))
  )
    return
```

2d. In `onSelect()` (line 123), replace:

```ts
    if (!confirm(`Remove ${existing?.firstName ?? ''} ${existing?.lastName ?? ''} from ${date}?`)) return
```

with:

```ts
    if (
      !(await confirm({
        title: 'Remove duty',
        message: `Remove ${existing?.firstName ?? ''} ${existing?.lastName ?? ''} from ${date}?`,
        confirmText: 'Remove',
      }))
    )
      return
```

- [ ] **Step 3: Verify**

Run: `pnpm typecheck && pnpm lint && pnpm --filter @oncall/web test`
Expected: all PASS (`ScheduleDetailPage.test.ts` does not trigger confirm-guarded handlers; it must stay green).

- [ ] **Step 4: Stop and report** (no commit — user commits on main)

---

### Task 4: Migrate `DoctorsPage.vue` + update its test

**Files:**
- Modify: `apps/web/src/pages/DoctorsPage.vue`
- Modify: `apps/web/src/__tests__/DoctorsPage.test.ts`

**Interfaces:**
- Consumes: `useConfirm()` and `useConfirmState()` from Task 1.

- [ ] **Step 1: Add import and instance in `DoctorsPage.vue`**

After line 15 (`import TableRow from '@/components/ui/TableRow.vue'`) add:

```ts
import { useConfirm } from '@/composables/useConfirm'
```

After line 19 (`const errorMsg = ref('')`) add:

```ts
const { confirm } = useConfirm()
```

- [ ] **Step 2: Replace the confirm guard in `deleteDoctor()`**

Replace (lines 111–120):

```ts
async function deleteDoctor(d: Doctor) {
  if (
    !confirm(
      `Delete doctor ${d.email}? They will be permanently hidden from the list. Past duties in published schedules are kept. This cannot be undone.`,
    )
  )
    return
  await doctorService.remove(d.id)
  await load()
}
```

with:

```ts
async function deleteDoctor(d: Doctor) {
  if (
    !(await confirm({
      title: 'Delete doctor',
      message: `Delete doctor ${d.email}? They will be permanently hidden from the list. Past duties in published schedules are kept. This cannot be undone.`,
      confirmText: 'Delete',
    }))
  )
    return
  await doctorService.remove(d.id)
  await load()
}
```

- [ ] **Step 3: Update `DoctorsPage.test.ts`**

3a. Add imports at the top (after the existing `import { mount } ...` line):

```ts
import { flushPromises } from '@vue/test-utils'
import { useConfirmState } from '../composables/useConfirm'
```

3b. Add state access + reset after the `vi.mock` block (next to `const remove = vi.fn()` declarations is fine, but AFTER the `import DoctorsPage ...` line so module order stays valid):

```ts
const { request, settle } = useConfirmState()
```

In `beforeEach`, add `settle(false)` as the last statement.

3c. Replace the test at lines 71–101 with:

```ts
  it('Delete button asks for confirmation and calls remove', async () => {
    list.mockResolvedValueOnce([
      {
        id: 1,
        userId: 10,
        email: 'dr@h.com',
        username: 'dr1',
        firstName: 'Jane',
        lastName: 'Roe',
        isActive: true,
        maxMonthlyDuties: 7,
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      },
    ])
    list.mockResolvedValue([]) // reload after delete
    const wrapper = mount(DoctorsPage, { global: { plugins: [createPinia()] } })
    await wrapper.vm.$nextTick()
    await wrapper.vm.$nextTick()
    const btn = wrapper
      .findAll('button')
      .find((b) => b.text() === 'Delete')
    await btn!.trigger('click')
    await wrapper.vm.$nextTick()
    expect(request.value?.title).toBe('Delete doctor')
    expect(request.value?.message).toContain('permanently hidden')
    settle(false)
    await flushPromises()
    expect(remove).not.toHaveBeenCalled()
    await btn!.trigger('click')
    settle(true)
    await flushPromises()
    expect(remove).toHaveBeenCalledWith(1)
  })
```

- [ ] **Step 4: Verify**

Run: `pnpm typecheck && pnpm lint && pnpm --filter @oncall/web test`
Expected: all PASS.

- [ ] **Step 5: Stop and report** (no commit — user commits on main)

---

### Task 5: Migrate `UsersPage`, `HolidaysPage`, `AvailabilityPage`, `MyAvailabilityPage`

**Files:**
- Modify: `apps/web/src/pages/UsersPage.vue`
- Modify: `apps/web/src/pages/HolidaysPage.vue`
- Modify: `apps/web/src/pages/AvailabilityPage.vue`
- Modify: `apps/web/src/pages/MyAvailabilityPage.vue`

**Interfaces:**
- Consumes: `useConfirm()` from Task 1.

- [ ] **Step 1: `UsersPage.vue`**

Add after the last import (line 15, `import TableRow from '@/components/ui/TableRow.vue'`):

```ts
import { useConfirm } from '@/composables/useConfirm'
```

Add after line 18 (`const errorMsg = ref('')`):

```ts
const { confirm } = useConfirm()
```

Replace in `remove()` (line 116):

```ts
  if (!confirm(`Delete ${u.email}?`)) return
```

with:

```ts
  if (
    !(await confirm({
      title: 'Delete user',
      message: `Delete ${u.email}?`,
      confirmText: 'Delete',
    }))
  )
    return
```

- [ ] **Step 2: `HolidaysPage.vue`**

Add after the last import (line 15):

```ts
import { useConfirm } from '@/composables/useConfirm'
```

Add after line 18 (`const errorMsg = ref('')`):

```ts
const { confirm } = useConfirm()
```

Replace in `remove()` (line 83):

```ts
  if (!confirm(`Delete holiday "${x.name}" on ${x.date}?`)) return
```

with:

```ts
  if (
    !(await confirm({
      title: 'Delete holiday',
      message: `Delete holiday "${x.name}" on ${x.date}?`,
      confirmText: 'Delete',
    }))
  )
    return
```

- [ ] **Step 3: `AvailabilityPage.vue`**

Add after the last import (line 22):

```ts
import { useConfirm } from '@/composables/useConfirm'
```

Add after line 29 (`const errorMsg = ref('')`):

```ts
const { confirm } = useConfirm()
```

Replace in `remove()` (line 129):

```ts
  if (!confirm(`Delete ${x.doctorFirstName} ${x.doctorLastName}'s ${x.type} record?`)) return
```

with:

```ts
  if (
    !(await confirm({
      title: 'Delete record',
      message: `Delete ${x.doctorFirstName} ${x.doctorLastName}'s ${x.type} record?`,
      confirmText: 'Delete',
    }))
  )
    return
```

- [ ] **Step 4: `MyAvailabilityPage.vue`**

Add after the last import (line 20):

```ts
import { useConfirm } from '@/composables/useConfirm'
```

Add after line 25 (`const errorMsg = ref('')`):

```ts
const { confirm } = useConfirm()
```

Replace in `remove()` (line 114):

```ts
  if (!confirm(`Delete your ${x.type} record (${x.startDate} → ${x.endDate})?`)) return
```

with:

```ts
  if (
    !(await confirm({
      title: 'Delete record',
      message: `Delete your ${x.type} record (${x.startDate} → ${x.endDate})?`,
      confirmText: 'Delete',
    }))
  )
    return
```

- [ ] **Step 5: Confirm no native `confirm()` remains**

Run: `rg -n "confirm\(" apps/web/src --glob '!__tests__'`
Expected: only `useConfirm`-related matches (`confirm({` calls, `const { confirm } = useConfirm()`, `useConfirm.ts` itself). No bare `window.confirm` / native `confirm('...')` calls.

- [ ] **Step 6: Verify**

Run: `pnpm typecheck && pnpm lint && pnpm --filter @oncall/web test`
Expected: all PASS.

- [ ] **Step 7: Stop and report** (no commit — user commits on main)

---

### Task 6: `ConfirmDialog` tests

**Files:**
- Create: `apps/web/src/__tests__/ConfirmDialog.test.ts`

**Interfaces:**
- Consumes: `ConfirmDialog.vue` from Task 2, `useConfirm`/`useConfirmState` from Task 1.

- [ ] **Step 1: Create the test file**

```ts
import { afterEach, describe, expect, it } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import ConfirmDialog from '../components/ui/ConfirmDialog.vue'
import { useConfirm, useConfirmState } from '../composables/useConfirm'

const { request, settle } = useConfirmState()
const { confirm } = useConfirm()

function hostButtons(): HTMLButtonElement[] {
  return Array.from(document.body.querySelectorAll('button'))
}

function overlay(): HTMLElement | null {
  return document.body.querySelector('div[class*="backdrop-blur"]')
}

const wrappers: VueWrapper[] = []

function mountHost(): VueWrapper {
  const w = mount(ConfirmDialog, { attachTo: document.body })
  wrappers.push(w)
  return w
}

afterEach(() => {
  settle(false)
  wrappers.splice(0).forEach((w) => w.unmount())
  document.body.innerHTML = ''
})

describe('ConfirmDialog', () => {
  it('renders title, message, and default labels; focuses Cancel when destructive', async () => {
    mountHost()
    const p = confirm({ title: 'Delete schedule', message: 'Delete this schedule and all its duties?' })
    await flushPromises()
    await flushPromises()
    expect(document.body.textContent).toContain('Delete schedule')
    expect(document.body.textContent).toContain('Delete this schedule and all its duties?')
    expect(hostButtons().map((b) => b.textContent)).toEqual(['Cancel', 'Confirm'])
    expect(document.activeElement?.textContent).toBe('Cancel')
    settle(true)
    await expect(p).resolves.toBe(true)
  })

  it('Confirm click resolves true and clears state', async () => {
    mountHost()
    const p = confirm({ title: 'T', message: 'm' })
    await flushPromises()
    hostButtons()[1]!.click()
    await expect(p).resolves.toBe(true)
    expect(request.value).toBeNull()
    await flushPromises()
    expect(hostButtons()).toEqual([])
  })

  it('Cancel click resolves false', async () => {
    mountHost()
    const p = confirm({ title: 'T', message: 'm' })
    await flushPromises()
    hostButtons()[0]!.click()
    await expect(p).resolves.toBe(false)
  })

  it('Escape resolves false', async () => {
    mountHost()
    const p = confirm({ title: 'T', message: 'm' })
    await flushPromises()
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    await expect(p).resolves.toBe(false)
  })

  it('overlay click resolves false', async () => {
    mountHost()
    const p = confirm({ title: 'T', message: 'm' })
    await flushPromises()
    const el = overlay()
    expect(el).not.toBeNull()
    el!.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }))
    el!.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    await expect(p).resolves.toBe(false)
  })

  it('renders custom labels', async () => {
    mountHost()
    const p = confirm({ title: 'T', message: 'm', confirmText: 'Delete', cancelText: 'Keep' })
    await flushPromises()
    expect(hostButtons().map((b) => b.textContent)).toEqual(['Keep', 'Delete'])
    settle(true)
    await expect(p).resolves.toBe(true)
  })

  it('applies destructive and primary variants', async () => {
    mountHost()
    const p1 = confirm({ title: 'T', message: 'm' })
    await flushPromises()
    expect(hostButtons()[1]!.className).toContain('bg-destructive')
    expect(document.body.querySelector('span[class*="rounded-full"]')?.className).toContain('bg-destructive/10')
    settle(true)
    await expect(p1).resolves.toBe(true)
    const p2 = confirm({ title: 'T', message: 'm', variant: 'primary' })
    await flushPromises()
    expect(hostButtons()[1]!.className).toContain('bg-primary')
    expect(document.body.querySelector('span[class*="rounded-full"]')?.className).toContain('bg-primary/10')
    settle(true)
    await expect(p2).resolves.toBe(true)
  })

  it('focuses Confirm when primary', async () => {
    mountHost()
    const p = confirm({ title: 'T', message: 'm', variant: 'primary' })
    await flushPromises()
    await flushPromises()
    expect(document.activeElement?.textContent).toBe('Confirm')
    settle(true)
    await expect(p).resolves.toBe(true)
  })

  it('double settle is a no-op and a second confirm resolves the first with false', async () => {
    mountHost()
    const p1 = confirm({ title: 'A', message: 'a' })
    const p2 = confirm({ title: 'B', message: 'b' })
    await expect(p1).resolves.toBe(false)
    settle(true)
    settle(true)
    await expect(p2).resolves.toBe(true)
    expect(request.value).toBeNull()
  })
})
```

- [ ] **Step 2: Verify**

Run: `pnpm typecheck && pnpm lint && pnpm --filter @oncall/web test`
Expected: all PASS. If the overlay-click test fails because the installed `@vueuse/core` `onClickOutside` listens to a different event, adapt the dispatched event to what `onClickOutside` uses in the installed version (`pointerdown` vs `mousedown` vs `click`) — do not weaken the assertion.

- [ ] **Step 3: Stop and report** (no commit — user commits on main)

---

### Task 7: Full verification

**Files:** none (verification only)

- [ ] **Step 1: Confirm zero native confirms remain in source**

Run: `rg -n "!\s*confirm\(|window\.confirm" apps/web/src`
Expected: no matches.

- [ ] **Step 2: Full gate**

Run: `pnpm typecheck && pnpm lint && pnpm test`
Expected: all PASS. (`pnpm test` includes API tests that need a reachable `DATABASE_URL` from `apps/api/.env`; if they fail on DB connectivity — a pre-existing environment issue unrelated to this change — report it and fall back to `pnpm --filter @oncall/web test` as the evidence for this feature.)

- [ ] **Step 3: Stop and report**

Report: files created/modified, verification command outputs, and a reminder that the user commits on `main`.
