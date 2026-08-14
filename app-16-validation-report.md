# APP-16 validation report

Status: **PASS_WITH_FULL_SUITE_AND_NATIVE_GATE_BLOCKED_BY_ENVIRONMENT**

## Executado com sucesso

| Verificação | Resultado |
|---|---:|
| Regressão linear APP-02 a APP-16 | 34/34 |
| Parsing TS/TSX | 324/324 |
| Typecheck estrito isolado do núcleo | PASS |
| Typecheck estrito isolado da store | PASS |
| Typecheck estrito isolado dos testes | PASS |
| Harness APP-16 | 27/27 |
| Catálogo real | 5.841 entidades |
| Grafo real | 15.385 dependências |
| Fluxos Maestro encontrados | 31/31 |

## Comportamentos verificados

- sessão local gera registro histórico íntegro;
- recibo e pacote agregado passam por checksum;
- evidência externa é importada sem habilitar rollback;
- duplicatas são ignoradas;
- adulteração é rejeitada;
- mudanças posteriores são detectadas pelo fingerprint;
- revalidação periódica preserva o recibo original;
- oito checkpoints geram recomendação para remover três e reter cinco;
- recibos permanecem independentes dos checkpoints completos.

## Bloqueios do ambiente

O typecheck integral não encontrou `expo/tsconfig.base` nem os tipos de React, Node e Jest.

A suíte Jest integral não iniciou porque o executável `jest` não está instalado.

O gate Android encontrou todos os 31 fluxos, mas ficou em `BLOCKED` pela ausência de `node_modules`, ADB, Maestro e dispositivo ou emulador acessível.
