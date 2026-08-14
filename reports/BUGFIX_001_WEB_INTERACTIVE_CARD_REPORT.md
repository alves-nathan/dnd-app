# BUGFIX-001 — Web interactive card nesting

## Symptom

React Native Web rendered a clickable `Card` as a native HTML `<button>`. Some cards also contained `Button`, `Chip`, `Field` or other controls, producing invalid nested interactive markup such as `<button><button>...</button></button>`.

The first visible occurrence was the character card on `app/index.tsx`, but the same structural risk existed in comparison scenarios, rotation creation and build-history snapshots.

## Root cause

`Card` supports `onPress` by rendering `Pressable` with `accessibilityRole="button"`. This is valid only when the card content is non-interactive. Several call sites combined the card-level action with child controls.

## Changes

- Character cards on the home screen are now containers with explicit `Abrir ficha`, progression and table-mode buttons.
- Saved comparison scenarios now use explicit `Usar cenário` and `Remover cenário` actions.
- Rotation actions now use an explicit `Adicionar à rotação` / `Remover da rotação` button before their editable controls.
- Build-history snapshots now rely exclusively on the existing `Marcar como antes`, `Marcar como depois` and removal buttons.
- `Card` documents that `onPress` is restricted to cards without nested controls.
- Added `interactiveCardNesting.test.ts`, which scans application/component TSX and rejects clickable cards containing known interactive controls.
- Web shadows now use `boxShadow`; native platforms keep native shadow properties and Android elevation.

## Validation performed

- TypeScript syntax check: PASS (381 files)
- Accessibility contracts: PASS
- Interactive-card source contract: PASS (no violations)
- APP-30 production contract check: PASS
- Bundled compendium check: PASS (1,284 items, all IDs unique)

## Local runtime verification

After installing dependencies, run:

```bash
npm run typecheck
npm test -- --runInBand src/tests/interactiveCardNesting.test.ts
npx expo start --web --clear
```

Verify the home screen and the following flows without DOM nesting errors:

- open character / progression / table mode;
- select and remove comparison scenarios;
- add an action to a rotation and edit its controls;
- mark build snapshots as before/after.
