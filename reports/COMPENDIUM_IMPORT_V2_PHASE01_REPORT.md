# Compendium Import V2 — Phase 01 Report

## Baseline

`dnd-combat-math-mvp-bugfix-011-custom-background.zip`

## Prompt execution status

This delivery intentionally starts the refactor without switching the production importer. It completes the requested domain audit and establishes the first shared-domain/V2 schema layer behind the current V1 path.

## Completed in this phase

### Domain audit

- Audited the current V1 schema, template, importer, mapper, export and file import pipeline.
- Audited storage paths (key-value + SQLite schema v3).
- Audited creation, custom background, progression, spellcasting and combat consumers.
- Generated a reproducible inventory of payload/rawJson/normalizedJson usage.
- Audited the bundled PHB 2024 pack: 1,284 items, 13 kinds, 1,284 unique IDs.
- Catalogued payload keys by kind.
- Identified canonical/runtime mismatches that require adapters instead of domain changes.

### Shared domain foundation

Added `src/compendium/importDomain.ts` with:

- canonical entity kinds;
- reuse of runtime `AbilityScore`, `ActionCost`, `DamageFormula`, `DiceTerm`, `ActiveEffectTemplate`;
- canonical skills, damage types and currency;
- typed payloads for all 13 existing kinds;
- structured currency;
- level progression, spellcasting, resources, references and extensible mechanics.

No `any` was introduced.

### V2 schema foundation

Added `src/compendium/importV2Schemas.ts` with:

- `dnd-combat-import.v2` envelope;
- typed source metadata;
- discriminated item union by `kind`;
- dedicated payload schema for all 13 current kinds;
- structured cost with transitional support for legacy string prices;
- `.passthrough()` extension points while real PHB fields are promoted incrementally.

### Version detection

Added `src/compendium/importVersion.ts` capable of distinguishing:

- `dnd-combat-import.v1`;
- `dnd-combat-import.v2`;
- legacy unversioned packages;
- unknown versions.

V1 migration itself remains Phase 05 work.

### Semantic validation foundation

Added `src/compendium/importSemanticValidation.ts` with initial checks for:

- duplicate IDs;
- missing subclass class;
- missing/wrong-kind feature references;
- feature subclass/class mismatch;
- versatile weapon without versatile damage.

### Tests and audit tooling

Added:

- `src/tests/compendiumImportV2Foundation.test.ts`;
- `scripts/audit-compendium-import-domain.js`;
- npm scripts `compendium:import-v2:audit` and `test:compendium-import-v2-foundation`.

## PHB 2024 inventory

| kind | count |
|---|---:|
| feature | 546 |
| spell | 391 |
| feat | 75 |
| creatureStatBlock | 66 |
| subclass | 48 |
| equipment | 42 |
| weapon | 38 |
| condition | 24 |
| background | 16 |
| armor | 13 |
| class | 12 |
| species | 10 |
| magicItem | 3 |
| **Total** | **1,284** |

## Validation performed

- `node scripts/audit-compendium-import-domain.js` — PASS
- `node scripts/check-typescript-syntax.js` — PASS, 404 TS/TSX files
- `node scripts/check-project-shape.js` — PASS
- `node scripts/check-accessibility-contracts.js` — PASS
- `node scripts/check-bundled-compendium.js` — PASS, 1,284 items / 1,284 unique IDs

Jest and full `tsc --noEmit` were not executed in this sandbox because the delivery zip does not contain `node_modules`. The new test suite is included for execution in the normal project environment.

## Important audit findings for the next phase

1. Runtime action costs are canonical, while PHB V1 contains values such as `passive`, `magicAction`, `attackReplacement`, `finishLongRest` and `none`.
2. Some weapons contain `STR_OR_DEX`, which is a rule/choice and must not be added to the Ability enum.
3. Several damage types are compound/variable strings and need structured normalization.
4. Equipment cost is still primarily a string in V1 data, while custom background already calculates currency.
5. The current schema does not require `templateVersion` even though the template/export produce it.
6. The V1 template documents substantially less than the current PHB package actually stores.
7. 121 current TS/TSX files now reference payload/rawJson/normalizedJson (including the newly added V2 foundation files); the generated audit artifact contains the exact list.

## Next execution step

Phase 02/04 continuation should implement the canonical normalizer first, because wiring the V2 schema directly into production before alias normalization would reject real current PHB values. After that, implement the explicit V1 -> V2 migration and a single `parseImportPack()` canonical entry point.
