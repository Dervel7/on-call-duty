# Web UI Restyle — "Pulse" Design Language Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restyle the entire `apps/web` Vue 3 SPA so it looks modern and vibrant for a young user base (90% of users), while keeping it effortless to use: identical routes, labels, data flows, and interactions — only presentation changes.

**Design direction ("Pulse"):** a fresh health-tech look built on the existing EKG/heartbeat brand motif. Electric-blue → violet brand gradient, pill-shaped controls, rounded cards, soft glows, playful but restrained motion, icon-supported navigation, and consistent badges/avatars/empty states. Calm surfaces + energetic accents: the color lives in CTAs, active states, progress, and the brand; everything data-bearing stays neutral and highly readable.

**Tech Stack:** Vue 3 `<script setup>` + TS, Tailwind CSS v4 (token-driven via `@theme inline`), `class-variance-authority`, `lucide-vue-next`. **Zero new npm dependencies.** No animation library, no CSS-in-JS, no component library — CSS keyframes + Tailwind utilities only.

## Global Constraints

- Repo rules: `AGENTS.md` at repository root. No Prettier, no lint rule changes, no time estimates, no GitHub Actions changes.
- Match existing code style: no semicolons, single quotes, 2-space indent, kebab-case files, PascalCase components.
- Commits: if work happens on `main` — **do NOT commit**, stop and report each task; if on a feature branch — commit after each task's verification passes.
- All commands run from the repository root (`C:\Users\kalamata\Documents\GitHub\on-call-duty`). Web-scoped commands: `pnpm --filter @oncall/web <script>`.
- No behavior changes: no route, service, store, validation, or API-call modifications. Only templates, styles, and presentational components change.
- No new code comments unless explaining a non-obvious contract (existing comment style: short, factual).
- Accessibility is not negotiable: keep every `focus-visible` ring, `role`, `aria-*` attribute, and label/`id` pairing. `prefers-reduced-motion` handling already exists globally in `style.css` — keep it working.
- Dark mode already works via the `dark` class on `<html>` (see `App.vue` + `theme.test.ts`). The restyle must look correct in **both** themes. This plan removes every hardcoded Tailwind palette color that currently breaks dark mode.
- Print styles (`@media print` in `style.css`, `.no-print` classes in `ReportsPage.vue`) must keep working.

## Protected Contracts (DO NOT break — tests or helpers depend on these)

| Contract | Where pinned | Requirement |
|---|---|---|
| `Button` default variant contains literal class `bg-primary`; destructive contains `bg-destructive` | `ConfirmDialog.test.ts:97,103` | Keep both utilities in the cva strings; the brand gradient is applied as a `background-image` layer on top (`bg-brand-gradient`), never as a replacement for `bg-primary` |
| ConfirmDialog icon circle classes contain `rounded-full` + `bg-destructive/10` / `bg-primary/10` | `ConfirmDialog.test.ts:98,104` | Keep these class names (you may add classes alongside) |
| Backdrop class `.animate-dialog-backdrop` | `AvailabilityPage.test.ts:306` | Keep the class name on Dialog/CalendarDialog backdrops |
| DutyCalendar fill-hint cell classes | `ScheduleDetailPage.test.ts:128-130,143-145` | Tests are UPDATED in Task 9 to the new token classes (`bg-success/10`, `bg-warning/10`, `bg-destructive/10`) — change component and test in the same task |
| Disabled exclusion chips have `line-through opacity-60` | `AvailabilityPage.test.ts:410-414`, `MyAvailabilityPage.test.ts:94-95` | Keep both classes on the chip buttons |
| `ProfilePage` success message has class `text-success` | `ProfilePage.test.ts:99` | Keep the `text-success` utility |
| DatePicker DOM shape: trigger button is a direct child of the component root; panel lives inside root | `pick-date.ts:11` (`btn.parentElement`) | Do not restructure DatePicker's root nesting |
| Picker attributes: `data-date`, `data-month`, `data-value`, `aria-label="Previous month"`/`"Next month"` | `pick-date.ts`, `pick-days.ts`, `pick-option.ts` | Keep all data attributes and nav button aria-labels |
| DoctorDashboard: first `<ul>` in the document is the "Who's on call" list, rows are `<li>` | `DoctorDashboard.test.ts:74` | Keep list order: Who's on call first, upcoming second; both stay `<ul>/<li>` |
| DoctorDashboard strings: `Welcome, Jane`, `4 / 7 duties this month`, `Fri 02 Jan`-style date text, `Other Doc, Second Doc` name joins | `DoctorDashboard.test.ts:63-77` | Keep the `fmt()` output rendered as text inside each row; when styling the number larger, wrap it in a `<span>` **inside** the same `<p>` so `textContent` still reads `4 / 7 duties this month` |
| AdminDashboard: ids `#s-year`, `#s-month`; button texts `Apply`, `Go to Schedules`; payment alert is `[role="alert"]` with exact texts `Payment deadline: …` | `AdminDashboard.test.ts:112-162` | Keep ids, button labels, role, and message strings |
| Dashboard/report strings: `31 / 31 days fully staffed`, `Well balanced`, `Imbalanced — review workload`, `inactive`, `No schedule for` | `AdminDashboard.test.ts`, `ReportsPage.test.ts` | Keep visible strings verbatim |
| Empty-state strings: `No published schedules yet.`, `No exclusions for the selected filters.`, `No exclusions for the selected month.`, `No activity found.`, `No upcoming on-call duties.`, `No published schedule covers this period.` | various page tests | Keep these exact strings as the `EmptyState` `title` (or leave the `<p>` where a list already renders it) |
| Loading text `Loading…` | various page tests | Keep the literal text next to the new `Spinner` |
| `Select` option buttons: `role="option"`, `data-value`, teleported to `document.body` | `Select.test.ts`, `pick-option.ts` | Keep DOM/teleport behavior; only classes change |

## Design Token Specification (single source of truth: `apps/web/src/style.css`)

### Light theme (`:root`) — replace existing values

```css
:root {
  /* surfaces */
  --background: 220 27% 96%;
  --background-tint: 220 40% 98%;
  --foreground: 228 26% 13%;
  --card: 0 0% 100%;
  --card-foreground: 228 26% 13%;
  --popover: 0 0% 100%;
  --popover-foreground: 228 26% 13%;

  /* brand — electric blue */
  --primary: 222 87% 53%;
  --primary-foreground: 0 0% 100%;

  /* scrub teal accent */
  --accent: 174 68% 42%;
  --accent-foreground: 0 0% 100%;

  /* semantic */
  --secondary: 220 25% 93%;
  --secondary-foreground: 228 26% 13%;
  --muted: 220 22% 94%;
  --muted-foreground: 224 14% 46%;
  --info: 199 85% 52%;
  --info-foreground: 0 0% 100%;
  --success: 152 70% 32%;
  --success-foreground: 0 0% 100%;
  --warning: 32 90% 36%;          /* NEW token (amber, AA-safe as text on /10 tints) */
  --warning-foreground: 0 0% 100%;
  --destructive: 350 78% 48%;
  --destructive-foreground: 0 0% 100%;

  /* lines + focus */
  --border: 220 18% 88%;
  --input: 220 16% 84%;
  --ring: 222 87% 53%;

  /* shape */
  --radius: 0.8rem;

  /* brand gradient (raw CSS var, not a color token) */
  --brand-gradient: linear-gradient(135deg, hsl(222 87% 53%) 0%, hsl(258 80% 60%) 100%);
}
```

### Dark theme (`.dark`) — replace existing values

```css
.dark {
  color-scheme: dark;

  --background: 228 24% 7%;
  --background-tint: 228 24% 9%;
  --foreground: 220 28% 94%;
  --card: 228 22% 10%;
  --card-foreground: 220 28% 94%;
  --popover: 228 22% 11%;
  --popover-foreground: 220 28% 94%;

  --primary: 222 90% 64%;
  --primary-foreground: 0 0% 100%;

  --accent: 174 65% 50%;
  --accent-foreground: 0 0% 100%;

  --secondary: 228 18% 15%;
  --secondary-foreground: 220 28% 94%;
  --muted: 228 18% 14%;
  --muted-foreground: 220 14% 64%;
  --info: 199 90% 60%;
  --info-foreground: 0 0% 100%;
  --success: 152 65% 50%;
  --success-foreground: 0 0% 100%;
  --warning: 36 95% 62%;
  --warning-foreground: 228 24% 8%;
  --destructive: 350 84% 62%;
  --destructive-foreground: 0 0% 100%;

  --border: 228 16% 19%;
  --input: 228 16% 22%;
  --ring: 222 90% 68%;

  --brand-gradient: linear-gradient(135deg, hsl(222 90% 64%) 0%, hsl(258 80% 68%) 100%);
}
```

### `@theme inline` additions/changes

```css
@theme inline {
  /* …existing color mappings, plus: */
  --color-warning: hsl(var(--warning));
  --color-warning-foreground: hsl(var(--warning-foreground));

  /* …existing radius mappings, plus: */
  --radius-xl: calc(var(--radius) + 0.2rem);

  /* shadows — update existing entries to: */
  --shadow-card: 0 1px 2px hsl(var(--foreground) / 0.04), 0 4px 12px -4px hsl(var(--foreground) / 0.08);
  --shadow-pop: 0 24px 48px -12px hsl(228 50% 20% / 0.25), 0 8px 20px -8px hsl(228 50% 20% / 0.15);
  --shadow-header: 0 1px 0 hsl(var(--border)), 0 6px 18px -10px hsl(var(--foreground) / 0.1);
}
```

### Component classes & utilities in `style.css`

Replace the existing `.nav-link` block (pill style, no underline):

```css
@layer components {
  .nav-link {
    display: inline-flex;
    align-items: center;
    gap: 0.375rem;
    white-space: nowrap;
    padding: 0.4rem 0.8rem;
    border-radius: 9999px;
    color: hsl(var(--muted-foreground));
    font-size: 0.875rem;
    font-weight: 500;
    transition: background-color 0.15s ease, color 0.15s ease;
  }
  .nav-link:hover {
    color: hsl(var(--foreground));
    background-color: hsl(var(--muted));
  }
  .nav-link.is-active {
    color: hsl(var(--primary));
    background-color: hsl(var(--primary) / 0.1);
    font-weight: 600;
  }

  .brand-tile {
    display: grid;
    place-items: center;
    height: 2.25rem;
    width: 2.25rem;
    border-radius: 0.7rem;
    background-image: var(--brand-gradient);
    box-shadow: 0 4px 14px -3px hsl(var(--primary) / 0.5), inset 0 1px 0 hsl(0 0% 100% / 0.3);
  }

  .bg-brand-gradient {
    background-image: var(--brand-gradient);
  }

  .text-brand-gradient {
    background-image: var(--brand-gradient);
    -webkit-background-clip: text;
    background-clip: text;
    color: transparent;
  }
}
```

Keep as-is: `ekg-draw`, `pulse-ring`, `dialog-pop`, `dialog-fade` keyframes, `.ekg-line`, `.pulse-ring`, `.animate-dialog-panel`, `.animate-dialog-backdrop`, page transition utilities, `@media (prefers-reduced-motion)`, `@media print`, scrollbar styling, `::selection`, `:focus-visible` base ring.

Additions to `@layer utilities`:

```css
  .animate-rise {
    animation: rise 0.45s cubic-bezier(0.16, 1, 0.3, 1) both;
  }
```

with keyframes:

```css
@keyframes rise {
  from {
    opacity: 0;
    transform: translateY(12px);
  }
  to {
    opacity: 1;
    transform: none;
  }
}
```

and a scroll-hiding utility:

```css
@layer utilities {
  .no-scrollbar {
    scrollbar-width: none;
  }
  .no-scrollbar::-webkit-scrollbar {
    display: none;
  }
}
```

Also update `body` heading styles: `h1, h2, h3… { letter-spacing: -0.02em; }`.

---

## File Structure

| File | Action | Responsibility |
|---|---|---|
| `apps/web/src/style.css` | Modify | New tokens, gradient vars, pill nav, utilities, keyframes |
| `apps/web/index.html` | Modify | Plus Jakarta Sans font, theme-color, favicon color |
| `apps/web/src/components/ui/Badge.vue` | Create | Pill status badge (7 variants + dot) |
| `apps/web/src/components/ui/Avatar.vue` | Create | Initials circle with deterministic per-name hue |
| `apps/web/src/components/ui/Spinner.vue` | Create | Animated SVG loading spinner |
| `apps/web/src/components/ui/EmptyState.vue` | Create | Icon + title + description + action slot |
| `apps/web/src/components/ui/PageHeader.vue` | Create | Standard page header (icon, title, subtitle, actions) |
| `apps/web/src/components/ui/Button.vue` | Modify | Pill radius, gradient primary, lift/glow motion |
| `apps/web/src/components/ui/Input.vue` | Modify | Rounded-lg, softer focus glow, hover border |
| `apps/web/src/components/ui/Select.vue` | Modify | Trigger + panel polish (same DOM contract) |
| `apps/web/src/components/ui/Switch.vue` | Modify | Gradient "on" track |
| `apps/web/src/components/ui/Card*.vue` | Modify | Radius/border/padding polish (5 files) |
| `apps/web/src/components/ui/Table*.vue` | Modify | Header/row polish (5 files) |
| `apps/web/src/components/ui/Dialog.vue` | Modify | rounded-2xl panel, stronger backdrop blur |
| `apps/web/src/components/ui/ConfirmDialog.vue` | Modify | Visual polish, keep pinned classes |
| `apps/web/src/components/ui/DatePicker.vue` | Modify | Day-cell polish, today/selected states |
| `apps/web/src/components/ui/MonthPicker.vue` | Modify | Month-cell polish |
| `apps/web/src/components/ui/CalendarDialog.vue` | Modify | Day-cell polish |
| `apps/web/src/components/layout/AppHeader.vue` | Modify | Pill nav with icons, mobile nav row, Avatar user chip |
| `apps/web/src/components/layout/AppLayout.vue` | Modify | Max-width content container |
| `apps/web/src/pages/LoginPage.vue` | Modify | Split-screen brand panel + glass form card |
| `apps/web/src/pages/LockedPage.vue` | Modify | Align with login styling |
| `apps/web/src/components/dashboard/DoctorDashboard.vue` | Modify | Hero card, animated progress, styled lists |
| `apps/web/src/components/dashboard/AdminDashboard.vue` | Modify | Stat cards, workload avatars + gradient bars |
| `apps/web/src/components/schedule/DutyCalendar.vue` | Modify | Token-based cell states, today ring, chips |
| `apps/web/src/pages/SchedulePreviewPage.vue` | Modify | Token counters, legend, skeleton polish |
| `apps/web/src/pages/ScheduleDetailPage.vue` | Modify | PageHeader, status Badge, layout |
| `apps/web/src/pages/UsersPage.vue` | Modify | Avatars, Badges, EmptyState, Spinner |
| `apps/web/src/pages/SchedulesPage.vue` | Modify | PageHeader, Badges, Spinner |
| `apps/web/src/pages/ScheduleRosterPage.vue` | Modify | PageHeader, EmptyState |
| `apps/web/src/pages/AvailabilityPage.vue` | Modify | PageHeader, Spinner, EmptyState (keep pinned chip classes) |
| `apps/web/src/pages/MyAvailabilityPage.vue` | Modify | PageHeader, Spinner, EmptyState (keep pinned chip classes) |
| `apps/web/src/pages/ReportsPage.vue` | Modify | Stat cards, Badges, gradient bars (keep `.no-print`) |
| `apps/web/src/pages/UsagePage.vue` | Modify | Badges, EmptyState, Spinner |
| `apps/web/src/pages/ActivityPage.vue` | Modify | Badges, EmptyState, Spinner |
| `apps/web/src/pages/ProfilePage.vue` | Modify | Card polish (keep `text-success`, structure) |
| `apps/web/src/__tests__/ScheduleDetailPage.test.ts` | Modify | Update 6 pinned fill-hint class assertions |
| `apps/web/src/__tests__/Badge.test.ts` | Create | Variant classes + dot |
| `apps/web/src/__tests__/Avatar.test.ts` | Create | Initials + deterministic hue |
| `apps/web/src/__tests__/Spinner.test.ts` | Create | Renders spinning indicator |
| `apps/web/src/__tests__/EmptyState.test.ts` | Create | Title/description/action slot |
| `apps/web/src/__tests__/PageHeader.test.ts` | Create | Title/subtitle/actions slot |

---

### Task 1: Design tokens & global stylesheet

**Files:**
- Modify: `apps/web/src/style.css`

**Steps:**

- [ ] Replace `:root` and `.dark` token blocks with the exact values in the *Design Token Specification* above (keep the existing comment style; add the `warning` pair and `--brand-gradient`).
- [ ] Update `@theme inline`: add `--color-warning`, `--color-warning-foreground`, `--radius-xl`, and the three shadow values.
- [ ] Replace `.nav-link` styles with the pill version; update `.brand-tile` (gradient background, radius `0.7rem`).
- [ ] Add `.bg-brand-gradient`, `.text-brand-gradient` component classes and the `.no-scrollbar`, `.animate-rise` utilities + `rise` keyframes exactly as specified.
- [ ] Change heading `letter-spacing` to `-0.02em`. Leave `@layer base`, print, and reduced-motion blocks otherwise untouched.
- [ ] Keep `page-enter/leave`, `ekg-line`, `pulse-ring`, `animate-dialog-panel`, `animate-dialog-backdrop` utilities unchanged.

- [ ] **Verify:** `pnpm --filter @oncall/web typecheck && pnpm --filter @oncall/web lint` → PASS. Run `pnpm --filter @oncall/web test` → all existing tests still pass (no test consumes removed values; `theme.test.ts` only toggles the `dark` class).

---

### Task 2: Typography & document head

**Files:**
- Modify: `apps/web/index.html`

**Steps:**

- [ ] Replace the IBM Plex Sans `<link>` with Plus Jakarta Sans (same preconnect lines kept):

```html
    <link
      href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&display=swap"
      rel="stylesheet"
    />
```

- [ ] Update `<meta name="theme-color">` to `#205eef` and the favicon `<rect … fill='%23205eef'/>` (new primary ≈ `hsl(222 87% 53%)`).
- [ ] In `apps/web/src/style.css`, update `--font-sans` inside `@theme inline` to `"Plus Jakarta Sans", ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif`.

- [ ] **Verify:** `pnpm --filter @oncall/web typecheck && pnpm --filter @oncall/web lint` → PASS.

---

### Task 3: New presentational primitives (+ tests)

**Files:**
- Create: `apps/web/src/components/ui/Badge.vue`, `Avatar.vue`, `Spinner.vue`, `EmptyState.vue`, `PageHeader.vue`
- Create: `apps/web/src/__tests__/Badge.test.ts`, `Avatar.test.ts`, `Spinner.test.ts`, `EmptyState.test.ts`, `PageHeader.test.ts`

**Interfaces:**

**`Badge.vue`** — cva-based pill. Props: `variant?: 'neutral' | 'primary' | 'success' | 'warning' | 'destructive' | 'accent' | 'outline'` (default `neutral`), `dot?: boolean`, `class?`. Base: `'inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium'`. Variants: neutral `bg-muted text-muted-foreground`; primary `bg-primary/10 text-primary`; success `bg-success/10 text-success`; warning `bg-warning/10 text-warning`; destructive `bg-destructive/10 text-destructive`; accent `bg-accent/10 text-accent`; outline `border border-border text-muted-foreground`. `dot` renders `<span class="size-1.5 rounded-full bg-current" aria-hidden="true" />` before the slot.

**`Avatar.vue`** — Props: `name: string` (e.g. `"Jane Roe"`), `size?: 'sm' | 'md' | 'lg'` (default `'md'` → `h-9 w-9 text-sm`; sm → `h-7 w-7 text-xs`; lg → `h-12 w-12 text-base`), `class?`. Base: `'grid shrink-0 select-none place-items-center rounded-full font-semibold'`. Initials: first letter of the first two whitespace-separated words, uppercased. Deterministic hue: `const hue = [...name].reduce((a, c) => a + c.charCodeAt(0), 0) % PALETTE.length` over this fixed 8-entry palette (dual-theme classes):

```ts
const PALETTE = [
  'bg-violet-500/15 text-violet-700 dark:text-violet-300',
  'bg-sky-500/15 text-sky-700 dark:text-sky-300',
  'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300',
  'bg-amber-500/15 text-amber-700 dark:text-amber-300',
  'bg-rose-500/15 text-rose-700 dark:text-rose-300',
  'bg-teal-500/15 text-teal-700 dark:text-teal-300',
  'bg-indigo-500/15 text-indigo-700 dark:text-indigo-300',
  'bg-fuchsia-500/15 text-fuchsia-700 dark:text-fuchsia-300',
]
```

**`Spinner.vue`** — Props: `size?: number` (default `16`), `class?`. Renders:

```html
<svg :width="size" :height="size" viewBox="0 0 24 24" fill="none" class="animate-spin" aria-hidden="true">
  <circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="3" class="opacity-20" />
  <path d="M12 2a10 10 0 0 1 10 10" stroke="currentColor" stroke-width="3" stroke-linecap="round" />
</svg>
```

**`EmptyState.vue`** — Props: `title: string`, `description?: string`, `icon?: Component` (default `Inbox` from lucide), `class?`. Template: vertical centered stack (`flex flex-col items-center gap-2 rounded-xl border border-dashed border-border/80 px-6 py-10 text-center`), icon in `grid h-12 w-12 place-items-center rounded-2xl bg-muted` with `class="h-6 w-6 text-muted-foreground"`, title `font-semibold text-foreground`, description `text-sm text-muted-foreground`, plus `<slot />` for an action button below.

**`PageHeader.vue`** — Props: `title: string`, `subtitle?: string`, `icon?: Component`, `class?`. Template:

```html
<div class="flex flex-wrap items-start justify-between gap-4">
  <div class="flex items-center gap-3">
    <span v-if="icon" class="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary">
      <component :is="icon" class="h-5 w-5" aria-hidden="true" />
    </span>
    <div>
      <h1 class="text-2xl font-bold tracking-tight text-foreground">{{ title }}</h1>
      <p v-if="subtitle" class="mt-0.5 text-sm text-muted-foreground">{{ subtitle }}</p>
    </div>
  </div>
  <div v-if="$slots.actions" class="flex flex-wrap items-center gap-2">
    <slot name="actions" />
  </div>
</div>
```

**Tests** (jsdom, follow the style of existing `Dialog.test.ts` / `Select.test.ts`):
- `Badge.test.ts`: default renders `bg-muted`; each variant maps to its class; `dot` renders an extra `span`; slot text renders.
- `Avatar.test.ts`: `name="Jane Roe"` → text `JR`; same name twice → identical palette class; different names may differ (assert deterministic function only, not a specific hue); sizes map to `h-7`/`h-9`/`h-12`.
- `Spinner.test.ts`: renders an `svg` with class `animate-spin` and honors `size` prop on width/height attributes.
- `EmptyState.test.ts`: renders `title`, `description`, default icon, and an action via slot.
- `PageHeader.test.ts`: renders title + subtitle + actions slot content; hides icon wrapper when no `icon`.

- [ ] **Verify:** `pnpm --filter @oncall/web typecheck && pnpm --filter @oncall/web lint && pnpm --filter @oncall/web test` → PASS.

---

### Task 4: Button & form control restyle

**Files:**
- Modify: `apps/web/src/components/ui/Button.vue`, `Input.vue`, `Select.vue`, `Switch.vue`

**Steps:**

- [ ] `Button.vue` — new cva strings:

```ts
const buttonVariants = cva(
  'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-full text-sm font-semibold transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:pointer-events-none disabled:opacity-50',
  {
    variants: {
      variant: {
        // bg-primary stays as a solid fallback under the gradient layer and is asserted by ConfirmDialog.test.ts
        default:
          'bg-primary text-primary-foreground bg-brand-gradient shadow-md shadow-primary/30 hover:-translate-y-0.5 hover:shadow-lg hover:shadow-primary/40 active:translate-y-0 active:shadow-md active:shadow-primary/30',
        secondary: 'bg-secondary text-secondary-foreground hover:bg-muted',
        destructive:
          'bg-destructive text-destructive-foreground shadow-md shadow-destructive/25 hover:-translate-y-0.5 hover:bg-destructive/90 active:translate-y-0',
        outline: 'border border-input bg-card hover:border-primary/40 hover:bg-primary/5 hover:text-foreground',
        accent:
          'bg-accent text-accent-foreground shadow-md shadow-accent/30 hover:-translate-y-0.5 hover:bg-accent/90 active:translate-y-0',
      },
      size: {
        default: 'h-10 px-5 py-2',
        sm: 'h-9 px-3.5',
        lg: 'h-12 px-8',
        icon: 'h-10 w-10 rounded-xl',
      },
    },
    defaultVariants: { variant: 'default', size: 'default' },
  },
)
```

Keep the `<button>` element, props API, and `cn(...)` usage identical.

- [ ] `Input.vue` — replace the class string with:

```
'flex h-10 w-full rounded-lg border border-input bg-card px-3.5 py-2 text-sm text-foreground shadow-sm transition-all placeholder:text-muted-foreground/60 hover:border-primary/35 focus-visible:border-primary focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-ring/15 disabled:opacity-50'
```

- [ ] `Select.vue` — trigger button: same treatment as Input (`rounded-lg`, `px-3.5`, `hover:border-primary/35`, `focus-visible:ring-4 focus-visible:ring-ring/15`), keep `h-10` and all ARIA/behavior. Panel: `'fixed z-50 overflow-y-auto rounded-xl border border-border/70 bg-popover p-1.5 shadow-pop …'` (keep `data-popover-layer`, `role="listbox"`, teleport). Option buttons: `h-9 … rounded-lg`; selected option: `'bg-primary/10 font-semibold text-primary'` (was `font-medium`). Do not touch script logic.
- [ ] `Switch.vue` — keep structure; when on: `'bg-primary bg-brand-gradient'` (gradient track); knob unchanged (`h-5 w-5 bg-background shadow`); keep focus ring classes.

- [ ] **Verify:** `pnpm --filter @oncall/web typecheck && pnpm --filter @oncall/web lint && pnpm --filter @oncall/web test` → PASS (ConfirmDialog/Select/MonthPicker/DatePicker/dialog-page tests must stay green — if a test asserts `font-medium` on the selected option, update that single assertion to `font-semibold` and note it in the report).

---

### Task 5: Card, Table, Dialog family restyle

**Files:**
- Modify: `Card.vue`, `CardHeader.vue`, `CardContent.vue`, `CardFooter.vue`, `CardTitle.vue`, `CardDescription.vue`, `Table.vue`, `TableHead.vue`, `TableRow.vue`, `TableCell.vue`, `TableBody.vue`, `TableHeader.vue`, `Dialog.vue`, `ConfirmDialog.vue`

**Steps:**

- [ ] `Card.vue`: `'rounded-xl border border-border/70 bg-card text-card-foreground shadow-card'`.
- [ ] `CardHeader.vue`: `'flex flex-col space-y-1.5 p-5'`; `CardContent.vue`: `'p-5 pt-0'`; `CardFooter.vue`: `'flex items-center p-5 pt-0'`. `CardTitle.vue`: `'font-semibold leading-none tracking-tight'` (unchanged); `CardDescription.vue` unchanged.
- [ ] `TableHead.vue`: `'h-11 px-3 text-left text-[11px] font-semibold uppercase tracking-wider text-muted-foreground'`.
- [ ] `TableRow.vue`: `'border-b border-border/60 transition-colors hover:bg-primary/[0.04]'`.
- [ ] `Table.vue` wrapper + `TableCell` + `TableHeader` + `TableBody`: unchanged (only the above two files carry visual weight).
- [ ] `Dialog.vue`: panel → `'animate-dialog-panel relative z-10 w-full max-w-md rounded-2xl border border-border/70 bg-card p-6 shadow-pop'`; backdrop → `'animate-dialog-backdrop absolute inset-0 bg-foreground/45 backdrop-blur-md'` (keep both animation class names and all script logic).
- [ ] `ConfirmDialog.vue`: keep `rounded-full` + `bg-primary/10` / `bg-destructive/10` on the icon circle (add `ring-1 ring-inset ring-primary/20` / `ring-destructive/20` if desired); buttons already pick up new Button styles.

- [ ] **Verify:** `pnpm --filter @oncall/web typecheck && pnpm --filter @oncall/web lint && pnpm --filter @oncall/web test` → PASS.

---

### Task 6: Pickers restyle (visual only)

**Files:**
- Modify: `apps/web/src/components/ui/DatePicker.vue`, `MonthPicker.vue`, `CalendarDialog.vue`

**Steps (identical treatment across all three calendars):**

- [ ] Triggers: match the new Input treatment (`rounded-lg`, `hover:border-primary/35`, `focus-visible:ring-4 focus-visible:ring-ring/15`).
- [ ] Panels: `'rounded-xl border border-border/70 bg-popover p-3 shadow-pop'`.
- [ ] Day/month cells: `rounded-lg` (was `rounded-md`); selected: `'bg-primary bg-brand-gradient font-semibold text-primary-foreground hover:opacity-90'` — **keep the literal `bg-primary` class**; today (DatePicker): keep `ring-1 ring-inset ring-ring/40 font-semibold`; weekend/hover states unchanged.
- [ ] "Today" link (DatePicker): `'rounded-full px-3 py-1 text-sm font-semibold text-primary transition-colors hover:bg-primary/10 …'`.
- [ ] **Do NOT change**: DOM structure/nesting (pick-date contract), `data-date`/`data-month`/`data-year` attributes, nav `aria-label`s, `data-popover-layer`, Escape/click-outside behavior, or any script logic.

- [ ] **Verify:** `pnpm --filter @oncall/web typecheck && pnpm --filter @oncall/web lint && pnpm --filter @oncall/web test` → PASS (DatePicker/MonthPicker/CalendarDialog tests drive by data attributes and must stay green).

---

### Task 7: App shell — header, nav, layout

**Files:**
- Modify: `apps/web/src/components/layout/AppHeader.vue`, `AppLayout.vue`

**Steps:**

- [ ] `AppHeader.vue` script: extend `navItems` entries with an `icon` component (named imports from `lucide-vue-next`):

| Item | Icon |
|---|---|
| Home | `House` |
| Duty roster | `CalendarCheck2` |
| My availability | `CalendarClock` |
| Users | `Users` |
| Availability | `CalendarOff` |
| Schedules | `CalendarDays` |
| Reports | `BarChart3` |
| Activity | `History` |
| Usage | `Gauge` |
| Profile | `UserRound` |

(If `House` is not exported by the installed lucide version, use `Home` — both exist in `lucide-vue-next@0.460`.) Keep `isActive()` and the logout flow untouched.

- [ ] Template: header shell → `'sticky top-0 z-40 w-full border-b border-border/70 bg-background/80 shadow-header backdrop-blur-xl'`. Inner bar: `'mx-auto flex h-16 w-full max-w-[1440px] items-center gap-4 px-4 sm:px-6 lg:px-8'`.
- [ ] Desktop nav: `'hidden md:flex flex-1 items-center gap-1 overflow-x-auto no-scrollbar'`; each link keeps `['nav-link', { 'is-active': … }]` and renders `<component :is="item.icon" class="size-4 shrink-0" aria-hidden="true" />` + label.
- [ ] Mobile nav: second row inside `<header>`, `'md:hidden flex items-center gap-1 overflow-x-auto no-scrollbar border-t border-border/60 px-3 py-2'`, same links (icons + labels).
- [ ] User chip: replace the initials `<span>` with `<Avatar :name="…" size="sm" />`, keep name text, replace the role `<span>` with `<Badge variant="outline">{{ auth.user.role }}</Badge>`. Keep the logout `Button` (new styles apply automatically).
- [ ] `AppLayout.vue` main: `'mx-auto w-full max-w-[1440px] px-4 py-8 sm:px-6 lg:px-8 lg:py-10'`.

- [ ] **Verify:** `pnpm --filter @oncall/web typecheck && pnpm --filter @oncall/web lint && pnpm --filter @oncall/web test` → PASS (`guard.test.ts`, `main.test.ts`, page tests mount pages, not the header — confirm no test queries the removed initials span; `HomePage.test.ts` and dashboard tests don't assert header markup).

---

### Task 8: Login & Locked pages

**Files:**
- Modify: `apps/web/src/pages/LoginPage.vue`, `LockedPage.vue`

**Steps:**

- [ ] `LoginPage.vue` — restructure template only (script untouched; keep ids `identifier`/`password`, `loginSchema` flow, error `role="alert"`, submit label logic):

```html
<div class="grid min-h-screen lg:grid-cols-2">
  <!-- Brand panel: desktop only -->
  <aside class="relative hidden flex-col justify-between overflow-hidden bg-foreground p-12 lg:flex">
    <div class="pointer-events-none absolute inset-0 opacity-90 bg-brand-gradient" />
    <div class="pointer-events-none absolute -bottom-24 -left-24 h-96 w-96 rounded-full bg-white/10 blur-3xl" />
    <div class="relative text-primary-foreground">
      <span class="brand-tile">…cross svg…</span>
      <h1 class="mt-8 max-w-md text-4xl font-extrabold leading-tight tracking-tight">
        Fair on-call rosters. Zero spreadsheet chaos.
      </h1>
      <ul class="mt-8 flex flex-col gap-4 text-sm font-medium">
        <li class="flex items-center gap-3"><CalendarCheck2 class="size-5" /> Balanced weekends, automatically</li>
        <li class="flex items-center gap-3"><ShieldCheck class="size-5" /> Hospital rules enforced for you</li>
        <li class="flex items-center gap-3"><BellRing class="size-5" /> Always know when you're on call</li>
      </ul>
    </div>
    <svg class="relative h-24 w-full text-white/25" …keep existing EKG path + .ekg-line… />
  </aside>
  <!-- Form side -->
  <div class="relative grid place-items-center overflow-hidden px-6 py-12">
    <div class="pointer-events-none absolute inset-0 -z-10 bg-gradient-to-br from-primary/10 via-background-tint to-accent/10" />
    <Card class="w-full max-w-md rounded-2xl border-border/60 bg-card/90 shadow-pop backdrop-blur">
      …keep the existing brand tile + pulse ring, CardHeader, form fields, error, submit button…
    </Card>
  </div>
</div>
```

Icon imports: `CalendarCheck2`, `ShieldCheck`, `BellRing`. Keep the mobile-visible brand tile + `pulse-ring` block inside the card exactly as today.

- [ ] `LockedPage.vue`: keep structure; add a `Lock` lucide icon in a `'grid h-12 w-12 place-items-center rounded-2xl bg-muted text-muted-foreground'` circle above the title inside the header; card gets `rounded-2xl`. Text strings unchanged.

- [ ] **Verify:** `pnpm --filter @oncall/web typecheck && pnpm --filter @oncall/web lint && pnpm --filter @oncall/web test` → PASS (`LoginPage.test.ts` / `LockedPage.test.ts` assert behavior and text, not layout; they must stay green unmodified).

---

### Task 9: DutyCalendar + schedule pages (the core surface)

**Files:**
- Modify: `apps/web/src/components/schedule/DutyCalendar.vue`, `apps/web/src/pages/SchedulePreviewPage.vue`, `apps/web/src/pages/ScheduleDetailPage.vue`, `apps/web/src/__tests__/ScheduleDetailPage.test.ts`

**DutyCalendar steps:**

- [ ] Script: add `const todayIso = new Date().toISOString().slice(0, 10)`; add `'isToday'` to the `Cell` interface (`js.getDate() === …` — compute `day.date === todayIso`). Keep everything else identical.
- [ ] Replace `cellBg()` mapping (this is the dark-mode fix):

```
blank            → 'border-transparent bg-transparent'
full (n >= SLOTS) → 'border-success/25 bg-success/10'
partial (n === 1) → 'border-warning/30 bg-warning/10'
empty (n === 0)   → 'border-destructive/25 bg-destructive/10'
conflict (no hints) → 'border-destructive/40 bg-destructive/5'
weekend           → 'border-border/60 bg-muted/40'
weekday           → 'border-border/60 bg-card'
```

- [ ] Grid markup: wrapper → `'min-w-[760px] rounded-xl border border-border/70 bg-card p-2'`; weekday label row + day grid → `grid grid-cols-7 gap-1.5` (drop the `gap-px bg-border` hairline grid). Weekday labels: `'rounded-lg bg-muted/60 px-2 py-1.5 text-center text-[11px] font-semibold uppercase tracking-wider text-muted-foreground'`.
- [ ] Day cell base class: `'min-h-[112px] rounded-lg border p-2 transition-colors'` + the state class from `cellBg()`. Day number: `text-xs font-bold`; weekend day numbers get `text-primary`. Today: render the number inside `'grid h-6 w-6 place-items-center rounded-full bg-primary text-[11px] font-bold text-primary-foreground'`. Keep the `WE` badge markup (it already matches the new style).
- [ ] Read-only slot text: wrap in `'inline-flex max-w-full items-center rounded-md bg-muted px-1.5 py-0.5'` chip; keep `title="slotFull"` and the `Lastname F.` label format. Keep `Unfillable` / `No doctor` (`text-destructive`) and change `1 of 2` from `text-amber-600` to `text-warning`.
- [ ] Keep the in-cell `Select` exactly as-is (it already works at this density).

**SchedulePreviewPage steps:**

- [ ] Replace the hardcoded counter colors: `text-green-700` → `text-success`, `text-amber-700` → `text-warning`, `text-red-700` → `text-destructive`; the error banner `text-red-700` → `text-destructive`.
- [ ] `STATUS_TONE` map: keep the object in script; ensure its class values only use tokens (`border-success/30 bg-success/10`, `border-warning/30 bg-warning/10`, `border-destructive/30 bg-destructive/10`, `border-border bg-muted/50` — adapt to whatever tones already exist, replacing raw palette classes with token equivalents).
- [ ] Skeleton: keep `animate-pulse` blocks; change cell/bg classes to `rounded-lg bg-muted` for the new gap grid.
- [ ] Keep the "Review the proposed roster…" subtitle, Back/Generate buttons, and all logic.

**ScheduleDetailPage steps:**

- [ ] Replace the `<h1>` + status `<span>` block with `PageHeader` (`:icon="CalendarDays"`, `:title="MONTHS[…] + ' ' + year"`) and move the status pill into the actions area **before** the action buttons: `<Badge :variant="isPublished ? 'success' : 'neutral'" dot>{{ isPublished ? 'Published' : 'Draft' }}</Badge>`. Keep the publish/revert/delete buttons and the locked-note paragraph verbatim.

**Test update (same task, mandatory):**

- [ ] `apps/web/src/__tests__/ScheduleDetailPage.test.ts` lines ~128-130 and ~143-145: replace `bg-red-100` → `bg-destructive/10`, `bg-green-100` → `bg-success/10`, `bg-amber-100` → `bg-warning/10` (6 assertions total). Do not change anything else in the file.

- [ ] **Verify:** `pnpm --filter @oncall/web typecheck && pnpm --filter @oncall/web lint && pnpm --filter @oncall/web test` → PASS (includes `SchedulePreviewPage.test.ts` and the updated `ScheduleDetailPage.test.ts`).

---

### Task 10: Dashboards

**Files:**
- Modify: `apps/web/src/components/dashboard/DoctorDashboard.vue`, `AdminDashboard.vue`

**DoctorDashboard steps (keep ALL pinned strings and the ul/li order):**

- [ ] First card → hero: add `'relative overflow-hidden'` to Card and an inner decorative `'pointer-events-none absolute -right-16 -top-16 h-48 w-48 rounded-full bg-brand-gradient opacity-10 blur-3xl'` div. Keep `CardTitle` text exactly `Welcome, {{ stats.doctor.firstName }}` (keep the `Activity` icon).
- [ ] Duty progress: keep ONE `<p>` containing `{{ stats.currentMonth.duties }} / {{ stats.currentMonth.maxMonthly }} duties this month` — wrap the leading `X / Y` in `<span class="text-3xl font-bold tracking-tight">` and `duties this month` in `<span class="text-sm font-medium text-muted-foreground">`. Bar: track `'h-3 w-full rounded-full bg-muted'`, fill `'h-3 rounded-full bg-brand-gradient transition-[width] duration-700'`. Add a right-aligned percentage `<span class="text-xs font-semibold text-muted-foreground tabular-nums">{{ Math.round(progress) }}%</span>` on the same row.
- [ ] Weekend line: `<Badge variant="outline">Weekend {{ stats.currentMonth.weekend }}</Badge>` (text stays `Weekend n`).
- [ ] "Who's on call" list (first `<ul>`): each `<li>` gets `'flex items-center justify-between gap-3 rounded-xl px-3 py-2.5 transition-colors hover:bg-muted/50'`; the mine-highlight becomes `'bg-primary/10 ring-1 ring-inset ring-primary/20'` (keep rounded). Keep the `{{ fmt(e.date) }} · {{ e.names.join(', ') }}` text node intact; replace the `You` span with `<Badge variant="accent">You</Badge>` and `Weekend` span with `<Badge variant="neutral">Weekend</Badge>` (texts unchanged).
- [ ] "My upcoming duties" list: same row treatment; keep `fmt(u.dutyDate)` text; `Weekend` → Badge.
- [ ] Empty strings stay verbatim (`No published schedule covers this period.`, `No upcoming on-call duties.`, `This month's schedule isn't published yet.`).

**AdminDashboard steps:**

- [ ] Payment alert: keep `role="alert"` + exact texts; restyle to `'flex items-center gap-3 rounded-xl border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm font-semibold text-destructive'` + a `TriangleAlert class="size-5 shrink-0"` icon.
- [ ] Filters row: unchanged structurally (ids `s-year`/`s-month`, `Apply` button).
- [ ] Coverage card: big number treatment — same single-`<p>` trick: `31 / 31` in `<span class="text-3xl font-bold tracking-tight tabular-nums">` + `days fully staffed` in a muted span. Add a coverage bar: track `'h-2.5 w-full rounded-full bg-muted'`, fill `'h-2.5 rounded-full bg-brand-gradient'`, width = `filled / daysInMonth * 100%`. Keep gaps text (`text-destructive`).
- [ ] Fairness card: keep spread number; swap the computed `fairnessBadge.class` values to `'bg-success/10 text-success'` (balanced) and `'bg-destructive/10 text-destructive'` (imbalanced), `'bg-muted text-muted-foreground'` (N/A) — or replace the span with `<Badge>` and map to variants; keep texts `Well balanced` / `Imbalanced — review workload` / `N/A`.
- [ ] Workload table: doctor cell → `<Avatar :name="`${w.firstName} ${w.lastName}`" size="sm" />` + name in a `'flex items-center gap-2.5'` wrapper; keep the `inactive` markup (may become `<Badge variant="neutral">inactive</Badge>` — text unchanged). Bar: track `'h-2.5 w-24 rounded-full bg-muted'`, fill `'h-2.5 rounded-full bg-brand-gradient'`. Keep `Weekend`/`Cap` columns as plain text.
- [ ] Keep the `No schedule for …` empty card and `Go to Schedules` button.

- [ ] **Verify:** `pnpm --filter @oncall/web typecheck && pnpm --filter @oncall/web lint && pnpm --filter @oncall/web test` → PASS (`DoctorDashboard.test.ts`, `AdminDashboard.test.ts`, `HomePage.test.ts` untouched and green).

---

### Task 11: List & form pages pass

**Files:**
- Modify: `UsersPage.vue`, `SchedulesPage.vue`, `ScheduleRosterPage.vue`, `AvailabilityPage.vue`, `MyAvailabilityPage.vue`, `ReportsPage.vue`, `UsagePage.vue`, `ActivityPage.vue`, `ProfilePage.vue`

**Shared pattern for every page in this task:**

- Page header block (`<h1>` + primary action button) → `PageHeader` with icon (mapping below) and the button moved into `#actions`. Subtitles (new, short, human): Users → "Manage doctor accounts and duty caps"; Schedules → "Generate, review, and publish monthly rosters"; Duty roster → "Published on-call schedules"; Availability → "Excluded days per doctor"; My availability → "Days you can't take duty"; Reports → "Monthly duty report and exports"; Usage → "Billing, generations, and alerts"; Activity → "Audit trail of user actions".
- `<p v-if="loading">Loading…</p>` → `<div v-if="loading" class="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground"><Spinner :size="16" /> Loading…</div>` (keep the literal `Loading…`).
- Bare empty `<p>` (when it is the only content of a section) → `<EmptyState :title="…exact existing string…" />` with contextual icon. If a page has no test pinning the string, you may add a one-line `description`.
- Status/role/state `<span>` pills → `<Badge>` with dot where it signals state.
- Keep every `role="alert"`, id, dialog structure, form field order, and button label from the current code.

**Per page:**

- [ ] `UsersPage.vue`: icon `Users`. Table: name cell → `Avatar` + name (`flex items-center gap-2.5`); role → `Badge variant="outline"`; status → `Badge :variant="u.isActive ? 'success' : 'neutral'" dot` with text `active`/`disabled`; inactive row wash `'bg-destructive/10'` → `'bg-destructive/[0.06]'`. Keep dialogs (they pick up Task 4/5 styles) and all flows.
- [ ] `SchedulesPage.vue`: icon `CalendarDays`. Status → `Badge :variant="s.status === 'published' ? 'success' : 'neutral'" dot` (text `Published`/`Draft`). Keep filter row + generate dialog.
- [ ] `ScheduleRosterPage.vue`: icon `CalendarCheck2`; empty string → EmptyState (`CalendarOff` icon); table rows keep `View` buttons.
- [ ] `AvailabilityPage.vue`: icon `CalendarOff`. Keep the grouped accordion exactly (button, chevron rotation, day chips with **`line-through opacity-60`** preserved); empty string → EmptyState. Loading → Spinner.
- [ ] `MyAvailabilityPage.vue`: icon `CalendarClock`. Same chip contract (`line-through opacity-60`); empty string → EmptyState; loading → Spinner.
- [ ] `ReportsPage.vue`: icon `BarChart3`, subtitle added. **Keep every `no-print` class.** Coverage/Fairness cards: same treatment as AdminDashboard (big-number spans + coverage bar + Badge). Roster table: `Weekend` → `Badge variant="primary"`, `Gap day`/`1 of 2` → `Badge variant="destructive"` / `variant="warning"`, `Unassigned` italic stays. Workload bars → `bg-brand-gradient` fill. Keep `Export CSV` / `Print / Save as PDF` buttons and `Generated …` line.
- [ ] `UsagePage.vue`: icon `Gauge`. Billing `Locked`/`Active` → `Badge :variant="billing.locked ? 'destructive' : 'success'" dot`; alerts State → `Badge :variant="a.resolvedAt ? 'neutral' : 'warning'"` with text `resolved`/`open`. Keep DatePicker + save flow.
- [ ] `ActivityPage.vue`: icon `History`. Action chip → `Badge variant="primary"`; role chip → `Badge variant="outline"`; empty string → EmptyState (`Inbox` icon); keep filter Card grid and pagination buttons.
- [ ] `ProfilePage.vue`: no PageHeader (narrow column stays); cards pick up Task 5 styles; Appearance card: add `Moon`/`Sun` icons? — **no**, keep it minimal: Label + description + existing `Switch`. Keep `text-success` on the success message (pinned) and all form logic.

- [ ] **Verify:** `pnpm --filter @oncall/web typecheck && pnpm --filter @oncall/web lint && pnpm --filter @oncall/web test` → PASS. All page tests (`UsersPage`, `SchedulesPage`, `AvailabilityPage`, `MyAvailabilityPage`, `ReportsPage`, `UsagePage`, `ActivityPage`, `ProfilePage`) must pass **unmodified** — if one fails, you changed behavior or a pinned string/class; fix the component, not the test.

---

### Task 12: Motion polish pass

**Files:**
- Modify: the page files from Tasks 8-11 (template-only additions)

**Steps:**

- [ ] Add `class="animate-rise"` to the top-level content wrapper of each dashboard card grid and page content column (`<div class="flex flex-col gap-4 animate-rise">`). Stagger sibling cards with `[animation-delay:60ms]`, `[animation-delay:120ms]` (first card no delay) ONLY on the two dashboard grids and the Reports stat grid — everywhere else a single `animate-rise` on the container.
- [ ] Do not add motion to: tables (rows), the DutyCalendar grid, pickers, or anything inside dialogs beyond existing dialog-pop.
- [ ] Reduced-motion is already globally neutralized (`style.css`) — no extra work, but spot-check.

- [ ] **Verify:** `pnpm --filter @oncall/web typecheck && pnpm --filter @oncall/web lint && pnpm --filter @oncall/web test` → PASS.

---

### Task 13: Final verification & visual smoke test

- [ ] Run from root: `pnpm typecheck && pnpm lint` (covers all packages).
- [ ] Run: `pnpm --filter @oncall/web test` → all green.
- [ ] Start the dev stack: `pnpm dev` (needs `apps/api/.env` with `DATABASE_URL`; if the API can't start, run `pnpm --filter @oncall/web dev` and note it).
- [ ] Browser verification (use the browser tool; capture screenshots):
  1. `/login` — desktop 1440px and mobile 390px: brand panel shows on desktop only; EKG animates; form usable.
  2. Sign in as admin (seed credentials) → Home: payment banner, stat cards, workload avatars/bars — **light AND dark** (toggle via Profile → Appearance).
  3. `/schedules` → open a schedule detail: calendar cell tints (green/amber/red tokens), today ring, WE badges; edit a slot via the pill Select.
  4. Schedule preview page (`/schedules/preview?...` via New schedule flow): counters, legend, skeleton on reload.
  5. `/users`, `/availability`, `/reports`, `/usage`, `/activity` — header pill nav with icons, badges, empty/loading states; mobile 390px: second nav row scrolls horizontally, no overflow.
  6. Sign in as doctor → Home: hero progress card, "Who's on call" rows with `You` highlight; `/my-availability` chips.
  7. Reports print preview: header/buttons hidden, tables readable.
  8. Keyboard check: Tab through login → visible focus rings on every control.
- [ ] Contrast sanity: primary on white ≥ 4.5:1 as text (badge text on /10 tints), destructive/warning/success badge text legible in both themes.
- [ ] Check `docs/admin-manual/` for references to specific visual details (colors, "IBM Plex", button shapes); update only if it names something this plan changed.
- [ ] Confirm no dead CSS remains in `style.css` (removed values replaced, no duplicated blocks) and no leftover `bg-red-100`/`bg-green-100`/`bg-amber-100`/`text-red-700`/`text-green-700`/`text-amber-700`/`text-amber-600` anywhere in `apps/web/src`.

**Final report:** files created/modified, test results, screenshots (light/dark/mobile), any deviation from the plan with reason, and commit list (or "user commits — on main" if applicable).

---

## Out of Scope (explicitly do NOT do)

- No new npm dependencies, no animation/chart/icon libraries.
- No toast/notification system, no new routes, no IA changes, no dark-mode toggle in the header (it lives in Profile, unchanged).
- No changes to `apps/api`, `packages/*`, `database/`, or any test beyond `ScheduleDetailPage.test.ts` (+ the five new component test files).
- No refactors of services/stores/composables; no renaming of components or props used by pages.
- No Prettier, no lint config edits, no format scripts.
