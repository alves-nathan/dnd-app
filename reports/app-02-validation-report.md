# APP-02 validation report

Status: **PASS_WITH_FULL_SUITE_BLOCKED_BY_REGISTRY**

## Executed successfully

| Check | Result |
|---|---:|
| Project shape | PASS |
| Accessibility contracts | PASS |
| Bundled PHB pack | PASS |
| Runtime catalog checksum and counts | PASS |
| Content-management static contracts | PASS |
| TS/TSX syntax parsing | 277/277 |
| Isolated strict TypeScript compilation | PASS |
| Runtime integration harness | 23/23 assertions |
| ZIP source integrity | PASS |

## Runtime catalog

| Metric | Value |
|---|---:|
| Catalog version | 4.8.0 |
| Runtime entities | 5,841 |
| Dependency edges | 15,385 |
| Categories | 57 |
| Aliases | 127 |
| Bundle size | 10,548,880 bytes |
| Bundle SHA-256 | `8c64d156da2653835ca2052b2618abdb1de93a4f6e6efe14a0afabdbebafed08` |

## Behavior verified

- store initialization and transition to `ready`;
- restoration of persisted preferences;
- non-mutating preview;
- commit and persistence;
- discard of a pending change;
- real catalog search;
- book-level impact calculation;
- dependency break reporting.

Disabling `mm-2025` in the harness resulted in:

- 2,077 disabled entities;
- 75 hard dependency breaks.

## Not executed

The full `npm run typecheck` and Jest suite were not executed because dependencies could not be installed in this environment. See `reports/app-02-dependency-install-blocker.log`.
