# APP-05 validation report

Status: **PASS_WITH_FULL_SUITE_BLOCKED_BY_MISSING_NODE_MODULES**

## Executed successfully

| Check | Result |
|---|---:|
| Project shape | PASS |
| Accessibility contracts | PASS |
| Bundled compendium | PASS |
| Runtime catalog checksum and counts | PASS |
| APP-02 content-management contracts | PASS |
| APP-03 character-bridge contracts | PASS |
| APP-04 dependency-progression contracts | PASS |
| APP-05 progression-transaction contracts | PASS |
| TS/TSX syntax parsing | 293/293 |
| Isolated strict TypeScript compilation — transaction core | PASS |
| Isolated strict TypeScript compilation — store/session hook | PASS |
| Runtime transaction harness | 24/24 assertions |
| ZIP integrity | PASS |

## Transaction scenarios

| Scenario | Result |
|---|---:|
| Published character unchanged before commit | PASS |
| Atomic commit | PASS |
| Mandatory pending choice blocks commit | PASS |
| Optional spell replacement remains warning | PASS |
| Concurrent edit conflict | PASS |
| Catalog snapshot approval | PASS |
| Exact rollback | PASS |
| Commit and rollback audit history | PASS |

## Runtime evidence

| Metric | Value |
|---|---:|
| Character store version | 20 |
| Transaction-aware editors | 10 |
| Harness assertions | 24 |
| Atomic level transition | 1 → 2 |
| Operations in level-up scenario | 2 |
| Rollback restored level | 1 |
| Audit entries after rollback | 2 |

## Catalog baseline

| Metric | Value |
|---|---:|
| Catalog version | 4.8.0 |
| Entities | 5,841 |
| Dependency edges | 15,385 |
| Categories | 57 |
| Aliases | 127 |
| Bundle SHA-256 | `8c64d156da2653835ca2052b2618abdb1de93a4f6e6efe14a0afabdbebafed08` |

## Not executed

The full `npm run typecheck` and Jest suite could not run because the uploaded source archive does not contain `node_modules`.

The typecheck cannot resolve Expo, React, Node, and Jest types. The Jest executable is absent.

See:

- `reports/app-05-full-typecheck-blocker.log`;
- `reports/app-05-jest-blocker.log`.
