# APP-10 validation report

Status: **PASS_WITH_FULL_SUITE_AND_NATIVE_GATE_BLOCKED_BY_ENVIRONMENT**

## Executado com sucesso

| Verificação | Resultado |
|---|---:|
| Shape do projeto | PASS |
| Acessibilidade | PASS |
| Compêndio incluído | PASS — 1.284 itens |
| Catálogo v4.8.0 | PASS — 5.841 entidades |
| Contratos APP-02 a APP-09 | PASS |
| Contratos APP-10 | PASS |
| Parsing TS/TSX | 306/306 |
| Typecheck isolado do núcleo | PASS |
| Typecheck isolado da store | PASS |
| Typecheck isolado do teste | PASS |
| Harness APP-10 | 22/22 |
| Fluxos Maestro APP-10 | 4/4 |
| Fluxos encontrados pelo gate nativo | 8/8 |

## Recuperação validada

- 1 plano recuperável e sujeito a confirmação;
- 1 plano criado para catálogo antigo;
- 1 plano conflitante;
- 2 registros em quarentena;
- 3 personagens agrupados pela mesma entidade afetada;
- commit individual sem alterar outro personagem ou seu plano.

## Bloqueios ambientais

O typecheck integral não encontrou `expo/tsconfig.base` nem os tipos de Jest, Node e React. A suíte Jest não iniciou porque `jest` não está instalado.

O gate Android foi realmente solicitado e ficou em **BLOCKED** por dependências ausentes, ADB indisponível e Maestro indisponível. Todos os oito arquivos de fluxo foram encontrados.

Nenhum bloqueio foi tratado como sucesso.
