# Fixed 23 — Custom Lineage feat timing and Tasha Warlock invocations

- Custom Lineage species feat is acquired at level 1 and no longer offers Epic Boons or other feats whose minimum level is above the species feat acquisition level.
- Species feat prerequisite validation uses the acquisition level rather than the character's final starting level.
- Tasha 2024-first compatibility pack v2 retains legacy-only Warlock invocations that were previously suppressed, while PHB 2024 reprints continue to resolve to PHB 2024.
- Pact of the Talisman is adapted as a level-3 invocation-style Pact option so Tasha talisman invocations remain usable on the 2024 Warlock chassis.
- Invocation UIs now show all options from active sources. Unmet level/dependency options remain visible but disabled.
- Structured `mechanics.requiresFeatureId` prerequisites are enforced in addition to textual prerequisites.
- The new Tasha pack upgrades predecessor Tasha bundles transactionally through the existing bundled-compendium migration path.
