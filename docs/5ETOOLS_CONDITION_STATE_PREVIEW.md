# V1.4a8.5.7 — Condition state, movement, saving throws and lifecycle preview

a8.5.6 approved at b9e4e1fcfec27c0daf521e3533ccec2d22613a48; Quality push 45878180463, PR 45878188080, structural 45878180320 all success. Main e676152ace06d5c6e5280d0a7204a259371cb9ae.

## Implementation
- New pure conditionStatePreview.ts shares existing instance validation. Effective condition view distinguishes explicit grants and parent implications; rejects conflicting editions. 2024 Unconscious implies Prone and Incapacitated; 2014 fall modeled as immediate independent grant. 2024 concentration break reported (2014 cross-rule review), never executes a transaction.
- Movement: unmodified speed, exhaustion thresholds and fixed zero-speed conditions, separate 2014 movement prohibition from speed lock (2024 Stunned does not impose movement restriction), revised standing cost and zero-speed block; fear source and dragging review markers. No actual movement/standing/terrain/forced movement transaction or budget calculation.
- Saving throws: STR/DEX automatic failure for four relevant conditions, Restrained DEX disadvantage, edition-specific exhaustion, global advantage/disadvantage cancellation. No death saves, save probability, concentration roll or automatic 20 override.
- Explicit hypothetical confirmed grant/end events preserve independent instance IDs and other recipients. 2014 Unconscious grant creates Prone if absent, 2024 ending preserves it; explicit unique ID required if not already present. No automatic expiry clock, source/immunity validation, removal eligibility, exhaustion mutation or storage. Caller supplies confirmed facts. No alias or activation.
- Capability matrix labels new scoped evidence previewOnly, never runtime implementation or parity. Existing attack and exhaustion previews remain intact.

## Validation
Seven new synthetic tests cover implications, movement differences, saves, independent grants, unconscious lifecycle, invalid states. No new dependencies or workflow changes. Quality will run full suite; structural audit uses existing capability matrix. No full local execution or native/device test. CI pending.

## Next
a8.6.1 — begin class/subclass/feature identity and owner/progression evidence, using prior a7.2/a8.4 reports and exact source bindings. Do not expand into production condition integration without separate review; remaining lifecycle triggers, immunity, concentration transactions, movement execution, spell targeting, actual inventories, durable backup/rollback, rights/trust and separate cutover approval remain pending.
