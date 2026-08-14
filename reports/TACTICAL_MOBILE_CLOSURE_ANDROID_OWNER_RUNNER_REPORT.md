# Central Tática — fechamento Android: owner runner

## Objetivo

Avançar o fechamento móvel preparado na baseline anterior até um runner Android dedicado, sem marcar execução nativa como concluída quando não existe dispositivo/emulador real disponível no ambiente de geração.

## Resultado

A tentativa nativa neste ambiente permaneceu bloqueada por ausência de Maestro CLI e adb/dispositivo. Nenhuma evidência nativa foi fabricada e os itens principais de E2E/TalkBack continuam pendentes no roadmap.

A codebase agora oferece um caminho focado para executar somente os quatro cenários táticos 91–94 antes da suíte beta completa:

```bash
npm run e2e:doctor:android
npm run tactical:mobile-closure:native:android
npm run tactical:mobile-closure:status
```

O runner grava artefatos em `artifacts/tactical-mobile-closure/android/<run-id>/` e mantém um resumo em `artifacts/tactical-mobile-closure/android-latest.json`.

## Alterações

- `scripts/run-tactical-mobile-closure-native.js`: runner Android dedicado, seleção de dispositivo, execução dos flows táticos, JUnit e resumo machine-readable.
- `scripts/lib/tactical-mobile-closure.js`: lista canônica dos flows 91–94.
- `scripts/e2e/run-maestro-with-artifacts.sh`: seleção de flows, filtros de tags, `MAESTRO_HOST`, preservação de `ADB_SERVER_SOCKET` e artefatos.
- `.maestro/flows/91..94`: tag comum `tactical-mobile-closure`.
- `scripts/lib/mobile-tools.js`: descoberta adicional de `~/.maestro/bin/maestro`.
- `scripts/write-tactical-mobile-closure-status.js`: inclui o último resultado automatizado Android.
- `src/tests/tacticalMobileClosure.test.ts` e audit local: novos contratos do runner.
- Checklist/roadmap: instruções para execução focada e host Android remoto/WSL.

## Validações

- Tactical mobile closure audit: PASS — 4/4 runtime checks + 17/17 contratos.
- Smoke com ferramentas fake: PASS; confirmou `--host`, `--include-tags=tactical-mobile-closure`, diretório de flows e geração JUnit.
- TypeScript syntax: PASS — 437 arquivos.
- Project shape: PASS.
- Accessibility contracts: PASS.
- Bundled PHB V2: PASS — 1.284 itens / 1.284 IDs únicos.
- Stat block actions gate: PASS.
- Area/multitarget gate: PASS.
- Optional map gate: PASS.
- Import V2 release gate: PASS.

## Estado nativo real

- Android: bloqueado neste ambiente; Maestro CLI e adb não estão disponíveis e não há dispositivo/emulador conectado.
- TalkBack/fonte ampliada: não executados.
- iOS/VoiceOver: não executados; requer macOS/Xcode.
- Evidence v3: ausente.
- Promoção beta: pendente.

O runner focado não cria `dnd-combat-beta-native-evidence.v3`; essa evidência continua sendo gerada apenas pela sessão operacional completa após automação e revisão manual reais.
