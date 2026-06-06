# Inspect — MVP Requirements Specification

> Mobile-first quality-control inspection platform for the textile & garment industry.
> **This MVP ships web-first**: backend + desktop console now, mobile (React Native) later reusing the same REST API.
> **Status: Final v1.0** · Scope: **pre-shipment inspection only** · Date: June 6, 2026 · Owner: Platform Admin.

> NOTE: This file is the verbatim requirements input captured from the user. The derived schema design lives in `2026-06-06-inspect-schema-design.md`.
> NOTE: §13 references "Real TypeORM entities + migrations" but the repo has already migrated OFF TypeORM to **Prisma** (commit de6a2e0). Prisma is the real stack; read that section as "real Prisma models + migrations, synchronize off equivalent (no db push in prod)".

---

## 1. Overview & MVP framing

Inspect runs quality-control inspections as **guided loops** — sequential, photo-driven mini-checklists that walk an inspector through each zone of a product (e.g. sleeves -> collar -> side seams -> stitching -> measurements -> packaging). Each loop captures photos, defect tags, free-form measurements, and notes. When all loops are done, the system computes an AQL result, a QA Manager signs off, and a **branded, tamper-proof PDF report** is generated for the buyer.

The product is ultimately mobile-first (field inspectors on factory floors), but the MVP is **web-first** to harden the backend and the admin/QA console first, and to reuse the exact same API for the mobile app later.

### The MVP capture reality

In the MVP there is **no mobile camera capture yet**, and **manual photo upload is restricted to the Platform Admin**. Therefore:

- **Tenants** (inspection companies / manufacturers) handle *setup and review* only: buyers, suppliers, POs, products, loop presets, creating/assigning inspections, and reviewing/approving reports.
- **The Platform Admin owns the entire populate step**: uploads the photos, arranges them into loop slots, tags defects, enters measurements, and submits.
- The **Inspector** role is provisioned but its core function (verified on-site capture) only activates when the mobile app ships. Until then there is **no inspector-facing capture or tagging UI on web**.

This is a deliberate pre-customer MVP shape (no design partner yet). It determines the web build: management + review surfaces for tenants, an Admin populate console for you, and no field-capture UI.

---

## 2. Glossary (canonical terms)

| Term | Meaning |
|---|---|
| **Platform / Admin** | You. The only role that crosses tenant boundaries, the only role that can manually upload photos (always badged), and the role that populates inspections in MVP. Operates the SaaS. |
| **Org / Tenant** | A paying customer workspace, fully isolated. An Org is **either** an inspection company **or** a manufacturer. |
| **User** | A member of an Org with a role (Inspector, QA Manager, or Org Owner). |
| **Buyer** | The party a report is *for*. Managed inside a tenant. May receive a PDF and/or be invited as a scoped read-only guest. Not a paying tenant by virtue of being a buyer. |
| **Supplier / Factory** | The production site being inspected. Managed inside a tenant. |
| **Loop** | One zone-level step in an inspection (reference shots, defect tags, measurements). |
| **Loop Preset** | A reusable, ordered sequence of loops. |
| **Inspection** | One pre-shipment inspection of a lot, against a loop preset and an AQL plan. |
| **Report** | The immutable, signed PDF generated from a completed, approved inspection. |

The "agency" terminology is retired. The inspecting party is always **the Org/Tenant**; the inspected/receiving counterparties are **Supplier** and **Buyer**, and their relationship can point either direction depending on which kind of Org the tenant is.

---

## 3. Tenancy & onboarding

- **Multi-tenant SaaS, workspace-isolated.** Every Org's data (users, buyers, suppliers, presets, inspections, reports) is scoped to that Org and never visible to another Org.
- An Org is typed `inspection_company | manufacturer`. The type does not affect isolation; it informs defaults and which counterparty the tenant "is."
- The **buyer <-> supplier relationship is bidirectional.** For an inspection-company tenant, the workspace is organized around *buyers* who have *suppliers*. For a manufacturer tenant, the tenant **is** the supplier and the workspace is organized around the *buyers* it ships to. Both parties are stored as first-class entities linked by a PO — not a fixed parent->child tree.
- The **Platform Admin** is the single cross-tenant actor (support, manual photo population, all-org access).

### Onboarding is invite-only (no public self-signup)

- **Platform Admin invites / creates Orgs.** There is no public tenant registration.
- **Each Org invites its own users** and assigns their roles.
- **Buyer guests are invited by their tenant**, scoped to that buyer's reports only.

---

## 4. Roles & permissions

Roles are **additive**: each higher role inherits everything below it.

```
Platform Admin  >=  Org Owner  >=  QA Manager  >=  Inspector
(cross-tenant)     (per-org)
```

| Capability | Inspector | QA Manager | Org Owner | Platform Admin |
|---|:--:|:--:|:--:|:--:|
| View reports (own org) | yes | yes | yes | yes |
| On-site verified capture (mobile camera) | yes(1) | yes(1) | yes(1) | yes(1) |
| Manage buyers / suppliers / POs / products (incl. create a buyer + set its branding) | - | yes | yes | yes |
| Create & edit loop presets | - | yes | yes | yes |
| Create & assign inspections | - | yes | yes | yes |
| Review & approve / reject / hold reports | - | yes | yes | yes |
| Manage users & change roles (within own org) | - | - | yes | yes |
| **Manually upload photos** (badged "unverified") | - | - | - | yes only |
| **Complete the populate step** (arrange photos, tag defects, enter measurements) — MVP | - | - | - | yes only(2) |
| Cross-org access (all tenants) | - | - | - | yes only |

(1) Future (mobile app). (2) In MVP the Platform Admin performs the whole populate step; tenant roles do not tag or measure on web. When mobile ships, the Inspector takes over verified capture + tagging on-site.

**No one can amend a submitted inspection or report**, regardless of role. Tamper-proof fields are never editable by any role.

---

## 5. Core domain model

Key entities and notable fields. Relationships in prose; this is a blueprint, not a final schema.

**Organization** — `id, name, type(inspection_company|manufacturer), createdAt`. Root of tenant isolation. Every tenant-scoped row carries `orgId`.

**User** — `id, orgId, name, email, role(inspector|qa_manager|org_owner), status`. Platform Admins live outside any single org (a separate `platform_admin` flag / table).

**Buyer** — `id, orgId, name, branding(logoUrl, primaryColor, ...), createdAt`. The report recipient; branding here drives per-buyer report styling. Created and branded by QA Manager and above.

**BuyerGuest** — `id, buyerId, orgId, email, status`. A read-only guest login **scoped to a single buyer's reports within a single tenant**. The same external buyer invited by two tenants has two separate records — never visible across tenants.

**Supplier** (factory) — `id, orgId, name, address, gps(optional), createdAt`.

**PurchaseOrder** — `id, orgId, poNumber, buyerId, supplierId, productId, totalQuantity, ...`. The link between a buyer and a supplier.

**Product** — `id, orgId, styleNumber, description, ...`.

**LoopPreset** — `id, orgId, name, version, createdByUserId`. An ordered set of `LoopStep`s. Attachable to a Buyer (default preset) or to an individual Inspection.

**LoopStep** — `id, presetId, order, zoneName, referenceImages[], requiredShotCount, allowedDefectTagIds[], measurementFields[(label)]`.

**DefectCatalog** — `id, scope(global|org), orgId?, name, defaultSeverity(critical|major|minor)`. Seeded with a global, pre-classified common-defect library (see §7); QA Managers add org-level custom entries; an inspection can also record a free-text one-off defect.

**Inspection** — the core aggregate:
`id, orgId, buyerId, supplierId, poId, productId, lotSize, inspectionType('pre_shipment'), aqlPlan{ generalLevel, critical{aql?}, major{aql?}, minor{aql?} }, computedSampling{ sampleSizeCodeLetter, sampleSize, perClass{ac, re} }, loopPresetId (snapshotted), assignedInspectorId, status, supersedesInspectionId?, tamperProof{ inspectorId, deviceId, submittedAt, gps } (locked), createdByUserId, createdAt, submittedAt`.

**InspectionLoop** — a loop instance within an inspection: `id, inspectionId, loopStepRef, photos[], appliedDefects[], measurementValues[], notes`. (Per-loop status is informational only — see §8.)

**Photo** — `id, inspectionLoopId, storageKey, source(mobile_verified|manual_upload), uploaderUserId, capturedAt?, gps?, deviceId?, exif?, contentHash, annotations[]`. `source` drives the report's verified/unverified badge.

**DefectInstance** — `id, inspectionId, inspectionLoopId, defectCatalogId? | customText?, severity(critical|major|minor), photoIds[], notes`.

**AqlResult** — `id, inspectionId, perClass{ found, ac, re, classResult(pass|fail) }, systemRecommendation(pass|fail), qaDecision(pass|fail|hold), decidedByUserId, decidedAt`.

**Report** — `id, inspectionId, orgId, buyerId, pdfStorageKey, brandingSnapshot, contentHash, signature, status(generated|delivered), generatedAt`. Immutable.

**AuditLog** — `id, orgId, entityType, entityId, action, actorUserId, payloadHash, prevEntryHash, createdAt`. Append-only, hash-chained (§9).

### Inspection lifecycle

```
draft -> assigned -> in_progress -> submitted -> under_review -> approved -> report_issued
                                          |                       |
                                          |                       +-> rejected / hold -> (re-inspection)
                                          +- (AQL auto-computed & flagged on submit)
```

A **re-inspection** is a brand-new `Inspection` with `supersedesInspectionId` pointing at the failed one. It is a separate **billable** event. The original stays locked; the chain is preserved for audit.

---

## 6. Loops & presets

- A QA Manager (or above) builds **loop presets**: an ordered list of zone steps, each with reference illustration(s), a required number of shots, the defect tags allowed in that zone, and free-form measurement field labels.
- A preset can be a **buyer default** (auto-applied to that buyer's inspections) or attached **per inspection**.
- On inspection creation, the chosen preset is **snapshotted** onto the inspection so later preset edits don't mutate historical inspections.
- MVP populate flow (Admin): upload a batch of photos for an inspection, **drag/drop them into the correct loop slots**, tag defects, and enter measurements per loop.

---

## 7. Defects & defect catalog

Hybrid model:

1. **Seeded global library**, pre-classified by severity so counts feed AQL directly. Starting set (editable):
   - **Critical** — sharp/broken needle or metal contamination, sharp points, anything posing a safety risk.
   - **Major** — skipped or broken stitches, open/insecure seams, holes, stains, wrong/missing components, measurement out of an agreed range.
   - **Minor** — loose threads, slight shade variation, minor puckering, light surface marks.
2. **Custom defects** — QA Managers add org-level entries; an inspection can also capture a **free-text one-off** defect with a chosen severity.

Every `DefectInstance` carries a severity, which determines the AQL class it counts against.

---

## 8. AQL & sampling logic

The system implements **ISO 2859-1 / ANSI-ASQ Z1.4 single sampling, General Inspection Level II** as the MVP default.

**Algorithm:**
1. **Lot size -> sample-size code letter** from the level-II code-letter table (e.g. 281–500 -> H, 501–1200 -> J, 1201–3200 -> K).
2. **Code letter + AQL -> sample size n and accept/reject numbers (Ac/Re)** from the single-sampling master table (normal severity). The same `n` applies; **each defect class has its own Ac/Re at its own AQL.**
3. **Per-class evaluation.** Count defects found in the sample per class; a class **fails** when `found >= Re` (i.e. `found > Ac`). Critical typically uses AQL ~= 0 -> `Ac = 0` (any critical defect fails the lot).
4. **System recommendation** = PASS only if every class passes; otherwise FAIL. **The inspection passes or fails as a whole** — there is no per-loop pass/fail. The system **flags** the recommendation; it does **not** finalize. A **QA Manager makes the binding call** (pass / fail / hold).

**Configuration:** `generalLevel` defaults to II. Per-class AQLs (critical / major / minor) are **optional / advanced fields** with sensible defaults (e.g. critical 0, major 2.5, minor 4.0).

**Implementation note:** embed ISO 2859-1 **Table I** (code letters) and **Table II-A** (normal single-sampling Ac/Re) as lookup data. Out of MVP scope: double/multiple sampling and normal<->tightened<->reduced **switching** (switching needs per-supplier lot history — easy to add later).

---

## 9. Tamper-proof & audit

"Tamper-proof" is concretely defined as the combination of:

- **Per-photo provenance.** Every photo records `source`: `mobile_verified` (captured in-app with signed EXIF + GPS + device + timestamp at source — future) or `manual_upload` (Admin-only — no verified metadata). The report shows a **"manually uploaded / unverified" badge** on `manual_upload` photos so the trust claim stays honest. Mobile capture, when it lands, is **camera-only — no gallery picker.**
- **Locked submission.** On submit, the inspection and its tamper-proof block (`inspectorId, deviceId, submittedAt, gps`) freeze. **No amendments by anyone.** Corrections happen only via a new linked re-inspection.
- **Content hash + Ed25519 signature.** On report generation, compute a `contentHash` over the canonicalized inspection data + ordered photo hashes + metadata, then sign it with a **platform Ed25519 key**. Signature + hash are embedded in the PDF footer. A public verification page recomputes and verifies the signature **without the viewer having to trust the portal** — this is what makes the report independently trustworthy to a buyer. (The signing pipeline is in MVP; the public verification page can be a fast-follow.)
- **Append-only, hash-chained audit log.** Each `AuditLog` entry stores the hash of the previous entry, so any retroactive edit breaks the chain and is detectable.

**PDF is the canonical, signed artifact** (an editable Word file cannot be tamper-proof, so Word export is out of scope — see §10).

**Not in scope:** legal e-signature frameworks (eIDAS / ESIGN), buyer code-of-conduct / social-compliance modules, and data-residency constraints — explicitly excluded per requirements.

---

## 10. Reports

- **Per-buyer branding.** Each report is themed with the buyer's logo/colors, snapshotted onto the report at generation.
- **English only** for MVP.
- **PDF only** for MVP (no Word export).
- **Delivery:** email + portal download. (No API/webhook push in MVP.)
- **Immutable** once generated; verifiable via embedded hash + Ed25519 signature.

**Standard pre-shipment report structure:**
1. **Cover** — buyer branding, PO, product/style, supplier/factory, inspector, date + GPS.
2. **Inspection scope** — type (pre-shipment), AQL plan, sample-size code letter, computed sample size, per-class Ac/Re.
3. **Quantity / carton verification.**
4. **Defect summary table** — counts of critical / major / minor against their accept/reject numbers, with the overall result.
5. **Per-loop photo evidence** — photos grouped by zone, each with its verified/unverified badge.
6. **Measurement sheet** — free-form measurements as recorded.
7. **Workmanship & packaging notes.**
8. **Conclusion** — QA Manager's binding result (pass / fail / hold) and remarks.
9. **Locked footer** — tamper-proof block (hash + Ed25519 signature), inspector ID, device ID, timestamp, GPS.

---

## 11. The three MVP screens (web)

1. **Companies / Workspace dashboard** — manage buyers and suppliers, and the POs/products inspections attach to. (QA Manager and above.)
2. **Create / Initiate inspection** — set buyer, supplier/factory, PO, product, lot size, AQL plan (level + per-class AQLs), loop preset, and assigned inspector; the tamper-proof block is shown as a **locked** section. (QA Manager and above.) The full population (photos, loop arrangement, defect tags, measurements) is performed by the Admin in MVP.
3. **Loop presets** — build and save reusable loop sequences with reference illustrations, required shots, allowed defect tags, and measurement fields; attach to a buyer or an inspection. (QA Manager and above.)

Supporting surfaces the MVP also needs: **report review/approval**, **report viewer + branded PDF download**, **buyer guest portal** (read-only, scoped), **user/role management** (Org Owner), and the **Admin populate console** (photo upload + drag-drop into loops + defect tagging + measurement entry).

---

## 12. MVP scope — in vs. deferred

| Area | In MVP | Deferred |
|---|---|---|
| Surfaces | Web/desktop console + backend API | Mobile app (React Native) |
| Photo capture | Admin manual upload (badged) | Mobile camera-only verified capture (EXIF/GPS/device) |
| Inspection type | Pre-shipment only | Inline / during-production / final |
| Sampling | ISO 2859-1 single sampling, level II | Double/multiple sampling; normal/tightened/reduced switching |
| Measurements | Free-form | Points-of-measure vs. spec + tolerances; tech-pack import; grading |
| Reports | Per-buyer branded PDF; email + portal | API/webhook delivery; Word export; multi-language |
| Tamper-proof | Provenance badges, locked submit, hash + Ed25519 signature, hash-chained audit | Public verification page (fast-follow) |
| Billing | Per inspection | Seats/tenant/tiered |
| Integrations | None | ERP/PLM, tech packs, WhatsApp/SMS, social-compliance |
| Roles | Inspector / QA Manager / Org Owner / Platform Admin (additive) | Finer-grained custom roles |
| Onboarding | Invite-only (Platform -> Org -> users/guests) | Public self-signup |

---

## 13. Architecture & technical notes

Built on the existing pnpm + Turborepo monorepo (`apps/api` NestJS, `apps/web` Next.js console; `apps/mobile` to come; `packages/*` for shared code).

- **Real persistence models + migrations.** (Spec said TypeORM; repo is now Prisma.) Keep `synchronize: false` equivalent — i.e. use `prisma migrate`, not `db push` in prod. Introduce a migration workflow before modeling the domain in §5. Do **not** rely on auto-sync.
- **Photo / object storage.** Photos go to **S3-compatible object storage** with **presigned upload URLs** issued by the API (no base64 through the API). Store `contentHash`, `source`, and metadata per photo.
- **API designed client-agnostic** so the future mobile app reuses it cleanly, and **not precluding offline sync** later — accept **client-supplied idempotency tokens**, tolerate client-generated correlation IDs, keep write endpoints idempotent. (No offline machinery is built in MVP; the API is just shaped to allow it.)
- **RBAC enforced server-side** on every tenant-scoped route, keyed off `orgId` + role; the Platform Admin is the only `orgId`-agnostic principal.
- **Report generation** server-side; PDF is the signed, canonical artifact; Ed25519 keys held by the platform.
- **A shared types package** (`packages/shared-types`) is now justified — the console, API, and future mobile app share the inspection domain types. Introduce it with this work.

---

## 14. Confirmed scoping decisions

| # | Decision |
|---|---|
| 1 | **Tenancy:** multi-tenant, workspace-isolated; an Org is an inspection company **or** a manufacturer; buyer<->supplier relationship is bidirectional. |
| 2 | **Roles** are additive (Admin >= Org Owner >= QA Manager >= Inspector). |
| 3 | **Onboarding is invite-only** — no public self-signup; Platform invites Orgs, Orgs invite users and buyer guests. |
| 4 | **Buyer access:** receives PDF and/or a read-only guest login scoped to that buyer's own reports, per tenant. |
| 5 | **Buyer/supplier/PO management** (including creating a buyer + setting branding) is **QA Manager and above**. |
| 6 | **Inspection scope:** pre-shipment only. |
| 7 | **Sampling:** ISO 2859-1 single sampling, general level II; per-class AQLs optional/advanced; **no** switching in MVP. |
| 8 | **Pass/fail** is computed at the **whole-inspection** level via AQL; per-loop status is informational; the system flags and a QA Manager makes the binding call. |
| 9 | **Measurements:** free-form (no spec/tolerance/tech-pack/grading). |
| 10 | **Capture in MVP:** Admin-only manual upload; the **Admin owns the full populate step** (upload + arrange + tag + measure); no inspector-facing capture UI on web. |
| 11 | **Photo provenance:** every photo badged verified vs. manually-uploaded; mobile capture (future) is camera-only. |
| 12 | **Reports are immutable** once submitted; corrections only via a new linked, billable **re-inspection**. |
| 13 | **Report format:** PDF only; per-buyer branded; English only; delivered by email + portal download. |
| 14 | **Tamper-proof:** locked submission + content hash + **Ed25519 signature** (buyer-verifiable) + append-only hash-chained audit log. |
| 15 | **No** e-signature/eIDAS/ESIGN, social-compliance, data-residency, or integrations in MVP. |
| 16 | **Billing:** per inspection. Both customer types (inspection companies and manufacturers) can be paying tenants. No design partner yet. |

---

## 15. Suggested build sequence

1. **Foundation** — `packages/shared-types`, persistence models, and the initial migration for the §5 domain model.
2. **Auth & tenancy** — login, multi-tenant RBAC, invite-only onboarding (Platform -> Org -> users/guests).
3. **Workspace** — buyers/suppliers/POs/products dashboard + loop-preset builder.
4. **Inspection setup** — create/assign-inspection flow, the AQL engine (ISO 2859-1 lookup tables), and the locked tamper-proof block.
5. **Admin populate console** — presigned S3 photo upload, drag-drop into loops, defect tagging, measurements.
6. **Decisioning** — AQL auto-flag on submit + QA review/approve/reject/hold.
7. **Reporting** — branded PDF generation, Ed25519 signing, hash-chained audit, email + portal download, buyer guest portal.
