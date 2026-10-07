# Left Sidebar Navigation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the top navigation bar (`AppHeader.vue`) of `apps/web` with a left sidebar that holds every navigation option, the signed-in user, and Logout. The sidebar slides: from `xl` (1280px) up it is docked and collapses to an icon rail; below `xl` it is an off-canvas drawer opened from a menu button.

**Scope:** presentation and navigation chrome only. No route, guard, store, service, or API change. The set of nav items, their order, labels, icons, and role rules stay exactly as today.

**Tech stack:** Vue 3 `<script setup>` + TS, Tailwind CSS v4, `@vueuse/core` (already installed: `useMediaQuery`, `useStorage`, `useEventListener`), `lucide-vue-next` (verified exports: `Menu`, `X`, `PanelLeftClose`, `PanelLeftOpen`). **Zero new npm dependencies.**

## Decisions (defaults applied in this plan)

The executor implements the defaults below. The user can change a code before execution starts; the affected tasks are listed.

| Code | Decision | Default in this plan | Alternative | Affects |
|---|---|---|---|---|
| D1 | Desktop behavior | Docked sidebar, collapsible to a 4.5rem icon rail | Always an overlay drawer, on every screen size (no docked mode) | Tasks 3, 4 |
| D2 | Breakpoint for the docked sidebar | `xl` (1280px) | `lg` (1024px): leaves ~704px content, which cramps every page grid built on `lg:` (see Research R6) | Tasks 3, 4 |
| D3 | Trigger below `xl` | Slim sticky top strip (h-14): menu button + brand | Floating round menu button only, no strip | Task 4 |
| D4 | Rail state persistence | `localStorage` key `oncall:sidebar-collapsed` (UI preference only, no auth data) | In-memory only (resets on reload) | Tasks 4, 5 |
| D5 | Item grouping | Flat list, same order as today, Profile stays last in the list | Section headings (e.g. Workspace / Administration / System); needs new en + el strings | Task 3 |
| D6 | Admin manual | Update the navigation text in `manual.html` section 1.3 | Also regenerate screenshots and the PDF (they show the old top bar) | Task 6 |

Not in scope (not requested): theme or language toggles in the sidebar, clinic name display, notification badges.

## Research Findings (current state)

| Ref | Fact | Source |
|---|---|---|
| R1 | Layout chain: `router/index.ts` route `/` -> `layouts/DefaultLayout.vue` -> `components/layout/AppLayout.vue` -> `AppHeader.vue` + `<main>` slot. `DefaultLayout` also mounts `ConfirmDialog` and the `page` `<Transition>`. | `layouts/DefaultLayout.vue`, `components/layout/AppLayout.vue` |
| R2 | `AppHeader.vue` builds `navItems` per role: everyone `Home`; doctor `Duty roster`, `My availability`; admin (`isAdmin` = administrator or superadmin) `Users`, `Availability`, `Schedules`, `Holidays`, `Rules`, `Reports`; superadmin `Activity`, `Usage`; everyone `Profile` last. `isActive()` matches exact path or a `/`-prefixed child. Role `manager` gets only Home + Profile. | `AppHeader.vue:35-64` |
| R3 | `AppHeader.vue` renders the item list twice: a desktop `<nav aria-label="Main">` (`lg:flex`) and a mobile `<nav aria-label="Main (mobile)">` (`lg:hidden`, wrapping row). The user chip (Avatar + name + role Badge) and the Logout button (`aria-label="Logout"`) sit on the right. | `AppHeader.vue:67-140` |
| R4 | Only consumers: `AppLayout.vue` and `__tests__/AppHeader.test.ts`. `.nav-link` and `nav.mainMobile` are used only by `AppHeader.vue`. `.brand-tile` is also used by `LoginPage.vue` (leave it unchanged). | grep |
| R5 | Modal infrastructure exists: `composables/useModal.ts` gives body scroll lock (ref-counted), initial focus, Tab trap, and focus restore. `Dialog.vue` uses it plus window `Escape`. Dialogs and popovers use `z-50`; the header uses `z-40`. | `useModal.ts`, `Dialog.vue` |
| R6 | Content is `main.mx-auto.max-w-[1440px]` with `px-4 sm:px-6 lg:px-8`. Page grids switch on `lg:` (for example `ActivityPage` `lg:grid-cols-5`). `DutyCalendar` and the Holidays grid have `min-w-[760px]` inside `overflow-x-auto`. A 256px sidebar docked at 1024px leaves ~704px of content; at 1280px it leaves ~960px, which is what the `lg:` layouts were designed for. | `AppLayout.vue`, `DutyCalendar.vue:152-153`, `HolidaysPage.vue:178` |
| R7 | The document (window) must stay the scroll container: `useModal` locks scrolling through `document.body.style.overflow`, and `Select`/`DatePicker`/`MonthPicker` position teleported panels from `getBoundingClientRect` and close on window scroll. A docked sidebar must therefore be `position: fixed` with padding on the content, not a split-pane layout with an inner scrolling `<main>`. | `useModal.ts:27`, `Select.vue:220-230` |
| R8 | Print: `@media print` hides `header` and `.no-print`, and resets `main` padding. The sidebar and the content offset need the same treatment. `LoginPage.vue` uses an `<aside>`, so do not add a global `aside` print rule. | `style.css:561-570` |
| R9 | Tests mock `vue-router` (`RouterLink` as `<a><slot /></a>`, static `useRoute`). i18n comes from the Vitest setup `__tests__/i18n.ts` (`setTestLocale`). jsdom has no `matchMedia`, so `useMediaQuery` returns `false` (drawer mode) in tests. | `AppHeader.test.ts`, `__tests__/i18n.ts` |
| R10 | Locales: `nav.main`, `nav.mainMobile`, `nav.logout`, and the item labels in `locales/en.json` and `locales/el.json`. | `en.json:36-52`, `el.json:36-52` |
| R11 | Admin manual section 1.3 says "the top navigation bar gives you everything you need". Screenshots `docs/admin-manual/screenshots/*.png` and the PDF show the top bar. | `docs/admin-manual/manual.html:180-192` |
| R12 | Current branch is `sidebar_UI` (not `main`), clean worktree. Per `AGENTS.md`, the executor commits on this branch: one commit per task after its verification passes, adding only the task files. | `git branch --show-current` |

## Target Layout

```
>= xl, expanded (D1)                    >= xl, rail
+------------+-------------------+      +----+------------------------+
| [+] On-Call|                   |      |[+] |                        |
|------------|                   |      |----|                        |
| # Home     |   <main> page     |      | #  |   <main> page          |
| # Users    |   (max 1440px,    |      | #  |                        |
| # ...      |    centered in    |      | #  |                        |
|            |    the rest)      |      |    |                        |
|------------|                   |      |----|                        |
| (AB) Name  |                   |      |(AB)|                        |
| [Logout]   |                   |      |[->]|                        |
| << Collapse|                   |      |[>>]|                        |
+------------+-------------------+      +----+------------------------+

< xl, closed                            < xl, open (modal drawer)
+--------------------------------+      +------------+-------------------+
| [=] [+] On-Call    (sticky)    |      | [+] On-Ca X|///// backdrop ////|
|--------------------------------|      |------------|///////////////////|
|   <main> page                  |      | # Home     |///////////////////|
|                                |      | # ...      |///////////////////|
+--------------------------------+      +------------+-------------------+
```

## Global Constraints

- Repo rules: root `AGENTS.md`. No Prettier, no lint rule changes, no time estimates, no GitHub Actions changes. No non-ASCII characters in new code, comments, or docs.
- Code style: no semicolons, single quotes, 2-space indent, kebab-case files, PascalCase components, `<script setup lang="ts">`.
- Comments: only "why" comments for non-obvious contracts; short and factual.
- Accessibility: one named `<nav>`; drawer is `role="dialog"` + `aria-modal` while open below `xl`; Escape and link click close it; focus returns to the menu button; closed drawer is `invisible` (not focusable); rail labels stay in the accessibility tree (`xl:sr-only`) and show as `title` tooltips.
- Both themes must look correct (tokens only; no hardcoded palette colors). `prefers-reduced-motion` is already handled globally in `style.css`.
- Z-order: mobile strip `z-30`; drawer backdrop and sidebar `z-40` (sidebar after backdrop in DOM); dialogs and popovers stay `z-50`.
- Commands run from the repository root (`C:\Users\kalamata\Documents\GitHub\on-call-duty`); web-scoped: `pnpm --filter @oncall/web <script>`.

## Protected Contracts

| Contract | Where | Requirement |
|---|---|---|
| Nav item set, order, labels, icons, role rules | `AppHeader.vue:35-59` (moves to `AppSidebar.vue`) | Copy verbatim; tests in Task 5 pin the exact lists per role |
| Logout button has `aria-label` = `t('nav.logout')` | `AppHeader.test.ts:93,114` (migrated) | Keep the `aria-label` on the Button |
| Role badge text rendered (`t('roles.<role>')`) | `AppHeader.test.ts:113` (migrated) | Keep the Badge in the sidebar footer |
| Window is the scroll container | R7 | Sidebar is `fixed`; never make `<main>` an inner scroller |
| `.brand-tile` class | `LoginPage.vue:70,136` | Do not change it |
| Print hides chrome | R8 | `no-print` on the sidebar, mobile strip stays a `<header>`, content offset has `print:pl-0` |

## File Structure

| File | Action | Responsibility |
|---|---|---|
| `apps/web/src/style.css` | Modify | `.nav-link` becomes a full-width vertical sidebar link with an active edge bar |
| `apps/web/src/components/layout/AppBrand.vue` | Create | Brand link (tile + name + tagline); shared by sidebar and mobile strip |
| `apps/web/src/components/layout/AppSidebar.vue` | Create | Nav items, user block, Logout, rail toggle, drawer behavior |
| `apps/web/src/components/layout/AppLayout.vue` | Modify | Owns `open`/`collapsed` state, mobile strip, content offset |
| `apps/web/src/components/layout/AppHeader.vue` | Delete | Replaced by `AppSidebar.vue` |
| `apps/web/src/locales/en.json`, `el.json` | Modify | Add 4 `nav.*` keys, remove `nav.mainMobile` |
| `apps/web/src/__tests__/AppHeader.test.ts` | Delete | Migrated into `AppSidebar.test.ts` |
| `apps/web/src/__tests__/AppSidebar.test.ts` | Create | Role items, a11y, language, drawer, rail |
| `apps/web/src/__tests__/AppLayout.test.ts` | Create | Menu button opens drawer; rail preference survives remount |
| `docs/admin-manual/manual.html` | Modify | Section 1.3 wording |

---

### Task 1: Sidebar link styles

**Files:** Modify `apps/web/src/style.css`

- [ ] Replace the whole `.nav-link` block (`.nav-link`, `.nav-link:hover`, `.nav-link.is-active`, and the `@media (max-width: 1279.98px)` override, lines 245-275) with:

```css
  .nav-link {
    position: relative;
    display: flex;
    align-items: center;
    gap: 0.75rem;
    width: 100%;
    min-height: 2.5rem;
    padding: 0.5rem 0.75rem;
    border-radius: 0.75rem;
    border: 1px solid transparent;
    color: hsl(var(--muted-foreground));
    font-size: 0.875rem;
    font-weight: 500;
    white-space: nowrap;
    transition: color 0.15s ease, background-color 0.15s ease, border-color 0.15s ease, box-shadow 0.15s ease;
  }
  .nav-link:hover {
    color: hsl(var(--foreground));
    background-color: hsl(var(--foreground) / 0.05);
  }
  .nav-link.is-active {
    color: hsl(var(--primary));
    background-color: hsl(var(--primary) / 0.1);
    border-color: hsl(var(--primary) / 0.35);
    box-shadow:
      0 0 18px -6px hsl(var(--primary) / 0.55),
      inset 0 0 14px -10px hsl(var(--primary) / 1);
    font-weight: 600;
  }
  /* Edge bar on the sidebar border; offset equals the nav's px-3 padding. */
  .nav-link.is-active::before {
    content: '';
    position: absolute;
    left: -0.75rem;
    top: 0.5rem;
    bottom: 0.5rem;
    width: 3px;
    border-radius: 9999px;
    background-image: var(--brand-gradient);
  }
```

- [ ] Leave every other rule (including `.brand-tile`, `--shadow-header`, and `@media print`) unchanged.
- [ ] Verify: `pnpm --filter @oncall/web lint` passes.

### Task 2: `AppBrand.vue`

**Files:** Create `apps/web/src/components/layout/AppBrand.vue`

- [ ] Move the brand `RouterLink` markup out of `AppHeader.vue:72-88` into a component. `compact` hides the text visually at `xl` (rail) but keeps it as the link's accessible name:

```vue
<script setup lang="ts">
import { RouterLink } from 'vue-router'
import { useI18n } from 'vue-i18n'

defineProps<{ compact?: boolean }>()

const { t } = useI18n()
</script>

<template>
  <RouterLink to="/" class="group flex shrink-0 items-center gap-2.5">
    <span class="brand-tile transition-transform duration-200 group-hover:scale-105">
      <svg viewBox="0 0 24 24" class="h-4 w-4" fill="none" aria-hidden="true">
        <path
          d="M10.5 3h3v5.5H19v3h-5.5V21h-3v-9.5H5v-3h5.5z"
          fill="currentColor"
          class="text-primary-foreground"
        />
      </svg>
    </span>
    <span :class="['flex flex-col leading-none', compact && 'xl:sr-only']">
      <span class="font-display text-[15px] font-bold tracking-tight text-foreground">{{ t('app.name') }}</span>
      <span class="hud-label mt-1">{{ t('app.tagline') }}</span>
    </span>
  </RouterLink>
</template>
```

### Task 3: `AppSidebar.vue`

**Files:** Create `apps/web/src/components/layout/AppSidebar.vue`

Behavior contract:

| State | `>= xl` (docked) | `< xl` (drawer) |
|---|---|---|
| `open` | ignored (always visible); forced to `false` when the viewport grows past `xl` | `false`: `invisible -translate-x-full`; `true`: slides in, backdrop, `role="dialog"`, scroll lock, focus trap |
| `collapsed` | `true`: 4.5rem rail, labels `xl:sr-only` + `title` tooltip | ignored (labels always shown) |
| Close triggers | n/a | Escape, backdrop click, X button, any nav link or brand click |

- [ ] Create the component:

```vue
<script setup lang="ts">
import { computed, ref, watch, type Component } from 'vue'
import { RouterLink, useRoute, useRouter } from 'vue-router'
import { useEventListener, useMediaQuery } from '@vueuse/core'
import {
  BarChart3,
  CalendarCheck2,
  CalendarClock,
  CalendarDays,
  CalendarHeart,
  CalendarOff,
  Gauge,
  History,
  House,
  LogOut,
  PanelLeftClose,
  PanelLeftOpen,
  ScrollText,
  UserRound,
  Users,
  X,
} from 'lucide-vue-next'
import { useI18n } from 'vue-i18n'
import { useAuthStore } from '@/stores/auth'
import { useModal } from '@/composables/useModal'
import Avatar from '@/components/ui/Avatar.vue'
import Badge from '@/components/ui/Badge.vue'
import Button from '@/components/ui/Button.vue'
import AppBrand from './AppBrand.vue'

/**
 * Left navigation. From xl up it is docked and `collapsed` turns it into an
 * icon rail; below xl it is an off-canvas modal drawer controlled by `open`.
 */
const open = defineModel<boolean>('open', { default: false })
const collapsed = defineModel<boolean>('collapsed', { default: false })

const { t } = useI18n()
const auth = useAuthStore()
const router = useRouter()
const route = useRoute()

const panel = ref<HTMLElement | null>(null)
const isDesktop = useMediaQuery('(min-width: 1280px)')
const drawerOpen = computed(() => open.value && !isDesktop.value)

useModal(() => drawerOpen.value, panel)
useEventListener(window, 'keydown', (e: KeyboardEvent) => {
  if (e.key === 'Escape' && drawerOpen.value) close()
})
// Without this, shrinking the window back below xl would reopen a stale drawer.
watch(isDesktop, (desktop) => {
  if (desktop) close()
})

function close() {
  open.value = false
}

async function onLogout() {
  await auth.logout()
  await router.push('/login')
}

// navItems and isActive: copy verbatim from AppHeader.vue:35-64.
</script>

<template>
  <Transition
    enter-active-class="transition-opacity duration-300"
    leave-active-class="transition-opacity duration-300"
    enter-from-class="opacity-0"
    leave-to-class="opacity-0"
  >
    <div
      v-if="drawerOpen"
      class="fixed inset-0 z-40 bg-foreground/40 backdrop-blur-sm"
      aria-hidden="true"
      @click="close"
    />
  </Transition>
  <aside
    id="app-sidebar"
    ref="panel"
    :role="drawerOpen ? 'dialog' : undefined"
    :aria-modal="drawerOpen ? 'true' : undefined"
    :aria-label="drawerOpen ? t('nav.main') : undefined"
    :class="[
      'no-print fixed inset-y-0 left-0 z-40 flex w-64 flex-col border-r border-border/60 bg-background/85 shadow-header backdrop-blur-xl transition-[transform,width,visibility] duration-300 ease-out xl:visible xl:translate-x-0',
      open ? 'visible translate-x-0' : 'invisible -translate-x-full',
      collapsed && 'xl:w-[4.5rem]',
    ]"
  >
    <div :class="['flex h-16 shrink-0 items-center gap-2 border-b border-border/60 px-4', collapsed && 'xl:justify-center xl:px-0']">
      <AppBrand :compact="collapsed" @click="close" />
      <button
        type="button"
        :aria-label="t('nav.closeMenu')"
        class="ml-auto grid h-9 w-9 place-items-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground xl:hidden"
        @click="close"
      >
        <X class="h-4 w-4" aria-hidden="true" />
      </button>
    </div>

    <nav v-if="auth.isAuthenticated" :aria-label="t('nav.main')" class="flex-1 overflow-x-hidden overflow-y-auto px-3 py-4">
      <ul class="flex flex-col gap-1">
        <li v-for="item in navItems" :key="item.to">
          <RouterLink
            :to="item.to"
            :title="collapsed ? item.label : undefined"
            :class="['nav-link', { 'is-active': isActive(item.to), 'xl:justify-center xl:px-0': collapsed }]"
            @click="close"
          >
            <component :is="item.icon" class="size-4 shrink-0" aria-hidden="true" />
            <span :class="['truncate', collapsed && 'xl:sr-only']">{{ item.label }}</span>
          </RouterLink>
        </li>
      </ul>
    </nav>

    <div class="mt-auto shrink-0 space-y-2 border-t border-border/60 p-3">
      <div v-if="auth.user" :class="['flex items-center gap-3 px-2 py-1.5', collapsed && 'xl:justify-center xl:px-0']">
        <Avatar :name="`${auth.user.firstName} ${auth.user.lastName}`" size="sm" />
        <div :class="['min-w-0 flex-1', collapsed && 'xl:hidden']">
          <p class="truncate text-sm font-medium text-foreground">{{ auth.user.firstName }} {{ auth.user.lastName }}</p>
          <Badge variant="outline" class="mt-1">{{ t(`roles.${auth.user.role}`) }}</Badge>
        </div>
      </div>
      <Button
        size="sm"
        variant="outline"
        :aria-label="t('nav.logout')"
        :class="['w-full', collapsed && 'xl:px-0']"
        @click="onLogout"
      >
        <LogOut class="h-4 w-4" aria-hidden="true" />
        <span :class="collapsed && 'xl:sr-only'">{{ t('nav.logout') }}</span>
      </Button>
      <button
        type="button"
        :aria-expanded="!collapsed"
        aria-controls="app-sidebar"
        :class="[
          'hidden w-full items-center gap-2 rounded-lg px-2 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground xl:flex',
          collapsed && 'xl:justify-center',
        ]"
        @click="collapsed = !collapsed"
      >
        <component :is="collapsed ? PanelLeftOpen : PanelLeftClose" class="h-4 w-4" aria-hidden="true" />
        <span :class="collapsed && 'xl:sr-only'">{{ collapsed ? t('nav.expandSidebar') : t('nav.collapseSidebar') }}</span>
      </button>
    </div>
  </aside>
</template>
```

Notes for the executor:

- `navItems` and `isActive` are copied verbatim from `AppHeader.vue`; do not reorder or rename items (D5 default).
- `@click` on `RouterLink` / `AppBrand` falls through to the rendered `<a>` and runs alongside navigation; closing on click (not on route change) also closes the drawer when the user taps the current page.
- The rail is pure CSS (`xl:` variants keyed on `collapsed`), so the drawer always shows labels even when the rail preference is on.
- `useModal` already restores focus to the element that opened the drawer (the menu button) and releases the scroll lock when `drawerOpen` turns false, including on unmount.
- Keep class strings literal in the template so the Tailwind v4 scanner picks them up.

### Task 4: `AppLayout.vue`

**Files:** Modify `apps/web/src/components/layout/AppLayout.vue`

- [ ] Replace the file content:

```vue
<script setup lang="ts">
import { ref } from 'vue'
import { useStorage } from '@vueuse/core'
import { Menu } from 'lucide-vue-next'
import { useI18n } from 'vue-i18n'
import AppBrand from './AppBrand.vue'
import AppSidebar from './AppSidebar.vue'

const { t } = useI18n()
const sidebarOpen = ref(false)
// UI preference only (no session data), so localStorage is acceptable here.
const sidebarCollapsed = useStorage('oncall:sidebar-collapsed', false)
</script>

<template>
  <div class="min-h-screen">
    <AppSidebar v-model:open="sidebarOpen" v-model:collapsed="sidebarCollapsed" />
    <div
      :class="[
        'transition-[padding] duration-300 ease-out print:pl-0',
        sidebarCollapsed ? 'xl:pl-[4.5rem]' : 'xl:pl-64',
      ]"
    >
      <header
        class="sticky top-0 z-30 flex h-14 items-center gap-3 border-b border-border/60 bg-background/70 px-4 shadow-header backdrop-blur-xl sm:px-6 xl:hidden"
      >
        <button
          type="button"
          :aria-label="t('nav.openMenu')"
          :aria-expanded="sidebarOpen"
          aria-controls="app-sidebar"
          class="grid h-9 w-9 place-items-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          @click="sidebarOpen = true"
        >
          <Menu class="h-5 w-5" aria-hidden="true" />
        </button>
        <AppBrand />
      </header>
      <main class="mx-auto w-full max-w-[1440px] px-4 py-8 sm:px-6 lg:px-8 lg:py-10">
        <slot />
      </main>
    </div>
  </div>
</template>
```

- [ ] `DefaultLayout.vue` needs no change.
- [ ] D3 alternative only: drop the `<header>` strip and render the menu button as `fixed left-4 top-4 z-30 xl:hidden` with `shadow-card` and a `bg-background/80 backdrop-blur` surface; add `pt-16` below `xl` to `main`.

### Task 5: Cutover, strings, tests

**Files:** Delete `AppHeader.vue` and `__tests__/AppHeader.test.ts`; modify both locale files; create `__tests__/AppSidebar.test.ts` and `__tests__/AppLayout.test.ts`.

- [ ] Delete `apps/web/src/components/layout/AppHeader.vue`.
- [ ] Locales: remove `nav.mainMobile`; add after `nav.logout`:

| Key | `en.json` | `el.json` |
|---|---|---|
| `nav.openMenu` | `Open menu` | `Άνοιγμα μενού` |
| `nav.closeMenu` | `Close menu` | `Κλείσιμο μενού` |
| `nav.collapseSidebar` | `Collapse sidebar` | `Σύμπτυξη πλευρικού μενού` |
| `nav.expandSidebar` | `Expand sidebar` | `Ανάπτυξη πλευρικού μενού` |

(Greek strings are locale data, not code; the ASCII rule does not apply to them.)

- [ ] Delete `apps/web/src/__tests__/AppHeader.test.ts` and create `AppSidebar.test.ts`. Migrate its four role tests, the accessibility test, and the language test (same `vi.mock('vue-router', ...)` and `user()` helper). Changes while migrating:
  - Labels come from `wrapper.findAll('nav a').map((a) => a.text())` without the `Set` dedupe: there is now one nav, so the exact list also proves nothing renders twice.
  - Accessibility: `wrapper.findAll('nav')` has exactly one nav named `Main`; `button[aria-label="Logout"]` exists.
  - Mount with `attachTo: document.body`, and pass `'onUpdate:open'` / `'onUpdate:collapsed'` handlers that call `wrapper.setProps(...)` so the component behaves as under `v-model`. Unmount in `afterEach` (releases the `useModal` scroll lock between tests).
- [ ] Add these behavior tests to `AppSidebar.test.ts` (jsdom = drawer mode, R9):
  1. Open drawer locks page scroll and is a modal dialog: mount with `open: true`; `document.body.style.overflow === 'hidden'`; `aside` has `role="dialog"` and `aria-modal="true"`.
  2. Escape closes the drawer and releases the lock: dispatch `new KeyboardEvent('keydown', { key: 'Escape' })` on `window`; `open` prop is `false`; `document.body.style.overflow === ''`.
  3. Choosing a destination closes the drawer: click the first `nav a`; `open` prop is `false`.
  4. The rail keeps every label accessible: mount admin with `collapsed: false`; click the button whose text is `Collapse sidebar`; `collapsed` prop is `true`; that button's text is now `Expand sidebar`; `nav a` texts still equal the full admin list.
- [ ] Create `AppLayout.test.ts` (same router mock, authenticated doctor, `slots: { default: '<p>page</p>' }`, `attachTo: document.body`, `localStorage.clear()` and unmount in `afterEach`):
  1. Menu button opens the drawer: `button[aria-label="Open menu"]` has `aria-expanded="false"`; after click, `"true"` and `document.body.style.overflow === 'hidden'`.
  2. Rail preference survives a reload: click `Collapse sidebar`, `await flushPromises()`, unmount, mount again; the toggle text is `Expand sidebar`.
- [ ] Verify: `pnpm --filter @oncall/web test`, `pnpm --filter @oncall/web typecheck`, `pnpm --filter @oncall/web lint` all pass. Grep `apps/web/src` for `AppHeader` and `mainMobile`: no matches.

### Task 6: Admin manual

**Files:** Modify `docs/admin-manual/manual.html`

- [ ] Line 181: replace "When you sign in as an administrator, the top navigation bar gives you everything you need:" with "When you sign in as an administrator, the navigation sidebar on the left gives you everything you need. On a small screen, open it with the menu button at the top left; on a wide screen you can shrink it to icons with <span class=\"kbd\">Collapse sidebar</span>:".
- [ ] Do not regenerate screenshots or the PDF (D6 default). Report in the final summary that `screenshots/*.png` and `On-Call Duty - Administrator Manual.pdf` still show the top bar.

### Task 7: Smoke verification (required before reporting done)

- [ ] Full gates from the root: `pnpm typecheck`, `pnpm lint`, `pnpm test`.
- [ ] Run `pnpm dev` (API + web; needs `apps/api/.env` and a seeded DB, e.g. `pnpm db:seed:multi`). In a real browser, sign in and check:

| Check | Viewport | Expected |
|---|---|---|
| S1 | 1440x900, administrator | Sidebar docked, all 8 admin items, active item highlighted with edge bar, content not hidden under sidebar |
| S2 | 1440x900 | Collapse: rail 4.5rem, icons centered, `title` tooltip on hover, content padding follows; reload keeps the rail |
| S3 | 1280x800, schedule detail page | `DutyCalendar` fits without horizontal scroll (expanded sidebar) |
| S4 | 1024x768 and 390x844 | Top strip with menu button; drawer slides in with backdrop; Tab stays inside; Escape, backdrop, X, and link click close it; focus returns to the menu button; page does not scroll behind it |
| S5 | Resize 390 -> 1440 with drawer open | Drawer docks; no lingering backdrop or scroll lock; resizing back shows it closed |
| S6 | Any | Dark mode (Profile toggle) and Greek language render correctly in sidebar, strip, and rail |
| S7 | 1440 | Open a `Select`, `DatePicker`, and a `Dialog` on a page: they render above the sidebar and position correctly |
| S8 | 1440 | Print preview of Reports and a schedule: no sidebar, no left padding |
| S9 | doctor, superadmin, manager | Item lists match R2 |

- [ ] Report: commands run with pass/fail, the S1-S9 results, and the D6 note.
