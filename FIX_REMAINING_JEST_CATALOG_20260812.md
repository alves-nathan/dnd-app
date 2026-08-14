# APP06 — Remaining Jest Catalog Fixes — 2026-08-12

## Context

After the SDK 57 dependency tree was repaired, the user's environment passed dependency lock validation, TypeScript typecheck, and Expo Doctor (20/20). Jest was reduced to 3 failures in 2 suites:

- `src/tests/extractedBookPackIntegration.test.ts`
- `src/tests/compendiumImportV2Cutover.test.ts`

## Root causes

### 1. Canonical V2 boundary rejected extracted granted actions

Some extracted Forge/Tasha `grantsActions` still used lossless legacy shapes:

- missing canonical `type`;
- textual/non-array `consumes` metadata.

The V2 Zod schema correctly requires a canonical action shape, but `normalizeGrantedActions()` only derived `name`; it did not derive `type` or preserve non-array `consumes` outside the canonical field. As a result, `parseImportPack(...).ok` could be false for staged/runtime book packs.

### 2. Cutover expectations predated MM 2024 dependency closure

The cutover test still expected the older 5-pack / 1,989-item catalog. The current runtime intentionally bundles `mm-2024-runtime-dependency-delta-v2-canonical.json`, making the current baseline 6 packs / 1,991 items.

### 3. Integration harness compared raw-ish V2 data against normalized persisted data

Once the normalizer was corrected, the integration harness needed to canonicalize its input packs before preview/persistence so replay comparisons remained symmetric and idempotent.

## Changes

- `src/compendium/importNormalization.ts`
  - derive a deterministic granted-action `type` when absent (`spell`, `attack`, or `utility`);
  - preserve non-array `consumes` as `legacyConsumes` and remove the invalid canonical `consumes` field;
  - emit explicit normalization issues for both conversions.
- `src/tests/extractedBookPackIntegration.test.ts`
  - load test packs through `parseImportPack(..., { validateSemantics: false })` before preview/persistence.
- `src/tests/compendiumImportV2Cutover.test.ts`
  - update fresh-install expectation to 1,991 items;
  - include the MM 2024 runtime dependency delta in expected pack IDs and bundled file names.
- `scripts/check-extracted-book-pack-integration.js`
  - canonicalize source packs before preview/persistence.
- Regenerated staged/derived catalog artifacts and checksums affected by canonical normalization (Forge and Tasha compatibility chain).

## Validation performed in the artifact environment

- `node scripts/check-typescript-syntax.js` — PASS (442 TypeScript files)
- `node scripts/check-extracted-book-pack-integration.js` — PASS (1,991 items / 6 packs)
- `node scripts/check-bundled-compendium.js` — PASS
- `npm run compendium:import-v2:release-gate` — PASS, including:
  - extracted-book staging;
  - MM 2024 dependency delta;
  - Spelljammer 2024 compatibility/upgrade;
  - Tasha 2024-first compatibility;
  - PHB 2014 legacy delta;
  - residual dependency audits;
  - 2024+Legacy character smoke 24/24;
  - custom Feat/Feature smoke 5/5;
  - V2 functional parity 13/13;
  - cutover audit;
  - post-cutover and final-baseline checks.

## User-side verification

No dependency reinstall is required for this patch if the user's current `node_modules` and newly generated `package-lock.json` are already healthy. Run:

```bash
npm run typecheck
npm test -- --runInBand
npx expo-doctor
```

If all three pass, preserve the user's current `package-lock.json`; it was generated successfully after the SDK 57 dependency correction and should remain the install lock for future `npm ci` runs.
