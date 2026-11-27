# a8.11.2 — Runtime contract preservation comparison

Rebuilds the runtime contract evidence, binds the baseline fingerprint, rejects a stale current bundle and compares every top-level section of the candidate bundle, including unknown fields and ordering of all array occurrences. No graph rewrite, alias merge, policy change, selection/provider replacement or version transition is approved. The real structural audit only compares the bundled fixture against itself; synthetic tests cover changed contracts.

A separate disposable filter review uses the existing CatalogLoader and ContentPolicyService on a cloned bundle. Requires exact unchanged bundle, exact current filter snapshot, known IDs, one explicit override and caller-confirmed exclusion of external dependencies. Blocks protected categories/entities, invalid states, unexpected changes and new hard dependency breaks (including repeated occurrences). Existing breaks are reported, not repaired. No controller or storage call; revision/history and installed inventory not inspected. JSON equality is intentionally conservative for filter comparison. No mechanical parity, activation, cutover or write approval.

Next a8.11.3: consolidate runtime evidence and preservation boundaries, including readiness blockers and existing filter/selection/provider obligations.
