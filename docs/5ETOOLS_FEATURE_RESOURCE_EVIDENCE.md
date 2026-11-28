# V1.4a8.6.4 — Feature and class resource evidence

## Baseline
a8.6.3 approved at 89781090767c0180845787ebf62d8cc697139668. Quality push 45903426688, PR 45903434366, structural 45903426584 (job 140194406590). Main unchanged e676152ace06d5c6e5280d0a7204a259371cb9ae. Main upstream 2512db75eb48ef06f6190b086a82430887906dca; Brew bfa899639c696b0ad38afb9a31c443c3b127a058. Projection fingerprint aaccc9568f9d102af62ed8c5df171badb57d3d7964b494ed3a68eca5fa8cef0b. Confirmed 22 flat skill choice candidates, 17 class plus 4 subclass complete profiles, 3 artificer-code profiles, 5 formula-pending class profiles.

## Implementation
- feature-resource-evidence.js reuses the emitted class graph and exact historical occurrence/target fingerprints. Audits 27 class, 146 subclass, 605 classFeature, 1031 subclassFeature and 233 optionalFeature records. Native owner graph checked; 573 class grant references (99 annotated) and 623 subclass references. No automatic grant.
- Inspect explicit 20-row class/subclass table columns. Distinguish integer and exact numeric text, dash, unlimited and nonnumeric cells. Limited literal label taxonomy for observed capacity, selection and concurrent-limit labels; unknown labels remain unclassified. Spell table groups and Pact slot columns separately excluded from resource classification. Numeric label/cell evidence is not proof of a capacity or recharge rule; no recovery or resource pool inferred.
- Inspect consumes name and explicit positive integer amount, missing amount stays pending; no default of one or name-based binding. Recovery fields observed only, no rest equivalence or automatic recovery.
- Reuse existing semantic choicesFor/normalizeSchedule and scheduledCount. Exact before/after checkpoints only; no interpolation, no inferred cumulative grant count, repeatability, replacement, eligibility, or selection.
- Compare actual runtime-facing historical fields: resource/resources, consumes, grantsActions, effectTemplates, actionCost/timing, choices, prerequisite, concentration, once-per-turn, engineKey and mechanics. Raw payload comparisons not equivalence; missing candidate does not prove no mechanic. 3493 historical occurrences, 1348 identity candidates, no approval.
- Five synthetic tests and real reconciliation assertions; aggregate-only logs, no additional clone/dependency/workflow. CI pending; full local suite not executed. No runtime or installation changes.

## Next a8.6.5
Use real aggregate results to select narrowly qualified resource capacity and recovery candidates, bind exact feature and source evidence, test explicit hypothetical spending/recovery and selection/replacement with existing resource engine. Preserve unclear scopes, missing amount, unlimited, mixed edition, annotation, and dependencies as pending. No actual writes, feature activation or cutover. Full inventory, durable backup/rollback, rights/trust, native validation and separate cutover approval remain pending.
