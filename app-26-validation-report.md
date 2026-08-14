# APP-26 validation report

Status: **PASS_WITH_FULL_SUITE_AND_NATIVE_GATE_BLOCKED_BY_ENVIRONMENT**

## Passed

| Check | Result |
|---|---:|
| Inherited regression | 194 PASS |
| APP-26 regression | 4/4 |
| TypeScript/TSX syntax | 369/369 |
| Isolated strict core typecheck | PASS |
| Isolated strict store typecheck | PASS |
| Isolated strict test typecheck | PASS |
| Runtime harness | 48/48 |
| Independent CLI verification | PASS |
| CLI signed audit report | PASS |
| Private material scan | PASS |
| Maestro definitions found | 71/71 |

## Behavior verified

- complete archive and active journal chain;
- missing and overlapping segment rejection;
- cross-device fork detection;
- receipt linkage to quorum, authorization and executor;
- full cryptographic verification when trust context is included;
- read-only imports;
- signed external audit reports;
- long-term retention without automatic evidence deletion.

## Blocked

- full application typecheck: Expo/React/Node/Jest dependencies unavailable;
- full Jest suite: `jest` executable unavailable;
- native execution: dependencies, ADB, Maestro and Android device unavailable;
- deterministic dependency install: internal registry does not provide `zustand@5.0.14`.
