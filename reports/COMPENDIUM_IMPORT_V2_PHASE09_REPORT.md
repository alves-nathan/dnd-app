# Compendium Import V2 — Phase 09 Functional Regression Report

## Objetivo

A Phase 09 executa as regressões funcionais obrigatórias antes do cutover do PHB 2024 bundled de V1 para `dnd-combat-import.v2`. O foco desta fase não é validar somente equivalência estrutural ou hashes: o conteúdo canônico V2 precisa alimentar as mesmas regras e os mesmos fluxos de runtime que o pacote V1 atualmente usado em produção.

O bootstrap de produção **não foi alterado** nesta fase. `src/compendium/bundledCompendium.ts` continua apontando para o pacote V1 até a Etapa 13.

## Baseline

- Base: Import V2 Phase 08.
- PHB V1: `assets/compendium/phb-2024-full-consolidated-import-pack-v5-complete-invocations.json`.
- PHB V2: `assets/compendium/phb-2024-full-consolidated-import-pack-v2-canonical.json`.
- Itens comparados: 1.284 V1 × 1.284 V2.

## Incompatibilidades de runtime encontradas e corrigidas

A migração V2 formalizou estruturas que antes eram strings ou aliases legacy. As regressões funcionais encontraram consumidores de runtime que ainda pressupunham o formato V1.

### 1. CurrencyValue no custom background

`customBackgroundRules.ts` aceitava somente número ou strings como `"1 GP"`. No V2, `cost` é estruturado como `{ amount, unit }`.

Correção: `parseEquipmentCostToCopper()` passou a aceitar `CP`, `SP`, `EP`, `GP` e `PP` estruturados, mantendo compatibilidade com V1.

Resultado: V1 e V2 produzem os mesmos 54 candidatos elegíveis para background personalizado; armas marciais continuam excluídas e Spear custa 100 CP.

### 2. EquipmentOptions estruturadas

`startingEquipmentRules.ts` esperava `equipmentOptions.A/B/C` como arrays de strings. O V2 normaliza cada opção para `{ items, currency, itemIds? }`.

Correção: o runtime passou a consumir tanto o array V1 quanto a opção V2, preservar referências diretas por ID e materializar currency em labels/runtime currency sem perder o comportamento existente.

Resultado: opções iniciais de Warlock, Fighter e Criminal são semanticamente equivalentes em V1 e V2.

### 3. CastingTime / ActionCost estruturado

O mapper aceitava apenas strings de ActionCost. Spells V2 possuem objetos estruturados com `actionCost` e metadata de timing/trigger.

Correção: `asActionCost()` passou a resolver `record.actionCost`.

Resultado: Fire Bolt = action, Misty Step = bonusAction, Counterspell = reaction e Shield = reaction.

Shield expôs uma melhoria intencional: no V1 o valor `reactionOnHitOrMagicMissile` era um alias de trigger que o mapper antigo interpretava como `action`; o V2 promove corretamente a semântica canônica para `reaction`, preservando o trigger no dado estruturado.

### 4. AbilityReference estruturado em weapons

Algumas armas V2 normalizam `STR_OR_DEX` para uma referência estruturada com `options: [STR, DEX]`.

Correção: o mapper resolve AbilityReference e escolhe a melhor habilidade atual do personagem para referências flexíveis. Compatibilidade com o alias V1 `STR_OR_DEX` foi mantida.

Resultado: Dagger em um personagem com DEX 18 / STR 10 usa DEX para ataque e dano em V2.

### 5. Creature speed estruturado

Velocidades condicionais V2 podem ser `{ value, condition, original }` em vez de número puro.

Correção: `pactChainCompanionRules.ts` passou a consumir tanto número quanto `speedMode.value`.

Resultado: companions/familiars e stat blocks com velocidades condicionais preservam os valores usados pelo runtime.

## Regressões funcionais V1 × V2

O audit executável `scripts/audit-compendium-import-v2-functional-parity.js` executa 13 grupos de checks reais de runtime:

1. candidatos de feats e spells da criação;
2. montagem representativa completa de personagem nível 1;
3. background normal + proficiências de classe/background;
4. equipamentos iniciais de class/background;
5. candidatos e preços do custom background;
6. orçamento de 50 GP e bloqueio de excesso;
7. escolhas internas de Origin Feats;
8. perfis Wizard/Warlock, elegibilidade de spells e seleção adiada;
9. Action Economy das spells;
10. weapon ability flexível;
11. progressão Warlock + Eldritch Invocations + Pact Chain;
12. creature stat blocks, companions e velocidade estruturada;
13. resources, granted actions, effects e tags de criaturas.

Resultado:

```text
Functional checks ................. 13 / 13 PASS
PHB V1 items ...................... 1.284
PHB V2 items ...................... 1.284
Functional parity failures ........ 0
```

## Montagem representativa completa

Um Warlock nível 1 é montado com conteúdo do pacote, passando pelos mesmos mappers usados pelo app:

- Warlock;
- Human;
- Criminal;
- Alert;
- Eldritch Blast;
- proficiências da classe + background;
- primeira opção de equipamento inicial de Warlock.

O estado de gameplay V2 é comparado ao V1 sem comparar IDs runtime aleatórios ou metadata editorial. São comparados classes, espécie, background, feats, spells, weapons, armor/accessories, equipment, currency e proficiências.

## Custom background

Além de comparar candidatos, a Phase 09 testa explicitamente a regra de 50 GP:

- cash-only inicia com 50 GP;
- compra de Spear reduz o saldo para 49 GP;
- tentativa de comprar 51 Spears é rejeitada;
- gasto nunca excede `CUSTOM_BACKGROUND_EQUIPMENT_BUDGET_COPPER`;
- Longsword continua inelegível por ser martial weapon.

## Progressão / Warlock

A regressão compara referências de progressão de Warlock em níveis 1, 3, 5, 7, 10 e 20, além de:

- invocation limit;
- lista selecionável;
- lista elegível no nível 3;
- Eldritch Mind;
- Pact of the Blade;
- Pact of the Chain;
- familiares elegíveis;
- perfis de Pact Magic nos níveis 1 e 7.

## Spellcasting

Wizard e Warlock são comparados nos níveis 1 e 7. A seleção parcial (`requireExact: false`) continua válida, preservando o fluxo recente que permite concluir a criação sem preencher todas as spells e completar posteriormente.

## Resources, actions e effects

Foram usados conteúdos representativos:

- Sorcerer / Innate Sorcery para resources;
- Fighter / Action Surge para granted actions;
- Barbarian / Rage para effect templates.

A comparação de effects ignora apenas metadata de `source` enriquecida no V2 (`rulesEra` etc.); propriedades de gameplay permanecem equivalentes.

## Creature stat blocks

A regressão compara:

- Imp como Pact Chain companion;
- Bestial Spirit com velocidade canônica estruturada;
- tags `wild-shape-candidate`;
- tags `find-familiar-form`;
- Wolf / Dire Wolf;
- Owl.

## Gates executados

```text
Phase 09 static check .............. PASS
Functional parity audit ............ PASS — 13/13
Phase 08 migration gate ............ PASS
PHB V2 deterministic drift check ... PASS
APP-30 isolated typecheck .......... PASS
TypeScript syntax .................. PASS — 426 files
Project shape ...................... PASS
Accessibility contracts ............ PASS
Bundled PHB ........................ PASS — V1, 1.284/1.284
Release readiness .................. PASS
```

A suíte Jest completa e o `tsc --noEmit` completo precisam ser executados no ambiente local com `node_modules` instalado.

## Arquivos alterados

- `src/compendium/mapper.ts` — suporte a structured ActionCost e AbilityReference.
- `src/characters/customBackgroundRules.ts` — CurrencyValue estruturado.
- `src/characters/startingEquipmentRules.ts` — EquipmentOptions V2 + item references.
- `src/characters/pactChainCompanionRules.ts` — speed modes estruturados.
- `src/tests/compendiumImportV2FunctionalParity.test.ts` — regressões Jest V1 × V2.
- `scripts/audit-compendium-import-v2-functional-parity.js` — audit runtime executável sem Jest.
- `scripts/check-compendium-import-v2-phase09.js` — gate de contrato da fase.
- `package.json` — comandos da Phase 09.
- `artifacts/compendium-import-v2-phase09-functional-parity-report.json` — evidência machine-readable.
- `docs/ROADMAP_COMPENDIUM_IMPORT_V2.md` — Etapa 12 concluída e Etapa 13 promovida para próxima.

## Migração / dados existentes

Nenhuma migração de storage ou de personagens foi executada nesta fase. Nenhum item do compêndio local é apagado ou recriado.

O PHB V2 permanece como **candidate artifact**, enquanto o bootstrap bundled continua V1. Isso mantém o rollback simples até o cutover controlado.

## Pendências para o cutover

Phase 10 / Etapa 13 deve:

1. trocar o bootstrap bundled para o PHB V2 canônico;
2. fazer o bootstrap passar pelo pipeline V2/persistência compatível;
3. manter V1 somente como entrada de compatibilidade;
4. adicionar gates de release que bloqueiem regressões de PHB, round-trip, criação e progressão;
5. validar upgrade de instalação existente sem mudar storage IDs de conteúdo já instalado;
6. executar a suíte completa no ambiente local/native antes da entrega final.
