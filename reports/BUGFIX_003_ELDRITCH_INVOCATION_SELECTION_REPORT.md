# BUGFIX-003 — Seleção e remoção de Eldritch Invocations

Data: 2026-08-05
Baseline: BUGFIX-002

## Sintomas

- Invocations com revisão editorial, como Eldritch Mind e Pact of the Chain, não eram selecionadas ao tocar no card durante a criação do personagem.
- Uma invocation já selecionada ficava desabilitada no card e não podia ser removida por meio dele, especialmente quando o limite estava completo.

## Causa raiz

`useCharacterChoiceBridge` materializa itens locais com um ID de interface no formato `compendium:<stored-id>`. O fluxo de aprovação durante a criação enviava esse ID sintético para `updateItemsReview`, mas o SQLite armazena o item sob o ID original. A atualização falhava antes de a seleção ser concluída.

Além disso, a condição de desabilitação considerava qualquer invocation selecionada e não repetível como indisponível. Quando o limite era atingido, todos os cards também eram desabilitados, incluindo os já selecionados, impedindo a correção da escolha.

## Correções

- Criado `getCompendiumReviewTargetId` para resolver o ID persistente pelo vínculo da ponte do catálogo, metadados do item ou fallback seguro.
- O fluxo de criação agora aprova a revisão usando o ID real do compêndio.
- Cards de invocation passaram a funcionar como alternância:
  - não selecionada: adiciona;
  - selecionada: remove uma ocorrência.
- Cards selecionados permanecem habilitados mesmo com limite completo ou dependência posteriormente inválida.
- Invocations repetíveis possuem ação explícita `Adicionar outra`, além de `Remover uma`.
- A mesma interação foi aplicada na criação, gerenciamento da ficha e level up.
- Acessibilidade informa a ação de remoção somente nos seletores de invocation.

## Testes adicionados

`src/tests/eldritchInvocationInteraction.test.ts`

Cobertura:

- resolução do ID persistente de revisão;
- card selecionado permanece habilitado;
- card vazio adiciona e card selecionado remove;
- integração dos três fluxos de UI.

## Validações executadas

- TypeScript syntax gate: PASS — 385 arquivos
- Project shape: PASS
- Accessibility contracts: PASS
- Bundled compendium: PASS — 1.284 itens e IDs únicos
- Release readiness: PASS
- Assertions de runtime dos helpers: PASS

A suíte Jest e o `tsc --noEmit` completo devem ser executados no ambiente do projeto com `node_modules` instalado.
