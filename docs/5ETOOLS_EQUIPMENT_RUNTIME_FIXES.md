# V1.4a8.5.3 — Isolated runtime equipment corrections

## Checkpoint
a8.5.2 FIX01 approved at f2627681cd0ed0548c1ee809dd0d83bb4e2f0e44; Quality push 45866561162, PR 45866567484, structural 45866561163 (job 140070768318). Historical ammo evidence: 87 absentBoth, 18 exactValue, 9 differentValue, zero missingCandidate; fingerprint 8228a93462c729d197f851cd992c6cafd62b8aa686bbf2a1ec0d6bad9fc284ff.

## Implementation
- getArmorClass: explicit standard heavy category (trimmed case-insensitive) plus dexCap=0 ignores DEX modifier, including negative values. Other categories, unclassified armor, missing caps and nonzero custom caps use previous behavior. A manually configured heavy+zero cap is treated as standard heavy. Shield/accessory and custom numeric modifiers remain unchanged. No schema or character migration.
- buildWeaponFromCompendiumItem: resolves STR_OR_DEX in both regular and versatile formula using selected STR/DEX damage ability, falling back to existing preferred flexible ability. Exact token replacement only; explicit other ability tokens and unrelated variables stay intact. Structured ability resolution and tie behavior retained. A placeholder only in versatile formula also participates in flexible ability detection. No retrospective rewrite of stored character weapons.
- Existing synthetic heavy armor gap test replaced by correct runtime expectation across five DEX scores, plus review-required application guard. Added two-grip mapper/action test for structured/legacy choice, explicit ability and custom variable. Added AC regression matrix for standard and custom armor plus shield, no mutation.
- No V3 activation or parity approval. Staging review code remains pending until broader parity assessment. No dependencies or workflow changes. CI pending; local full suite not run.

## Next a8.5.4
Review CI. Assess explicit edition-specific conditions and exhaustion effects using existing effect/condition engine without activating V3; follow with class/subclass/feature identity and progression review. Remaining armor strength/stealth, ammo differences, mastery, loading/reload, actual installations, full inventory, durable backups, rollback, rights/trust, native testing and explicit cutover approval remain gates.
