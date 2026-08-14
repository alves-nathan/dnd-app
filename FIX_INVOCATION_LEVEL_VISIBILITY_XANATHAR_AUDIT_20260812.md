# Fixed 24 — Invocation level visibility + Xanathar audit

## Change

- Creation, level-up, and invocation manager now list only Eldritch Invocations whose minimum Warlock level has been reached.
- Same-level invocations whose non-level prerequisites are still unmet remain visible and disabled with their prerequisite message.
- Validation remains fail-closed; this is a candidate-list UX change, not a relaxation of rules.

## Audit

- Grasp of Hadar is a Xanathar’s Guide to Everything invocation, not a Tasha invocation.
- The parsed Xanathar pack contains 14 legacy Eldritch Invocation options.
- Fixed 23 bundles PHB 2024 and the Tasha 2024-compatible projection, but does not bundle Xanathar yet.
- Therefore Grasp of Hadar and other Xanathar-only invocations appear only after an Xanathar source pack is installed/enabled.
- A regression test confirms that a legacy invocation with classId `phb-2014-class-warlock` is recognized once source `xgte-2017` is active and Warlock level 2 is reached.

## Important compatibility distinction

Xanathar invocations that were reprinted in PHB 2024 should resolve to the 2024 version when the full Xanathar compatibility pack is integrated. Xanathar-only invocations need a compatibility projection rather than being mislabeled as PHB/Tasha content.
