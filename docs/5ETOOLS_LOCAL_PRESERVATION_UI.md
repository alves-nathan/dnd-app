# V1.4a8.3.2 — Local preservation evidence UI

a8.3.1 approved at 52577f7fc64dc07b0a4618d662134fd0c71812e7: Quality push 45841022814, PR 45841033615, structural 45841023119; all success. Main remains e676152ace06d5c6e5280d0a7204a259371cb9ae.

## Implementation
The existing isolated V3 file preview exposes a preservation panel only after a successful stage. Select two existing local JSON exports: compendium technical snapshot and complete V3 character/portable backup including catalog audit and remediation plans. Read only, no restore, no backup generation/export, no new persistence or share path. The user supplies the files; no durability inferred. Up to 25 million JS characters per backup (50 MB pre-read when file size known). In-memory text is cleared on discard/unmount; no payload logging. Explicit verification captures current portable checkpoint, runtime reference, observed compendium/catalog and recomputes the original stage fingerprint; checks hydration of persisted stores and conservatively blocks pending operations. Any observed store reference or input change expires evidence. UI and store snapshot envelope keys normalized to a fixed order before stage hashing. Only summary counts, fingerprint, failure codes and blockers are shown; no approvals or activation.

## Validation
Three additional synthetic integration tests appended to upstream5etoolsPreservation.test.ts (existing structural audit already invokes it): real fixture exports and zero writes, stage mismatch/readiness, missing/corrupt/swapped/stale exports. Existing six preservation cases retained. No workflow changes or new dependencies. Native picker/lifecycle, memory pressure and real SQLite/device integration not exercised here. CI pending; no user backups read by assistant, no proprietary payloads added.

## Remaining gates / next
a8.4: consolidate evidence/gap matrix for all 13 entity kinds, full historical and real installation inventories, mechanical parity, dependencies/aliases, durable full checkpoint and real rollback, rights/trust, native UX and explicit cutover approval. Do not infer completeness from observed local data. Legacy V1/V2, runtime and main remain unchanged. The current panel uses exact compatibility checks (normalization differences may conservatively block); no migration until independently approved. No replacement or distribution.
