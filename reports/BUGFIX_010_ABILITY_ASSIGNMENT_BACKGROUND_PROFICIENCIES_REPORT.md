# BUGFIX-010 — Atribuição de atributos e proficiências de background

Data: 2026-08-10
Baseline: `dnd-combat-math-mvp-bugfix-009-character-deletion.zip`

## Objetivo

Corrigir e melhorar três comportamentos da criação de personagem:

1. Quando os atributos são gerados por 4d6, registrar e exibir os seis resultados antes da atribuição.
2. Fazer Standard Array/4d6 iniciarem sem valores pré-atribuídos, com cada resultado utilizável exatamente uma vez e remoção da escolha ao tocar novamente.
3. Tornar visíveis e efetivas as proficiências concedidas pelo background, impedindo que uma perícia já concedida seja consumida novamente como escolha da classe.

## Implementação

### Atributos gerados

- Adicionado `GeneratedAbilityAssignments`, que associa cada atributo ao índice do resultado gerado, e não apenas ao valor numérico.
- Isso permite tratar corretamente rolagens duplicadas, por exemplo dois resultados 15: `#1 · 15` e `#2 · 15` continuam sendo duas rolagens independentes.
- Standard Array e 4d6 agora começam com `abilityValueAssignments = {}`.
- Ao selecionar um resultado para STR/DEX/CON/INT/WIS/CHA, aquela instância é desabilitada nos demais atributos.
- Tocar novamente no resultado selecionado remove a atribuição.
- O fluxo só avança quando as seis instâncias forem atribuídas exatamente uma vez.
- Na modalidade 4d6, a UI mostra antes da seleção cada conjunto de quatro dados, o menor dado descartado e o total.
- A tela de edição posterior de atributos recebeu o mesmo comportamento.

### Persistência das rolagens

- O `abilityGeneration.generatedValues` passa a preservar o pool que originou a distribuição em Standard Array/4d6.
- Para dados antigos em que `generatedValues` havia sido salvo na ordem final dos atributos, `diceRolls[].total` é usado para recuperar o conjunto original quando disponível.
- A versão do rascunho de criação foi elevada de 9 para 10.
- O rascunho passa a persistir `abilityValueAssignments` e rejeita índices duplicados na sanitização.

### Proficiências de background

- As perícias fixas do background são exibidas como já selecionadas na etapa Proficiências.
- Ferramentas fixas também são exibidas como concedidas automaticamente; famílias que exigem escolha continuam usando o seletor controlado existente.
- Uma perícia já concedida pelo background fica indisponível na lista de escolhas da classe.
- A engine também rejeita estados antigos que tentem contar a mesma perícia simultaneamente como proficiência do background e escolha da classe (`CLASS_SKILL_ALREADY_GRANTED_BY_BACKGROUND`).
- Ao trocar de background, escolhas de classe que agora colidam com proficiências automáticas do novo background são removidas do rascunho.
- O card de resumo do background na etapa Origem agora informa as perícias e ferramentas concedidas.

### Gate histórico APP-03

O check `scripts/check-character-choice-bridge.js` ainda exigia literalmente `CHARACTER_CREATION_DRAFT_VERSION = 8`, apesar da baseline já estar na versão 9. O gate foi tornado compatível com evolução de schema: exige a declaração da constante e informa dinamicamente a versão atual.

## Arquivos principais alterados

- `app/characters/new.tsx`
- `app/characters/[id]/attributes.tsx`
- `src/characters/abilityGeneration.ts`
- `src/characters/creationDraft.ts`
- `src/characters/proficiencyRules.ts`
- `scripts/check-character-choice-bridge.js`

## Testes adicionados/atualizados

- `src/tests/abilityGeneration.test.ts`
  - toggle da atribuição;
  - exclusividade por índice;
  - rolagens com totais duplicados;
  - exigência de seis atribuições únicas.
- `src/tests/characterCreationAbilityUi.test.ts`
  - contrato da exibição das rolagens;
  - desabilitação do resultado já utilizado;
  - remoção ao tocar novamente;
  - proficiências automáticas do background na UI.
- `src/tests/proficiencyRules.test.ts`
  - aplicação automática das perícias do background;
  - rejeição de duplicidade entre background e escolha da classe.
- `src/tests/characterCreationDraft.test.ts`
  - schema do rascunho v10 com mapa de atribuições.

## Validações executadas no ambiente de correção

- `npm run typescript:syntax:check` — PASS (396 arquivos TS/TSX)
- `npm run check:shape` — PASS
- `npm run check:a11y` — PASS
- `npm run compendium:bundled:check` — PASS (1.284 itens / 1.284 IDs únicos)
- `npm run catalog:character-bridge:check` — PASS (`creationDraftVersion=10`)
- `npm run app30:typecheck:isolated` — PASS
- `npm run release:check` — PASS
- Harness direto de `abilityGeneration` — PASS
- Harness direto de `buildProficiencySelection` — PASS

A suíte Jest completa não foi executada neste runtime porque o pacote de entrega não contém `node_modules`. Ela deve ser executada na máquina de desenvolvimento após aplicar a correção.
