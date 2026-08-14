# APP-07 validation report

Status: **PASS_WITH_FULL_GATE_BLOCKED_BY_ENVIRONMENT**

## Implementação aprovada

| Verificação | Resultado |
|---|---:|
| Project shape | PASS |
| Accessibility contracts | PASS |
| Bundled compendium | PASS — 1.284 itens |
| Runtime catalog | PASS — v4.8.0 |
| APP-02 a APP-06 contracts | PASS |
| TypeScript syntax | PASS — 296/296 |
| APP-05 harness | PASS — 24/24 |
| APP-06 harness | PASS — 21/21 |
| Dependency lock | PASS |
| APP-07 contracts | PASS |
| APP-07 evidence harness | PASS — 18/18 |
| Beta local gate requires APP-07 evidence | PASS |
| Android beta-candidate requires APP-07 evidence | PASS |

## Dependências

- 35 dependências diretas fixadas em versões exatas;
- 1.199 entradas do registry no lockfile;
- 1.199 entradas com `integrity`;
- nenhuma dependência direta usa `latest`, `^` ou `~`;
- `packageManager`: `npm@10.9.2`.

A tentativa de `npm ci` foi classificada como **BLOCKED / REGISTRY_PACKAGE_MISSING**. O registry interno retornou 404 para `zustand@5.0.14`.

## Gate integral

O gate APP-07 atual retornou **BLOCKED**, como esperado neste ambiente:

| Etapa | Resultado |
|---|---:|
| Dependency lock | PASS |
| APP-06 smoke | PASS |
| Full typecheck | BLOCKED |
| Full Jest | BLOCKED |
| Native Android gate | BLOCKED |

A evidência bloqueada foi recusada por `app07:release:gate:verify`, pelo beta local gate e pelo script de build Android. Portanto, nenhum beta-candidate pode ser criado com validação incompleta.

## Evidência exigida para PASS

- fingerprint da codebase e commit Git;
- typecheck integral;
- Jest integral;
- aplicativo Android na versão esperada;
- quatro fluxos Maestro;
- JUnit sem falhas;
- logcat;
- screenshot PNG;
- tamanho e SHA-256 dos artefatos nativos.

## Bloqueios externos

- registry sem `zustand@5.0.14`;
- `node_modules` ausente;
- ADB indisponível;
- Maestro indisponível;
- nenhum dispositivo Android disponível neste ambiente.

Nenhum bloqueio foi convertido em sucesso e nenhuma dependência foi rebaixada ou substituída.
