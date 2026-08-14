# Tactical Stat Block Actions — Implementation Report

## Baseline

Implementation based on `dnd-combat-math-mvp-import-v2-phase12-final-baseline.zip`.

## Scope completed

The roadmap block **Ações dos stat blocks** is complete:

- creature stat block actions can be projected into persistent tactical targets;
- imported attack bonus, damage, reach/range and saving throws are exposed in the tactical UI;
- fixed attack bonuses are rolled against the character's calculated AC;
- damage can use the formula average or a real dice roll;
- per-action uses/recharge are projected as target resources;
- target reactions are modeled independently from the character reaction;
- manual attack/save flow remains as a safe fallback for dynamic formulas that require caster context.

## Architecture

### `src/characters/tacticalStatBlockRules.ts`

Provides a boundary between compendium creature payloads and tactical runtime state. It projects AC, HP, speed, size, actions, bonus actions, reactions, damage, saves and recharge/uses into `TacticalTarget` structures without creating a second creature domain.

### `src/rules-engine/turns/turnCycle.ts`

Adds automatic resolution for imported target actions. Fixed attack bonuses are resolved against `getArmorClass(character)`, fixed save DCs use the character's save modifier/proficiency, imported damage formulas can use average or dice rolls, and damage continues through the existing incoming-damage/concentration path.

### `app/characters/[id]/tactical.tsx`

Adds compendium creature selection, imported action controls, average/roll damage mode, resource recharge controls and target reactions. The pre-existing manual target attack flow remains available.

## PHB 2024 coverage

The bundled canonical V2 PHB contains:

- 66 creature stat blocks;
- 109 action rows total;
  - 104 actions;
  - 3 bonus actions;
  - 2 reactions;
- 99 attack-like rows;
- 5 save-effect rows;
- 5 utility/special rows;
- 3 imported action resources/recharges.

With the context currently stored on a tactical target, **66/109** rows can be resolved/registered automatically. **43/109** require external caster context or another variable not represented by the target itself (primarily `casterSpellAttack`, `casterSpellSaveDC`, spell-level-dependent summon formulas, or multiattack formulas without a fixed attack bonus). These actions remain visible and use the existing manual fallback rather than inventing values.

## Data safety and persistence

`TacticalTarget` now persists the source creature IDs, projected actions and projected resources. `combatScenarioStore` persistence was advanced from version 3 to 4; the existing normalizer keeps older scenarios compatible.

Imported target data is scenario-local. The compendium item itself is never mutated by combat usage, resource spending or recharge.

## Regression coverage

`src/tests/tacticalStatBlockActions.test.ts` covers real bundled data for:

- Wolf projection and Bite;
- attack resolution versus character AC;
- Quasit Scare saving throw and condition;
- Ape Rock recharge;
- Construct Spirit reaction consumption.

`scripts/audit-tactical-statblock-actions.js` provides a dependency-light runtime harness against the bundled V2 PHB.

## Validation executed

- `npm run tactical:statblock-actions:check` — PASS
- runtime audit — 5/5 PASS
- TypeScript syntax check — PASS, 431 files
- project shape — PASS
- accessibility contracts — PASS
- bundled compendium — PASS, 1,284 items / 1,284 unique IDs
- release readiness — PASS

A full `tsc --noEmit` / Jest suite requires the local `node_modules`, which is not included in the supplied baseline archive.

## Known boundary

Dynamic summon actions are deliberately not auto-resolved until the tactical scenario has explicit caster/spell context. This is a safety boundary, not missing imported data. The next roadmap block can introduce additional tactical context if needed rather than parsing or guessing those values from descriptions.

## Roadmap

The next unchecked block in `docs/ROADMAP_CHARACTER_CREATION_PHASE5H_TURN_CYCLE_REACTIONS.md` is **Áreas e múltiplos alvos**.
