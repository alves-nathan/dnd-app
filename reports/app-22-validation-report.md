# APP-22 validation report

Status: **PASS_WITH_FULL_SUITE_AND_NATIVE_GATE_BLOCKED_BY_ENVIRONMENT**

## Implementação validada

- política de saúde assinada (`dnd-catalog-rollout-health-policy.v1`);
- evidência agregada e opt-in (`dnd-catalog-rollout-health-evidence.v1`);
- diretrizes assinadas de expansão, redução, promoção, pausa e rollback (`dnd-catalog-rollout-directive.v1`);
- promoção restrita a `preview → beta → stable`;
- rollout efetivo aplicado à elegibilidade, sem download ou aplicação automática;
- métricas locais nos fluxos de elegibilidade, download, integridade, preview, commit e rollback;
- comparação por faixas amplas de coorte, sem exportar identificador de instalação.

## Verificações

| Verificação | Resultado |
|---|---:|
| Regressão herdada | 94 PASS |
| Regressão linear atual | 30/30 |
| Parsing TS/TSX | 354/354 |
| Typecheck isolado do núcleo | PASS |
| Typecheck isolado das stores integradas | PASS |
| Typecheck isolado do teste | PASS |
| Harness APP-22 | 42/42 |
| Assinatura CLI de política e diretriz | PASS |
| Material criptográfico privado | Nenhum encontrado |
| Fluxos Maestro encontrados | 55/55 |

## Catálogo

- versão: 4.8.0;
- entidades: 5.841;
- dependências: 15.385;
- categorias: 57;
- aliases: 127;
- SHA-256: `8c64d156da2653835ca2052b2618abdb1de93a4f6e6efe14a0afabdbebafed08`.

## Bloqueios ambientais

O typecheck integral não concluiu porque `expo/tsconfig.base` e os tipos de React, Node e Jest não estão instalados. A suíte Jest não iniciou porque o executável `jest` está ausente.

A instalação determinística foi classificada como **REGISTRY_PACKAGE_MISSING** porque o registry interno não disponibiliza `zustand@5.0.14`.

O gate Android encontrou todos os fluxos, mas permaneceu **BLOCKED** por ausência de `node_modules`, ADB, Maestro e dispositivo/emulador Android.

Nenhum bloqueio foi convertido em aprovação.
