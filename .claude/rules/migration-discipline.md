---
paths:
  - "apps/mobile/**"
  - "packages/domain/**"
  - "packages/design-tokens/**"
---

# React Native migration discipline

Governing spec: [docs/in-progress/specs/2026-08-26-inspect-react-native-migration-design.md](../../docs/in-progress/specs/2026-08-26-inspect-react-native-migration-design.md).
Ledger: [docs/reference/screen-migration-map.md](../../docs/reference/screen-migration-map.md).

## The re-point rule (non-negotiable)

When a screen's logic turns out to be non-presentational, it moves to `@inspect/domain` **and `apps/web` is
re-pointed at it in the same change.** Never fork a rule into mobile.

Both platforms are maintained long-term. That only survives if each migration *reduces* total logic. A rule
that exists in two places is a rule that will be fixed in one place.

## Port behaviour, not layout

The web console is a desktop console; the app is a phone. `populate-workspace.tsx` is 782 lines of
grid-and-panel, and its phone equivalent is a full-screen camera showing one slot at a time. Extract what
the screen *does* — data in, actions out, states, edge cases — and design the native screen from that.
Copying markup structure produces something bad on both platforms.

## Scope boundaries

Three surfaces are **permanently web-only**. Do not port them, and do not add mobile routes for them:

- `/admin/orgs` — Platform Admin. The app has no Platform Admin mode at all.
- `/portal` — the buyer guest portal.
- `/r/[token]` — public signature verification, which must open for anyone holding a link.

## Role floors

The app has no `PLATFORM_ADMIN`. Before porting any screen, confirm its API routes are reachable by the
roles the app actually carries (`INSPECTOR`, `QA_MANAGER`, `ORG_OWNER`). A route still gated at
`PLATFORM_ADMIN` is a backlog item, not something to work around client-side.

## Mobile-specific invariants

These follow from the domain invariants in the root `CLAUDE.md`; they are the mobile expressions of them.

- **A 409 on a filled photo slot surfaces as a conflict for the inspector, never a silent drop.** One image
  per slot is the slot's identity. If it filled while offline, a human decides: keep mine as a retake, or
  discard. Dropping loses evidence; forcing overwrites someone else's.
- **Submit is blocked while the upload queue is non-empty.** Cycle completeness is judged server-side
  against what the server holds. Submitting with photos still on the device asks the server to evaluate an
  inspection that does not exist yet.
- **Hash photo bytes at capture time**, on-device, before the bytes can be touched again. The content-hash
  chain is the tamper-proof guarantee.
- **Never compute an AQL verdict on the device.** The engine is server-side and its result is what gets
  signed. The app displays; the API decides.

## Every migration updates the ledger

A screen is not migrated until its row in `docs/reference/screen-migration-map.md` reflects reality and its
`INS-NNN` backlog item is flipped. This is what lets the next session start cold.
