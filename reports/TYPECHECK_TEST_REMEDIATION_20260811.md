# Typecheck / Jest remediation — 2026-08-11

Baseline: tactical mobile closure Android owner runner.

## Input failures addressed

The local run reported 31 TypeScript errors in 14 files and 8 failing Jest suites / 11 failing tests. The failures clustered into four root causes:

1. Missing `CUSTOM_BACKGROUND_TOOL_COUNT` import and stale test fixtures.
2. Zod V2 inferred types drifting from the shared import domain (`CompendiumImportSource`, feat `abilityScoreIncrease`).
3. PHB legacy shapes reaching the V2 structural gate (`spell.payload.components: []` and variable resource costs such as `1+` / `1-5`).
4. Compatibility normalization gaps for legacy/needs-review files (missing spell classes and weapon classification).

## Remediation

- Restored `CUSTOM_BACKGROUND_TOOL_COUNT` import in character creation.
- Added V2 source extension index signature to the shared domain so `.passthrough()` metadata remains type-compatible.
- Narrowed feat `abilityScoreIncrease` schema to `AbilityScore[] | Record<string, unknown>[]` instead of `unknown[]`.
- Allowed resource-consumption amounts to preserve variable source expressions (`number | string`) rather than rejecting `1+` and `1-5`.
- Added canonical spell component normalization:
  - empty legacy arrays are removed;
  - V/S/M arrays are promoted to a structured object;
  - unrecognized textual arrays are preserved as reviewable text.
- Regenerated the canonical PHB V2 artifact; 46 empty `components` arrays are no longer materialized.
- Made spell-class reference resolution defensive for needs-review imports.
- Added a conservative `weaponCategory: unknown` state for legacy weapons whose simple/martial category cannot be inferred; this emits a warning and is not eligible for simple-weapon rules until reviewed.
- Defaulted missing legacy `weaponType` to `manual` instead of failing structural validation.
- Updated stale TypeScript test fixtures (`castingTime`, optional armor array, widened preview source type).
- Added regression coverage for empty spell components, variable resource costs, missing spell classes, and unresolved weapon category/type.

## Canonical PHB after regeneration

- items: 1,284
- unique IDs: 1,284
- kinds: 13
- semantic errors: 0
- semantic warnings: 0
- semantic infos: 1
- SHA-256: `6091dacf28f74bf2f645b3fe00b7d32ad5adee76fc933ac299102cd535a43fd6`

## Gates executable in this container

Passed:

- TypeScript syntax check (437 files)
- tactical mobile closure audit (4/4 runtime checks + 17/17 contracts)
- project shape
- accessibility contracts
- bundled PHB V2 check (1,284/1,284)
- PHB deterministic migration check
- V1 × V2 functional parity (13/13)
- phase 10 cutover audit/check
- post-cutover check
- final baseline check
- release readiness

Full `tsc --noEmit` and Jest cannot be executed in this container because the distributed baseline intentionally has no `node_modules`. They must be re-run in the owner's installed workspace.
