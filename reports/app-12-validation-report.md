# APP-12 validation report

Status: **PASS_WITH_FULL_SUITE_AND_NATIVE_GATE_BLOCKED_BY_ENVIRONMENT**

## Executado com sucesso

| Verificação | Resultado |
|---|---:|
| Shape do projeto | PASS |
| Contratos mínimos de acessibilidade | PASS |
| Compêndio incluído | PASS — 1.284 itens |
| Catálogo de runtime | PASS — v4.8.0 |
| Entidades do catálogo | 5.841 |
| Dependências do catálogo | 15.385 |
| Contratos APP-02 a APP-11 | PASS |
| Contratos estáticos APP-12 | PASS |
| Parsing TS/TSX | 311/311 |
| Typecheck estrito isolado do núcleo | PASS |
| Harness APP-12 | 21/21 |
| Fluxos Maestro APP-12 | 4/4 |
| Fluxos reconhecidos pelo gate | 15/15 |

## Cenário validado

O harness registrou uma desativação de `Acid Splash` e depois restaurou o estado anterior:

- revisão avançou de 0 para 2;
- 2 commits foram preservados;
- o commit de restauração referenciou o commit original;
- 1 personagem afetado foi vinculado ao reconhecimento;
- 1 plano preventivo vazio tornou-se obsoleto;
- 1 plano com decisão manual foi preservado;
- o personagem permaneceu inalterado.

## Execução integral bloqueada

O `npm run typecheck` integral ficou bloqueado pela ausência de `expo/tsconfig.base` e dos tipos de Jest, Node e React.

A suíte Jest integral não iniciou porque o executável `jest` não está disponível sem `node_modules`.

O gate Android encontrou os 15 fluxos, mas ficou bloqueado pela ausência de dependências integrais, ADB, Maestro e dispositivo Android acessível.

Nenhum bloqueio foi convertido em aprovação.
