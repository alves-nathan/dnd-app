# APP-19 validation report

Status: **PASS_WITH_FULL_SUITE_AND_NATIVE_BLOCKED_BY_ENVIRONMENT**

## Executed successfully

| Check | Result |
|---|---:|
| Linear regression APP-02 through APP-19 | 40/40 |
| TypeScript/TSX syntax parsing | 339/339 |
| Isolated strict typecheck — transparency core | PASS |
| Isolated strict typecheck — transparency store | PASS |
| Isolated strict typecheck — update coordinator | PASS |
| APP-19 runtime harness | 32/32 assertions |
| Merkle inclusion proof | PASS |
| Merkle consistency proof | PASS |
| Remote-server rollback detection | PASS |
| Omission/fork detection | PASS |
| Portable trust tampering rejection | PASS |
| Quorum recovery | PASS |
| Remote manifest signing CLI | PASS |
| Maestro definitions found | 43/43 |

## Runtime catalog

- Catalog version: 4.8.0
- Entities: 5,841
- Dependency edges: 15,385

## Environment blockers

The full `npm run typecheck` could not complete because the archive does not contain `node_modules`; `expo/tsconfig.base` and the Jest, Node and React type packages are unavailable.

The full Jest suite did not start because the `jest` executable is unavailable.

The dependency installer classified the configured registry as `REGISTRY_PACKAGE_MISSING` because it does not provide `zustand@5.0.14`.

The Android gate found all 43 Maestro flows, but execution was blocked because ADB, Maestro and an authorized Android device/emulator are not available in this environment.
