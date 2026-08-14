# APP-13 validation report

Status: **PASS_WITH_FULL_SUITE_AND_NATIVE_GATE_BLOCKED_BY_ENVIRONMENT**

## Executado com sucesso

| Verificação | Resultado |
|---|---:|
| Regressão APP-02 a APP-12 | PASS |
| Contratos APP-13 | PASS |
| Parsing TS/TSX | 313/313 |
| Typecheck estrito isolado do núcleo | PASS |
| Typecheck estrito isolado do teste | PASS |
| Harness APP-13 | 27/27 |
| Catálogo real | 5.841 entidades |
| Dependências do catálogo | 15.385 |
| Fluxos Maestro APP-13 | 4/4 |
| Fluxos reconhecidos pelo gate | 19/19 |

## Comportamentos verificados

- backup `dnd-combat-character-backup.v3` com auditoria portátil;
- checksum próprio do histórico;
- detecção de adulteração;
- comparação `incomingAhead` e `diverged`;
- identificação de commit e plano conflitantes;
- remapeamento de plano para personagem importado;
- preservação de plano local conflitante;
- importação do catálogo como novo commit local;
- auditoria de origem embutida sem sobrescrever o histórico local.

## Bloqueios ambientais

- typecheck integral: tipos Jest, Node e React ausentes; `expo/tsconfig.base` ausente;
- Jest integral: executável `jest` ausente;
- gate Android: dependências, ADB, Maestro e dispositivo indisponíveis.
