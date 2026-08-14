# APP-17 validation report

Status: **PASS_WITH_FULL_SUITE_AND_NATIVE_GATE_BLOCKED_BY_ENVIRONMENT**

## Executado com sucesso

| Verificação | Resultado |
|---|---:|
| Regressão linear APP-02 a APP-17 | 36/36 |
| Parsing TS/TSX | 330/330 |
| Typecheck isolado do núcleo e stores | PASS |
| Typecheck isolado do teste | PASS |
| Harness transacional APP-17 | 43/43 |
| Definições Maestro | 35/35 |

## Cenário real do harness

- catálogo atual: v4.8.0, 5,841 entidades;
- candidato de teste: v4.8.1, 5,842 entidades;
- grafo: 15,385 dependências;
- diferenças: +1 / -0 / 1 alterada(s);
- personagens afetados: 1;
- migrações de snapshot: 1;
- evidências afetadas: 1;
- armazenamento do bundle real: 81 blocos;
- troca real da store: PASS;
- commit e rollback coordenados: PASS.

## Bloqueios ambientais

- instalação: `BLOCKED / REGISTRY_PACKAGE_MISSING`;
- pacote ausente no mirror: `zustand`;
- typecheck integral: bloqueado sem `node_modules` e `expo/tsconfig.base`;
- Jest integral: `jest` não encontrado;
- execução Android: bloqueada sem dependências, ADB, Maestro e dispositivo.

Todos os 35 fluxos foram localizados. Nenhum bloqueio foi reportado como sucesso.
