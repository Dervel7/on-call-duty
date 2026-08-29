# Custom Confirm Dialog — Design

Date: 2026-08-18
Status: Approved

## Problem

All destructive or irreversible actions in the web app use the browser's native
`confirm()` popup. There are 9 call sites across 6 pages:

| Page | Actions |
|---|---|
| `ScheduleDetailPage.vue` | publish, revert to draft, delete schedule, remove duty |
| `DoctorsPage.vue` | delete doctor |
| `UsersPage.vue` | delete user |
| `AvailabilityPage.vue` | delete record |
| `MyAvailabilityPage.vue` | delete record |
| `HolidaysPage.vue` | delete holiday |

The native popup is visually jarring, cannot be styled, blocks the JS thread, and
does not match the application's design language.

## Decisions

- Replace **all 9** call sites — no native `confirm()` remains in the app.
- **Promise-based composable** (`useConfirm()`) with a single global host mounted
  in `DefaultLayout`. Call sites keep their guard-style control flow
  (`if (!(await confirm(...))) return`).
- The host **reuses `Dialog.vue`** internally, so overlay, blur, card, Escape,
  click-outside, and scroll-lock behavior stay identical to the rest of the app.
- Two variants: `destructive` (default, red) and `primary` (positive actions).
- The least destructive button receives autofocus.

## 1. Composable — `apps/web/src/composables/useConfirm.ts`

```ts
export interface ConfirmOptions {
  title: string
  message: string
  confirmText?: string   // default 'Confirm'
  cancelText?: string    // default 'Cancel'
  variant?: 'destructive' | 'primary'  // default 'destructive'
}

export function useConfirm(): { confirm: (options: ConfirmOptions) => Promise<boolean> }
```

Module-level reactive state holds the current request and its resolver:

```ts
interface ConfirmState extends ConfirmOptions {
  resolve: (value: boolean) => void
}

const state = ref<ConfirmState | null>(null)
```

`confirm(options)` sets the state and returns a Promise. A module-level
`resolve(value)` helper resolves the pending promise and sets the state to
`null`, which unmounts the dialog. Any later `resolve` call is a no-op because
the state is already `null` — double resolution (e.g. Escape racing a button
click) cannot occur.

The host component imports the same module state. No provide/inject is needed —
the app is an SPA with exactly one host.

## 2. Host — `apps/web/src/components/ui/ConfirmDialog.vue`

Mounted once in `DefaultLayout.vue` (every page using `confirm()` renders inside
it). Renders nothing while state is `null`.

Structure:

- Wraps the existing `Dialog.vue` (`:title` bound to the request title, footer
  slot overridden).
- Body: `TriangleAlert` icon (`lucide-vue-next`) inside a tinted circle —
  `bg-destructive/10 text-destructive` or `bg-primary/10 text-primary` —
  followed by the message in `text-sm text-muted-foreground`.
- Footer: Cancel button (`variant="outline"`) + Confirm button
  (`variant="destructive"` or `"default"`).
- Confirm click → `resolve(true)` then close. Cancel click, Escape, overlay
  click, and Dialog `update:open` → `resolve(false)`.
- Autofocus on open: Cancel for `destructive` requests, Confirm for `primary`.
- If a second `confirm()` is invoked while one is pending, the first promise
  resolves `false` before the new request replaces it (cannot happen with one
  host and single-threaded UI, but the behavior is defined).

## 3. Call-site migration

All target handlers are already `async`. Each native call becomes:

```ts
const { confirm } = useConfirm()

if (!(await confirm({
  title: 'Delete schedule',
  message: 'Delete this schedule and all its duties?',
  confirmText: 'Delete',
}))) return
```

Variant mapping:

| Call site | Title | Variant | confirmText |
|---|---|---|---|
| ScheduleDetailPage — delete schedule | Delete schedule | destructive | Delete |
| ScheduleDetailPage — remove duty | Remove duty | destructive | Remove |
| ScheduleDetailPage — publish | Publish schedule | primary | Publish |
| ScheduleDetailPage — revert to draft | Revert to draft | primary | Revert |
| DoctorsPage — delete doctor | Delete doctor | destructive | Delete |
| UsersPage — delete user | Delete user | destructive | Delete |
| AvailabilityPage — delete record | Delete record | destructive | Delete |
| MyAvailabilityPage — delete record | Delete record | destructive | Delete |
| HolidaysPage — delete holiday | Delete holiday | destructive | Delete |

Existing confirmation messages are preserved verbatim as `message`; short
imperative labels become `title`.

## 4. Accessibility

- Focus is moved into the dialog on open (autofocus safe button) and the dialog
  is announced via its heading, matching `Dialog.vue` behavior.
- Keyboard: Escape cancels, Enter activates the focused button (native button
  behavior, no extra code).
- The least destructive action is focused first: Cancel for destructive
  requests, Confirm for primary.

## 5. Testing

One test file: `apps/web/src/components/ui/__tests__/ConfirmDialog.test.ts`
(jsdom + `@vue/test-utils`, attached to `document.body` for Teleport):

- Renders title, message, and default button labels.
- Confirm click resolves `true`; Cancel, Escape, and overlay click resolve
  `false`.
- Custom `confirmText`/`cancelText` render.
- Both variants apply the correct button variant and icon tint.
- Double resolution is guarded (resolve called twice does not throw).
- State clears after resolution (dialog unmounts).

One page test currently stubs `window.confirm` (`DoctorsPage.test.ts:87`); it is
updated to resolve the confirm through the composable state instead.

## Limitations

- The dialog is app-modal (one pending confirm at a time); concurrent confirms
  resolve first-in `false`. Accepted for this app.
- No focus trap inside `Dialog.vue` today; autofocus alone covers the confirm
  use case. A full trap would be a separate improvement to `Dialog.vue`.
