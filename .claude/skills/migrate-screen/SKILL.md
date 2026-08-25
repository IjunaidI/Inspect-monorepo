---
name: migrate-screen
description: Port one web console screen to React Native. Use when migrating a screen from apps/web to apps/mobile, or when picking up the next item from the screen migration ledger.
argument-hint: "[web route, e.g. /inspections or /presets/new]"
---

# Migrate one screen to React Native

Spec: [the migration design](../../../docs/in-progress/specs/2026-08-26-inspect-react-native-migration-design.md) ·
Ledger: [screen-migration-map.md](../../../docs/reference/screen-migration-map.md)

One screen per invocation. Create a todo per step below and work them in order.

## 1. Claim the screen

Read the ledger row. Confirm:

- It is **not** one of the permanently web-only surfaces (`/admin/orgs`, `/portal`, `/r/[token]`).
- It has an `INS-NNN` backlog item. If not, file one before writing code.
- Its dependencies are migrated. A detail screen whose list screen does not exist yet is out of order.

## 2. Get the behaviour contract — do not read the screen inline

Dispatch the `screen-cartographer` subagent for the web screen's files. Screens run to hundreds of lines of
markup; you need perhaps forty lines of behaviour. Reading them directly spends the context you will want
for writing the native screen.

You want back: data loaded and from where, actions fired and to where, every state (loading / empty / error
/ forbidden / success), role gating, and edge cases the web screen handles.

## 3. Get the API contract

Prefer the generated OpenAPI spec over reading controllers ([INS-084](../../../docs/future/BACKLOG.md)).
Until it exists, read the controller and its service.

For each endpoint record: method, path, request shape, response shape, **role floor**, and error statuses
that mean something specific (404 vs. 409 vs. 410).

**Then check the role floor against mobile's roles.** The app has no `PLATFORM_ADMIN`. A route still gated
there is a backlog item, not something to work around on the client.

## 4. Classify every piece of logic

For each rule the screen applies, ask: *would a phone and a desktop answer this differently?*

| Kind | Goes to | Example |
|---|---|---|
| Presentational | The mobile screen | Column layout, which chips are visible, sheet vs. dialog |
| Domain rule | `@inspect/domain` | Cycle completeness, role gates, status transitions, AQL display |
| Wire shape | `@inspect/shared-types` | Any DTO or enum crossing the network |
| HTTP call | `@inspect/api-client` | The endpoint call itself |

**When something moves to `@inspect/domain`, re-point `apps/web` at it in the same change.** This is the
rule the whole two-platform strategy rests on. A rule living in two places is a rule that gets fixed in one.

## 5. Write the native screen

- Mirror the web route in Expo Router where it makes sense (`/inspections/[id]/review` → the same path).
  Mirror the *route*, never the layout.
- Style from `@inspect/design-tokens`. Never hardcode a hex value.
- Handle every state the cartographer found. A forbidden state that renders as an empty list is a bug.

## 6. Verify

```
pnpm type-check          # all packages and apps
pnpm web test            # MUST stay green — you re-pointed web in step 4
```

Then run the screen on a device or simulator. Type-checking a native screen proves nothing about whether it
renders.

## 7. Close the loop

- Update the ledger row.
- Flip the `INS-NNN` item to `done` with a `done:` line.
- Update [docs/STATUS.md](../../../docs/STATUS.md)'s "Last verified" date.

## Red flags

| Thought | Reality |
|---|---|
| "I will copy the web screen and adjust it" | You will port a desktop layout to a phone. Start from the behaviour contract. |
| "I will duplicate this rule in mobile for now" | That is the drift this strategy exists to prevent. Move it to `@inspect/domain`. |
| "The route 403s, I will hide the button" | The API is the RBAC authority. Hiding UI does not grant access — file the backlog item. |
| "I will compute the AQL result locally to show it faster" | The engine is server-side and its output is what gets signed. |
| "Type-check passes, it works" | It has never rendered. Run it on a device. |
| "I will update the ledger at the end of the batch" | The next session starts cold and reads the ledger. Update it per screen. |
