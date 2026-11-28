# V1.4a8.3.1 — Local import UI / isolated preview

a8.2.2 FIX01 approved at f8f0d6a50acb632123b83e93b58aeca98b33cc36: Quality push 45838823077, PR 45838838314, structural 45838823061. All success. Previous preservation suite 6/6.

## Implementation
Existing local file screen recognizes explicit canonical/historical V3 before file kind conversion and when JSON is pasted in its editor. Dedicated read-only branch permits selection, discard and return; no metadata rewrite, editable projection, save, share or activation. Explicit preview action uses hydrated compendium and ready catalog observed in stores; rejects unavailable/busy inventory. Displayed preview expires when the input or observed store references change. Aggregate UI model contains counts, declared commit, fingerprint and review codes; no raw payload or persistence projection. No automatic hydration/initialization here, no new route or dependency. Partial observed installed IDs (not complete historical inventory); no durable stage session or backup/approval workflow yet.

## Important bug discovered
Legacy validateCompendiumJson used a permissive Zod schema stripping unknown keys; store routed unknown versions into the legacy repository path. An explicit V3 could lose provenance and be persisted as V1. Block recognized V3 at store, legacy JSON validator, canonical parser and local file parser, including contract marker mislabeled V1/V2 and forced text. Version detector continues returning unknown (V3 not a supported persistence version). Existing ordinary V1/V2/unversioned readers unchanged. This protects recognized envelopes, not deliberate manual removal of all markers or arbitrary malformed text. No runtime activation or data edits.

## Tests
Five synthetic tests (classification, forced-kind fallback isolation, aggregate result, readiness/collision, actual key-value V1/V2 repository no writes) in upstream5etoolsLocalV3Preview.test.ts. Existing structural workflow adds one lightweight suite; Quality runs typecheck/full regression. Native screen interaction and SQLite device test not executed; same shared legacy parser used by SQLite. CI pending. No licensed upstream payloads committed.

## Next a8.3.2
Connect explicit preservation evidence and local backup/checkpoint verification to staging UX (not activation), inventory gaps, native test plan. No cutover until full historical/installed inventory, parity, dependency/alias, durable checkpoint, production rollback, rights/trust and approval are evidenced.
