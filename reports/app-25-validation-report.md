# APP-25 validation report

Status: **PASS_WITH_FULL_SUITE_AND_NATIVE_GATE_BLOCKED_BY_ENVIRONMENT**

## Resultados aprovados

| Verificação | Resultado |
|---|---:|
| Regressão herdada | 190 PASS |
| Regressão APP-25 | 4/4 |
| Parsing TS/TSX | 365/365 |
| Typecheck isolado do núcleo | PASS |
| Typecheck isolado da store | PASS |
| Typecheck isolado do teste | PASS |
| Harness APP-25 | 40/40 |
| Fluxos Maestro encontrados | 67/67 |
| Material criptográfico privado | PASS |

## Comportamentos verificados

- cadeia append-only e detecção de adulteração;
- continuidade entre arquivos e diário ativo;
- detecção de alteração externa do rollout;
- bloqueio do encerramento com divergência;
- autorização e confirmação assinadas para recuperação;
- rejeição de replay por checksum e nonce;
- geração e validação da evidência final;
- execução automática permanentemente desativada.

## Etapas bloqueadas pelo ambiente

O typecheck integral e Jest não puderam ser concluídos porque `node_modules` está ausente. O registry interno classificou a instalação como `REGISTRY_PACKAGE_MISSING` e não disponibiliza `zustand@5.0.14`.

O gate encontrou os 67 fluxos, mas não os executou por ausência de ADB, Maestro e dispositivo ou emulador Android.
