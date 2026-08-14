# BUGFIX-011 — Background personalizado na criação de personagem

Data: 2026-08-10
Baseline: BUGFIX-010 — ability assignment + background proficiencies

## Objetivo

Adicionar uma opção de **Background personalizado** ao fluxo de criação e permitir que as partes mecânicas do background sejam escolhidas a partir das opções disponíveis no aplicativo, mantendo o contrato das regras 2024.

## Regra funcional adotada

O background personalizado possui:

- 3 atributos elegíveis para os bônus de origem;
- 1 Origin Feat;
- 2 proficiências em perícias;
- 1 proficiência em ferramenta;
- pacote de equipamento com orçamento total de 50 GP, incluindo o ouro não gasto;
- armas marciais e armaduras não podem compor o pacote do background; armas simples com custo válido podem.

## Alterações implementadas

### 1. Opção “Personalizado” na etapa Origem

`app/characters/new.tsx` agora exibe `background-custom` junto dos backgrounds importados.

Ao selecionar a opção personalizada, o usuário configura:

- nome do background;
- exatamente 3 atributos entre STR, DEX, CON, INT, WIS e CHA;
- Origin Feat entre todos os Origin Feats disponíveis nas fontes ativas.

A etapa de atributos usa somente os três atributos escolhidos pelo background para distribuir +2/+1 ou +1/+1/+1.

### 2. Proficiências controladas

O background personalizado exige:

- exatamente 2 perícias entre todas as 18 perícias;
- exatamente 1 ferramenta entre todas as ferramentas disponíveis no seletor do app.

As proficiências são transformadas em um background sintético validado para reutilizar a mesma engine de proficiências dos backgrounds importados.

Uma perícia concedida pelo background é automaticamente indisponibilizada nas escolhas da classe, preservando a regra de não gastar uma escolha de classe em uma proficiência já concedida pelo background.

### 3. Equipamento personalizado com orçamento de 50 GP

Foi criado `src/characters/customBackgroundRules.ts`.

O seletor de equipamento:

- agrega itens de todas as fontes ativas;
- aceita equipamentos gerais com custo estruturado;
- aceita armas simples;
- exclui armas marciais e armaduras;
- exclui itens sem preço estruturado ou acima de 50 GP por unidade/pacote;
- permite busca;
- permite múltiplas compras do mesmo item;
- impede ultrapassar 50 GP;
- mantém o saldo não gasto como moedas;
- oferece a opção direta “Usar somente 50 GP”.

Itens do catálogo que ainda precisam de revisão são validados quando escolhidos explicitamente, antes de entrarem no pacote.

### 4. Reconciliação de moeda

`CharacterEquipmentSelection` passou a aceitar `currency`, permitindo preservar o saldo exato em CP/SP/GP sem converter valores fracionários para texto.

`applyStartingEquipmentSelections` agora reconcilia todas as denominações de moeda por seleção e preserva moeda manual previamente adicionada.

Também foi corrigido o caso de seleção explicitamente vazia (`items: []`): o app não tenta mais interpretar o texto “50 GP restantes” como um equipamento fictício.

### 5. Persistência

Adicionado `CharacterCustomBackgroundChoice` a `CharacterBuildChoices`.

A definição personalizada é armazenada na própria ficha e não depende de um ID fictício persistido no compêndio.

O personagem recebe um `background` manual com o nome escolhido e mantém as regras mecânicas em `buildChoices.customBackground`.

O reconciliador recria o background sintético a partir dessas escolhas para reaplicar proficiências após mudanças posteriores da ficha.

### 6. Draft de criação

`CHARACTER_CREATION_DRAFT_VERSION`: 10 → 11.

O rascunho passa a armazenar e sanitizar `customBackground`, permitindo retomar a criação sem perder as escolhas.

### 7. Segurança ao alternar backgrounds

Ao trocar entre um background normal e o personalizado:

- equipamento do background anterior é removido do draft;
- Origin Feat é reavaliado;
- conflitos de perícia com a classe são removidos;
- apenas uma seleção de equipamento de background permanece ativa.

## Arquivos principais alterados

- `app/characters/new.tsx`
- `src/characters/customBackgroundRules.ts` (novo)
- `src/characters/buildReconciliation.ts`
- `src/characters/creationDraft.ts`
- `src/characters/startingEquipmentRules.ts`
- `src/types/index.ts`

## Testes adicionados/atualizados

- `src/tests/customBackgroundRules.test.ts` (novo)
- `src/tests/characterCreationCustomBackgroundUi.test.ts` (novo)
- `src/tests/characterCreationDraft.test.ts`

Cobertura adicionada para:

- 3 atributos / 2 perícias / 1 ferramenta;
- criação do background sintético;
- aplicação das proficiências;
- filtro de equipamento;
- permissão de arma simples;
- exclusão de arma marcial e armadura;
- limite de 50 GP;
- saldo em moeda;
- pacote de somente 50 GP;
- eliminação de seleção antiga de outro background;
- persistência e sanitização do draft;
- contrato visual da criação.

## Validações executadas neste ambiente

- `node scripts/check-typescript-syntax.js` — PASS (399 arquivos)
- `node scripts/run-app30-isolated-typecheck.js` — PASS
- `node scripts/check-project-shape.js` — PASS
- `node scripts/check-accessibility-contracts.js` — PASS
- `node scripts/check-bundled-compendium.js` — PASS (1284 itens / 1284 IDs únicos)
- `node scripts/check-release-readiness.js` — PASS
- harness runtime de background personalizado — PASS
- harness runtime de pacote cash-only — PASS

A suíte Jest completa não foi executada neste ambiente porque a entrega não contém `node_modules`.

## Validação recomendada na máquina de desenvolvimento

```bash
npm run typecheck

npm test -- --runInBand \
  src/tests/customBackgroundRules.test.ts \
  src/tests/characterCreationCustomBackgroundUi.test.ts \
  src/tests/characterCreationDraft.test.ts \
  src/tests/proficiencyRules.test.ts \
  src/tests/startingEquipmentRules.test.ts

npm test -- --runInBand
```

Teste manual recomendado:

1. Criar personagem e selecionar `Personalizado` em Background.
2. Escolher três atributos distintos.
3. Selecionar um Origin Feat.
4. Escolher duas perícias e uma ferramenta.
5. Confirmar que perícias do background ficam indisponíveis entre as escolhas da classe.
6. Escolher equipamento até 50 GP, incluindo uma arma simples.
7. Confirmar que armas marciais e armaduras não aparecem no seletor do background.
8. Confirmar que o saldo não gasto é mantido como moeda.
9. Finalizar a ficha, reabri-la e confirmar que background, proficiências e equipamento permanecem.
