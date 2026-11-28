# V1.4a8.6.1 — Class owner and progression evidence

## Baseline
a8.5.7 approved at 30ae7e743ae773e7b6476f0dd6a731efbd159693; Quality push 45882194593, PR 45882201095, structural 45882194605 (job 140123991973). Main unchanged e676152ace06d5c6e5280d0a7204a259371cb9ae. Matrix e726e023fe77b3abb0579fe9cd35f5e56365b753d9e88fc5766ff9697aaef89e. Main upstream 2512db75eb48ef06f6190b086a82430887906dca, Brew bfa899639c696b0ad38afb9a31c443c3b127a058.

| Kind | Main emitted | Historical occurrences | Identity candidates | Pending |
| --- | ---: | ---: | ---: | ---: |
| class | 27 | 50 | 35 | 15 |
| subclass | 146 | 251 | 143 | 108 |
| feature | 1869 | 3192 | 1170 | 2022 |

Feature includes 605 classFeature, 1031 subclassFeature, 233 optional features; never equate optional feature with native grant. Runtime inventory 12 classes, 48 subclasses, 429 features; preserve existing owner-context pending status. Counts are occurrences, not unique IDs or verified actual installations.

## Implementation
scripts/5etools/class-progression-evidence.js reuses existing reconciliation input; verifies exact source occurrence and candidate fingerprints, consistent owner identity across historical ID variants, independent edition pending evidence. Rechecks emitted graph owner/kind/level and exact grant reference-to-featureIds/progression projection; counts duplicate and annotated grants and unlisted native features (not automatic errors). Optional features separate. Compares selected mechanical fields raw, distinguishes missing/added/different/absent, does not infer default. Progression comparison preserves order, duplicate references, ambiguous endpoints and level differences, no automatic mapping. Unresolved/era-pending endpoint prevents positive comparison; added counts are observed unmatched candidate membership, not definitive new grants when unresolved. Cross-level/owner semantic differences remain review. Runtime status counts only, no runtime owner inference. CI logs aggregate only; no new workflow, clone, dependencies or runtime changes.

## Validation
Five new synthetic tests using actual class converter and reconciliation; owner/level projection tampering, identity binding, historical completeness, variant conflicts, duplicates/order/level/era. Real reconciliation checks the 3493 historical occurrences and current emitted family totals. CI pending; no local full test execution. No mappings or parity approved, no legacy removal.

## Next a8.6.2
Use CI aggregates to prioritize class mechanics: hit dice, proficiency and spellcasting tables, owner/progression gaps. Inspect class/subclass spellcasting and multiclass rules separately before runtime regression probes. Preserve grant annotations and optional-feature selection/replacement semantics; no automatic grant or cutover. Actual installation, full historical inventory, durable backup/rollback, rights/trust, native validation and explicit approval still pending.

## FIX01 — strict TypeScript fixture guard
Original HEAD 2e0a6fcf3e267249e886b03f6e8120853e8b10f4: Quality push 45887821454 (job 140142832328) and PR 45887827957 (job 140142851394) failed in tsc --noEmit at upstream5etoolsClassProgressionEvidence.test.ts:69 (TS2532, possible undefined from Array.find). Add explicit presence guard for historical row and raw occurrence, then dereference the narrowed occurrence. No assertion, production code, converter, workflow or validation gate changes.

Structural 45887821405 (job 140142831959) passed. Real report e75dbcf5b6d1e3bdcf0b14e2ae7c2a2dbd5ab0d7a9df4df3b8585670554bfff6: 35/35 candidate class hit dice and saving throw proficiency fields exact; spellcasting 26 different and 9 missing; 35 resources missing. All 1170 candidate feature levels exact, but 118 sourceType differences. Class grants 573, including 99 annotated; subclass grants 623. Unlisted native features 32 classFeature and 408 subclassFeature (not necessarily errors). Historical progression: classes 3 endpointMappingPending and 32 endpointEditionPending; subclasses 29 and 114 respectively. No approved parity. FIX01 requires all three checks again before a8.6.2.
