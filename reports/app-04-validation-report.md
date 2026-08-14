# APP-04 validation report

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
| TS/TSX syntax parsing | 290/290 |
| Isolated strict TypeScript compilation | PASS |
| Runtime dependency harness | 18/18 assertions |

## Real catalog scenarios

| Scenario | Result |
|---|---:|
| Wizard spell candidates | 227 |
| Available after simulated filter | 226 |
| Blocked candidates preserved | 1 |
| Wizard subclasses | 4 |
| Weapon Master weapon candidates | 38 |
| Legacy source fallback | PASS |

## Secondary editors

Nine secondary editors were checked for use of `useCharacterChoiceBridge`. None reads `items`, `searchItems`, or `enabledSourceIds` directly from `useCompendiumStore`. Local store calls remain only where mutation or hydration is required.

## Not executed

The full `npm run typecheck` and Jest suite could not run because the uploaded source archive does not contain `node_modules`. The typecheck cannot resolve Expo, React, Node, and Jest types; the Jest executable is absent.

See:

- `reports/app-04-full-typecheck-blocker.log`;
- `reports/app-04-jest-blocker.log`.
