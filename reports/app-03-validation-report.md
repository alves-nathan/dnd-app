# APP-03 validation report

Status: **PASS_WITH_FULL_SUITE_BLOCKED_BY_MISSING_DEPENDENCIES**

## Executado com sucesso

| Check | Resultado |
|---|---:|
| Integridade do pacote fonte APP-02 | PASS |
| Shape do projeto | PASS |
| Contratos de acessibilidade | PASS |
| Compêndio incluído | PASS |
| Catálogo runtime | PASS |
| Gerenciamento de conteúdo APP-02 | PASS |
| Contratos estáticos APP-03 | PASS |
| Parsing TS/TSX | 287/287 |
| Typecheck estrito isolado | PASS |
| Testes isolados compilados | 32/32 |
| Harness real da ponte | 35/35 |

## Ponte de escolhas

| Métrica | Valor |
|---|---:|
| Snapshot | `catalog-4.8.0-b1983121` |
| Escolhas visíveis | 1.066 |
| Total incluindo indisponíveis | 3.988 |
| Duplicatas ocultadas | 1.066 |
| Indisponíveis preservadas | 2.922 |
| Colisões ambíguas | 58 |
| Store de personagens | v19 |
| Rascunho de criação | v8 |

## Não executado integralmente

O pacote fonte não contém `node_modules`.

- `npm run typecheck`: bloqueado por ausência de `expo/tsconfig.base` e dos tipos de Jest, Node e React.
- `npm run test:catalog-character-bridge`: bloqueado porque `jest` não está instalado.

O núcleo foi compilado em modo estrito com o TypeScript global do ambiente e os testes relevantes foram compilados e executados por um harness isolado, sem substituir a futura execução da suíte oficial no ambiente local.
