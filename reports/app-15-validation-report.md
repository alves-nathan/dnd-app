# APP-15 validation report

Status: **PASS_WITH_FULL_SUITE_AND_NATIVE_BLOCKED_BY_ENVIRONMENT**

## Executado com sucesso

| Verificação | Resultado |
|---|---:|
| Regressão linear APP-02 a APP-14 | PASS |
| Contratos estáticos APP-15 | PASS |
| Parsing TypeScript/TSX | 320/320 |
| Typecheck estrito isolado do núcleo | PASS |
| Typecheck estrito isolado da store | PASS |
| Typecheck estrito isolado dos testes | PASS |
| Harness com catálogo real | 21/21 |
| Recibo de integridade | PASS |
| Pacote de evidências | PASS |
| Fluxos Maestro localizados | 27/27 |

## Dados utilizados

| Métrica | Valor |
|---|---:|
| Catálogo | 4.8.0 |
| Entidades | 5.841 |
| Dependências | 15.385 |
| Itens do compêndio incluído | 1.284 |
| Store da sessão | versão 2 |

## Comportamentos validados

- comparação do estado efetivo com o projetado;
- bloqueio do encerramento por divergência;
- detecção de draft órfão;
- diagnóstico de fichas e planos;
- reconhecimento explícito de avisos;
- geração e validação do recibo;
- invalidação de recibo adulterado;
- geração e validação das evidências completas;
- reabertura protegida do rollback por recibo íntegro.

## Bloqueios do ambiente

O `npm run typecheck` foi solicitado, mas não encontrou `expo/tsconfig.base` nem os tipos de React, Node e Jest. O Jest não iniciou porque o executável não está instalado sem `node_modules`.

O gate Android encontrou os 27 fluxos, mas permaneceu bloqueado por dependências, ADB, Maestro e dispositivo ou emulador ausentes.
