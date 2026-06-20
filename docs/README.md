# docs/ — how this folder works

Planning and project-tracking live here. Code-adjacent docs (root `CLAUDE.md` / `README.md`,
`apps/**/README.md`) stay next to the code.

## Layout
- **[STATUS.md](STATUS.md)** — start here. Where every pillar stands. Source-of-truth dashboard.
- **[future/BACKLOG.md](future/BACKLOG.md)** — remaining work, stable `INS-NNN` ids, severity-grouped.
- **done/** — shipped specs (`done/specs/`) + plans (`done/plans/`). Dated, historical; corrected-in-place with a dated banner where they would otherwise mislead.
- **in-progress/** — the spec + plan for work currently underway.
- **future/** — drafted-but-not-started specs/plans (besides the backlog).
- **reference/** — living, non-dated architecture refs (kept current): [`inspect-schema.md`](reference/inspect-schema.md) (domain/Prisma design + app-layer invariants), [`inspect-build-index.md`](reference/inspect-build-index.md) (cross-phase router + tech defaults).

## Naming
- Spec: `in-progress/specs/YYYY-MM-DD-<topic>-design.md`. Plan: `in-progress/plans/YYYY-MM-DD-<topic>.md`.
- The spec and its plan **share one `YYYY-MM-DD-<topic>` stem** so they pair up and sort chronologically; `-design` marks the spec.
- Reference docs are **undated** (`inspect-<topic>.md`) — they are evergreen, not point-in-time.

## Lifecycle
1. Brainstorm → spec in `in-progress/specs/YYYY-MM-DD-<topic>-design.md`.
2. Plan → `in-progress/plans/YYYY-MM-DD-<topic>.md`.
3. Implement, referencing `INS-NNN` ids from the backlog in plans and commit messages.
4. On merge: move the spec + plan `in-progress → done/`, flip the backlog items to `done` (with a `done:` line), and bump STATUS's **"Last verified"** date plus any pillar row that changed.
5. Review doc-affecting changes before committing (links resolve, STATUS + BACKLOG agree with the code).

## Rules of thumb
- **reference/ vs done/:** if a doc must stay accurate as the code evolves, it is evergreen → `reference/` (undated). If it captures the design/decision/plan for a specific shipped change, it is point-in-time → `done/` (dated, immutable except correction banners).
- **Stable ids:** every backlog item keeps a permanent `INS-NNN` id; ids are never reused. A superseded/merged item becomes a tombstone line pointing at the surviving id.
- New specs/plans start under `in-progress/` — the old `docs/superpowers/` path is **retired** (its contents were migrated here on 2026-06-20).
