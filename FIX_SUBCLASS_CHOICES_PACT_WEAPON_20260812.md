# Fixed 14 — configurações internas de subclasse e Pact Weapon

## Objetivo

- Persistir escolhas internas de subclasses que alteram a expressão mecânica da subclasse.
- Exigir essas escolhas durante a criação quando aplicável e expô-las na ficha para personagens existentes.
- Integrar escolhas de lista de magias, incluindo o patrono de The Genie.
- Mostrar Pact Weapon somente quando Pact of the Blade estiver realmente selecionada.

## Regras implementadas

### The Genie (Tasha)

A configuração `genie-kind` é derivada dos mechanics importados e oferece Dao, Djinni, Efreeti e Marid. A escolha controla a apresentação de Genie’s Wrath, Elemental Gift e as magias adicionais do patrono. As magias comuns e específicas do tipo de gênio passam a ser elegíveis no seletor de Warlock, respeitando o nível máximo de magia da classe.

### Armorer (Forge of the Artificer)

O modelo de Arcane Armor é derivado de `modelChoice` e pode ser alterado porque os dados importados registram `modelChangeTiming`.

### Escolhas refreshable por descanso

Features de subclasse que trazem simultaneamente `choices` e `choiceRefresh` são tratadas como configuração mutável apenas depois de seu `levelGained`. Isso cobre Hunter’s Prey no nível 3 e Defensive Tactics no nível 7 sem transformar opções momentâneas de outras features em escolhas obrigatórias de criação.

## Persistência e migração

- `CharacterBuildChoices.subclassChoices` guarda `subclassItemId`, `choiceId` e `optionId`.
- Character store version: 24.
- Creation draft version: 12.
- Personagens antigos recebem pendência `subclassOptions` quando uma configuração obrigatória estiver faltando.
- Escolhas obsoletas são podadas pela reconciliação quando a subclasse deixa de estar ativa.

## Pact Weapon

A ficha usa `hasPactOfTheBlade(character, compendiumItems)` antes de renderizar o botão Pact Weapon. A rota e as regras de arma de pacto já mantêm a mesma validação, evitando que Warlocks sem Pact of the Blade recebam essa ação.

## Validações executadas neste ambiente

- `npm run typescript:syntax:check` — PASS, 451 arquivos.
- `npm run check:shape` — PASS.
- `npm run check:a11y` — PASS.
- `npm run compendium:import-v2:release-gate` — PASS completo.
- Harness Genie: Efreeti inclui Fireball e não inclui Wall of Stone; Dao inclui Wall of Stone.
- Harness de elegibilidade: Fireball não é Warlock por padrão e torna-se elegível com a lista adicional de Efreeti, respeitando max spell level.
- Harness Hunter: nível 3 exige Hunter’s Prey; nível 7 acrescenta Defensive Tactics.

O `tsc --noEmit` e o Jest completo devem ser executados no WSL do projeto, pois esta entrega não inclui `node_modules`.
