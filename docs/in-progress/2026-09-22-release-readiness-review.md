# Release-readiness review — 2026-09-22

> A high-level, read-only review of the whole product ahead of the first APK export
> ([INS-086](future/BACKLOG.md) device pass). Four parallel passes: mobile shell/auth/config,
> the capture loop + photo queue, the mobile CRUD screens against the API contract, and the
> API + web console. Every finding below was filed as a backlog item (INS-102 … INS-109) so it
> can be scheduled; this document is the narrative. Line numbers are as of commit `677399b`.
>
> **Verdict in one line:** the domain core and the wire contract are sound; the *pipeline*
> (EAS cannot build a clean checkout), the *session lifecycle* (expired sessions strand users
> outside list screens), the *evidence chain* (client-asserted storage keys and hashes) and
> the *photo queue's durability* are where a field pilot would fail.

## 1. Can the APK be built? — no, not from a clean checkout (fixed this session)

| # | Finding | Evidence |
|---|---|---|
| 1 | The four shared packages ship `main: dist/index.js`, `dist/` is gitignored, and no `eas-build-post-install` hook builds them — an EAS cloud build dies on `Cannot find module '@inspect/shared-types'`. | `packages/*/package.json`, `apps/mobile/package.json` (no hooks) |
| 2 | `app.json` has no `android.package` / `ios.bundleIdentifier`; `eas build --non-interactive` refuses to run. | `apps/mobile/app.json:12-25` |
| 3 | `config.ts` falls back to `http://localhost:3000` when `EXPO_PUBLIC_INSPECT_API_URL` is unset — a mis-configured profile ships a binary where every call fails, and plain `http://` is blocked in release anyway. | `apps/mobile/src/lib/config.ts:8` |
| 4 | `version: 0.0.0`; `userInterfaceStyle: automatic` on a light-only theme (dark alerts/keyboard against a cream app); a hard-coded LAN IP in the `development` profile. | `app.json:5,9`, `eas.json:11-12` |

Items 1–4 are [INS-102](future/BACKLOG.md); the build-blocking ones were fixed in this session.

## 2. Mobile — session and navigation

- **401 handling is per-screen and incomplete.** Only the tab/list screens sign out on 401.
  Capture, review, report, preset detail/builder, new-inspection and every create/edit/archive
  handler show "Unauthorized" with a Retry that can never succeed once the 30-day refresh token
  lapses. One shared failure handler in `lib/errors.ts` fixes all of them.
- **Concurrent refresh race.** Home fires three requests at once; each runs `currentAccessToken`
  and three `/auth/refresh` calls hit the throttled endpoint. Memoize the in-flight refresh.
- **No reactive refresh-on-401** in `@inspect/api-client` and **no request timeout** (bare `fetch`,
  no `AbortController`) — a stalled cellular socket leaves a spinner forever.
- **Identity is never revalidated.** Role/name come from SecureStore at login only; a promoted
  user stays locked out of Library/Team until sign-out. Re-fetch `/auth/me` on foreground.
- **No route `ErrorBoundary`** — a render throw in release crashes to the launcher.
- Deep links: only `scheme: inspect`; the console's invite URL is a web URL, so the paste field
  is the real path. A cold deep link while signed out loses its destination after login.

→ [INS-106](future/BACKLOG.md).

## 3. Mobile — capture loop and photo queue (the evidence path)

Invariant drift vs the API: **none found.** The frontier mirrors `nextSlot` including discard
gaps, one-image-per-slot is enforced by the enqueue guard + the 409 split, `sampleSize` is
display-only, the submit gate re-reads the server's `cycleState`.

The impure shell around the tested core is where evidence can be lost:

- **Evidence can be deleted on relaunch.** `saveQueue` is a non-atomic `File.write` that swallows
  failures; `reconcile` then deletes every file in `captures/` not referenced by the parsed queue,
  and a corrupt queue file parses to `[]`. Kill mid-write or disk-full → every unsent photo is an
  "orphan" and is erased. Write-then-rename, and adopt unreferenced captures instead of deleting.
- **The queue never drains on cold launch.** The singleton is built lazily by the capture and
  review screens only; after an app kill, offline shots wait until that inspection is reopened.
  Construct + `kick()` it from the signed-in root layout.
- **401/403 permanently "rejects" the queue.** Any 4xx other than the slot 409 is `permanent`,
  so a failed refresh (or a drain running after sign-out) marks every photo "Rejected — retake or
  discard" and reconnect never revives them. Treat auth failures as transient and pause while
  signed out.
- Custom defects carry no `clientRequestId` (a retried tap double-counts a defect); `uploaded`
  cache records are never reconciled with the server (ghost "Saved" slots after a web-side
  discard); camera permission with `canAskAgain=false` is a dead end; `cameraReady` never resets
  when the camera view remounts (first shutter after a Prev fails); sign-out leaves the previous
  user's queue and bytes; a locked inspection's outstanding uploads offer a no-op Retake.
- Server side, `registerPhoto` never checks the PUT bytes against `contentHash` — see §5.

→ [INS-105](future/BACKLOG.md).

## 4. Mobile — CRUD screens vs the API contract

Contract drift: **none found.** Bodies match every `Create*/Update*Input`, read fields all exist,
role floors match at every route.

- **Every unpaged list silently caps at 50 rows** (`list-query.ts` default `take`); pickers for
  companies, products, presets and the team roster never page. The 51st row simply does not exist.
- **The Archived view hides "Load more"** when page 1 has no archived rows — a dead end.
- **Lists go stale** after create/edit/archive (no `useFocusEffect` anywhere).
- Reports list hard-caps at 50; the PO list is an unbounded fetch by API design (no query params).
- GPS fields send `NaN` → generic 400; `OptionPicker` keys rows by index.

→ [INS-108](future/BACKLOG.md).

## 5. API and web console

- **Critical — the evidence chain is anchored on client-asserted `storageKey` + `contentHash`.**
  `registerPhoto`/retake store whatever key and hash the caller sends; nothing checks the key lies
  under `orgs/{orgId}/inspections/{id}/`, and the hash is never recomputed from the object. The
  populate floor is now `INSPECTOR` (CLAUDE.md's "Platform-Admin-only" is stale), so any inspector
  can sign a report over bytes that do not exist or belong to another inspection. Derive the key
  server-side (opaque presign id) and HEAD/stream the object to compute the hash before writing
  the row. → [INS-103](future/BACKLOG.md)
- **Critical — the console serves demo data during a real outage.** `loadOrFallback` returns
  design fixtures on any network error or 5xx with no environment gate; a customer would see
  plausible fake QC results. → [INS-104](future/BACKLOG.md)
- **High — account lifecycle.** Refresh tokens are stateless, 30 days, never rotated, never
  revocable (no logout path, no token version). No password change or reset flow exists at all.
  Every Railway deploy re-runs `prisma db seed`, which re-converges the bootstrap admin password.
  → [INS-107](future/BACKLOG.md)
- **High — presigned PUT signs only `host`** (no content-length/type): a 15-minute URL accepts a
  multi-GB object of any MIME type. → [INS-109](future/BACKLOG.md)
- Medium: no `ValidationPipe`/DTO validation layer (JSON columns accept unbounded payloads); the
  public verify endpoint is unthrottled and its token is a `cuid()`; single signing key with no
  `kid` in the payload (rotation would invalidate every historical report); password policy is
  length ≥ 8 with no per-account lockout; the deployed API runs with `NODE_ENV=development`
  (re-enables `/docs`); no helmet/CSP. → [INS-109](future/BACKLOG.md)
- **Audit coverage is better than CLAUDE.md says** (13 services, not 2). Still unaudited:
  `POST /inspections` (create), `POST /users/invite` (the invitation row), login/refresh.
- Verified still true: guest visibility keys on `clientCompanyId AND orgId` at all three sites;
  `canonicalSnapshot`/`contentHash`/`signature` are never updated; Report→Inspection FK is
  `Restrict`; JWT secrets fail closed at boot; no live secrets in the tracked tree.

## 6. Suggested order

1. INS-102 (pipeline — done) → export the APK → run the device pass with the known caveats.
2. INS-105 + INS-106 before any field pilot (evidence loss, stranded sessions).
3. INS-103 + INS-104 before any customer sees a signed report or the console.
4. INS-107 / INS-108 / INS-109 before a paying customer.
