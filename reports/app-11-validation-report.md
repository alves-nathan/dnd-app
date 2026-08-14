# APP-11 validation report

Status: **PASS_WITH_FULL_SUITE_AND_NATIVE_GATE_BLOCKED_BY_ENVIRONMENT**

## Executado com sucesso

| Verificação | Resultado |
|---|---:|
| Shape do projeto | PASS |
| Contratos mínimos de acessibilidade | PASS |
| Compêndio incluído | PASS — 1.284 itens |
| Catálogo de runtime | PASS — v4.8.0 |
| Contratos APP-02 a APP-10 | PASS |
| Contratos estáticos APP-11 | PASS |
| Parsing TS/TSX | 308/308 |
| Typecheck estrito isolado do núcleo | PASS |
| Harness APP-11 | 23/23 |
| Fluxos Maestro APP-11 | 3/3 |
| Fluxos reconhecidos pelo gate | 11/11 |

## Cenário com catálogo real

A desativação preventiva de `Acid Splash` foi avaliada contra três personagens:

- 3 personagens examinados;
- 2 personagens afetados;
- 2 personagens que passariam a ter bloqueios novos;
- 2 referências afetadas;
- 1 entidade, 1 livro e 1 categoria agrupados;
- 2 novos bloqueios e nenhum aviso novo;
- 1 plano preventivo criado;
- 1 plano existente preservado;
- 0 decisões automáticas.

A ativação inversa da mesma entidade não produziu personagens afetados.

## Não executado integralmente

O `npm run typecheck` integral ficou bloqueado porque a árvore de dependências não está instalada. Estão ausentes `expo/tsconfig.base` e os tipos de Jest, Node e React.

A suíte Jest integral não iniciou porque o executável `jest` não está disponível.

O gate Android encontrou todos os onze fluxos, mas ficou bloqueado pela ausência de dependências integrais, ADB, Maestro e dispositivo Android acessível.

Nenhum bloqueio foi convertido em aprovação.
