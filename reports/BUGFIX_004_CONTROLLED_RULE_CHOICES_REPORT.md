# BUGFIX-004 — Controlled rule choices

## Problem

Rule-governed choices were rendered as comma-separated free-text fields. The clearest reproduction was the Musician Origin Feat, where the user had to type instrument names manually and the validation only counted strings. The same pattern existed for tools, skills, Expertise and languages in other creation and feat-editing flows.

## Root cause

The rules layer exposed only the number of required choices. It did not expose the allowed option family, such as Musical Instruments, Artisan's Tools or Gaming Sets. The UI therefore had no structured data source and fell back to `Field` components.

Background placeholders such as `one Artisan's Tools` were also treated as if they were granted proficiency names instead of unresolved choices.

## Remediation

### Shared option catalog

Added `src/characters/choiceOptions.ts` with structured lists and parsers for:

- artisan's tools;
- musical instruments;
- gaming sets;
- other tools and kits;
- Standard Languages;
- Rare Languages.

The parser resolves existing catalog descriptors such as:

- `musicalInstrument:3`;
- `artisanToolOrMusicalInstrument`;
- `one Artisan's Tools`;
- `one Musical Instrument`;
- `one Gaming Set`.

### Shared selection component

Added `ChoiceChipSelector`, backed by `PaginatedChipList`, with:

- visible selected/required count;
- selection limit enforcement;
- selected choices always removable;
- pagination for large lists;
- preservation and removal of older custom values already stored on a character;
- deterministic test IDs.

### Feat choices

The creation screen and feat-management screen now use controlled selectors for:

- skill proficiency;
- mixed skill/tool choices such as Skilled;
- Expertise;
- tool proficiency;
- language proficiency.

`getFeatChoiceSchema` now carries `toolOptions`, `languageChoiceCount` and `languageOptions`. Musician is restricted to musical instruments, while Crafter is restricted to artisan's tools.

### Class and background choices

Class and background tool requirements now contain exact options. Placeholders are no longer written into character proficiencies.

Examples:

- Bard: exactly three musical instruments;
- Monk: one artisan's tool or musical instrument;
- Artisan background: one artisan's tool;
- Entertainer background: one musical instrument;
- backgrounds that grant a gaming set: one concrete gaming set.

### Languages

Character creation now grants Common automatically and requires two selected Standard Languages. Class features with `languagesAdd` or `languageChoices` are also resolved into fixed and selectable class languages.

### Manual proficiency editor

The post-creation proficiency editor no longer uses free-text fields for tools, weapons, armor or languages. It uses selectable lists and retains existing custom values as removable selections.

### Persistence

- Character creation draft version increased from 8 to 9.
- Added background tool and class language choice persistence.
- Character migrations default the new fields safely for old saves.
- Reconciliation reapplies the controlled choices and fixed Common language.

## Regression coverage

Added or expanded:

- `choiceOptions.test.ts`;
- `featChoiceRules.test.ts`;
- `proficiencyRules.test.ts`;
- `ruleDrivenChoiceUi.test.ts`.

Coverage includes Musician, Crafter, Bard instruments, background tools, Standard Languages, class language progression and removal after reaching a selection limit.

## Validation performed

- TypeScript syntax check: PASS — 389 files.
- Project shape: PASS.
- Accessibility contracts: PASS.
- Release readiness: PASS.
- Bundled compendium: PASS — 1,284 items and 1,284 unique IDs.
- Choice-option runtime contracts: PASS.
- Rule-driven UI source contract: PASS.

The complete `tsc --noEmit` and Jest suite could not run in this environment because its internal npm mirror returned 404 while resolving React Native. No dependency or lockfile changes were made by this bugfix.
