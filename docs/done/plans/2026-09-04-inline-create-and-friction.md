# Inline Create From Pickers + Friction Blockers — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a QA Manager create a company, product or purchase order from inside the picker that needs it, on web and mobile, without leaving the form — and remove the dead-end empty states, `alert()` popups and keyboard traps on the same screens.

**Architecture:** One pure `filterOptions` matcher in `@inspect/domain` feeds a searchable picker on each platform (web: a new `EntityPicker` combobox over a generalised `Modal`; mobile: the existing `OptionPicker` grown in place). Each platform gets three small quick-create forms with a shared `onCreated(dto)` contract; the host appends the DTO to local list state and selects it — the pattern the preset builder already uses for custom defects. No API changes; every create route is already `QA_MANAGER`-floored.

**Tech Stack:** TypeScript 5.7, React 19.2.3 (pinned once at the root), Next.js 15 App Router (Server Actions, `useTransition`), Expo SDK 57 / RN 0.86 (`Modal`, `FlatList`, `KeyboardAvoidingView`), Vitest 4 (+ jsdom and Testing Library for the first web component tests), pnpm 9.12.0 workspaces + Turbo.

**Spec:** [../specs/2026-09-04-inline-create-and-friction-design.md](../specs/2026-09-04-inline-create-and-friction-design.md) — INS-091.

## Global Constraints

- Wire shapes live only in `@inspect/shared-types`; rules only in `@inspect/domain` with web re-pointed in the same change (`.claude/rules/wire-contract.md`, `migration-discipline.md`).
- `@inspect/api-client` owns HTTP. Mobile calls `client.post` from `@/lib/session`; web calls `apiPost` from `@/lib/api`. Never add a second `fetch` call site.
- Web uses `components/inspect/*` only. Do **not** import from `components/ui/*` (dead shadcn vocabulary). Never hardcode a hex that exists in `tokens.ts` — use `ui.danger`, `ui.line`, `ui.accent`, `ui.sub`, `ui.faint`, `ui.ink`, `ui.lineSoft`, `ui.accentSoft`, `ui.fill`.
- Mobile colours come from `palette` in `@inspect/design-tokens`; `SafeAreaView` from `react-native-safe-area-context`, never from `react-native`.
- No new React version anywhere. CI asserts exactly one resolved React.
- The 38 existing web Vitest tests and the 29 domain tests must pass unchanged.
- Shared packages resolve through `dist/` for `tsc`/`next build`: run `pnpm build` (or `pnpm type-check`, which depends on `^build`) after changing a package before trusting web/mobile type-check. Vitest aliases to `src`, so tests see the change immediately.
- Windows: run commands from the repo root as `pnpm --filter <pkg> <script>`. If `pnpm` is missing from PATH use `npx -y pnpm@9.12.0 …`.
- Commit after every task with the `INS-091` id in the message.

---

## File structure

**Create**
- `packages/domain/src/filter-options.ts` + `.test.ts` — the matcher.
- `apps/web/components/inspect/modal.tsx` + `modal.test.tsx` — portal modal shell with stacking, focus trap, scroll lock.
- `apps/web/components/inspect/entity-picker.tsx` + `entity-picker.test.tsx` — searchable combobox with "+ Add new…" footer.
- `apps/web/components/inspect/error-banner.tsx` — the shared red banner.
- `apps/web/components/inspect/quick-create/quick-create-company.tsx`, `quick-create-product.tsx`, `quick-create-purchase-order.tsx` — dialogs.
- `apps/mobile/src/components/form-screen.tsx` — SafeArea + KeyboardAvoiding + ScrollView.
- `apps/mobile/src/components/quick-create-sheet.tsx` — the bottom sheet shell.
- `apps/mobile/src/components/quick-create/company.tsx`, `product.tsx`, `purchase-order.tsx` — sheet forms.

**Modify**
- `packages/domain/src/index.ts`; `packages/shared-types/src/api-dtos.ts` (`PurchaseOrderDto.clientCompany`).
- `apps/web/package.json`, `apps/web/components/inspect/confirm-dialog.tsx`.
- `apps/web/app/(console)/dashboard/actions.ts`, `products/actions.ts`, `purchase-orders/actions.ts` (quick-create actions).
- `apps/web/app/(console)/purchase-orders/new/create-form.tsx`; `inspections/new/create-form.tsx` + `page.tsx`.
- `alert()` sites: `dashboard/directory-client.tsx`, `inspections/row-actions.tsx`, `presets/presets-list.tsx`, `users/users-client.tsx`.
- `apps/mobile/src/components/option-picker.tsx`; `apps/mobile/src/app/purchase-orders/new.tsx`, `inspections/new.tsx`, `companies/index.tsx`; the form screens listed in Task 10.
- Docs: `docs/future/BACKLOG.md`, `docs/STATUS.md`, `docs/reference/screen-migration-map.md`.

---

### Task 1: `filterOptions` in `@inspect/domain`

**Files:**
- Create: `packages/domain/src/filter-options.ts`, `packages/domain/src/filter-options.test.ts`
- Modify: `packages/domain/src/index.ts`

**Interfaces:**
- Produces: `filterOptions<T>(query: string, items: readonly T[], label: (item: T) => string): T[]` — exported from `@inspect/domain`. Used by Task 4 (web picker) and Task 9 (mobile picker).

- [ ] **Step 1: Write the failing test**

```ts
// packages/domain/src/filter-options.test.ts
import { describe, expect, it } from 'vitest';

import { filterOptions } from './filter-options';

const rows = [
  { id: '1', name: 'Acme Factory Ltd' },
  { id: '2', name: 'São Paulo Textiles' },
  { id: '3', name: 'Northwind Apparel' },
];
const byName = (r: { name: string }) => r.name;

describe('filterOptions', () => {
  it('returns every item in original order for an empty or whitespace query', () => {
    expect(filterOptions('', rows, byName)).toEqual(rows);
    expect(filterOptions('   ', rows, byName)).toEqual(rows);
  });

  it('matches case-insensitively on a substring', () => {
    expect(filterOptions('north', rows, byName).map((r) => r.id)).toEqual(['3']);
  });

  it('requires every whitespace-separated token to appear somewhere in the label', () => {
    expect(filterOptions('acme fac', rows, byName).map((r) => r.id)).toEqual(['1']);
    expect(filterOptions('acme north', rows, byName)).toEqual([]);
  });

  it('folds diacritics so an unaccented query matches an accented label', () => {
    expect(filterOptions('sao', rows, byName).map((r) => r.id)).toEqual(['2']);
  });

  it('does not mutate the input', () => {
    const copy = [...rows];
    filterOptions('acme', rows, byName);
    expect(rows).toEqual(copy);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter @inspect/domain test -- filter-options`
Expected: FAIL — `Cannot find module './filter-options'`.

- [ ] **Step 3: Implement**

```ts
// packages/domain/src/filter-options.ts
/**
 * Picker search (INS-091). ONE matcher for the web combobox and the mobile
 * option picker, so "what does typing in a picker match" cannot drift between
 * platforms. Case-insensitive, diacritic-folded, every token must appear.
 */
const fold = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();

export function filterOptions<T>(
  query: string,
  items: readonly T[],
  label: (item: T) => string,
): T[] {
  const tokens = fold(query).split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return [...items];
  return items.filter((item) => {
    const haystack = fold(label(item));
    return tokens.every((t) => haystack.includes(t));
  });
}
```

Add to `packages/domain/src/index.ts` after the `rankCompaniesByActivity` export line:

```ts
export { filterOptions } from './filter-options';
```

- [ ] **Step 4: Run tests**

Run: `pnpm --filter @inspect/domain test`
Expected: 34 passing (29 existing + 5 new).

- [ ] **Step 5: Commit**

```bash
git add packages/domain/src/filter-options.ts packages/domain/src/filter-options.test.ts packages/domain/src/index.ts
git commit -m "feat(domain): INS-091 — filterOptions, the one picker-search matcher for web + mobile"
```

---

### Task 2: `PurchaseOrderDto.clientCompany.defaultLoopPresetId`

**Files:**
- Modify: `packages/shared-types/src/api-dtos.ts:207-215`

**Interfaces:**
- Produces: `PurchaseOrderDto.clientCompany?: { id: string; name: string; defaultLoopPresetId?: string | null } | null`. Read by Tasks 8 and 13 for the default-preset rule.

- [ ] **Step 1: Edit the DTO**

Replace the `clientCompany` line in `PurchaseOrderDto` with:

```ts
  /** INS-055: a PO is explicitly two-party. Both are required on create. */
  clientCompany?: {
    id: string;
    name: string;
    /**
     * INS-091: the API includes the full Company row here, so the client's
     * default preset rides along — the new-inspection forms pre-select it.
     */
    defaultLoopPresetId?: string | null;
  } | null;
```

- [ ] **Step 2: Verify the contract guard and OpenAPI**

Run: `pnpm --filter @inspect/api exec jest src/common/wire-contract.spec.ts --runInBand`
Expected: PASS (nested shapes are only checked as far as the relation existing).

Run: `pnpm --filter @inspect/api openapi:generate` then `git status --short apps/api`
Expected: either no change, or `openapi.json` changed — stage it if so.

- [ ] **Step 3: Rebuild packages and type-check**

Run: `pnpm build --filter @inspect/shared-types --filter @inspect/domain` then `pnpm type-check`
Expected: all green.

- [ ] **Step 4: Commit**

```bash
git add packages/shared-types/src/api-dtos.ts apps/api/openapi.json
git commit -m "feat(shared-types): INS-091 — PurchaseOrderDto carries the client's defaultLoopPresetId the API already sends"
```

---

### Task 3: Web component-test infrastructure + `Modal`

**Files:**
- Modify: `apps/web/package.json` (devDependencies)
- Create: `apps/web/components/inspect/modal.tsx`, `apps/web/components/inspect/modal.test.tsx`
- Modify: `apps/web/components/inspect/confirm-dialog.tsx`

**Interfaces:**
- Produces: `Modal({ title, onClose, width?, children, labelledBy? })` — client component rendering through a portal to `document.body`. Escape and backdrop close **only the topmost** modal. Used by Tasks 6, 7, 8 and by `ConfirmDialog`.

- [ ] **Step 1: Add the test dependencies**

Run from the repo root:

```bash
pnpm --filter @inspect/web add -D jsdom@^26.1.0 @testing-library/react@^16.3.0 @testing-library/dom@^10.4.0 @testing-library/user-event@^14.6.1
```

Expected: `apps/web/package.json` devDependencies gain the four entries; `pnpm-lock.yaml` updates. Do **not** change `vitest.config.mts` — the environment is chosen per file with a pragma.

- [ ] **Step 2: Write the failing test**

```tsx
// apps/web/components/inspect/modal.test.tsx
// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';

import { Modal } from './modal';

afterEach(cleanup);

describe('Modal', () => {
  it('renders title and children through a portal with dialog semantics', () => {
    render(
      <Modal title="New company" onClose={() => {}}>
        <input aria-label="Name" />
      </Modal>,
    );
    const dialog = screen.getByRole('dialog');
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    expect(screen.getByText('New company')).toBeTruthy();
    expect(dialog.parentElement?.parentElement).toBe(document.body);
  });

  it('moves focus inside on open and locks body scroll while open', () => {
    const { unmount } = render(
      <Modal title="T" onClose={() => {}}>
        <input aria-label="First" />
      </Modal>,
    );
    expect(document.activeElement).toBe(screen.getByLabelText('First'));
    expect(document.body.style.overflow).toBe('hidden');
    unmount();
    expect(document.body.style.overflow).toBe('');
  });

  it('Escape closes only the topmost of two stacked modals', () => {
    const outer = vi.fn();
    const inner = vi.fn();
    render(
      <>
        <Modal title="Outer" onClose={outer}>
          <button>a</button>
        </Modal>
        <Modal title="Inner" onClose={inner}>
          <button>b</button>
        </Modal>
      </>,
    );
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(inner).toHaveBeenCalledTimes(1);
    expect(outer).not.toHaveBeenCalled();
  });

  it('backdrop click closes, panel click does not', () => {
    const onClose = vi.fn();
    render(
      <Modal title="T" onClose={onClose}>
        <button>inside</button>
      </Modal>,
    );
    fireEvent.click(screen.getByText('inside'));
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.click(screen.getByTestId('modal-backdrop'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 3: Run it to verify it fails**

Run: `pnpm --filter @inspect/web test -- modal`
Expected: FAIL — `Cannot find module './modal'`.

- [ ] **Step 4: Implement `Modal`**

```tsx
// apps/web/components/inspect/modal.tsx
'use client';

import { useEffect, useId, useRef, useState, useSyncExternalStore } from 'react';
import type { ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { ui } from './tokens';

/**
 * The design system's modal shell (INS-091). Generalised from ConfirmDialog so
 * a FORM can live in it: portal to <body> (a form inside a form is invalid
 * HTML, and quick-create dialogs open from inside forms), focus trap, body
 * scroll lock, and a stack so Escape / backdrop close only the topmost layer
 * when a quick-create opens a nested quick-create.
 */
const stack: symbol[] = [];
const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

const subscribeNoop = () => () => {};

export function Modal({
  title,
  onClose,
  width = 480,
  children,
}: {
  title: string;
  onClose: () => void;
  width?: number;
  children: ReactNode;
}) {
  const mounted = useSyncExternalStore(subscribeNoop, () => true, () => false);
  const titleId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const [me] = useState(() => Symbol('modal'));
  const [depth, setDepth] = useState(0);

  // Register on the stack; lock scroll while any modal is open.
  useEffect(() => {
    stack.push(me);
    setDepth(stack.length - 1);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      const i = stack.indexOf(me);
      if (i >= 0) stack.splice(i, 1);
      if (stack.length === 0) document.body.style.overflow = prevOverflow;
    };
  }, [me]);

  // Initial focus + Escape (topmost only) + Tab trap.
  useEffect(() => {
    const panel = panelRef.current;
    if (!panel) return;
    const first = panel.querySelector<HTMLElement>(FOCUSABLE);
    (first ?? panel).focus();

    function onKey(e: KeyboardEvent) {
      if (stack[stack.length - 1] !== me) return;
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
        return;
      }
      if (e.key === 'Tab' && panel) {
        const nodes = Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE));
        if (nodes.length === 0) return;
        const firstEl = nodes[0];
        const lastEl = nodes[nodes.length - 1];
        if (e.shiftKey && document.activeElement === firstEl) {
          e.preventDefault();
          lastEl.focus();
        } else if (!e.shiftKey && document.activeElement === lastEl) {
          e.preventDefault();
          firstEl.focus();
        }
      }
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [me, onClose]);

  if (!mounted) return null;

  return createPortal(
    <div
      data-testid="modal-backdrop"
      onClick={() => {
        if (stack[stack.length - 1] === me) onClose();
      }}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(11,18,32,0.45)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 100 + depth,
      }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
        style={{
          background: '#fff',
          borderRadius: 12,
          padding: 24,
          width,
          maxWidth: '90vw',
          maxHeight: '90vh',
          overflowY: 'auto',
          border: `1px solid ${ui.line}`,
          fontFamily: ui.font,
          outline: 'none',
        }}
      >
        <div id={titleId} style={{ fontSize: 15, fontWeight: 600, color: ui.ink }}>
          {title}
        </div>
        {children}
      </div>
    </div>,
    document.body,
  );
}
```

- [ ] **Step 5: Run the modal tests**

Run: `pnpm --filter @inspect/web test -- modal`
Expected: 4 passing.

- [ ] **Step 6: Rewrite `ConfirmDialog` on `Modal` (props unchanged)**

Replace the whole body of `apps/web/components/inspect/confirm-dialog.tsx` with:

```tsx
'use client';

import { useEffect, useRef } from 'react';
import type { ReactNode } from 'react';
import { Modal } from './modal';
import { ui } from './tokens';

/** The design system's modal confirm (first consumer: archive + start-inspection). */
export function ConfirmDialog({
  title,
  body,
  confirmLabel = 'Confirm',
  danger = false,
  onConfirm,
  onCancel,
}: {
  title: string;
  body: ReactNode;
  confirmLabel?: string;
  danger?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const confirmRef = useRef<HTMLButtonElement>(null);
  // Focus lands on the confirm action (Modal focuses the FIRST focusable,
  // which here is Cancel) so the dialog keeps its keyboard-first behaviour.
  useEffect(() => {
    confirmRef.current?.focus();
  }, []);

  return (
    <Modal title={title} onClose={onCancel} width={420}>
      <div style={{ fontSize: 13, color: ui.sub, marginTop: 8, lineHeight: 1.5 }}>{body}</div>
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 18 }}>
        <button
          onClick={onCancel}
          style={{ height: 34, padding: '0 14px', borderRadius: 8, fontSize: 13, fontWeight: 500, fontFamily: 'inherit', background: '#fff', color: ui.ink, border: `1px solid ${ui.line}`, cursor: 'pointer' }}
        >
          Cancel
        </button>
        <button
          ref={confirmRef}
          onClick={onConfirm}
          style={{ height: 34, padding: '0 14px', borderRadius: 8, fontSize: 13, fontWeight: 550, fontFamily: 'inherit', background: danger ? ui.danger : ui.accent, color: '#fff', border: '1px solid transparent', cursor: 'pointer' }}
        >
          {confirmLabel}
        </button>
      </div>
    </Modal>
  );
}
```

- [ ] **Step 7: Full web suite + type-check**

Run: `pnpm --filter @inspect/web test` → 42 passing (38 + 4). Run: `pnpm --filter @inspect/web type-check` → clean.

- [ ] **Step 8: Commit**

```bash
git add apps/web/package.json pnpm-lock.yaml apps/web/components/inspect/modal.tsx apps/web/components/inspect/modal.test.tsx apps/web/components/inspect/confirm-dialog.tsx
git commit -m "feat(web): INS-091 — Modal shell (portal, focus trap, stack, scroll lock) + first component tests; ConfirmDialog rebuilt on it"
```

---

### Task 4: Web `EntityPicker`

**Files:**
- Create: `apps/web/components/inspect/entity-picker.tsx`, `apps/web/components/inspect/entity-picker.test.tsx`

**Interfaces:**
- Consumes: `filterOptions` from `@inspect/domain` (Task 1).
- Produces:

```ts
export interface PickerOption { id: string; label: string; hint?: string }
export function EntityPicker(props: {
  name?: string;            // hidden <input name> so <form action> FormData sees the id
  label: string;
  options: PickerOption[];
  value: string;            // '' = none
  onChange: (id: string) => void;
  placeholder?: string;
  emptyText?: string;
  createLabel?: string;     // footer row, rendered only when onCreate is given
  onCreate?: () => void;
  hintText?: string;
  invalid?: boolean;
  disabled?: boolean;
}): JSX.Element
```

- [ ] **Step 1: Write the failing test**

```tsx
// apps/web/components/inspect/entity-picker.test.tsx
// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { EntityPicker } from './entity-picker';

afterEach(cleanup);

const options = [
  { id: 'c1', label: 'Acme Factory Ltd' },
  { id: 'c2', label: 'Northwind Apparel' },
  { id: 'c3', label: 'São Paulo Textiles' },
];

function setup(extra: Partial<Parameters<typeof EntityPicker>[0]> = {}) {
  const onChange = vi.fn();
  const onCreate = vi.fn();
  const utils = render(
    <EntityPicker
      name="clientCompanyId"
      label="Client"
      options={options}
      value=""
      onChange={onChange}
      placeholder="Select the client…"
      emptyText="No companies yet."
      {...extra}
    />,
  );
  return { ...utils, onChange, onCreate };
}

describe('EntityPicker', () => {
  it('opens on click, filters on typing, and selects with a click', async () => {
    const user = userEvent.setup();
    const { onChange } = setup();
    await user.click(screen.getByRole('combobox', { name: /client/i }));
    const list = screen.getByRole('listbox');
    expect(within(list).getAllByRole('option')).toHaveLength(3);
    await user.type(screen.getByPlaceholderText('Search…'), 'sao');
    expect(within(list).getAllByRole('option')).toHaveLength(1);
    await user.click(within(list).getByRole('option'));
    expect(onChange).toHaveBeenCalledWith('c3');
    expect(screen.queryByRole('listbox')).toBeNull();
  });

  it('arrow keys + Enter select and Escape closes', async () => {
    const user = userEvent.setup();
    const { onChange } = setup();
    await user.click(screen.getByRole('combobox'));
    await user.keyboard('{ArrowDown}{Enter}');
    expect(onChange).toHaveBeenCalledWith('c2');
    await user.click(screen.getByRole('combobox'));
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('listbox')).toBeNull();
  });

  it('writes the selected id to the hidden input and shows its label', () => {
    setup({ value: 'c2' });
    const hidden = document.querySelector<HTMLInputElement>('input[name="clientCompanyId"]');
    expect(hidden?.value).toBe('c2');
    expect(screen.getByRole('combobox').textContent).toContain('Northwind Apparel');
  });

  it('shows the "+ Add new" footer only when onCreate is given, and it fires without changing the value', async () => {
    const user = userEvent.setup();
    const { onChange, onCreate, rerender } = setup();
    await user.click(screen.getByRole('combobox'));
    expect(screen.queryByText('+ Add new company…')).toBeNull();
    await user.keyboard('{Escape}');

    rerender(
      <EntityPicker
        name="clientCompanyId"
        label="Client"
        options={options}
        value=""
        onChange={onChange}
        createLabel="+ Add new company…"
        onCreate={onCreate}
      />,
    );
    await user.click(screen.getByRole('combobox'));
    await user.click(screen.getByText('+ Add new company…'));
    expect(onCreate).toHaveBeenCalledTimes(1);
    expect(onChange).not.toHaveBeenCalled();
  });

  it('renders emptyText and keeps the footer when there are no options', async () => {
    const user = userEvent.setup();
    const { onCreate } = setup({ options: [], createLabel: '+ Add new company…', onCreate: vi.fn() });
    void onCreate;
    await user.click(screen.getByRole('combobox'));
    expect(screen.getByText('No companies yet.')).toBeTruthy();
    expect(screen.getByText('+ Add new company…')).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter @inspect/web test -- entity-picker`
Expected: FAIL — `Cannot find module './entity-picker'`.

- [ ] **Step 3: Implement**

```tsx
// apps/web/components/inspect/entity-picker.tsx
'use client';

import { useEffect, useId, useMemo, useRef, useState } from 'react';
import type { CSSProperties, KeyboardEvent } from 'react';
import { ChevronDown } from 'lucide-react';
import { filterOptions } from '@inspect/domain';
import { ui } from './tokens';

export interface PickerOption {
  id: string;
  label: string;
  hint?: string;
}

const lbl: CSSProperties = { display: 'block', fontSize: 11, fontWeight: 600, color: ui.sub, marginBottom: 4, textTransform: 'uppercase', letterSpacing: 0.4 };

/**
 * Searchable entity combobox (INS-091). Replaces native <select> wherever the
 * user picks a company / product / PO. The optional footer row "+ Add new…"
 * never changes the value — it hands control to the host, which opens a
 * quick-create dialog and, on success, appends + selects the new row.
 * Search goes through the shared `filterOptions` so web and mobile match alike.
 */
export function EntityPicker({
  name,
  label,
  options,
  value,
  onChange,
  placeholder = 'Select…',
  emptyText = 'Nothing to choose from yet.',
  createLabel = '+ Add new…',
  onCreate,
  hintText,
  invalid = false,
  disabled = false,
}: {
  name?: string;
  label: string;
  options: PickerOption[];
  value: string;
  onChange: (id: string) => void;
  placeholder?: string;
  emptyText?: string;
  createLabel?: string;
  onCreate?: () => void;
  hintText?: string;
  invalid?: boolean;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const listId = useId();
  const labelId = useId();

  const filtered = useMemo(() => filterOptions(query, options, (o) => o.label), [query, options]);
  const selected = options.find((o) => o.id === value);
  const rowCount = filtered.length + (onCreate ? 1 : 0);

  useEffect(() => {
    if (!open) return;
    searchRef.current?.focus();
    function onDown(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) close();
    }
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  function close() {
    setOpen(false);
    setQuery('');
    setActive(0);
  }

  function pick(index: number) {
    if (index < filtered.length) {
      onChange(filtered[index].id);
      close();
    } else if (onCreate) {
      close();
      onCreate();
    }
  }

  function onKey(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      e.preventDefault();
      close();
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive((i) => Math.min(i + 1, Math.max(rowCount - 1, 0)));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((i) => Math.max(i - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (rowCount > 0) pick(active);
    }
  }

  const row = (isActive: boolean, isSelected: boolean): CSSProperties => ({
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    width: '100%',
    padding: '9px 12px',
    fontSize: 13,
    fontFamily: 'inherit',
    textAlign: 'left',
    color: ui.ink,
    background: isActive ? ui.accentSoft : 'transparent',
    fontWeight: isSelected ? 600 : 400,
    borderWidth: 0,
    cursor: 'pointer',
  });

  return (
    <div ref={rootRef} style={{ position: 'relative' }}>
      <span id={labelId} style={lbl}>{label}</span>
      {name && <input type="hidden" name={name} value={value} />}
      <button
        type="button"
        role="combobox"
        aria-labelledby={labelId}
        aria-expanded={open}
        aria-controls={listId}
        aria-haspopup="listbox"
        disabled={disabled}
        onClick={() => (open ? close() : setOpen(true))}
        onKeyDown={(e) => {
          if (!open && (e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ')) {
            e.preventDefault();
            setOpen(true);
          }
        }}
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          width: '100%',
          height: 36,
          padding: '0 10px',
          fontSize: 13,
          fontFamily: 'inherit',
          textAlign: 'left',
          color: selected ? ui.ink : ui.faint,
          background: '#fff',
          border: `1px solid ${invalid ? ui.danger : ui.line}`,
          borderRadius: 8,
          cursor: disabled ? 'default' : 'pointer',
          opacity: disabled ? 0.6 : 1,
        }}
      >
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {selected ? selected.label : placeholder}
        </span>
        <ChevronDown size={14} color={ui.faint} />
      </button>
      {hintText && <div style={{ fontSize: 11, color: invalid ? ui.danger : ui.faint, marginTop: 4 }}>{hintText}</div>}

      {open && (
        <div
          style={{ position: 'absolute', left: 0, right: 0, top: '100%', marginTop: 4, background: '#fff', border: `1px solid ${ui.line}`, borderRadius: 8, zIndex: 60, overflow: 'hidden' }}
          onKeyDown={onKey}
        >
          <input
            ref={searchRef}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setActive(0);
            }}
            placeholder="Search…"
            aria-controls={listId}
            style={{ width: '100%', height: 34, padding: '0 12px', fontSize: 13, fontFamily: 'inherit', border: 'none', borderBottom: `1px solid ${ui.lineSoft}`, outline: 'none', boxSizing: 'border-box' }}
          />
          <div id={listId} role="listbox" style={{ maxHeight: 240, overflowY: 'auto' }}>
            {filtered.length === 0 && (
              <div style={{ padding: '10px 12px', fontSize: 12.5, color: ui.faint }}>
                {query ? 'No matches.' : emptyText}
              </div>
            )}
            {filtered.map((o, i) => (
              <button
                key={o.id}
                type="button"
                role="option"
                aria-selected={o.id === value}
                onMouseEnter={() => setActive(i)}
                onClick={() => pick(i)}
                style={row(i === active, o.id === value)}
              >
                <span style={{ flex: 1 }}>{o.label}</span>
                {o.hint && <span style={{ fontSize: 11.5, color: ui.faint }}>{o.hint}</span>}
              </button>
            ))}
          </div>
          {onCreate && (
            <button
              type="button"
              onMouseEnter={() => setActive(filtered.length)}
              onClick={() => pick(filtered.length)}
              style={{ ...row(active === filtered.length, false), color: ui.accent, fontWeight: 550, borderTop: `1px solid ${ui.lineSoft}` }}
            >
              {createLabel}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Run the picker tests**

Run: `pnpm --filter @inspect/web test -- entity-picker`
Expected: 5 passing. If the `arrow keys` test fails because focus is on the search input and the listbox `onKeyDown` did not receive the event, confirm the `onKeyDown` sits on the popover wrapper (it does above — the input is inside it, so keydown bubbles).

- [ ] **Step 5: Type-check + lint**

Run: `pnpm --filter @inspect/web type-check && pnpm --filter @inspect/web lint`
Expected: clean (the one known font warning is pre-existing).

- [ ] **Step 6: Commit**

```bash
git add apps/web/components/inspect/entity-picker.tsx apps/web/components/inspect/entity-picker.test.tsx
git commit -m "feat(web): INS-091 — EntityPicker, a searchable combobox with a '+ Add new…' footer"
```

---

### Task 5: `ErrorBanner` and the seven `alert()` sites

**Files:**
- Create: `apps/web/components/inspect/error-banner.tsx`
- Modify: `apps/web/app/(console)/dashboard/directory-client.tsx` (RowMenu, ~line 330-345), `apps/web/app/(console)/inspections/row-actions.tsx` (`run`, copy-link, ~lines 45-80), `apps/web/app/(console)/presets/presets-list.tsx` (`handleArchive`, ~line 51-60), `apps/web/app/(console)/users/users-client.tsx` (~lines 95-155)

**Interfaces:**
- Produces: `ErrorBanner({ children, style? })` — `role="alert"` red panel. Used by Tasks 6–8.

- [ ] **Step 1: Create the banner**

```tsx
// apps/web/components/inspect/error-banner.tsx
import type { CSSProperties, ReactNode } from 'react';
import { ui } from './tokens';

/**
 * The console's one error banner (INS-091). Replaces the copy-pasted
 * #FEF2F2/#FECACA panel and every `alert()` — errors render next to the
 * control that failed, dismiss with the next attempt, and never block.
 */
export function ErrorBanner({ children, style }: { children: ReactNode; style?: CSSProperties }) {
  return (
    <div
      role="alert"
      style={{ padding: '10px 14px', background: '#FEF2F2', border: '1px solid #FECACA', borderRadius: 8, fontSize: 12.5, color: ui.danger, lineHeight: 1.45, ...style }}
    >
      {children}
    </div>
  );
}
```

- [ ] **Step 2: `directory-client.tsx` — RowMenu**

Add `import { ErrorBanner } from '@/components/inspect/error-banner';`. Inside `RowMenu`, next to `const [confirming, setConfirming] = useState(false);` add `const [error, setError] = useState<string | null>(null);`. Change `runArchiveOrRestore`:

```tsx
  function runArchiveOrRestore(fn: (id: string) => Promise<{ error?: string } | undefined>) {
    startTransition(async () => {
      const r = await fn(id);
      if (r?.error) {
        setError(r.error);
        return; // keep the menu open so the message is read in place
      }
      router.refresh();
      onClose();
    });
  }
```

Render the banner as the last child of the menu's root `<div ref={ref} …>`, before the closing tag (after the `{confirming && (<ConfirmDialog …/>)}` block):

```tsx
      {error && <ErrorBanner style={{ margin: 8, padding: '8px 10px', fontSize: 12 }}>{error}</ErrorBanner>}
```

- [ ] **Step 3: `row-actions.tsx`**

Add the import. Next to `const [reassigning, setReassigning] = useState(false);` add `const [error, setError] = useState<string | null>(null);`. Change `run`:

```tsx
  function run(fn: () => Promise<{ error?: string }>) {
    startTransition(async () => {
      const r = await fn();
      if (r.error) {
        setError(r.error);
        return;
      }
      router.refresh();
      setOpen(false);
      setReassigning(false);
    });
  }
```

Replace the copy-link `alert(...)` with `setError('Could not copy the link — copy it from the address bar after opening the inspection.');` and remove the `setOpen(false)` that follows it inside the `catch` path only (keep it after a successful copy):

```tsx
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(`${window.location.origin}/inspections/${id}/review`);
                setOpen(false);
              } catch {
                setError('Could not copy the link — copy it from the address bar after opening the inspection.');
              }
            }}
```

Render inside the menu popover `<div style={{ position: 'absolute', right: 0, top: 32 … }}>` as its last child:

```tsx
          {error && <ErrorBanner style={{ margin: 8, padding: '8px 10px', fontSize: 12 }}>{error}</ErrorBanner>}
```

Also clear it when the menu opens: change the trigger to `onClick={() => { setOpen(!open); setError(null); }}`.

- [ ] **Step 4: `presets-list.tsx`**

Add the import and `const [error, setError] = useState<string | null>(null);` beside the existing `useState` calls. Change `handleArchive`:

```tsx
  function handleArchive(id: string) {
    startTransition(async () => {
      const result = await archivePreset(id);
      if (result.error) {
        setError(result.error);
      } else {
        setError(null);
        setPresets((prev) => prev.filter((p) => p.id !== id));
      }
      setMenuOpen(null);
    });
  }
```

Render directly above the `<div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)' … }}>`:

```tsx
      {error && <ErrorBanner style={{ marginBottom: 12 }}>{error}</ErrorBanner>}
```

- [ ] **Step 5: `users-client.tsx` — the member row**

Add the import. In the row component (the one holding `const [role, setRole] = useState(...)` and `const [menuOpen, setMenuOpen] = useState(false)`), add `const [rowError, setRowError] = useState<string | null>(null);`. Replace the three `alert(r.error)` calls with `setRowError(r.error)`; in the role `onChange` keep `setRole(row.apiRole)` after it. Render under the role `<select>` in the same `<td>`:

```tsx
        {rowError && <ErrorBanner style={{ marginTop: 6, padding: '6px 10px', fontSize: 12 }}>{rowError}</ErrorBanner>}
```

- [ ] **Step 6: Verify no `alert(` remains and gates pass**

Run: `grep -rn "alert(" "apps/web/app/(console)" --include=*.tsx | grep -v "Alert\."` → no output.
Run: `pnpm --filter @inspect/web type-check && pnpm --filter @inspect/web lint && pnpm --filter @inspect/web test` → clean, 47 passing.

- [ ] **Step 7: Commit**

```bash
git add apps/web/components/inspect/error-banner.tsx "apps/web/app/(console)/dashboard/directory-client.tsx" "apps/web/app/(console)/inspections/row-actions.tsx" "apps/web/app/(console)/presets/presets-list.tsx" "apps/web/app/(console)/users/users-client.tsx"
git commit -m "fix(web): INS-091 — ErrorBanner replaces every alert(); errors render beside the control"
```

---

### Task 6: Web quick-create actions + Company and Product dialogs

**Files:**
- Modify: `apps/web/app/(console)/dashboard/actions.ts` (append), `apps/web/app/(console)/products/actions.ts` (append), `apps/web/app/(console)/purchase-orders/actions.ts` (append)
- Create: `apps/web/components/inspect/quick-create/quick-create-company.tsx`, `apps/web/components/inspect/quick-create/quick-create-product.tsx`

**Interfaces:**
- Consumes: `Modal` (Task 3), `ErrorBanner` (Task 5), `Btn` from `@/components/inspect/shell`, `apiPost`/`ApiError` from `@/lib/api`, `ApiCompany`/`ApiProduct`/`ApiPurchaseOrder`/`ApiCompanyKind` from `@/lib/api`.
- Produces:
  - `quickCreateCompany(input: { name: string; kind?: ApiCompanyKind }): Promise<{ data?: ApiCompany; error?: string }>`
  - `quickCreateProduct(input: { styleNumber: string; description?: string | null }): Promise<{ data?: ApiProduct; error?: string }>`
  - `quickCreatePurchaseOrder(input: { poNumber: string; clientCompanyId: string; factoryCompanyId: string; productId: string; totalQuantity?: number }): Promise<{ data?: ApiPurchaseOrder; error?: string }>`
  - `QuickCreateCompany({ open, onClose, onCreated: (c: ApiCompany) => void })`, `QuickCreateProduct({ open, onClose, onCreated: (p: ApiProduct) => void })` — both render `null` when `!open`.

- [ ] **Step 1: Append the actions**

`dashboard/actions.ts` — add `import type { ApiCompany, ApiCompanyKind } from '@/lib/api';` and append:

```ts
/**
 * INS-091 — quick-create from a picker. Returns the DTO instead of redirecting
 * (a redirect inside a modal would throw the host form away). Mirrors
 * `createDefect` in presets/actions.ts.
 */
export async function quickCreateCompany(input: {
  name: string;
  kind?: ApiCompanyKind;
}): Promise<{ data?: ApiCompany; error?: string }> {
  const name = input.name.trim();
  if (!name) return { error: 'Name is required' };
  try {
    const data = await apiPost<ApiCompany>('/companies', { name, kind: input.kind });
    revalidatePath('/dashboard');
    return { data };
  } catch (e) {
    return { error: msg(e, 'create failed') };
  }
}
```

`products/actions.ts` — add `import type { ApiProduct } from '@/lib/api';` and append:

```ts
/** INS-091 — quick-create from a picker; returns the DTO, never redirects. */
export async function quickCreateProduct(input: {
  styleNumber: string;
  description?: string | null;
}): Promise<{ data?: ApiProduct; error?: string }> {
  const styleNumber = input.styleNumber.trim();
  if (!styleNumber) return { error: 'Style number is required' };
  const description =
    typeof input.description === 'string' && input.description.trim().length > 0 ? input.description : null;
  try {
    const data = await apiPost<ApiProduct>('/products', { styleNumber, description });
    revalidatePath('/products');
    return { data };
  } catch (e) {
    return { error: msg(e, 'Failed to create product') };
  }
}
```

`purchase-orders/actions.ts` — add `import type { ApiPurchaseOrder } from '@/lib/api';` and append:

```ts
/** INS-091 — quick-create from the new-inspection PO picker; returns the DTO. */
export async function quickCreatePurchaseOrder(input: {
  poNumber: string;
  clientCompanyId: string;
  factoryCompanyId: string;
  productId: string;
  totalQuantity?: number;
}): Promise<{ data?: ApiPurchaseOrder; error?: string }> {
  const poNumber = input.poNumber.trim();
  if (!poNumber) return { error: 'PO number is required' };
  if (!input.clientCompanyId || !input.factoryCompanyId || !input.productId) {
    return { error: 'Client, factory and product are required' };
  }
  try {
    const data = await apiPost<ApiPurchaseOrder>('/purchase-orders', { ...input, poNumber });
    revalidatePath('/purchase-orders');
    return { data };
  } catch (e) {
    return { error: msg(e, 'Failed to create purchase order') };
  }
}
```

- [ ] **Step 2: `QuickCreateCompany`**

```tsx
// apps/web/components/inspect/quick-create/quick-create-company.tsx
'use client';

import { useState, useTransition } from 'react';
import type { CSSProperties, FormEvent } from 'react';
import { Modal } from '@/components/inspect/modal';
import { ErrorBanner } from '@/components/inspect/error-banner';
import { Btn } from '@/components/inspect/shell';
import { ui } from '@/components/inspect/tokens';
import type { ApiCompany, ApiCompanyKind } from '@/lib/api';
import { quickCreateCompany } from '@/app/(console)/dashboard/actions';

export const qcLabel: CSSProperties = { display: 'block', fontSize: 11, fontWeight: 600, color: ui.sub, marginBottom: 4, textTransform: 'uppercase', letterSpacing: 0.4 };
export const qcInput: CSSProperties = { width: '100%', height: 36, padding: '0 10px', fontSize: 13, fontFamily: 'inherit', border: `1px solid ${ui.line}`, borderRadius: 8, outline: 'none', boxSizing: 'border-box' };

/**
 * INS-091 — create a company without leaving the form that needs it. Only
 * `name` is required by the API; branding + location are finished later on
 * /companies/[id]. On success the DTO goes to the host, which appends + selects.
 */
export function QuickCreateCompany({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: (company: ApiCompany) => void;
}) {
  const [name, setName] = useState('');
  const [kind, setKind] = useState<ApiCompanyKind>('THIRD_PARTY');
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  if (!open) return null;

  function submit(e: FormEvent) {
    e.preventDefault();
    start(async () => {
      const r = await quickCreateCompany({ name, kind });
      if (!r.data) {
        setError(r.error ?? 'create failed');
        return;
      }
      setName('');
      setError(null);
      onCreated(r.data);
    });
  }

  return (
    <Modal title="New company" onClose={onClose}>
      <form onSubmit={submit} style={{ marginTop: 14 }}>
        {error && <ErrorBanner style={{ marginBottom: 12 }}>{error}</ErrorBanner>}
        <div style={{ marginBottom: 14 }}>
          <label style={qcLabel} htmlFor="qc-company-name">Name *</label>
          <input id="qc-company-name" value={name} onChange={(e) => setName(e.target.value)} style={qcInput} placeholder="e.g. Northwind Apparel" required />
        </div>
        <div style={{ marginBottom: 14 }}>
          <label style={qcLabel} htmlFor="qc-company-kind">Kind</label>
          <select id="qc-company-kind" value={kind} onChange={(e) => setKind(e.target.value as ApiCompanyKind)} style={{ ...qcInput, cursor: 'pointer' }}>
            <option value="THIRD_PARTY">Third-party</option>
            <option value="INTERNAL">Internal</option>
          </select>
        </div>
        <div style={{ fontSize: 11.5, color: ui.faint, marginBottom: 16 }}>
          Branding and location can be added later from the directory.
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <Btn kind="ghost" onClick={onClose}>Cancel</Btn>
          <Btn kind="primary" type="submit" loading={pending} disabled={!name.trim()}>
            {pending ? 'Creating…' : 'Create company'}
          </Btn>
        </div>
      </form>
    </Modal>
  );
}
```

- [ ] **Step 3: `QuickCreateProduct`**

```tsx
// apps/web/components/inspect/quick-create/quick-create-product.tsx
'use client';

import { useState, useTransition } from 'react';
import type { FormEvent } from 'react';
import { Modal } from '@/components/inspect/modal';
import { ErrorBanner } from '@/components/inspect/error-banner';
import { Btn } from '@/components/inspect/shell';
import { ui } from '@/components/inspect/tokens';
import type { ApiProduct } from '@/lib/api';
import { quickCreateProduct } from '@/app/(console)/products/actions';
import { qcInput, qcLabel } from './quick-create-company';

/** INS-091 — create a product from the picker that needs it. */
export function QuickCreateProduct({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: (product: ApiProduct) => void;
}) {
  const [styleNumber, setStyleNumber] = useState('');
  const [description, setDescription] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  if (!open) return null;

  function submit(e: FormEvent) {
    e.preventDefault();
    start(async () => {
      const r = await quickCreateProduct({ styleNumber, description });
      if (!r.data) {
        setError(r.error ?? 'create failed');
        return;
      }
      setStyleNumber('');
      setDescription('');
      setError(null);
      onCreated(r.data);
    });
  }

  return (
    <Modal title="New product" onClose={onClose}>
      <form onSubmit={submit} style={{ marginTop: 14 }}>
        {error && <ErrorBanner style={{ marginBottom: 12 }}>{error}</ErrorBanner>}
        <div style={{ marginBottom: 14 }}>
          <label style={qcLabel} htmlFor="qc-style">Style number *</label>
          <input id="qc-style" value={styleNumber} onChange={(e) => setStyleNumber(e.target.value)} style={qcInput} placeholder="e.g. NV-2026-POLO-M" required />
        </div>
        <div style={{ marginBottom: 16 }}>
          <label style={qcLabel} htmlFor="qc-desc">Description</label>
          <textarea id="qc-desc" value={description} onChange={(e) => setDescription(e.target.value)} rows={3} style={{ ...qcInput, height: 'auto', padding: '8px 10px', resize: 'vertical', lineHeight: 1.5, color: ui.ink }} placeholder="Optional" />
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <Btn kind="ghost" onClick={onClose}>Cancel</Btn>
          <Btn kind="primary" type="submit" loading={pending} disabled={!styleNumber.trim()}>
            {pending ? 'Creating…' : 'Create product'}
          </Btn>
        </div>
      </form>
    </Modal>
  );
}
```

- [ ] **Step 4: Type-check + lint**

Run: `pnpm --filter @inspect/web type-check && pnpm --filter @inspect/web lint` → clean. (If the `@/app/(console)/...` import path is rejected by tsconfig's `@/app/*` alias, use the relative path `../../../app/(console)/dashboard/actions` instead.)

- [ ] **Step 5: Commit**

```bash
git add "apps/web/app/(console)/dashboard/actions.ts" "apps/web/app/(console)/products/actions.ts" "apps/web/app/(console)/purchase-orders/actions.ts" apps/web/components/inspect/quick-create
git commit -m "feat(web): INS-091 — quick-create actions (return the DTO, no redirect) + Company and Product dialogs"
```

---

### Task 7: Web PO form — searchable pickers with inline create

**Files:**
- Modify: `apps/web/app/(console)/purchase-orders/new/create-form.tsx`

**Interfaces:**
- Consumes: `EntityPicker` (Task 4), `QuickCreateCompany`/`QuickCreateProduct` (Task 6), `ErrorBanner` (Task 5), `rankCompaniesByActivity` from `@inspect/domain`.

- [ ] **Step 1: Rewrite the form**

Replace the file's contents with:

```tsx
'use client';

import { useActionState, useMemo, useState } from 'react';
import { rankCompaniesByActivity } from '@inspect/domain';
import { Btn } from '@/components/inspect/shell';
import { ui } from '@/components/inspect/tokens';
import { EntityPicker } from '@/components/inspect/entity-picker';
import { ErrorBanner } from '@/components/inspect/error-banner';
import { QuickCreateCompany } from '@/components/inspect/quick-create/quick-create-company';
import { QuickCreateProduct } from '@/components/inspect/quick-create/quick-create-product';
import type { ApiCompany, ApiProduct } from '@/lib/api';
import { createPurchaseOrder } from '../actions';

const label = { display: 'block', fontSize: 11, fontWeight: 600, color: ui.sub, marginBottom: 4, textTransform: 'uppercase' as const, letterSpacing: 0.4 };
const input = { width: '100%', height: 36, padding: '0 10px', fontSize: 13, fontFamily: 'inherit', border: `1px solid ${ui.line}`, borderRadius: 8, outline: 'none', boxSizing: 'border-box' as const };

type Creating = 'client' | 'factory' | 'product' | null;

/**
 * INS-055 — both party pickers are fed by the SAME company list, because trade
 * role is a property of this PO, not of the company. Ranking is a hint
 * (`rankCompaniesByActivity`, shared with mobile; per-role ranking is INS-087).
 *
 * INS-091 — every picker is searchable and ends in "+ Add new…": the company
 * or product is created in a dialog, appended to the list and selected, and
 * nothing typed here is lost. Lists live in state so they can grow.
 */
export function CreatePurchaseOrderForm({ companies: initialCompanies, products: initialProducts }: { companies: ApiCompany[]; products: ApiProduct[] }) {
  const [state, action, pending] = useActionState(createPurchaseOrder, {});
  const [companies, setCompanies] = useState(initialCompanies);
  const [products, setProducts] = useState(initialProducts);
  const [clientId, setClientId] = useState('');
  const [factoryId, setFactoryId] = useState('');
  const [productId, setProductId] = useState('');
  const [creating, setCreating] = useState<Creating>(null);

  const companyOptions = useMemo(
    () => rankCompaniesByActivity(companies).map((c) => ({ id: c.id, label: c.name })),
    [companies],
  );
  const productOptions = useMemo(
    () => products.map((p) => ({ id: p.id, label: p.styleNumber, hint: p.description ?? undefined })),
    [products],
  );

  // Mirrors the API's 400 (spec §2.4). The server check is the authority.
  const selfDealing = clientId !== '' && clientId === factoryId;
  const incomplete = !clientId || !factoryId || !productId;

  function onCompanyCreated(c: ApiCompany) {
    setCompanies((prev) => [...prev, c]);
    if (creating === 'client') setClientId(c.id);
    if (creating === 'factory') setFactoryId(c.id);
    setCreating(null);
  }
  function onProductCreated(p: ApiProduct) {
    setProducts((prev) => [...prev, p]);
    setProductId(p.id);
    setCreating(null);
  }

  return (
    <div style={{ marginTop: 24, maxWidth: 560, background: '#fff', border: `1px solid ${ui.line}`, borderRadius: 12, padding: '24px 28px' }}>
      <form action={action}>
        {state.error && <ErrorBanner style={{ marginBottom: 14 }}>{state.error}</ErrorBanner>}
        <div style={{ marginBottom: 16 }}>
          <label style={label}>PO Number *</label>
          <input name="poNumber" style={input} placeholder="e.g. PO-2026-NV-0042" required />
        </div>
        <div style={{ marginBottom: 16 }}>
          <EntityPicker
            name="clientCompanyId"
            label="Client *"
            options={companyOptions}
            value={clientId}
            onChange={setClientId}
            placeholder="Select the client…"
            emptyText="No companies yet."
            hintText="Receives the branded report."
            createLabel="+ Add new company…"
            onCreate={() => setCreating('client')}
          />
        </div>
        <div style={{ marginBottom: 16 }}>
          <EntityPicker
            name="factoryCompanyId"
            label="Factory *"
            options={companyOptions}
            value={factoryId}
            onChange={setFactoryId}
            placeholder="Select the factory…"
            emptyText="No companies yet."
            invalid={selfDealing}
            hintText={selfDealing ? 'Client and factory must differ.' : 'Produces the goods being inspected.'}
            createLabel="+ Add new company…"
            onCreate={() => setCreating('factory')}
          />
        </div>
        <div style={{ marginBottom: 16 }}>
          <EntityPicker
            name="productId"
            label="Product *"
            options={productOptions}
            value={productId}
            onChange={setProductId}
            placeholder="Select product…"
            emptyText="No products yet."
            createLabel="+ Add new product…"
            onCreate={() => setCreating('product')}
          />
        </div>
        <div style={{ marginBottom: 20 }}>
          <label style={label}>Total Quantity</label>
          <input name="totalQuantity" type="number" min={1} style={input} placeholder="e.g. 1200" />
        </div>
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <Btn kind="ghost" href="/purchase-orders">Cancel</Btn>
          <Btn kind="primary" type="submit" loading={pending} disabled={selfDealing || incomplete}>
            {pending ? 'Creating…' : 'Create PO'}
          </Btn>
        </div>
      </form>

      <QuickCreateCompany open={creating === 'client' || creating === 'factory'} onClose={() => setCreating(null)} onCreated={onCompanyCreated} />
      <QuickCreateProduct open={creating === 'product'} onClose={() => setCreating(null)} onCreated={onProductCreated} />
    </div>
  );
}
```

- [ ] **Step 2: Gates**

Run: `pnpm --filter @inspect/web type-check && pnpm --filter @inspect/web lint` → clean.

- [ ] **Step 3: Browser check (local stack)**

Start `pnpm dev` (API + web; needs the root `.env`). Log in as a QA Manager or owner of Acme Apparel Group, open `http://localhost:3001/purchase-orders/new`. Verify: the Client picker opens with a search box; typing filters; "+ Add new company…" opens a dialog; creating one appends and selects it; the PO number typed beforehand is still there; a duplicate PO number shows the 409 message in the banner.

- [ ] **Step 4: Commit**

```bash
git add "apps/web/app/(console)/purchase-orders/new/create-form.tsx"
git commit -m "feat(web): INS-091 — PO form: searchable pickers with inline company/product create"
```

---

### Task 8: Web new-inspection form — PO inline create, no dead end, default preset

**Files:**
- Create: `apps/web/components/inspect/quick-create/quick-create-purchase-order.tsx`
- Modify: `apps/web/app/(console)/inspections/new/page.tsx`, `apps/web/app/(console)/inspections/new/create-form.tsx`

**Interfaces:**
- Consumes: `quickCreatePurchaseOrder` (Task 6), `EntityPicker`, `QuickCreateCompany`, `QuickCreateProduct`, `Modal`, `ErrorBanner`, `PurchaseOrderDto.clientCompany.defaultLoopPresetId` (Task 2).
- Produces: `QuickCreatePurchaseOrder({ open, onClose, onCreated: (po: ApiPurchaseOrder) => void, companies: ApiCompany[], products: ApiProduct[] })`.

- [ ] **Step 1: `QuickCreatePurchaseOrder`**

```tsx
// apps/web/components/inspect/quick-create/quick-create-purchase-order.tsx
'use client';

import { useMemo, useState, useTransition } from 'react';
import type { FormEvent } from 'react';
import { rankCompaniesByActivity } from '@inspect/domain';
import { Modal } from '@/components/inspect/modal';
import { ErrorBanner } from '@/components/inspect/error-banner';
import { EntityPicker } from '@/components/inspect/entity-picker';
import { Btn } from '@/components/inspect/shell';
import type { ApiCompany, ApiProduct, ApiPurchaseOrder } from '@/lib/api';
import { quickCreatePurchaseOrder } from '@/app/(console)/purchase-orders/actions';
import { QuickCreateCompany, qcInput, qcLabel } from './quick-create-company';
import { QuickCreateProduct } from './quick-create-product';

type Creating = 'client' | 'factory' | 'product' | null;

/**
 * INS-091 — a PO created from the new-inspection picker. It needs two
 * companies and a product, so it carries the same three pickers as the PO
 * form, each with its own "+ Add new…" (one level of nested dialog). The host
 * passes the lists it already loaded; rows created here stay local to the
 * dialog and are selected as they are created.
 */
export function QuickCreatePurchaseOrder({
  open,
  onClose,
  onCreated,
  companies: initialCompanies,
  products: initialProducts,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: (po: ApiPurchaseOrder) => void;
  companies: ApiCompany[];
  products: ApiProduct[];
}) {
  const [companies, setCompanies] = useState(initialCompanies);
  const [products, setProducts] = useState(initialProducts);
  const [poNumber, setPoNumber] = useState('');
  const [clientId, setClientId] = useState('');
  const [factoryId, setFactoryId] = useState('');
  const [productId, setProductId] = useState('');
  const [qty, setQty] = useState('');
  const [creating, setCreating] = useState<Creating>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const companyOptions = useMemo(
    () => rankCompaniesByActivity(companies).map((c) => ({ id: c.id, label: c.name })),
    [companies],
  );
  const productOptions = useMemo(
    () => products.map((p) => ({ id: p.id, label: p.styleNumber, hint: p.description ?? undefined })),
    [products],
  );
  const selfDealing = clientId !== '' && clientId === factoryId;
  const ready = poNumber.trim() !== '' && clientId && factoryId && productId && !selfDealing;

  if (!open) return null;

  function submit(e: FormEvent) {
    e.preventDefault();
    if (!ready) return;
    start(async () => {
      const r = await quickCreatePurchaseOrder({
        poNumber,
        clientCompanyId: clientId,
        factoryCompanyId: factoryId,
        productId,
        totalQuantity: qty.trim() ? Number(qty) : undefined,
      });
      if (!r.data) {
        setError(r.error ?? 'create failed');
        return;
      }
      setError(null);
      onCreated(r.data);
    });
  }

  return (
    <Modal title="New purchase order" onClose={onClose} width={520}>
      <form onSubmit={submit} style={{ marginTop: 14 }}>
        {error && <ErrorBanner style={{ marginBottom: 12 }}>{error}</ErrorBanner>}
        <div style={{ marginBottom: 14 }}>
          <label style={qcLabel} htmlFor="qc-po-number">PO number *</label>
          <input id="qc-po-number" value={poNumber} onChange={(e) => setPoNumber(e.target.value)} style={qcInput} placeholder="e.g. PO-2026-NV-0042" required />
        </div>
        <div style={{ marginBottom: 14 }}>
          <EntityPicker label="Client *" options={companyOptions} value={clientId} onChange={setClientId} placeholder="Select the client…" emptyText="No companies yet." hintText="Receives the branded report." createLabel="+ Add new company…" onCreate={() => setCreating('client')} />
        </div>
        <div style={{ marginBottom: 14 }}>
          <EntityPicker label="Factory *" options={companyOptions} value={factoryId} onChange={setFactoryId} placeholder="Select the factory…" emptyText="No companies yet." invalid={selfDealing} hintText={selfDealing ? 'Client and factory must differ.' : 'Produces the goods being inspected.'} createLabel="+ Add new company…" onCreate={() => setCreating('factory')} />
        </div>
        <div style={{ marginBottom: 14 }}>
          <EntityPicker label="Product *" options={productOptions} value={productId} onChange={setProductId} placeholder="Select product…" emptyText="No products yet." createLabel="+ Add new product…" onCreate={() => setCreating('product')} />
        </div>
        <div style={{ marginBottom: 16 }}>
          <label style={qcLabel} htmlFor="qc-po-qty">Total quantity</label>
          <input id="qc-po-qty" type="number" min={1} value={qty} onChange={(e) => setQty(e.target.value)} style={qcInput} placeholder="Optional" />
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <Btn kind="ghost" onClick={onClose}>Cancel</Btn>
          <Btn kind="primary" type="submit" loading={pending} disabled={!ready}>
            {pending ? 'Creating…' : 'Create PO'}
          </Btn>
        </div>
      </form>

      <QuickCreateCompany
        open={creating === 'client' || creating === 'factory'}
        onClose={() => setCreating(null)}
        onCreated={(c) => {
          setCompanies((prev) => [...prev, c]);
          if (creating === 'client') setClientId(c.id);
          if (creating === 'factory') setFactoryId(c.id);
          setCreating(null);
        }}
      />
      <QuickCreateProduct
        open={creating === 'product'}
        onClose={() => setCreating(null)}
        onCreated={(p) => {
          setProducts((prev) => [...prev, p]);
          setProductId(p.id);
          setCreating(null);
        }}
      />
    </Modal>
  );
}
```

- [ ] **Step 2: `page.tsx` — load companies and products too**

Replace the `Promise.all` block and the render of the form:

```tsx
  const [pos, presets, users, companies, products] = await Promise.all([
    apiGet<ApiPurchaseOrder[]>('/purchase-orders').catch(() => []),
    apiGet<ApiLoopPreset[]>('/loop-presets').catch(() => []),
    apiGet<ApiUser[]>('/users').catch(() => []),
    apiGet<ApiCompany[]>('/companies').catch(() => []),
    apiGet<ApiProduct[]>('/products').catch(() => []),
  ]);
  const inspectors = users.filter((u) => u.role === 'INSPECTOR' && u.status === 'ACTIVE');
  …
        <CreateInspectionForm pos={pos} presets={presets} inspectors={inspectors} companies={companies} products={products} />
```

and extend the import: `import { apiGet, type ApiPurchaseOrder, type ApiLoopPreset, type ApiUser, type ApiCompany, type ApiProduct } from '@/lib/api';`.

- [ ] **Step 3: `create-form.tsx` — PO picker, no dead end, controlled preset with default rule**

Make these edits in `apps/web/app/(console)/inspections/new/create-form.tsx`:

Imports — add:

```tsx
import Link from 'next/link';
import { EntityPicker } from '@/components/inspect/entity-picker';
import { ErrorBanner } from '@/components/inspect/error-banner';
import { QuickCreatePurchaseOrder } from '@/components/inspect/quick-create/quick-create-purchase-order';
import type { ApiCompany, ApiProduct } from '@/lib/api';
```

Signature and state — replace the function head and the `poId` state:

```tsx
export function CreateInspectionForm({ pos: initialPos, presets, inspectors, companies, products }: { pos: ApiPurchaseOrder[]; presets: ApiLoopPreset[]; inspectors: ApiUser[]; companies: ApiCompany[]; products: ApiProduct[] }) {
  const [state, action, pending] = useActionState(createInspection, {} as { error?: string });
  const [pos, setPos] = useState(initialPos);
  const [poId, setPoId] = useState(initialPos[0]?.id ?? '');
  const [presetId, setPresetId] = useState(presets[0]?.id ?? '');
  const [presetTouched, setPresetTouched] = useState(false);
  const [creatingPo, setCreatingPo] = useState(false);
```

Add, after `const po = pos.find((p) => p.id === poId);`:

```tsx
  // INS-091 — the client's default preset is written by both company forms
  // and, until now, read by nothing. Applied on PO change while the user has
  // not chosen a preset by hand; skipped when the id is not in the list.
  function selectPo(nextId: string) {
    setPoId(nextId);
    if (presetTouched) return;
    const next = pos.find((p) => p.id === nextId);
    const preferred = next?.clientCompany?.defaultLoopPresetId;
    if (preferred && presets.some((p) => p.id === preferred)) setPresetId(preferred);
  }
```

Delete the block:

```tsx
  if (pos.length === 0) {
    return <div style={card}>No purchase orders yet. Create two companies (the client and the factory), a product and a PO first, then return here.</div>;
  }
```

Remove the line `<input type="hidden" name="poId" value={poId} />` (the picker writes it). Replace the PO `<div style={{ ...field, marginTop: 14 }}> … </select></div>` with:

```tsx
          <div style={{ marginTop: 14 }}>
            <EntityPicker
              name="poId"
              label="PO"
              options={pos.map((p) => ({ id: p.id, label: p.poNumber, hint: p.clientCompany?.name ?? undefined }))}
              value={poId}
              onChange={selectPo}
              placeholder="Select the PO…"
              emptyText="No purchase orders yet — add one below."
              createLabel="+ Add new purchase order…"
              onCreate={() => setCreatingPo(true)}
            />
          </div>
```

Replace the preset `<select name="loopPresetId" defaultValue=… >` with a controlled select plus an empty-state link:

```tsx
            {presets.length === 0 ? (
              <div style={{ fontSize: 12.5, color: ui.sub }}>
                No loop presets yet. <Link href="/presets/new" style={{ color: ui.accent, fontWeight: 550 }}>Create one in the preset builder</Link>, then return here.
              </div>
            ) : (
              <select
                name="loopPresetId"
                value={presetId}
                onChange={(e) => { setPresetId(e.target.value); setPresetTouched(true); }}
                style={{ ...input, cursor: 'pointer' }}
              >
                {presets.map((p) => <option key={p.id} value={p.id}>{p.name} (v{p.version})</option>)}
              </select>
            )}
```

Replace `{state?.error && <div style={{ color: ui.danger, fontSize: 13 }}>{state.error}</div>}` with `{state?.error && <ErrorBanner>{state.error}</ErrorBanner>}`. Add `disabled={pending || !poId || !presetId}` to the submit `<button>` (it currently has `disabled={pending}`).

Render the dialog as the last child of the `<form>` (it portals out, so nesting is fine):

```tsx
      <QuickCreatePurchaseOrder
        open={creatingPo}
        onClose={() => setCreatingPo(false)}
        companies={companies}
        products={products}
        onCreated={(created) => {
          setPos((prev) => [created, ...prev]);
          setCreatingPo(false);
          selectPo(created.id);
        }}
      />
```

Note `selectPo` reads `pos` from the current render, which does not yet include `created`; so change `selectPo` to accept an optional row: `function selectPo(nextId: string, row?: ApiPurchaseOrder)` and use `const next = row ?? pos.find(...)`; call it as `selectPo(created.id, created)`.

- [ ] **Step 4: Gates + browser check**

Run: `pnpm --filter @inspect/web type-check && pnpm --filter @inspect/web lint && pnpm --filter @inspect/web test` → clean, 47 passing.

Browser, on an org with no POs (or a fresh org via `/admin/orgs`): `/inspections/new` renders the form; the PO picker shows "No purchase orders yet — add one below." and "+ Add new purchase order…"; the dialog's Client picker → "+ Add new company…" opens a second modal on top; Escape closes only the inner one; after creating client, factory, product and the PO, the PO is selected and the client/factory/product line under it fills in; if the client company has a default preset (set one on `/companies/[id]` first), the preset select jumps to it; Create inspection lands on the review page.

- [ ] **Step 5: Commit**

```bash
git add apps/web/components/inspect/quick-create/quick-create-purchase-order.tsx "apps/web/app/(console)/inspections/new/page.tsx" "apps/web/app/(console)/inspections/new/create-form.tsx"
git commit -m "feat(web): INS-091 — new inspection: PO picker with nested quick-create, no dead-end empty state, client default preset honoured"
```

---

### Task 9: Mobile `OptionPicker` — search, empty text, "+ Add new…" footer, 44pt rows

**Files:**
- Modify: `apps/mobile/src/components/option-picker.tsx`

**Interfaces:**
- Consumes: `filterOptions` from `@inspect/domain` (Task 1).
- Produces: the existing props plus `searchable?: boolean`, `emptyText?: string`, `createLabel?: string`, `onCreate?: () => void`. All optional; the nine call sites keep compiling.

- [ ] **Step 1: Rewrite the component**

```tsx
/**
 * A minimal cross-platform select: a labelled field that opens a modal option
 * list. Extracted from /inspections/new when the company edit screen needed
 * the same control — one picker, not one per screen.
 *
 * INS-091: searchable (shared `filterOptions`, so web and mobile match alike),
 * an `emptyText` instead of a blank box, an optional "+ Add new…" footer that
 * hands control to the host (it never changes the value), 44pt rows.
 */
import { palette } from '@inspect/design-tokens';
import { filterOptions } from '@inspect/domain';
import { useMemo, useState } from 'react';
import {
  FlatList,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

export function OptionPicker<T>(props: {
  label: string;
  value: T | null;
  options: T[];
  display: (v: T) => string;
  placeholder: string;
  onSelect: (v: T) => void;
  /** Show the search field even for short lists (default: > 6 options). */
  searchable?: boolean;
  emptyText?: string;
  createLabel?: string;
  onCreate?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const showSearch = props.searchable ?? props.options.length > 6;
  const filtered = useMemo(
    () => filterOptions(query, props.options, props.display),
    [query, props.options, props.display],
  );

  function close() {
    setOpen(false);
    setQuery('');
  }

  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{props.label}</Text>
      <Pressable style={styles.select} onPress={() => setOpen(true)} accessibilityRole="button">
        <Text style={props.value == null ? styles.selectPlaceholder : styles.selectValue}>
          {props.value == null ? props.placeholder : props.display(props.value)}
        </Text>
      </Pressable>
      <Modal visible={open} transparent animationType="fade" onRequestClose={close}>
        <KeyboardAvoidingView
          style={styles.pickerBackdrop}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
          <Pressable style={styles.backdropTouch} onPress={close} />
          <View style={styles.pickerBody}>
            {showSearch ? (
              <TextInput
                style={styles.search}
                value={query}
                onChangeText={setQuery}
                placeholder="Search…"
                placeholderTextColor={palette.faint}
                autoFocus
                autoCapitalize="none"
                autoCorrect={false}
              />
            ) : null}
            <FlatList
              data={filtered}
              keyExtractor={(_, i) => String(i)}
              keyboardShouldPersistTaps="handled"
              ListEmptyComponent={
                <Text style={styles.emptyText}>
                  {query ? 'No matches.' : (props.emptyText ?? 'Nothing to choose from yet.')}
                </Text>
              }
              renderItem={({ item }) => (
                <Pressable
                  style={styles.pickerRow}
                  onPress={() => {
                    props.onSelect(item);
                    close();
                  }}
                >
                  <Text style={styles.pickerRowText}>{props.display(item)}</Text>
                </Pressable>
              )}
            />
            {props.onCreate ? (
              <Pressable
                style={[styles.pickerRow, styles.createRow]}
                onPress={() => {
                  close();
                  props.onCreate?.();
                }}
              >
                <Text style={styles.createRowText}>{props.createLabel ?? '+ Add new…'}</Text>
              </Pressable>
            ) : null}
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  field: { gap: 6 },
  fieldLabel: {
    color: palette.faint,
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.6,
    textTransform: 'uppercase',
  },
  select: {
    borderWidth: 1,
    borderColor: palette.line,
    borderRadius: 8,
    backgroundColor: palette.panel,
    paddingHorizontal: 12,
    paddingVertical: 11,
    minHeight: 44,
    justifyContent: 'center',
  },
  selectValue: { color: palette.ink, fontSize: 14 },
  selectPlaceholder: { color: palette.faint, fontSize: 14 },
  pickerBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(11,18,32,0.45)',
    justifyContent: 'center',
    padding: 32,
  },
  backdropTouch: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0 },
  pickerBody: {
    backgroundColor: palette.bg,
    borderRadius: 12,
    maxHeight: '70%',
    overflow: 'hidden',
  },
  search: {
    height: 44,
    paddingHorizontal: 16,
    fontSize: 14,
    color: palette.ink,
    backgroundColor: palette.panel,
    borderBottomWidth: 1,
    borderBottomColor: palette.line,
  },
  pickerRow: {
    minHeight: 44,
    paddingHorizontal: 16,
    paddingVertical: 12,
    justifyContent: 'center',
    borderBottomWidth: 1,
    borderBottomColor: palette.lineSoft,
  },
  pickerRowText: { color: palette.ink, fontSize: 14 },
  emptyText: { color: palette.faint, fontSize: 13, padding: 16 },
  createRow: { borderBottomWidth: 0, borderTopWidth: 1, borderTopColor: palette.line, backgroundColor: palette.panel },
  createRowText: { color: palette.accent, fontSize: 14, fontWeight: '600' },
});
```

- [ ] **Step 2: Gates**

Run: `pnpm build --filter @inspect/domain` (so mobile's `tsc` sees `filterOptions` in `dist`), then `pnpm --filter @inspect/mobile type-check && pnpm --filter @inspect/mobile lint` → clean.

- [ ] **Step 3: Commit**

```bash
git add apps/mobile/src/components/option-picker.tsx
git commit -m "feat(mobile): INS-091 — OptionPicker: search, emptyText, '+ Add new…' footer, 44pt rows"
```

---

### Task 10: Mobile `FormScreen` + keyboard-safe form screens

**Files:**
- Create: `apps/mobile/src/components/form-screen.tsx`
- Modify: `apps/mobile/src/app/products/new.tsx`, `purchase-orders/new.tsx`, `inspections/new.tsx`, `presets/new.tsx`, `users.tsx`, `companies/[id]/index.tsx`, `companies/[id]/guests.tsx`, `inspections/[id]/review.tsx`, `products/[id].tsx`, `purchase-orders/[id].tsx`, `invite.tsx`

**Interfaces:**
- Produces: `FormScreen({ children, header?, contentStyle? })`. Used by Tasks 11–13 and the screens above.

- [ ] **Step 1: Create the wrapper**

```tsx
// apps/mobile/src/components/form-screen.tsx
/**
 * INS-091 — every form screen's shell. Before this, only /login avoided the
 * keyboard and no screen persisted taps, so the first tap on a button with the
 * keyboard up only dismissed the keyboard. One wrapper, one behaviour.
 */
import { palette } from '@inspect/design-tokens';
import type { ReactNode } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet } from 'react-native';
import type { StyleProp, ViewStyle } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

export function FormScreen({
  children,
  header,
  contentStyle,
}: {
  children: ReactNode;
  /** Rendered above the scrolling body, outside the keyboard-avoiding area. */
  header?: ReactNode;
  contentStyle?: StyleProp<ViewStyle>;
}) {
  return (
    <SafeAreaView style={styles.screen}>
      {header}
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView
          contentContainerStyle={[styles.body, contentStyle]}
          keyboardShouldPersistTaps="handled"
        >
          {children}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: palette.bg },
  flex: { flex: 1 },
  body: { padding: 16, gap: 12, paddingBottom: 40 },
});
```

- [ ] **Step 2: Adopt it — worked example `products/new.tsx`**

Replace the ready-state return's outer shell. Before:

```tsx
  return (
    <SafeAreaView style={styles.screen}>
      <ScrollView contentContainerStyle={styles.body}>
        <BackButton label="Cancel" fallbackHref="/products" />
        …
      </ScrollView>
    </SafeAreaView>
  );
```

After:

```tsx
  return (
    <FormScreen>
      <BackButton label="Cancel" fallbackHref="/products" />
      …
    </FormScreen>
  );
```

Add `import { FormScreen } from '@/components/form-screen';`. Keep `SafeAreaView` imported only if the loading/forbidden branches still use it (they do here). Remove `ScrollView` from the `react-native` import if nothing else uses it; delete the now-unused `styles.body` entry (lint flags unused styles only if `react-native/no-unused-styles` is on — if it is not, leave it).

- [ ] **Step 3: Adopt it on the other ten screens**

Apply the same mechanical rule to each file's **ready-state** return only — loading/forbidden/error branches keep their `SafeAreaView`:

| File | What wraps the body today | Rule |
|---|---|---|
| `purchase-orders/new.tsx` | `SafeAreaView > ScrollView(styles.body)` | as the example |
| `inspections/new.tsx` | `SafeAreaView > View(styles.header) + ScrollView(styles.body)` | `<FormScreen header={<View style={styles.header}>…</View>}>` |
| `presets/new.tsx` | `SafeAreaView > View(header) + ScrollView` | header prop |
| `users.tsx` | `SafeAreaView > ScrollView` (roster + invite form) | as the example; pass `contentStyle` if its body padding differs |
| `companies/[id]/index.tsx` | `SafeAreaView > ScrollView` | as the example |
| `companies/[id]/guests.tsx` | `SafeAreaView > ScrollView` | as the example |
| `inspections/[id]/review.tsx` | `SafeAreaView > ScrollView` | as the example |
| `products/[id].tsx` | `SafeAreaView > ScrollView` | as the example |
| `purchase-orders/[id].tsx` | `SafeAreaView > ScrollView` | as the example |
| `invite.tsx` | `SafeAreaView > ScrollView` | as the example |

Where a screen's `ScrollView` carries a `RefreshControl`, keep that screen's own `ScrollView` and instead add `keyboardShouldPersistTaps="handled"` to it and wrap it in `KeyboardAvoidingView` inline — do not force it through `FormScreen`. (None of the ten are expected to, but check.)

- [ ] **Step 4: Gates**

Run: `pnpm --filter @inspect/mobile type-check && pnpm --filter @inspect/mobile lint` → clean.
Run from `apps/mobile`: `npx expo export --platform android --output-dir ../../.tmp-export` then `rm -rf ../../.tmp-export` → bundles green, 25 routes.

- [ ] **Step 5: Commit**

```bash
git add apps/mobile/src/components/form-screen.tsx apps/mobile/src/app
git commit -m "fix(mobile): INS-091 — FormScreen: keyboard avoidance + persistent taps on every form screen"
```

---

### Task 11: Mobile `QuickCreateSheet` + Company/Product sheets + "New" on the directory

**Files:**
- Create: `apps/mobile/src/components/quick-create-sheet.tsx`, `apps/mobile/src/components/quick-create/company.tsx`, `apps/mobile/src/components/quick-create/product.tsx`
- Modify: `apps/mobile/src/app/companies/index.tsx` (header, ~lines 183-190; header comment)

**Interfaces:**
- Consumes: `client` from `@/lib/session`; `CreateCompanyInput`, `CompanyDto`, `CompanyKind`, `CreateProductInput`, `ProductDto` from `@inspect/shared-types`; `ApiError` from `@inspect/api-client`.
- Produces:
  - `QuickCreateSheet({ visible, title, onClose, children })`
  - `QuickCreateCompanySheet({ visible, onClose, onCreated: (c: CompanyDto) => void })`
  - `QuickCreateProductSheet({ visible, onClose, onCreated: (p: ProductDto) => void })`
  - `describeCreateError(e: unknown, fallback: string): string` exported from `quick-create-sheet.tsx`.

- [ ] **Step 1: The sheet shell**

```tsx
// apps/mobile/src/components/quick-create-sheet.tsx
/**
 * INS-091 — the bottom sheet that hosts a quick-create form. Same chrome as
 * the capture unit sheet (handle row, title, Cancel), plus keyboard avoidance
 * and persistent taps so the form is usable with the keyboard up.
 */
import { ApiError } from '@inspect/api-client';
import { palette } from '@inspect/design-tokens';
import type { ReactNode } from 'react';
import {
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

export function QuickCreateSheet({
  visible,
  title,
  onClose,
  children,
}: {
  visible: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView
        style={styles.backdrop}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <Pressable style={styles.backdropTouch} onPress={onClose} />
        <View style={styles.body}>
          <View style={styles.handleRow}>
            <Text style={styles.title}>{title}</Text>
            <Pressable onPress={onClose} hitSlop={8}>
              <Text style={styles.link}>Cancel</Text>
            </Pressable>
          </View>
          <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.content}>
            {children}
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

/** Network failures are not ApiErrors; say so in words, not a TypeError. */
export function describeCreateError(e: unknown, fallback: string): string {
  if (e instanceof ApiError) return e.message;
  if (e instanceof TypeError) return 'No connection. Check the network and try again.';
  return e instanceof Error ? e.message : fallback;
}

/** Shared field styles for the three sheet forms. */
export const sheetStyles = StyleSheet.create({
  field: { gap: 6 },
  fieldLabel: {
    color: palette.faint,
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.6,
    textTransform: 'uppercase',
  },
  input: {
    borderWidth: 1,
    borderColor: palette.line,
    borderRadius: 8,
    backgroundColor: palette.panel,
    paddingHorizontal: 12,
    paddingVertical: 11,
    color: palette.ink,
    fontSize: 14,
    minHeight: 44,
  },
  chipRow: { flexDirection: 'row', gap: 8 },
  chip: {
    borderWidth: 1,
    borderColor: palette.line,
    borderRadius: 999,
    paddingHorizontal: 12,
    minHeight: 36,
    justifyContent: 'center',
    backgroundColor: palette.panel,
  },
  chipActive: { borderColor: palette.accent, backgroundColor: palette.accentSoft },
  chipText: { color: palette.sub, fontSize: 13, fontWeight: '600' },
  chipTextActive: { color: palette.accent },
  hint: { color: palette.faint, fontSize: 12, lineHeight: 17 },
  errorText: { color: palette.danger, fontSize: 13 },
  button: {
    backgroundColor: palette.accent,
    borderRadius: 8,
    alignItems: 'center',
    paddingVertical: 12,
    minHeight: 44,
    justifyContent: 'center',
  },
  buttonDisabled: { opacity: 0.5 },
  buttonLabel: { color: '#fff', fontSize: 15, fontWeight: '700' },
});

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(11,18,32,0.45)',
    justifyContent: 'flex-end',
  },
  backdropTouch: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0 },
  body: {
    backgroundColor: palette.bg,
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    maxHeight: '85%',
    paddingTop: 16,
  },
  handleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    marginBottom: 12,
  },
  title: { color: palette.ink, fontSize: 16, fontWeight: '700' },
  link: { color: palette.accent, fontSize: 14, fontWeight: '600' },
  content: { paddingHorizontal: 16, paddingBottom: 32, gap: 12 },
});
```

- [ ] **Step 2: Company sheet**

```tsx
// apps/mobile/src/components/quick-create/company.tsx
/**
 * INS-091 — the phone's FIRST company create (the directory was read-only).
 * Only `name` is required by the API; branding + location are finished on
 * /companies/[id]. Same pending/error/append/auto-select pattern as the preset
 * builder's custom-defect row.
 */
import { palette } from '@inspect/design-tokens';
import type { CompanyDto, CompanyKind, CreateCompanyInput } from '@inspect/shared-types';
import { useState } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';

import { client } from '@/lib/session';
import { QuickCreateSheet, describeCreateError, sheetStyles as s } from '../quick-create-sheet';

export function QuickCreateCompanySheet({
  visible,
  onClose,
  onCreated,
}: {
  visible: boolean;
  onClose: () => void;
  onCreated: (company: CompanyDto) => void;
}) {
  const [name, setName] = useState('');
  const [kind, setKind] = useState<CompanyKind>('THIRD_PARTY');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function create() {
    const trimmed = name.trim();
    if (!trimmed) {
      setError('Name is required.');
      return;
    }
    setPending(true);
    setError(null);
    try {
      const body: CreateCompanyInput = { name: trimmed, kind };
      const created = await client.post<CompanyDto>('/companies', body);
      setName('');
      onCreated(created);
    } catch (e) {
      setError(describeCreateError(e, 'Could not create the company.'));
    } finally {
      setPending(false);
    }
  }

  return (
    <QuickCreateSheet visible={visible} title="New company" onClose={onClose}>
      <View style={s.field}>
        <Text style={s.fieldLabel}>Name *</Text>
        <TextInput
          style={s.input}
          value={name}
          onChangeText={setName}
          placeholder="e.g. Northwind Apparel"
          placeholderTextColor={palette.faint}
          autoFocus
          autoCorrect={false}
          returnKeyType="done"
          onSubmitEditing={create}
        />
      </View>
      <View style={s.field}>
        <Text style={s.fieldLabel}>Kind</Text>
        <View style={s.chipRow}>
          {(['THIRD_PARTY', 'INTERNAL'] as const).map((k) => (
            <Pressable key={k} style={[s.chip, kind === k && s.chipActive]} onPress={() => setKind(k)}>
              <Text style={[s.chipText, kind === k && s.chipTextActive]}>
                {k === 'THIRD_PARTY' ? 'Third-party' : 'Internal'}
              </Text>
            </Pressable>
          ))}
        </View>
      </View>
      <Text style={s.hint}>Branding and location can be added later from the company screen.</Text>
      {error ? <Text style={s.errorText}>{error}</Text> : null}
      <Pressable
        style={[s.button, (pending || !name.trim()) && s.buttonDisabled]}
        onPress={create}
        disabled={pending || !name.trim()}
      >
        <Text style={s.buttonLabel}>{pending ? 'Creating…' : 'Create company'}</Text>
      </Pressable>
    </QuickCreateSheet>
  );
}
```

- [ ] **Step 3: Product sheet**

```tsx
// apps/mobile/src/components/quick-create/product.tsx
/** INS-091 — create a product from the picker that needs it. */
import { palette } from '@inspect/design-tokens';
import type { CreateProductInput, ProductDto } from '@inspect/shared-types';
import { useState } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';

import { client } from '@/lib/session';
import { QuickCreateSheet, describeCreateError, sheetStyles as s } from '../quick-create-sheet';

export function QuickCreateProductSheet({
  visible,
  onClose,
  onCreated,
}: {
  visible: boolean;
  onClose: () => void;
  onCreated: (product: ProductDto) => void;
}) {
  const [styleNumber, setStyleNumber] = useState('');
  const [description, setDescription] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function create() {
    const trimmed = styleNumber.trim();
    if (!trimmed) {
      setError('Style number is required.');
      return;
    }
    setPending(true);
    setError(null);
    try {
      const body: CreateProductInput = {
        styleNumber: trimmed,
        description: description.trim() || null,
      };
      const created = await client.post<ProductDto>('/products', body);
      setStyleNumber('');
      setDescription('');
      onCreated(created);
    } catch (e) {
      setError(describeCreateError(e, 'Could not create the product.'));
    } finally {
      setPending(false);
    }
  }

  return (
    <QuickCreateSheet visible={visible} title="New product" onClose={onClose}>
      <View style={s.field}>
        <Text style={s.fieldLabel}>Style number *</Text>
        <TextInput
          style={s.input}
          value={styleNumber}
          onChangeText={setStyleNumber}
          placeholder="ST-2026-001"
          placeholderTextColor={palette.faint}
          autoFocus
          autoCapitalize="characters"
          autoCorrect={false}
        />
      </View>
      <View style={s.field}>
        <Text style={s.fieldLabel}>Description</Text>
        <TextInput
          style={[s.input, { minHeight: 72 }]}
          value={description}
          onChangeText={setDescription}
          placeholder="Optional"
          placeholderTextColor={palette.faint}
          multiline
        />
      </View>
      {error ? <Text style={s.errorText}>{error}</Text> : null}
      <Pressable
        style={[s.button, (pending || !styleNumber.trim()) && s.buttonDisabled]}
        onPress={create}
        disabled={pending || !styleNumber.trim()}
      >
        <Text style={s.buttonLabel}>{pending ? 'Creating…' : 'Create product'}</Text>
      </Pressable>
    </QuickCreateSheet>
  );
}
```

- [ ] **Step 4: "New" on the directory**

In `apps/mobile/src/app/companies/index.tsx`: add `import { QuickCreateCompanySheet } from '@/components/quick-create/company';` and `const [creating, setCreating] = useState(false);` beside the other `useState` calls. Change the header's title line so the title and a "New" action share a row:

```tsx
        <View style={styles.titleRow}>
          <Text style={styles.title}>Companies</Text>
          <Pressable onPress={() => setCreating(true)} hitSlop={8} accessibilityRole="button">
            <Text style={styles.newLink}>New</Text>
          </Pressable>
        </View>
```

Add to `styles`: `titleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }` and `newLink: { color: palette.accent, fontSize: 15, fontWeight: '700', minHeight: 44, lineHeight: 44 }`.

Render the sheet just before the ready-state `</SafeAreaView>`:

```tsx
      <QuickCreateCompanySheet
        visible={creating}
        onClose={() => setCreating(false)}
        onCreated={(c) => {
          setCreating(false);
          router.push(`/companies/${c.id}`);
        }}
      />
```

Update the header comment: replace the bullet `Create stays web-only for now; a row opens …` with `Create opens the INS-091 quick-create sheet (name + kind) and lands on /companies/[id] to finish branding/location; a row opens /companies/[id] for edit/archive/restore.`

- [ ] **Step 5: Gates**

Run: `pnpm --filter @inspect/mobile type-check && pnpm --filter @inspect/mobile lint` → clean.

- [ ] **Step 6: Commit**

```bash
git add apps/mobile/src/components/quick-create-sheet.tsx apps/mobile/src/components/quick-create apps/mobile/src/app/companies/index.tsx
git commit -m "feat(mobile): INS-091 — QuickCreateSheet + company/product sheets; the directory can create a company"
```

---

### Task 12: Mobile PO form — inline create + PO sheet

**Files:**
- Create: `apps/mobile/src/components/quick-create/purchase-order.tsx`
- Modify: `apps/mobile/src/app/purchase-orders/new.tsx`

**Interfaces:**
- Consumes: `OptionPicker` (Task 9), `QuickCreateCompanySheet`/`QuickCreateProductSheet` (Task 11), `rankCompaniesByActivity`.
- Produces: `QuickCreatePurchaseOrderSheet({ visible, onClose, onCreated: (po: PurchaseOrderDto) => void, companies: CompanyDto[], products: ProductDto[] })`.

- [ ] **Step 1: The PO sheet**

```tsx
// apps/mobile/src/components/quick-create/purchase-order.tsx
/**
 * INS-091 — a PO created from the new-inspection picker. Carries the same
 * three pickers as /purchase-orders/new, each with its own "+ Add new…"
 * (one nested sheet). Lists are seeded by the host and grow locally.
 */
import { palette } from '@inspect/design-tokens';
import { rankCompaniesByActivity } from '@inspect/domain';
import type {
  CompanyDto,
  CreatePurchaseOrderInput,
  ProductDto,
  PurchaseOrderDto,
} from '@inspect/shared-types';
import { useMemo, useState } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';

import { OptionPicker } from '@/components/option-picker';
import { client } from '@/lib/session';
import { QuickCreateSheet, describeCreateError, sheetStyles as s } from '../quick-create-sheet';
import { QuickCreateCompanySheet } from './company';
import { QuickCreateProductSheet } from './product';

type Creating = 'client' | 'factory' | 'product' | null;

export function QuickCreatePurchaseOrderSheet({
  visible,
  onClose,
  onCreated,
  companies: initialCompanies,
  products: initialProducts,
}: {
  visible: boolean;
  onClose: () => void;
  onCreated: (po: PurchaseOrderDto) => void;
  companies: CompanyDto[];
  products: ProductDto[];
}) {
  const [companies, setCompanies] = useState(initialCompanies);
  const [products, setProducts] = useState(initialProducts);
  const [poNumber, setPoNumber] = useState('');
  const [clientCo, setClientCo] = useState<CompanyDto | null>(null);
  const [factoryCo, setFactoryCo] = useState<CompanyDto | null>(null);
  const [product, setProduct] = useState<ProductDto | null>(null);
  const [quantityText, setQuantityText] = useState('');
  const [creating, setCreating] = useState<Creating>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const ranked = useMemo(() => rankCompaniesByActivity(companies), [companies]);
  const selfDealing = clientCo !== null && clientCo.id === factoryCo?.id;
  const quantity = quantityText.trim() === '' ? undefined : Number(quantityText);
  const quantityValid = quantity === undefined || (Number.isFinite(quantity) && quantity >= 1);
  const ready =
    poNumber.trim() !== '' && clientCo !== null && factoryCo !== null && product !== null && !selfDealing && quantityValid;

  async function create() {
    if (!ready || !clientCo || !factoryCo || !product) return;
    setPending(true);
    setError(null);
    try {
      const body: CreatePurchaseOrderInput = {
        poNumber: poNumber.trim(),
        clientCompanyId: clientCo.id,
        factoryCompanyId: factoryCo.id,
        productId: product.id,
        ...(quantity !== undefined ? { totalQuantity: quantity } : {}),
      };
      const created = await client.post<PurchaseOrderDto>('/purchase-orders', body);
      onCreated(created);
    } catch (e) {
      setError(describeCreateError(e, 'Could not create the purchase order.'));
    } finally {
      setPending(false);
    }
  }

  const companyLabel = (c: CompanyDto) => c.name;
  const productLabel = (p: ProductDto) => (p.description ? `${p.styleNumber} — ${p.description}` : p.styleNumber);

  return (
    <QuickCreateSheet visible={visible} title="New purchase order" onClose={onClose}>
      <View style={s.field}>
        <Text style={s.fieldLabel}>PO number *</Text>
        <TextInput
          style={s.input}
          value={poNumber}
          onChangeText={setPoNumber}
          placeholder="PO-2026-0001"
          placeholderTextColor={palette.faint}
          autoCapitalize="characters"
          autoCorrect={false}
        />
      </View>
      <OptionPicker label="Client (receives the branded report) *" value={clientCo} options={ranked} display={companyLabel} placeholder="Select the client…" emptyText="No companies yet." createLabel="+ Add new company…" onCreate={() => setCreating('client')} onSelect={setClientCo} />
      <OptionPicker label="Factory (produces the goods) *" value={factoryCo} options={ranked} display={companyLabel} placeholder="Select the factory…" emptyText="No companies yet." createLabel="+ Add new company…" onCreate={() => setCreating('factory')} onSelect={setFactoryCo} />
      {selfDealing ? <Text style={s.errorText}>Client and factory must differ.</Text> : null}
      <OptionPicker label="Product *" value={product} options={products} display={productLabel} placeholder="Select the product…" emptyText="No products yet." createLabel="+ Add new product…" onCreate={() => setCreating('product')} onSelect={setProduct} />
      <View style={s.field}>
        <Text style={s.fieldLabel}>Total quantity (pcs)</Text>
        <TextInput style={s.input} value={quantityText} onChangeText={setQuantityText} placeholder="Optional" placeholderTextColor={palette.faint} keyboardType="number-pad" />
        {!quantityValid ? <Text style={s.errorText}>Quantity must be a number of 1 or more.</Text> : null}
      </View>
      {error ? <Text style={s.errorText}>{error}</Text> : null}
      <Pressable style={[s.button, (!ready || pending) && s.buttonDisabled]} onPress={create} disabled={!ready || pending}>
        <Text style={s.buttonLabel}>{pending ? 'Creating…' : 'Create purchase order'}</Text>
      </Pressable>

      <QuickCreateCompanySheet
        visible={creating === 'client' || creating === 'factory'}
        onClose={() => setCreating(null)}
        onCreated={(c) => {
          setCompanies((prev) => [...prev, c]);
          if (creating === 'client') setClientCo(c);
          if (creating === 'factory') setFactoryCo(c);
          setCreating(null);
        }}
      />
      <QuickCreateProductSheet
        visible={creating === 'product'}
        onClose={() => setCreating(null)}
        onCreated={(p) => {
          setProducts((prev) => [...prev, p]);
          setProduct(p);
          setCreating(null);
        }}
      />
    </QuickCreateSheet>
  );
}
```

- [ ] **Step 2: Wire `/purchase-orders/new`**

In `apps/mobile/src/app/purchase-orders/new.tsx`:

- Imports: add `import { QuickCreateCompanySheet } from '@/components/quick-create/company';` and `import { QuickCreateProductSheet } from '@/components/quick-create/product';`.
- Lists must grow, so hold them in state. After `const [load, setLoad] = useState<Load>({ kind: 'loading' });` add:

```tsx
  const [companies, setCompanies] = useState<CompanyDto[]>([]);
  const [products, setProducts] = useState<ProductDto[]>([]);
  const [creating, setCreating] = useState<'client' | 'factory' | 'product' | null>(null);
```

- Change `fetchAndApply` to seed them:

```tsx
  const fetchAndApply = useCallback(() => {
    fetchFormData().then((result) => {
      setLoad(result);
      if (result.kind === 'ready') {
        setCompanies(result.companies);
        setProducts(result.products);
      }
    });
  }, []);
```

- Delete `const { companies, products } = load;` in the ready branch.
- Give the three `OptionPicker`s: `emptyText="No companies yet."` / `"No products yet."`, `createLabel="+ Add new company…"` / `"+ Add new product…"`, and `onCreate={() => setCreating('client')}` / `'factory'` / `'product'`.
- Before the closing `</FormScreen>` (Task 10 wrapped this screen) add:

```tsx
        <QuickCreateCompanySheet
          visible={creating === 'client' || creating === 'factory'}
          onClose={() => setCreating(null)}
          onCreated={(c) => {
            setCompanies((prev) => rankCompaniesByActivity([...prev, c]));
            if (creating === 'client') setClientCo(c);
            if (creating === 'factory') setFactoryCo(c);
            setCreating(null);
          }}
        />
        <QuickCreateProductSheet
          visible={creating === 'product'}
          onClose={() => setCreating(null)}
          onCreated={(p) => {
            setProducts((prev) => [...prev, p]);
            setProduct(p);
            setCreating(null);
          }}
        />
```

- Replace `setError(e instanceof Error ? e.message : 'Create failed');` in `create()` with `setError(describeCreateError(e, 'Create failed'));` and import `describeCreateError` from `@/components/quick-create-sheet`.
- Update the header comment: append a line `INS-091: every picker is searchable and ends in "+ Add new…" — a company or product is created in a sheet, appended and selected; nothing typed here is lost.`

- [ ] **Step 3: Gates**

Run: `pnpm --filter @inspect/mobile type-check && pnpm --filter @inspect/mobile lint` → clean.

- [ ] **Step 4: Commit**

```bash
git add apps/mobile/src/components/quick-create/purchase-order.tsx apps/mobile/src/app/purchase-orders/new.tsx
git commit -m "feat(mobile): INS-091 — PO form pickers create companies/products in place; PO quick-create sheet"
```

---

### Task 13: Mobile new-inspection — PO inline create, no dead end, default preset, preset link

**Files:**
- Modify: `apps/mobile/src/app/inspections/new.tsx`

**Interfaces:**
- Consumes: `QuickCreatePurchaseOrderSheet` (Task 12), `OptionPicker` (Task 9), `PurchaseOrderDto.clientCompany.defaultLoopPresetId` (Task 2), `Link` from `expo-router`.

- [ ] **Step 1: Load companies and products for the sheet**

Extend the `Load` ready variant and `fetchFormData`:

```tsx
  | {
      kind: 'ready';
      pos: PurchaseOrderDto[];
      presets: LoopPresetDto[];
      inspectors: UserDto[];
      companies: CompanyDto[];
      products: ProductDto[];
    };
…
    const [pos, presets, users, companies, products] = await Promise.all([
      client.get<PurchaseOrderDto[]>('/purchase-orders'),
      client.get<LoopPresetDto[]>('/loop-presets'),
      client.get<UserDto[]>('/users'),
      client.get<CompanyDto[]>('/companies'),
      client.get<ProductDto[]>('/products'),
    ]);
    return { kind: 'ready', pos, presets, inspectors: users.filter(…), companies, products };
```

Add `CompanyDto`, `ProductDto` to the `@inspect/shared-types` type import; add `import { Link } from 'expo-router';` (alongside `useRouter`) and `import { QuickCreatePurchaseOrderSheet } from '@/components/quick-create/purchase-order';`.

- [ ] **Step 2: State for a growing PO list, the sheet, and the default-preset rule**

After `const [po, setPo] = useState<PurchaseOrderDto | null>(null);` add:

```tsx
  const [pos, setPos] = useState<PurchaseOrderDto[]>([]);
  const [creatingPo, setCreatingPo] = useState(false);
  const [presetTouched, setPresetTouched] = useState(false);
```

Seed `pos` in `fetchAndApply` next to the preset default: `if (result.kind === 'ready') { setPos(result.pos); setPreset((p) => p ?? result.presets[0] ?? null); }`.

Add the selection helper after `const lotValid = …`:

```tsx
  // INS-091 — honour the client company's default preset on PO change, until
  // the user picks a preset by hand. Skipped when the id is not in the list.
  function selectPo(next: PurchaseOrderDto, presets: LoopPresetDto[]) {
    setPo(next);
    if (presetTouched) return;
    const preferred = next.clientCompany?.defaultLoopPresetId;
    const match = preferred ? presets.find((p) => p.id === preferred) : undefined;
    if (match) setPreset(match);
  }
```

- [ ] **Step 3: Remove the dead end and wire the pickers**

Delete the whole `if (load.pos.length === 0) { return (…No purchase orders yet…) }` block.

Replace the PO `OptionPicker` with:

```tsx
        <OptionPicker
          label="Purchase order *"
          value={po}
          options={pos}
          display={(p) => p.poNumber}
          placeholder="Select the PO…"
          emptyText="No purchase orders yet — add one below."
          createLabel="+ Add new purchase order…"
          onCreate={() => setCreatingPo(true)}
          onSelect={(p) => selectPo(p, load.presets)}
        />
```

Replace the preset empty-state `<Text style={styles.errorText}>No loop presets exist yet — create one in the console first.</Text>` with:

```tsx
          <Text style={styles.hint}>
            No loop presets yet.{' '}
            <Link href="/presets/new" style={styles.link}>Create one in the preset builder</Link>, then return here.
          </Text>
```

Give the preset `OptionPicker` `onSelect={(p) => { setPreset(p); setPresetTouched(true); }}`.

Add before the closing `</FormScreen>` (Task 10 wrapped this screen; `load` is narrowed to `ready` here):

```tsx
        <QuickCreatePurchaseOrderSheet
          visible={creatingPo}
          onClose={() => setCreatingPo(false)}
          companies={load.companies}
          products={load.products}
          onCreated={(created) => {
            setPos((prev) => [created, ...prev]);
            setCreatingPo(false);
            selectPo(created, load.presets);
          }}
        />
```

Update the header comment's list of "deliberate improvements" with a fourth: `INS-091: no dead-end empty state — the PO picker creates a PO (and its companies/product) in place; the client's default preset is honoured.`

- [ ] **Step 4: Gates**

Run: `pnpm --filter @inspect/mobile type-check && pnpm --filter @inspect/mobile lint` → clean.
Run from `apps/mobile`: `npx expo export --platform android --output-dir ../../.tmp-export` → 25 routes; delete the output dir.

- [ ] **Step 5: Emulator check**

Follow the session memory's Android workflow (AVD `inspect`, Expo Go, `adbt.mjs`, test user `qa.mobile@acme-apparel.test`). On `/inspections/new`: the PO picker opens with search; "+ Add new purchase order…" slides up the sheet; inside it "+ Add new company…" slides a second sheet; Cancel closes only the inner sheet; creating client, factory, product and PO selects the PO and fills the client/factory/product lines; keyboard up + one tap on Create works. On `/purchase-orders/new`: same for the three pickers. On `/companies`: New → sheet → lands on the new company's screen.

- [ ] **Step 6: Commit**

```bash
git add apps/mobile/src/app/inspections/new.tsx
git commit -m "feat(mobile): INS-091 — new inspection: PO quick-create in place, no dead end, default preset, preset builder link"
```

---

### Task 14: Docs — backlog, STATUS, ledger, spec/plan lifecycle

**Files:**
- Modify: `docs/future/BACKLOG.md`, `docs/STATUS.md`, `docs/reference/screen-migration-map.md`
- Move: `docs/in-progress/specs/2026-09-04-inline-create-and-friction-design.md` → `docs/done/specs/`; `docs/in-progress/plans/2026-09-04-inline-create-and-friction.md` → `docs/done/plans/`

- [ ] **Step 1: File INS-091 (done) and INS-092 (todo) in `docs/future/BACKLOG.md`**

Under `## High`, after INS-086, add:

```markdown
### INS-091 · Pickers cannot create what is missing — four-screen detour to start an inspection   [HIGH]
- status: done
- done: 2026-09-04 — `EntityPicker` (web) / grown `OptionPicker` (mobile) are searchable via the shared `filterOptions` and end in "+ Add new…"; company, product and PO quick-create dialogs/sheets (nested one level) append + select; web `Modal` (portal, focus trap, stack, scroll lock) + `ErrorBanner` replaced every `alert()`; mobile `FormScreen` gives every form keyboard avoidance + persistent taps; `/companies` on mobile can create; both new-inspection forms lost their dead-end empty state and honour the client's `defaultLoopPresetId`. First web component tests (jsdom + Testing Library): `modal.test.tsx`, `entity-picker.test.tsx`.
- area: Console + mobile (forms/pickers) / shared contract
- evidence: `apps/web/app/(console)/inspections/new/create-form.tsx` (former dead-end paragraph), `apps/mobile/src/app/inspections/new.tsx` ("create … in the console first"), no `/companies/new` on mobile.
- problem: Every related-entity picker was an unsearchable list with no create path; starting an inspection on a fresh org meant four screens (two on another platform for mobile) and the form's typed state was lost.
- fix: Inline quick-create from pickers on both platforms + the friction blockers on the same screens.
- verify: On an org with zero POs, `/inspections/new` on web and mobile reaches a created inspection without leaving the screen; `grep alert(` finds nothing under `apps/web/app/(console)`.
- refs: spec [../done/specs/2026-09-04-inline-create-and-friction-design.md](../done/specs/2026-09-04-inline-create-and-friction-design.md) · plan [../done/plans/2026-09-04-inline-create-and-friction.md](../done/plans/2026-09-04-inline-create-and-friction.md)
```

Under `## Low`, add the umbrella item:

```markdown
### INS-092 · UX friction audit residue (2026-09-04)   [LOW]
- status: todo
- area: Console + mobile
- evidence: audit recorded in the INS-091 spec §0; each line below names its file.
- problem: Papercuts found while auditing for INS-091 and deliberately left out of it: (web) no shared Field/Input/Label primitives — styles copy-pasted in ~8 forms; create-from-list actions redirect to the detail page and lose the list (`dashboard/actions.ts` createCompany, `products/actions.ts`, `purchase-orders/actions.ts`); PO client/factory/product immutable after create with no UI hint (`purchase-orders/[id]/edit-form.tsx`); no breadcrumb component (three hand-rolled); `directory-client.tsx` row click uses `window.location.href`; the Create Company submit lacks `loading=` (no double-submit guard); `users-client.tsx` "Add member" toggle discards typed input; `/inspections/new` preset dropdown lists every version of every preset (INS-076 residue). (mobile) no shared Field/Input/Button primitives; sub-44pt targets (`presets/new.tsx` reorder glyphs, `users.tsx` deactivate link, `companies/index.tsx` chips); no `RefreshControl` on any `[id]`/`new` screen; retry re-runs the whole `Promise.all`; no success feedback after create (no toast primitive); `products/new.tsx` form flashes before the role probe resolves; AQL preview flickers to a spinner on every debounce; `users.tsx` role change is non-optimistic; PO list has no search/paging (API `GET /purchase-orders` takes no query params); `presets/new.tsx` dead `void seed;`.
- fix: Pick per item; the shared-primitive extractions on each platform are the highest-leverage first steps.
- verify: Per item.
- refs: [BACKLOG.md](BACKLOG.md) INS-091 · INS-087 (per-role picker ranking, related)
```

- [ ] **Step 2: STATUS.md**

- Line 3: `**Last verified: 2026-09-04.**` (already that date; keep).
- Web console pillar row: append `INS-091 (2026-09-04): searchable pickers with inline company/product/PO create, Modal + ErrorBanner (no `alert()` left), first component tests — **47 Vitest tests.**`
- Mobile pillar row: append `INS-091 (2026-09-04): OptionPicker search + "+ Add new…", quick-create sheets, FormScreen keyboard handling on 11 screens, company create from the directory.`
- Shared packages row: `@inspect/domain` (**34 tests**: … + `filterOptions`).
- "Verified numbers" line: web 47/5 · domain 34/7 (update after the actual run).
- "Open backlog (N items)" heading and list: add `[INS-092](future/BACKLOG.md) UX friction residue`; recount.

- [ ] **Step 3: Ledger rows in `docs/reference/screen-migration-map.md`**

Append to the Status cell of these rows: `/inspections/new` → `; INS-091 2026-09-04: PO quick-create in place (nested company/product sheets), no dead end, default preset honoured`; `/purchase-orders …` → `; INS-091 2026-09-04: searchable pickers + inline company/product create`; `/dashboard` + `/companies` → `; INS-091 2026-09-04: directory can create a company (quick-create sheet → /companies/[id])`. In the `**Note on /dashboard**` paragraph, change `read-only until /companies/[id] ports (create/edit/archive stay on the web)` to `create via the INS-091 quick-create sheet; edit/archive on /companies/[id]`.

- [ ] **Step 4: Move spec + plan to `docs/done/`**

```bash
git mv docs/in-progress/specs/2026-09-04-inline-create-and-friction-design.md docs/done/specs/
git mv docs/in-progress/plans/2026-09-04-inline-create-and-friction.md docs/done/plans/
```

Fix the spec's own status line and plan link (`../plans/…` still resolves after both move). Check every link added in this task resolves (open each relative path).

- [ ] **Step 5: Full verification run, then commit**

Run: `pnpm test && pnpm type-check && pnpm lint` from the root → all green. Confirm the numbers you wrote into STATUS match the output.

```bash
git add docs
git commit -m "docs: INS-091 done, INS-092 filed; STATUS + ledger reflect inline create and the friction fixes"
```

---

## Self-review

**Spec coverage**
- §1.1 inline create on PO form (web T7, mobile T12) and inspection form (web T8, mobile T13) with nested company/product ✔
- §1.2 searchable pickers via one matcher (T1, T4, T9) ✔
- §1.3 no dead-end empty states; preset links to the same-platform builder (T8, T13) ✔
- §1.4 company create on mobile (T11) ✔
- §1.5 default preset honoured (T2 contract, T8, T13) ✔
- §1.6 no `alert()` (T5) ✔
- §1.7 keyboard-safe mobile forms (T10) ✔
- §3.1/§3.2 shared layer (T1, T2) ✔ · §4.1–4.7 (T3–T8) ✔ · §5.1–5.5 (T9–T13) ✔ · §6 error handling: 409 in banner (dialogs/sheets show `ApiError.message`), self-dealing, network wording (`describeCreateError`), nested stacking, preset skip when archived ✔ · §7 verification + docs (T7/T8/T13 checks, T14) ✔

**Placeholder scan** — no TBD/TODO; every code step carries code. The Task 10 table describes a mechanical rule with a worked example rather than repeating eleven near-identical diffs; each row states what to wrap.

**Type consistency** — `PickerOption {id,label,hint?}` used identically in T4/T7/T8; `onCreated(dto)` on every dialog/sheet; `quickCreate*` return `{ data?, error? }` everywhere; `filterOptions(query, items, label)` in T1/T4/T9; `describeCreateError(e, fallback)` in T11/T12/T13; `selectPo` takes `(id, row?)` on web and `(row, presets)` on mobile — different signatures by design, each used only within its own file.
