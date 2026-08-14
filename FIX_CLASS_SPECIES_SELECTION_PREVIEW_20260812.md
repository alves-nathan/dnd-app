# APP06 — Class and Species Selection Preview

## Goal
Improve character creation context without moving full compendium text into the wizard.

## Class selection
- Selected classes now show a compact class description.
- The selected class card lists class features up to the effective class level.
- If no class-specific level is available, the preview falls back to the total character level.
- Feature rows show level gained, feature name and a compact summary.

## Species selection
- The selected species now shows a compact species description.
- Species traits/features are listed up to the total character level.
- Level-gated traits (for example Aasimar Celestial Revelation at level 3) do not appear before their level.
- Existing species choice editors remain separate and continue to handle required options.

## Data source
The preview uses the same validated Import V2 mechanical items already consumed by creation/progression. No rule text is hardcoded into the UI.
