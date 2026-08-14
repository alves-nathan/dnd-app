# Tactical Areas and Multiple Targets

## Scope completed

The roadmap block **Áreas e múltiplos alvos** is complete on top of the tactical stat-block-actions baseline.

Implemented:

- structured tactical templates for line, cone, cube, sphere and cylinder;
- additional runtime support for emanation, square and custom/imported area shapes;
- multiple target selection per action;
- per-target attack-hit allocation for multi-ray/multi-attack spells;
- per-target saving-throw state;
- per-target declared/rolled damage;
- save-success damage adjustment (`half` / `none`) when the imported spell defines it;
- per-target condition application from eligible spell effect templates;
- target HP and temporary HP updates when HP is tracked;
- Cleave secondary target resolution with adjacency validation;
- tactical log entries for each save, damage application, condition and Cleave event.

## Architecture

### `src/rules-engine/targeting/areaTemplates.ts`

Introduces the shared runtime area boundary. It normalizes V2 compendium area payloads into `TacticalAreaTemplate`, describes them for the UI, determines whether an action supports multiple targets, calculates target limits and implements deterministic selection toggling.

The normalizer preserves non-standard imported geometry as `custom` instead of inventing a standard shape. `shapeOptions` (for example walls/rings) are preserved as a readable custom template.

### `src/types/index.ts`

Adds:

- `TacticalAreaTemplate` / `TacticalAreaShape`;
- structured area metadata on `SpellAction`;
- save-success behavior and condition IDs on spell actions;
- `TacticalTargetResolution` and `targetResults` on `TacticalActionResolution`;
- `cleave` as a tactical effect event.

Existing single-target resolution remains valid through the legacy `targetId` / `confirmedHits` fields.

### `src/compendium/mapper.ts`

Maps structured V2 spell `area`, target descriptions and `damageOnSaveSuccess` into the character spell model without replacing the existing display-friendly `targeting.area` string.

### `src/rules-engine/actions/buildActions.ts`

Carries the structured area, save ability, save-success damage rule and target-relevant conditions from `Spell` into `SpellAction`.

Terrain effect templates are deliberately not converted into target conditions.

### `src/rules-engine/turns/tacticalCombat.ts`

The tactical rotation resolver now accepts multiple per-target results. It:

- validates duplicate/over-limit target resolutions;
- refuses save-dependent resolution while an affected target is still `pending`;
- applies full/half/zero damage according to the individual save;
- updates target HP/temp HP independently;
- applies conditions independently;
- applies Repelling Blast per hit/target;
- validates Cleave secondary adjacency (<= 5 ft in the current linear model);
- keeps old single-target rotations compatible.

### `app/characters/[id]/tactical.tsx`

The rotation UI now exposes:

- imported area shape/dimensions;
- reference target;
- affected-target multi-selection;
- explicit notice that geometric membership is manual in linear mode;
- hits per target;
- save result per target;
- damage per target;
- current target HP;
- Cleave primary/secondary selection.

## PHB 2024 coverage

The canonical bundled PHB contains 391 spells and 124 spells with non-empty area metadata.

Standard area shapes found in real data include:

- sphere: 31;
- cube: 21;
- emanation: 20;
- cylinder: 9;
- cone: 7;
- square: 5;
- line: 3.

The runtime normalizer can project 122/124 non-empty area payloads. The two intentionally non-targeted exceptions are `Dancing Lights` and `Light`, whose `area` objects describe light radii rather than affected-creature geometry.

The V2 data also contains non-standard shapes/options (walls, rings, panels, portals, etc.). Those are preserved as `custom` templates and remain manually target-selected until the optional X/Y map can represent their geometry faithfully.

## Cleave

Cleave now participates in tactical target resolution:

- target 1 remains the primary target;
- one secondary target may be selected;
- the secondary must be within 5 ft of the primary using the current linear positions;
- a distant secondary generates `TACTICAL_CLEAVE_TARGET_NOT_ADJACENT`;
- damage entered for an invalid secondary is not applied.

## Regression coverage

`src/tests/tacticalAreaMultiTarget.test.ts` covers:

- real PHB Burning Hands area mapping;
- standard area shape normalization;
- custom `shapeOptions` preservation;
- per-target save / half damage / condition behavior;
- pending-save blocking;
- multi-ray target limit and deselection;
- Cleave adjacent and non-adjacent targets.

`scripts/audit-tactical-area-multitarget.js` provides a dependency-light static/data audit against the bundled V2 PHB.

## Validation executed

- `npm run tactical:area-multitarget:check` — PASS;
- area/multi-target audit — PASS;
- TypeScript syntax check — PASS, 433 files;
- isolated core TypeScript compile (`areaTemplates.ts` + `tacticalCombat.ts`) — PASS;
- APP-30 isolated typecheck — PASS;
- project shape — PASS;
- accessibility contracts — PASS;
- bundled PHB — PASS, 1,284 items / 1,284 unique IDs;
- release readiness — PASS;
- Import V2 release gate — PASS;
- direct runtime harness: Burning Hands + two independent saves/damage — PASS;
- direct runtime harness: Cleave adjacency/damage — PASS.

A full Jest suite / project `tsc --noEmit` still requires the local project `node_modules`, which is not included in this archive.

## Deliberate boundary

The current tactical scenario stores one-dimensional positions. Therefore cone/cube/sphere/line containment is **not** automatically inferred. Doing so from a 1D distance would create false rules behavior.

For now:

1. the app displays the imported area template;
2. the user explicitly marks affected targets;
3. the engine resolves each marked target independently.

Automatic geometric inclusion belongs to the next roadmap block, **Mapa opcional**, which adds optional X/Y coordinates while preserving the linear mode.
