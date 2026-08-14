# APP-14 validation report

Status: **PASS_WITH_FULL_SUITE_AND_NATIVE_GATE_BLOCKED_BY_ENVIRONMENT**

## Executado com sucesso

| Verificação | Resultado |
|---|---:|
| Regressão APP-02 a APP-13 | PASS |
| Contratos estáticos APP-14 | PASS |
| Parsing TS/TSX | 318/318 |
| Typecheck estrito isolado do núcleo | PASS |
| Typecheck estrito isolado da store | PASS |
| Harness APP-14 | 31/31 |
| Commit coordenado | PASS |
| Retomada idempotente | PASS |
| Proteção contra commit duplicado do catálogo | PASS |
| Rollback integral | PASS |
| Fluxos Maestro encontrados | 23/23 |

## Cenário do harness

| Métrica | Valor |
|---|---:|
| Catálogo | 4.8.0 |
| Entidades | 5.841 |
| Dependências | 15.385 |
| Conflitos explícitos | 2 |
| Reconhecimentos | 2 |
| Personagens afetados | 1 |
| Planos preventivos projetados | 1 |
| Novos bloqueios | 1 |

A preparação manteve o checkpoint original inalterado. O commit publicou o estado projetado, a retomada não duplicou a transação do catálogo e o rollback restaurou personagens, filtros, revisão e histórico.

## Gate integral bloqueado

O typecheck integral não pôde carregar `expo/tsconfig.base` nem os tipos de React, Node e Jest. A suíte Jest não iniciou porque `jest` não está instalado sem `node_modules`.

O gate Android encontrou todos os 23 fluxos, porém ficou em **BLOCKED** por ausência de dependências integrais, ADB, Maestro e dispositivo Android.
