# Inspect Phase 1 — Foundation & Domain Core — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax. TDD throughout.

**Goal:** Build the pure-logic, DB-free core of Inspect — the AQL engine (ISO 2859-1), the tamper-proof crypto (canonicalize + content hash + Ed25519), the audit hash-chain, and the `@inspect/shared-types` contract package — all fully unit-tested with jest, no database required.

**Architecture:** Plain TypeScript modules under `apps/api/src/{aql,tamper-proof,audit}/` (NestJS-free, pure functions) plus a new workspace package `packages/shared-types`. The DB-bound NestJS services in later phases consume these.

**Tech Stack:** TypeScript, jest + ts-jest (existing in `apps/api`), Node `node:crypto`, Zod (shared-types).

**Why DB-free:** This workspace has no Postgres/Redis. These modules are pure logic and verify with `jest` alone.

---

## File structure

- `apps/api/src/aql/aql-tables.ts` — ISO 2859-1 Table I (code letters, Level II) + sample sizes + the supported Ac/Re grid.
- `apps/api/src/aql/aql.engine.ts` — `codeLetterForLotSize`, `sampleSizeForCodeLetter`, `planFor`, `evaluateClass`, `evaluateInspection`.
- `apps/api/src/aql/aql.types.ts` — `DefectClass`, `AqlPlanInput`, `ComputedSampling`, `ClassResult`, `AqlEvaluation`.
- `apps/api/src/aql/aql.engine.spec.ts` — tests.
- `apps/api/src/tamper-proof/canonicalize.ts` — deterministic JSON canonicalization.
- `apps/api/src/tamper-proof/content-hash.ts` — sha256 over canonical payload + ordered photo hashes.
- `apps/api/src/tamper-proof/signature.ts` — Ed25519 sign/verify (node:crypto).
- `apps/api/src/tamper-proof/*.spec.ts` — tests.
- `apps/api/src/audit/audit-chain.ts` — `entryHash`, `appendLink`, `verifyChain`.
- `apps/api/src/audit/audit-chain.spec.ts` — tests.
- `packages/shared-types/` — new package: `package.json`, `tsconfig.json`, `src/index.ts` (+ enums, json-contracts via Zod).

---

## ISO 2859-1 reference data (embedded)

**Table I — sample-size code letter, General Inspection Level II (lot size → letter):**

| Lot size | Letter | | Lot size | Letter |
|---|---|---|---|---|
| 2–8 | A | | 1,201–3,200 | K |
| 9–15 | B | | 3,201–10,000 | L |
| 16–25 | C | | 10,001–35,000 | M |
| 26–50 | D | | 35,001–150,000 | N |
| 51–90 | E | | 150,001–500,000 | P |
| 91–150 | F | | 500,001+ | Q |
| 151–280 | G | | | |
| 281–500 | H | | | |
| 501–1,200 | J | | | |

**Sample size by code letter:** A2 B3 C5 D8 E13 F20 G32 H50 J80 K125 L200 M315 N500 P800 Q1250 R2000.

**Supported single-sampling NORMAL Ac/Re grid (Re = Ac + 1), derived from the canonical L(200) column + Z1.4 diagonal repetition.** Cells outside this set throw `AqlPlanNotAvailableError` (no guessing — verify against the licensed ANSI/ASQ Z1.4 before extending).

| Letter (n) | AQL 1.0 | 1.5 | 2.5 | 4.0 | 6.5 |
|---|---|---|---|---|---|
| G (32) | — | — | 2 | 3 | 5 |
| H (50) | — | 2 | 3 | 5 | 7 |
| J (80) | 2 | 3 | 5 | 7 | 10 |
| K (125) | 3 | 5 | 7 | 10 | 14 |
| L (200) | 5 | 7 | 10 | 14 | 21 |
| M (315) | 7 | 10 | 14 | — | — |
| N (500) | 10 | 14 | 21 | — | — |

(values are **Ac**; Re = Ac+1. "—" = not in the verified set → throw.)

**Critical class:** AQL `0` is a special case → `Ac=0, Re=1` (any critical defect rejects), at the lot's normal sample size `n`.

**Per-class evaluation:** a class **FAILs** when `found >= Re` (i.e. `found > Ac`), else PASS. `systemRecommendation = PASS` iff every evaluated class passes.

---

## Task 1: AQL types

**Files:** Create `apps/api/src/aql/aql.types.ts`

- [ ] **Step 1: Write the types**

```ts
export type DefectClass = 'critical' | 'major' | 'minor';
export type AqlCodeLetter =
  | 'A' | 'B' | 'C' | 'D' | 'E' | 'F' | 'G' | 'H'
  | 'J' | 'K' | 'L' | 'M' | 'N' | 'P' | 'Q' | 'R';

/** Per-class AQL inputs. A value of 0 means "any defect rejects" (Ac=0). */
export interface AqlPlanInput {
  critical?: number; // default 0
  major?: number;    // default 2.5
  minor?: number;    // default 4.0
}

export interface ClassPlan { aql: number; ac: number; re: number; }

export interface ComputedSampling {
  sampleSizeCodeLetter: AqlCodeLetter;
  sampleSize: number;
  perClass: Partial<Record<DefectClass, ClassPlan>>;
}

export interface ClassResult { found: number; ac: number; re: number; outcome: 'PASS' | 'FAIL'; }
export interface AqlEvaluation {
  perClass: Partial<Record<DefectClass, ClassResult>>;
  systemRecommendation: 'PASS' | 'FAIL';
}
```

- [ ] **Step 2: Commit** — `git add apps/api/src/aql/aql.types.ts && git commit -m "feat(aql): types"`

## Task 2: AQL tables + lookups (TDD)

**Files:** Create `aql-tables.ts`, `aql.engine.ts`, `aql.engine.spec.ts`

- [ ] **Step 1: Failing tests** (`aql.engine.spec.ts`) — assert the spec examples and canonical cells:

```ts
import { codeLetterForLotSize, sampleSizeForCodeLetter, planFor } from './aql.engine';

describe('codeLetterForLotSize (Level II)', () => {
  it.each([[281,'H'],[500,'H'],[501,'J'],[1200,'J'],[1201,'K'],[3200,'K'],[8,'A'],[500000,'P'],[600000,'Q']])(
    'lot %i -> %s', (lot, letter) => expect(codeLetterForLotSize(lot)).toBe(letter));
  it('rejects lot < 2', () => expect(() => codeLetterForLotSize(1)).toThrow());
});

describe('sampleSizeForCodeLetter', () => {
  it.each([['H',50],['J',80],['K',125],['L',200],['N',500]] as const)(
    '%s -> %i', (l, n) => expect(sampleSizeForCodeLetter(l)).toBe(n));
});

describe('planFor (Ac/Re; Re=Ac+1)', () => {
  it('L @ 2.5 -> Ac10/Re11', () => expect(planFor('L', 2.5)).toEqual({ aql: 2.5, ac: 10, re: 11 }));
  it('L @ 4.0 -> Ac14/Re15', () => expect(planFor('L', 4.0)).toEqual({ aql: 4.0, ac: 14, re: 15 }));
  it('H @ 2.5 -> Ac3/Re4', () => expect(planFor('H', 2.5)).toEqual({ aql: 2.5, ac: 3, re: 4 }));
  it('critical AQL 0 -> Ac0/Re1', () => expect(planFor('H', 0)).toEqual({ aql: 0, ac: 0, re: 1 }));
  it('throws on unsupported cell', () => expect(() => planFor('G', 1.0)).toThrow(/not available/i));
});
```

- [ ] **Step 2: Run, verify fail** — `cd apps/api && ./node_modules/.bin/jest src/aql` → FAIL (modules undefined).
- [ ] **Step 3: Implement** `aql-tables.ts` (the Table I ranges, sample sizes, and the Ac grid above as `Record<AqlCodeLetter, Partial<Record<number, number>>>`) and `aql.engine.ts` (`codeLetterForLotSize`, `sampleSizeForCodeLetter`, `planFor` with the `aql===0 → {0,1}` special case and `AqlPlanNotAvailableError` otherwise; `Re=ac+1`).
- [ ] **Step 4: Run, verify pass.**
- [ ] **Step 5: Commit.**

## Task 3: Per-class evaluation + whole-inspection recommendation (TDD)

- [ ] **Step 1: Failing tests** — `computeSampling(lotSize, plan)` and `evaluateInspection(sampling, counts)`:

```ts
import { computeSampling, evaluateInspection } from './aql.engine';
it('computes sampling for lot 1000, default plan', () => {
  const s = computeSampling(1000, {}); // critical 0, major 2.5, minor 4.0
  expect(s.sampleSizeCodeLetter).toBe('J');
  expect(s.sampleSize).toBe(80);
  expect(s.perClass.major).toEqual({ aql: 2.5, ac: 5, re: 6 });
  expect(s.perClass.minor).toEqual({ aql: 4.0, ac: 7, re: 8 });
  expect(s.perClass.critical).toEqual({ aql: 0, ac: 0, re: 1 });
});
it('FAILs the lot if any class reaches Re', () => {
  const s = computeSampling(1000, {});
  const e = evaluateInspection(s, { critical: 0, major: 6, minor: 2 });
  expect(e.perClass.major!.outcome).toBe('FAIL'); // 6 >= 6
  expect(e.systemRecommendation).toBe('FAIL');
});
it('PASSes when all classes below Re', () => {
  const s = computeSampling(1000, {});
  expect(evaluateInspection(s, { critical: 0, major: 5, minor: 7 }).systemRecommendation).toBe('PASS');
});
it('one critical defect FAILs', () => {
  const s = computeSampling(1000, {});
  expect(evaluateInspection(s, { critical: 1, major: 0, minor: 0 }).systemRecommendation).toBe('FAIL');
});
```

- [ ] **Step 2–4:** run-fail → implement `computeSampling`/`evaluateInspection` (defaults: critical 0, major 2.5, minor 4.0; outcome FAIL when `found >= re`) → run-pass.
- [ ] **Step 5: Commit.**

## Task 4: Tamper-proof canonicalization + content hash (TDD)

**Files:** `tamper-proof/canonicalize.ts`, `content-hash.ts`, specs.

- [ ] **Step 1: Failing tests** — canonicalization is stable across key order; hash is deterministic and order-sensitive on photo hashes:

```ts
import { canonicalize } from './canonicalize';
import { contentHash } from './content-hash';
it('canonicalizes regardless of key order', () =>
  expect(canonicalize({ b: 1, a: 2 })).toBe(canonicalize({ a: 2, b: 1 })));
it('hash is deterministic', () => {
  const p = { inspectionId: 'i1' }; const ph = ['h1', 'h2'];
  expect(contentHash(p, ph)).toBe(contentHash(p, ph));
});
it('hash changes if a photo hash changes', () =>
  expect(contentHash({ x: 1 }, ['h1'])).not.toBe(contentHash({ x: 1 }, ['h2'])));
```

- [ ] **Step 2–4:** implement `canonicalize` (recursive sorted-key JSON.stringify) and `contentHash(payload, orderedPhotoHashes)` = `sha256(canonicalize(payload) + '\n' + photoHashes.join(','))` via `node:crypto`. run-pass.
- [ ] **Step 5: Commit.**

## Task 5: Ed25519 signature (TDD)

**Files:** `tamper-proof/signature.ts`, spec.

- [ ] **Step 1: Failing tests:**

```ts
import { generateKeyPair, sign, verify } from './signature';
it('verifies a valid signature', () => {
  const { privateKey, publicKey } = generateKeyPair();
  const sig = sign('hello', privateKey);
  expect(verify('hello', sig, publicKey)).toBe(true);
});
it('rejects a tampered message', () => {
  const { privateKey, publicKey } = generateKeyPair();
  const sig = sign('hello', privateKey);
  expect(verify('HELLO', sig, publicKey)).toBe(false);
});
```

- [ ] **Step 2–4:** implement with `crypto.generateKeyPairSync('ed25519')`, `crypto.sign(null, Buffer, privateKey)`, `crypto.verify(...)`; keys as PEM, signature base64. run-pass.
- [ ] **Step 5: Commit.**

## Task 6: Audit hash-chain (TDD)

**Files:** `audit/audit-chain.ts`, spec.

- [ ] **Step 1: Failing tests:**

```ts
import { entryHash, verifyChain } from './audit-chain';
const mk = (seq: number, action: string, prev: string | null) => {
  const payloadHash = entryHash({ seq, action }, null); // payload digest
  return { sequence: seq, action, payloadHash, prevEntryHash: prev };
};
it('detects an unbroken chain', () => {
  const e0 = { sequence: 0, payloadHash: 'p0', prevEntryHash: null as string | null };
  const e1 = { sequence: 1, payloadHash: 'p1', prevEntryHash: entryHash(e0, null) };
  expect(verifyChain([e0, e1])).toBe(true);
});
it('detects tampering', () => {
  const e0 = { sequence: 0, payloadHash: 'p0', prevEntryHash: null as string | null };
  const e1 = { sequence: 1, payloadHash: 'p1', prevEntryHash: entryHash(e0, null) };
  const tampered = { ...e0, payloadHash: 'EVIL' };
  expect(verifyChain([tampered, e1])).toBe(false);
});
```

- [ ] **Step 2–4:** implement `entryHash(entry, prev)` = sha256 over canonical(entry)+prev; `verifyChain(entries)` recomputes each `prevEntryHash` and confirms linkage + monotonic sequence. run-pass.
- [ ] **Step 5: Commit.**

## Task 7: `@inspect/shared-types` package

**Files:** `packages/shared-types/{package.json,tsconfig.json,src/index.ts,src/enums.ts,src/json-contracts.ts}`; modify root `tsconfig`/workspace as needed.

- [ ] **Step 1:** create `package.json` (`name:"@inspect/shared-types"`, `main`/`types` → `dist`, `build:"tsc -p tsconfig.json"`, dep `zod`), `tsconfig.json` (extends base, `composite`, `outDir dist`, `rootDir src`).
- [ ] **Step 2:** `enums.ts` — string-literal unions mirroring the Prisma enums (UserRole, InspectionStatus, DefectSeverity, PhotoSource, QaDecision, …).
- [ ] **Step 3:** `json-contracts.ts` — Zod schemas for the `Json` columns: `AqlPlanSchema`, `ComputedSamplingSchema`, `TamperProofBlockSchema`, `LoopPresetSnapshotSchema`, `GpsPointSchema`, `AqlPerClassResultSchema`; export inferred types.
- [ ] **Step 4:** `index.ts` re-exports. Run `pnpm install` then `pnpm --filter @inspect/shared-types build` and `type-check`. Expected: builds clean.
- [ ] **Step 5: Commit.**

---

## Self-review notes
- Spec coverage: §8 (AQL Tasks 1–3), §9 tamper-proof (Tasks 4–6), §13 shared-types (Task 7). DB-bound §5/§6/§7/§10/§11 are later phases.
- The AQL Ac/Re grid is the **MVP-supported band**; extending it requires authoritative Z1.4 values + arrow-rule handling (flagged task in Phase 4).
