# APP-INTEGRATION-06 — Monster dependency closure

Status: **PASS**  
Compatibility profile: **2024-first + legacy**  
Date: **2026-08-11**

## Objective

Close the two executable legacy Monster Manual dependencies left by APP-INTEGRATION-05 without importing an unnecessary full legacy/current Monster Manual:

- `mm-2014-creature-mage` — base stat block for `Aarakocra Spelljammer Variant`;
- `mm-2014-creature-flumph` — base stat block for `Flapjack Variant`.

## Source verification

The current Monster Manual index on D&D Beyond contains both **Flumph** and **Mage**. The current Mage stat block is also available in the official D&D Beyond 2024 Basic Rules and was used as the authoritative mechanical source for the runtime record.

The current Flumph entry is confirmed in the official Monster Manual 2024 index. Its mechanical stat block was cross-checked against the D&D 2024 licensed Roll20 compendium because the detailed D&D Beyond Monster Manual entry is not exposed in the same freely parseable form in this environment. For that reason the imported Flumph remains `status: needsReview` / `confidence: importedNeedsReview` until a manual check against an owned current Monster Manual can be performed.

No long source prose was copied; records contain only structured/paraphrased mechanics needed by the runtime.

## Minimal current-rules delta

Generated pack:

`assets/compendium/mm-2024-runtime-dependency-delta-v2-canonical.json`

Logical pack id:

`mm-2024-runtime-dependency-delta-v1`

Records:

- `mm-2024-creature-mage`
- `mm-2024-creature-flumph`

Count: **2 `creatureStatBlock` records**.

The Mage carries 12 spell references, all resolved against the bundled PHB 2024 catalog. The Flumph stores `hover` as a mechanical flag rather than as a movement-speed value, preserving the V2 canonical speed contract and making the pack idempotent across import/export/persistence normalization.

SHA-256:

`ab6f55a1bc5632ca13fe994bf3ded4ccc3999009df137680b40eaabf679113c9`

## Spelljammer reconciliation

The 2024-first compatibility projection now maps:

- `mm-2014-creature-mage` → `mm-2024-creature-mage`;
- `mm-2014-creature-flumph` → `mm-2024-creature-flumph`.

Effective variant refs:

- `spelljammer-2022-feature-lox-aarakocra-spelljammer-variant` → `mm-2024-creature-mage`;
- `spelljammer-2022-feature-lox-flapjack-variant` → `mm-2024-creature-flumph`.

The compatibility projection now reports **171 rewritten legacy-reference occurrences** in total and **0 executable MM 2014 base-creature references**.

The in-place upgrade scenario for an installation that already contains the previous Spelljammer pack finishes with:

- **28 updates**;
- **0 creates**;
- **0 conflicts**;
- item count preserved;
- replay **182/182 unchanged**.

## Residual dependency audit

Final classifications:

- runtime-required: **0 unique / 0 occurrences**;
- display-only: **22 unique / 25 occurrences**;
- provenance-only: **2 unique / 7 occurrences**;
- PHB 2014 outside provenance: **0**;
- XGtE residual: **0**;
- malformed legacy IDs: **0**.

This means no additional legacy book delta is required to make the currently bundled mechanics executable. Display-only references remain contextual/documentary and do not justify importing DMG 2014 or MM 2014 wholesale.

## Runtime integration

Fresh install pack order:

1. PHB 2024 — 1,284
2. MM 2024 minimal runtime delta — 2
3. Forge of the Artificer 2025 — 200
4. Spelljammer 2022, 2024-compatible — 182
5. Tasha 2020, 2024-compatible — 267
6. PHB 2014 minimal legacy delta — 56

Final snapshot: **1,991 items / 6 packs**.

All six first imports are valid/executable with zero conflicts. Replays of MM delta, Forge, Spelljammer, Tasha compatibility and PHB 2014 delta are idempotent.

## Gate results

- `compendium:core:mm2024:delta:check` — PASS
- `compendium:legacy:spelljammer:2024:adapt:check` — PASS
- `compendium:legacy:spelljammer:2024:upgrade:check` — PASS
- `compendium:legacy:dependencies:audit:check` — PASS
- `compendium:legacy:monster-closure:check` — **11/11 PASS**
- `compendium:books:integration:check` — PASS, 1,991 items / 6 packs
- `compendium:legacy:2024:smoke` — **24/24 PASS**
- `custom-feat-feature:smoke` — **5/5 PASS**
- `compendium:bundled:check` — PASS
- `compendium:import-v2:functional-parity` — **13/13 PASS**
- `compendium:import-v2:release-gate` — **PASS**
- `typescript:syntax:check` — PASS, **442 files**
- `check:shape` — PASS
- `check:a11y` — PASS

Full Jest was not rerun because this distributed codebase does not contain `node_modules`; the independent TypeScript/Node gates above cover the changed import/runtime paths and are included in the release gate where applicable.

## Application changes

- Added `scripts/build-mm2024-runtime-delta.js`.
- Added `scripts/check-monster-dependency-closure.js`.
- Added the MM 2024 delta to `src/compendium/bundledCompendium.ts`.
- Added the pack to bundled/catalog validation and real import integration harnesses.
- Updated Spelljammer compatibility mapping for Mage/Flumph.
- Updated Spelljammer in-place upgrade harness to stage the MM current-rules delta before the compatibility upgrade.
- Updated the legacy dependency audit to require zero runtime-required dependencies.
- Updated integration Jest coverage for the six-pack catalog and MM-delta idempotency.
- Added MM-delta generation/closure checks to the Import V2 release gate.

## Decision

**APP-INTEGRATION-06 is complete.**

The app no longer needs the full Monster Manual 2014 or a full Monster Manual 2024 import to execute the currently imported legacy mechanics. The current runtime closure is satisfied by a two-record 2024-first delta.

## Next gate

**APP-INTEGRATION-07 — End-to-end 2024+legacy release smoke**

Exercise the six-pack catalog as one release candidate across character creation/progression, legacy subclasses on 2024 chassis, Mage/Flumph variant resolution, companions/stat blocks, combat math, catalog update, export/backup/restore and post-restore idempotency, while requiring zero runtime-required legacy dependencies and no regression of the consolidated custom feat/feature mechanics.
