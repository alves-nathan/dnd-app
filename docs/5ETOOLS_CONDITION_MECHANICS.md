# V1.4a8.5.4 — Edition-specific Exhaustion preview

## Checkpoint
a8.5.3 approved at 1a9073ed2c393a64586f093a462b558a39d04d90: Quality push 45871619086, PR 45871627996, structural 45871619101, all success. Main remains e676152ace06d5c6e5280d0a7204a259371cb9ae. Main snapshot 2512db75eb48ef06f6190b086a82430887906dca; Brew bfa899639c696b0ad38afb9a31c443c3b127a058.

## Implementation
- scripts/5etools/condition-mechanics-preview.js: bind the two observed PHB/XPHB Exhaustion definitions to source, physical ID, staging ID, provenance and exact canonical entries SHA-256. No rule text added. Changed definitions or mismatched edition remain indeterminate. This is a local evidence binding, not signature or rights verification.
- Pure explicit hypothetical level 0–6, base speed and base maximum HP preview. 2014 cumulative disadvantage/checks, attacks/saves, half speed/max HP, zero speed and death thresholds; 2024 -2 per level D20 modifier and -5 feet per level speed, no inherited 2014 effects. Whole-number bases, floor halving and nonnegative speed; no modifier composition, actual HP adjustment or death transaction.
- Explicit receive/removal/long-rest transitions. 2014 receive amount and food/drink confirmation; 2024 one level per receipt, one removed at completed long rest. External removal amount must be explicitly provided (not a grant of removal authority). Terminal death not automatically cleared; 2014 exhaustion-caused death preview supports only explicitly confirmed revival, 2024 revival unresolved. No inference from active effect IDs or automatic application to characters.
- Aggregate condition audit reuses existing condition converter real fixture. Expected 15 per edition: one hash-bound Exhaustion model candidate, fourteen effects-review pending. No other condition mappings, alias approvals, effects or runtime changes. ActiveEffects currently deduplicates condition IDs and can clear effects at long rest, so it is not a level-counter implementation.

## Validation
Four added synthetic tests cover thresholds, revised numeric penalties, transitions and invalid input/redaction. Existing real condition test checks exact definition fingerprints and rejects changed text/edition. No new workflow, dependencies or full upstream parse. CI pending; full suite not run locally. No migration, writes or parity approval.

## Next a8.5.5
Review CI, then establish a condition-to-runtime capability matrix for the remaining 14 pairs, separating roll modifiers, action restrictions, movement, automatic saves, immunities, triggers and ending conditions; add isolated regression probes for existing hooks and explicit missing capabilities before deciding on runtime condition state model. Then move to class/subclass/feature identity/progression. Durable backups, actual installations, rollback, full inventory, rights/trust and explicit cutover approval still required.
