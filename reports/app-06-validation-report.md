# APP-06 validation report

Status: **PASS_WITH_NATIVE_EXECUTION_BLOCKED_BY_ENVIRONMENT**

## Executed successfully

| Check | Result |
|---|---:|
| Project shape | PASS |
| Accessibility contracts | PASS |
| Bundled compendium | PASS |
| Runtime catalog v4.8.0 | PASS |
| APP-02 through APP-05 contracts | PASS |
| APP-06 recovery contracts | PASS |
| TS/TSX syntax parsing | 296/296 |
| Isolated strict core typecheck | PASS |
| Isolated strict store/session typecheck | PASS |
| APP-05 transaction harness | 24/24 |
| APP-06 recovery harness | 21/21 |
| Maestro recovery flow definitions | 4/4 |

## Recovery behavior verified

- persisted active draft becomes `recoverable` after restart reconciliation;
- recovery requires explicit acknowledgement;
- acknowledged draft commits atomically;
- every mutation advances the checkpoint sequence;
- concurrent published changes produce `conflicted` state;
- orphaned and invalid records are quarantined;
- inactive recovery drafts cannot write into the published character;
- discard leaves the published character untouched.

## Native gate

The native gate script and four Maestro flows are present. The diagnostic run returned **BLOCKED** because this environment does not provide `node_modules`, ADB, Maestro, or an Android device/emulator.

## Full-suite blockers

- `npm ci`: registry 404 for `zustand@5.0.14`;
- full TypeScript: missing `expo/tsconfig.base` and React/Node/Jest types;
- Jest: executable not installed.

No dependency was changed to bypass these blockers.
