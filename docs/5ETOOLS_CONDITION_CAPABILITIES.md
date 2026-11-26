# V1.4a8.5.5 — Condition capability matrix

## Checkpoint
a8.5.4 approved at 7dff3b64e6fd3dd85685a6634f87fa58400b6ead. Quality push 45873601874, PR 45873611113, structural 45873601870 (job 140094980277) all success. Main e676152ace06d5c6e5280d0a7204a259371cb9ae. Main upstream reviewed at 2512db75eb48ef06f6190b086a82430887906dca. a8.5.4 covers two Exhaustion definitions via preview only.

## Implementation
- scripts/5etools/condition-capability-matrix.js: 14 remaining names, 28 edition-specific definition rows, canonical entries SHA-256 per reviewed source definition. Exact identity/provenance/edition binding; changed definition or wrong source stays indeterminate. No copied rule text, no alias or effect injection.
- Per-definition obligation codes distinguish direct target hook (only the Prone distance-based incoming attack roll modifier), generic primitive without condition orchestration, explicit gap, cross-rule review and not demonstrated. Counts are obligations, not implementation percentages. Scope is clauses in these condition definitions, not complete edition rules.
- Differences kept separate: 2014 Stunned explicitly blocks movement, 2024 definition does not; Grappled 2024 contextual attack penalty and dragging costs, 2014 ending triggers; Incapacitated 2024 concentration/speech/initiative; Invisible observer exceptions; Petrified poison/disease vs Poisoned condition immunity; Unconscious 2024 Prone persists. 2014 bonus action and stand cost flagged cross-rule review rather than silently inferred.
- Existing condition audit emits only aggregate counts, not identities/raw clauses. No additional clone, parse pipeline, workflow or dependency. All 28 definitions remain review-required, zero approved mappings or parity. No runtime or stored-data changes.

## Tests
Four new synthetic tests in upstream5etoolsConditionConverter.test.ts: changed definition and duplicate inventory; existing Prone incoming roll hook at 5/6 feet with cancellation; generic hit chance versus guaranteed critical (also guarantees hit, hence not valid for critical-on-hit conditions); missing speed lock/nested condition/concentration automation and existing explicit concentration clearing. Existing real snapshot test verifies all 28 hash bindings, selected edition differences and rejection of mismatched source/text. CI pending, full suite not run locally.

## Next a8.5.6
Use aggregate results to design explicit edition-aware condition state and capability binding (actor/target/source, level, independent instances, lifecycle, context). Prioritize safe scoped roll hooks and critical-on-hit semantics without treating hits as guaranteed; decide whether to implement in separate review-only preview or runtime fix with regression coverage. Keep current legacy conditions, Exhaustion preview, and existing source approval gates unchanged. Follow with class/subclass/feature ownership and progression review. No cutover: inventory, parity, durable backups, production rollback, rights/trust, device testing and separate approval still pending.
