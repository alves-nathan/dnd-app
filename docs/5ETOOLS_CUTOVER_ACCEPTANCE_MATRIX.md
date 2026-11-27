# a8.12.2 — Acceptance matrix and gate ordering

The global report is rederived from the current-run matrix and family fragment. Every existing global blocker maps exactly once to an acceptance gate. Criteria are explicit, dependency order is acyclic, and existing infrastructure is marked partial. All gates and criteria remain unverified; this tool cannot mark a gate accepted, invoke migration or authorize cutover.

| Priority | Gate | Required evidence |
|---|---|---|
| 1 | Inventory | Complete installed compendium/portable state, runtime package/config binding, local/legacy/manual inventory, unmatched/excluded ledger |
| 2 (parallel) | Rights/trust | Per-source permitted use, homebrew permission, candidate signature and anti-replay/revocation chain |
| 3 | Mechanical parity | Supported edition/scope, occurrence dispositions, consumer regression, preserve unapproved legacy |
| 4 | Relationships | Dependency/alias, runtime-only, category, links/choices/providers and selection preservation |
| 5 | Durable checkpoint | Complete coherent stores and package bytes, read-back integrity, legacy restore and recovery/quarantine |
| 6 | Transaction/rollback | Explicit idempotent plan, production adapter fault injection/restart, rollback and reference/history preservation |
| 7 | Native validation | Candidate-bound Android/iOS evidence, import/restore, build/combat/filter regression and accessibility |
| 8 | Explicit cutover | All gates reviewed against same candidate, explicit owner approval, separate legacy retirement decision |

Inventory and rights review can proceed independently. Durable checkpoint preparation can begin after inventory without waiting for all parity work. Native evidence is not inferred from Jest or structural CI. Existing local preview/preservation, catalog trust and transaction mechanisms are reused, not asserted to cover real installed data or V3 migration. No new workflow, clone or dependency. The final structural audit emits aggregate planning evidence only. Next a8.13.1: local read-only inventory evidence contract (complete state surfaces, provenance and explicit unavailable/unknown states), before any durable capture or mutation.
