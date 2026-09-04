# Inline create from pickers + friction blockers — design

- **Item:** INS-091 (filed with this spec)
- **Date:** 2026-09-04
- **Status:** done 2026-09-04 (INS-091); plan at
  [../plans/2026-09-04-inline-create-and-friction.md](../plans/2026-09-04-inline-create-and-friction.md)
- **Platforms:** `apps/web` and `apps/mobile`, landing together with one shared contract

## 0. Problem

Creating an inspection today needs four entities to exist first: two companies, a product and a
purchase order. Every one of them is picked from a dropdown that offers no way to create what is
missing, so the user leaves the form, walks up to four other screens, and comes back with the form's
typed state gone. The empty-state copy makes the detour explicit:

- Web `apps/web/app/(console)/inspections/new/create-form.tsx:61-63` replaces the whole form with
  "Create two companies (the client and the factory), a product and a PO first, then return here."
- Mobile `apps/mobile/src/app/inspections/new.tsx:205-215` says the same and adds "in the console",
  and `apps/mobile/src/app/inspections/new.tsx:277` tells the user to build a preset "in the console"
  although `/presets/new` exists on the phone.
- Mobile has **no company create at all** (`/companies` is a read-only directory; there is no
  `/companies/new`), so the PO form is a hard dead end on a fresh org.

Secondary friction found in the same audit and fixed here because it sits on the same screens:

- Every picker is unsearchable over an unbounded list (native `<select>` on web; a plain
  `ScrollView` of rows on mobile, `apps/mobile/src/components/option-picker.tsx`).
- Seven `alert()` calls surface server errors on the web console (`directory-client.tsx:337`,
  `inspections/row-actions.tsx:52,78`, `presets/presets-list.tsx:55`, `users/users-client.tsx:103,138,152`).
- Only `login.tsx` wraps its form in a `KeyboardAvoidingView`; no mobile form sets
  `keyboardShouldPersistTaps`, so the first tap on a button while the keyboard is up only dismisses it.
- A company's `defaultLoopPresetId` is written by both company forms and read by nothing: the
  new-inspection form always defaults to `presets[0]`.

The rest of the audit (shared form primitives, tap targets, pull-to-refresh on detail screens,
breadcrumbs, PO party edit, redirect-after-create losing the list) is **out of scope** and filed as
one umbrella backlog item, INS-092.

## 1. What the user gets

1. **"+ Add new…" inside pickers.** On the PO form (web and mobile) the Client, Factory and Product
   pickers end with a row that opens a small create form in place. On the new-inspection form the
   PO picker does the same, and that PO form carries its own client/factory/product pickers, each
   with their own "+ Add new…". On success the new entity is appended to the picker's list and
   selected; the host form keeps everything already typed.
2. **Searchable pickers.** Both platforms' entity pickers gain a filter input. Matching is one shared
   pure function so the two cannot drift.
3. **No dead-end empty states.** The inspection form renders even with zero POs; the PO picker shows
   its empty text and the "+ Add new…" row. Preset empty states link to the preset builder **on the
   same platform** (no modal; the builder is a full screen by design).
4. **Company create on mobile**, via the same sheet, from a "New" button on the directory.
5. **Default preset honoured.** Selecting a PO pre-selects `po.clientCompany.defaultLoopPresetId` when
   it exists and the user has not chosen a preset by hand.
6. **No more `alert()`** on the console; errors render inline next to the control that failed.
7. **Keyboard-safe mobile forms.** Every form screen scrolls under the keyboard and taps land on the
   first try.

Loop preset, inspector/user and defect are **not** given inline create in this batch: preset is a
full-screen builder, user creation is an invite flow, and defect already has it.

## 2. Roles

Every create route involved is already floored at `QA_MANAGER` by a class-level `@Roles` decorator
(`companies`, `products`, `purchase-orders` controllers), and every screen that hosts one of these
pickers is gated at `QA_MANAGER` too. So the "+ Add new…" row needs **no extra role check**: whoever
can see the picker can create the entity. The API remains the authority; a 403 is surfaced inline
like any other error. No API change.

## 3. Shared layer

Per `.claude/rules/wire-contract.md` and `migration-discipline.md`: rules go to `@inspect/domain`
with web re-pointed in the same change; wire shapes go to `@inspect/shared-types`; UI components are
per platform.

### 3.1 `@inspect/domain` — `filterOptions`

```ts
export function filterOptions<T>(
  query: string,
  items: readonly T[],
  label: (item: T) => string,
): T[]
```

- Empty or whitespace query returns the input order unchanged.
- Case-insensitive; every whitespace-separated token in the query must appear somewhere in the
  label (so "acme fac" matches "Acme Factory Ltd").
- Diacritics are folded (`normalize('NFD')` and strip combining marks) so "Sao" matches "São".
- Never mutates the input. Test-driven in `packages/domain/src/filter-options.test.ts`.

Both pickers call this; neither implements matching locally.

### 3.2 `@inspect/shared-types` — one field

`PurchaseOrderDto.clientCompany` becomes `{ id: string; name: string; defaultLoopPresetId?: string | null }`.
The API already sends it (`PurchaseOrdersService.list/get` use `include: { clientCompany: true }`),
so this only makes the contract honest. `wire-contract.spec.ts` checks nested shapes only as far as
the relation existing, so no `DECORATIONS` entry is needed. `openapi.json` is regenerated if its
diff is non-empty (`pnpm api openapi:generate`; CI gates staleness).

No new DTOs: `CreateCompanyInput` (`name` required), `CreateProductInput` (`styleNumber` required)
and `CreatePurchaseOrderInput` (`poNumber` + three ids required) already exist.

## 4. Web (`apps/web`)

The console uses `components/inspect/*` only; `components/ui/*` (shadcn) is dead vocabulary and is
not touched.

### 4.1 `components/inspect/modal.tsx`

Generalises the shell of `confirm-dialog.tsx` (fixed overlay, `role="dialog"` + `aria-modal` +
`aria-labelledby`, Escape, backdrop click, click-stop on the panel) into:

```ts
<Modal title width={480} onClose={...}>{children}</Modal>
```

Adds what a form host needs and a confirm did not: a focus trap (Tab/Shift+Tab cycle within the
panel, initial focus on the first focusable), `document.body` scroll lock while any modal is open,
and **stacking**: a module-level stack of open modals so Escape and backdrop click close only the
topmost, and each layer's `zIndex` is `100 + depth`. `ConfirmDialog` is rewritten on top of `Modal`
with its public props unchanged; its two consumers do not change.

### 4.2 `components/inspect/entity-picker.tsx`

A client component replacing native `<select>` for entity choice:

```ts
<EntityPicker
  name="clientCompanyId"          // hidden <input>, so <form action> FormData still works
  label="Client"
  options={[{ id, label, hint? }]}
  value={id | ''}
  onChange={(id) => ...}
  placeholder="Select the client…"
  emptyText="No companies yet."
  createLabel="+ Add new company…"   // footer row rendered only when onCreate is given
  onCreate={() => ...}
  required? invalid? hintText?
/>
```

- Trigger looks like the current select (same height, hairline, radius); opens a popover under it
  with a search input focused, a listbox of `filterOptions(query, options, o => o.label)`, and the
  optional footer row. Styles reuse `ui.*` from `tokens.ts`; no new hex.
- Keyboard: ArrowUp/Down move the active row, Enter selects (or fires `onCreate` when the footer is
  active), Escape closes, typing filters. ARIA: `role="combobox"` on the trigger with
  `aria-expanded`/`aria-controls`, `role="listbox"`/`role="option"` with `aria-selected`.
- Closes on outside click. Selecting the footer does **not** change the value; it calls `onCreate`.

### 4.3 `components/inspect/error-banner.tsx`

`<ErrorBanner>{message}</ErrorBanner>` — the `#FEF2F2`/`#FECACA` panel with `ui.danger` text that is
currently copy-pasted. Used by all new code and by the seven `alert()` replacements. Existing
copy-pasted banners may adopt it opportunistically but that is not a goal of this item.

### 4.4 Quick-create server actions

Non-redirecting variants beside the existing actions, following `createDefect` in
`presets/actions.ts` (return the DTO, never `redirect`):

- `quickCreateCompany({ name, kind? })` in `dashboard/actions.ts` → `POST /companies` → `{ data?: ApiCompany, error? }`
- `quickCreateProduct({ styleNumber, description? })` in `products/actions.ts` → `POST /products`
- `quickCreatePurchaseOrder({ poNumber, clientCompanyId, factoryCompanyId, productId, totalQuantity? })`
  in `purchase-orders/actions.ts` → `POST /purchase-orders`

Each validates the required field, wraps `ApiError`/`Error` with the existing `msg()` idiom, and
calls `revalidatePath` on the entity's list route so the next full load includes the row. The
existing FormData actions and their redirects are untouched: the standalone `/new` pages behave as
before.

### 4.5 Quick-create dialogs — `components/inspect/quick-create/`

- `quick-create-company.tsx` — fields: Name (required), Kind (`INTERNAL`/`THIRD_PARTY`, default
  `THIRD_PARTY`). Footer hint: "Branding and location can be added later from the directory."
- `quick-create-product.tsx` — Style number (required), Description.
- `quick-create-purchase-order.tsx` — PO number (required), Client and Factory `EntityPicker`s over
  one company list with the self-dealing check mirrored from the PO form, Product `EntityPicker`,
  Total quantity. Each picker has its own `onCreate` opening a nested company/product dialog (one
  level of stacking; the created row is appended to this dialog's local list and selected).

Common contract: `open`, `onClose`, `onCreated(dto)`; `useTransition` pending state disables the
submit and shows the `Btn` spinner; errors render in an `ErrorBanner` inside the dialog; a success
closes the dialog and hands the DTO up. The host owns list state (`useState` seeded from the
server-component props), appends, and sets the picker value — the pattern already used by the
preset builder for custom defects.

### 4.6 Wiring

- `purchase-orders/new/create-form.tsx`: the three selects become `EntityPicker`s with `onCreate`;
  the ranked company list moves into state so it can grow.
- `inspections/new/create-form.tsx`: the PO select becomes an `EntityPicker` with
  `onCreate` opening `QuickCreatePurchaseOrder` (which needs companies and products, so
  `inspections/new/page.tsx` also fetches `/companies` and `/products`, each `.catch(() => [])` as
  the page already does). The `pos.length === 0` early return is deleted. The preset select stays a
  select but, when `presets` is empty, renders a line linking to `/presets/new`. Selecting a PO
  applies the default-preset rule from §1.5 (a `presetTouched` flag stops it overriding a manual pick).
- `alert()` sites: each gets a local `error` state rendered with `ErrorBanner` near the control
  (row actions render it in the row; list menus render it above the list).

### 4.7 Tests

The first component tests land, so per the comment in `vitest.config.mts` a DOM environment is
added: `jsdom`, `@testing-library/react`, `@testing-library/dom` (its peer) and
`@testing-library/user-event` as devDependencies, with `// @vitest-environment jsdom` per test file so
the existing node-environment suite is untouched. Plain Vitest assertions; no jest-dom matchers. Tests:

- `entity-picker.test.tsx`: opens on click, filters on typing, arrow keys + Enter select and write
  the hidden input, Escape closes, footer row appears only with `onCreate` and fires it without
  changing the value, `emptyText` shows for an empty list.
- `modal.test.tsx`: Escape closes only the topmost of two stacked modals; focus starts inside;
  body scroll lock toggles.

The 38 existing tests stay untouched (they are an acceptance instrument, not a suite to edit).

## 5. Mobile (`apps/mobile`)

### 5.1 `components/option-picker.tsx`

The one picker gains, behind optional props so the nine call sites keep compiling:

- a search `TextInput` at the top of the modal when `options.length > 6` or `searchable` is set,
  filtering via `filterOptions`; `autoFocus`, `keyboardShouldPersistTaps="handled"` on the list;
- `onCreate?: () => void` + `createLabel?: string` → a footer row "+ Add new …" always visible under
  the list (not filtered away);
- `emptyText?: string` rendered when the filtered list is empty;
- rows `minHeight: 44`, `FlatList` instead of `ScrollView.map`, the modal wrapped so the keyboard does
  not cover the search field.

### 5.2 `components/quick-create-sheet.tsx` and `components/quick-create/`

`QuickCreateSheet({ visible, title, onClose, children })`: a slide-up `Modal` (same chrome as the
capture unit sheet: handle row, title, Cancel), `KeyboardAvoidingView`, scrollable body,
`keyboardShouldPersistTaps="handled"`. Three forms with the same `onCreated(dto)` contract as web,
same fields as §4.5, same pending/error/append/auto-select pattern as `addCustomDefect` in
`presets/new.tsx`. They call `client.post` from `@/lib/session` (the single api-client instance; no
new fetch call site). The PO sheet hosts three `OptionPicker`s with their own `onCreate`, stacking
a second sheet on top.

### 5.3 `components/form-screen.tsx`

`FormScreen` = `SafeAreaView` (from `react-native-safe-area-context`) + `KeyboardAvoidingView`
(`behavior: 'padding'` on iOS, `undefined` on Android) + `ScrollView` with
`keyboardShouldPersistTaps="handled"` and the shared `body` padding. Adopted by the form screens
that currently render a bare `ScrollView`: `products/new`, `purchase-orders/new`, `inspections/new`,
`presets/new`, `users`, `companies/[id]/index`, `companies/[id]/guests`, `inspections/[id]/review`,
`products/[id]`, `purchase-orders/[id]`, `invite`.

### 5.4 Wiring

- `purchase-orders/new.tsx`: `companies`/`products` move from the `Load` union into state after load
  so they can grow; the three pickers get `onCreate`; sheets appended below the form.
- `inspections/new.tsx`: the `pos.length === 0` early return is deleted; the PO picker gets
  `emptyText` + `onCreate`; `fetchFormData` also loads `/companies` and `/products` for the PO
  sheet; preset empty copy becomes a link to `/presets/new`; default-preset rule per §1.5.
- `companies/index.tsx`: a "New" button in the header opens `QuickCreateCompany`; on success it
  pushes `/companies/${id}` (where branding and location can be completed). The header comment and
  the ledger note "create stays web-only" are updated.
- Ledger rows for `/inspections/new`, `/purchase-orders …`, `/dashboard` + `/companies` gain a
  2026-09-04 note.

### 5.5 Tests

No component test infrastructure exists on mobile and none is added. `filterOptions` is covered in
domain. Gates: `pnpm --filter @inspect/mobile type-check`, `lint`, `npx expo export` (route count
unchanged at 25: no new routes, only sheets), then the emulator walk in §7.

## 6. Error handling and edge cases

- **Duplicate name / style number / PO number:** the API answers 409 (fixed 2026-09-02); the message
  renders inside the dialog or sheet, the form stays open with the typed values.
- **Self-dealing in the PO dialog:** client === factory disables Create and shows the same copy as
  the PO form; the API 400 stays the authority.
- **403:** surfaces inline like any error. It cannot normally happen (see §2).
- **Network failure on mobile:** the raw `TypeError` message is replaced with "No connection. Check
  the network and try again." when `e` is not an `ApiError`. Nothing is queued: quick-create is
  online-only, unlike photos.
- **Created entity and ranking:** a company created inline is appended to the *end* of the
  ranked list (it has zero activity), then selected; the picker shows it as the current value
  regardless of position.
- **Nested dialogs:** at most two levels (PO → company/product). Escape/backdrop closes the top one
  only; the outer dialog keeps its state.
- **Preset default:** applied on PO change only while `presetTouched` is false; if the referenced
  preset id is not in the loaded list (archived), the rule is skipped silently.

## 7. Verification

1. `pnpm test` (domain gains `filter-options.test.ts`; web gains the two component test files;
   the 38 + 29 existing pass unchanged), `pnpm type-check`, `pnpm lint`.
2. `pnpm api openapi:generate` yields no diff, or the diff is committed.
3. Web click-through with the Chrome DevTools tools against the local stack on a fresh org:
   `/inspections/new` with zero POs → "+ Add new purchase order…" → "+ Add new company…" twice →
   "+ Add new product…" → PO created and selected → inspection created. Then `/purchase-orders/new`
   search + inline create, and each former `alert()` site shows an inline banner on a forced error.
4. Mobile on the Android emulator (workflow in session memory): the same flow on
   `/inspections/new` and `/purchase-orders/new`; "New" on `/companies`; keyboard does not cover the
   sheet's fields; one tap on Create works while the keyboard is up.
5. Docs: INS-091 → `done` with a `done:` line; INS-092 filed; STATUS "Last verified" bumped and the
   web/mobile pillar rows updated; ledger rows updated; this spec and its plan moved to `docs/done/`.
