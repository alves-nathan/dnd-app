# Auditoria do domínio — Compendium Import V2

Baseline auditada: `BUGFIX-011 custom background`.

## Resumo executivo

O importador atual ainda é V1 e aceita qualquer `payload` como `Record<string, unknown>`. O runtime, entretanto, já possui tipos estáveis para abilities, action economy, damage formulas, spell scaling, effects, resources, spells, weapons, armor e entidades de personagem. O pacote PHB 2024 já carrega uma estrutura muito mais rica que o schema V1 formaliza.

A refatoração deve, portanto, ocorrer do importador em direção ao domínio, e não o contrário.

## Importador atual

Arquivos centrais:

- `src/compendium/schemas.ts` — único schema Zod do compêndio; payload genérico.
- `src/compendium/importTemplate.ts` — anuncia `dnd-combat-import.v1` e contém documentação/exemplos manuais.
- `src/compendium/importer.ts` — parse, validação genérica, checksum, normalização e construção persistida.
- `src/compendium/mapper.ts` — converte `normalizedJson` em entidades de personagem.
- `src/compendium/actionMapping.ts` — extrai ações, recursos, dano e scaling a partir de payload genérico.
- `src/compendium/packageExport.ts` — exporta novamente no formato V1.
- `src/compendium/fileImport.ts` / `semiStructuredImport.ts` — entrada local estruturada e semi-estruturada.

### Limitações confirmadas

1. `payload` é `z.record(z.string(), z.unknown())`.
2. `templateVersion` não é exigido pelo schema do envelope; ele é apenas produzido pelo template/export.
3. O template V1 documenta uma fração do que o PHB atual realmente contém.
4. O mapper precisa reconstruir tipos por parsing manual de `Record<string, unknown>`.
5. Preços usados por custom background ainda são lidos principalmente de strings.
6. O pacote possui valores que não cabem diretamente nos enums runtime e exigem normalização explícita.

## Domínio runtime reutilizável

`src/types/index.ts` já define, entre outros:

- `AbilityScore`;
- `ActionCost`;
- `DamageSourceType`;
- `ResourceRecharge`;
- `DamageFormula` / `DamageComponent` / `DiceTerm`;
- `ResourcePool` / `ResourceCost`;
- `ActiveEffectTemplate`;
- `SpellScalingRule`;
- `Spell`;
- `Weapon` / `Armor` / `Equipment` / `MagicItem`;
- `AttackAction` / `SpellAction`;
- `Feature`;
- `CharacterProficiencies`.

A primeira fundação V2 criada nesta entrega importa/reutiliza esses tipos em `src/compendium/importDomain.ts` em vez de duplicá-los.

## Persistência atual

O compêndio possui dois caminhos compatíveis de storage:

- snapshot key-value/Zustand;
- SQLite (`dnd-combat-math.db`).

SQLite schema version atual: 3. `compendium_items` persiste um JSON completo por item, mantendo:

- `id` do item armazenado;
- `import_item_id`;
- `pack_id`;
- `source_id`;
- `type`;
- `name`;
- `status`;
- JSON completo;
- search text;
- timestamps.

Isso permite introduzir V2 sem recriar automaticamente o banco. O cutover pode preservar IDs e payloads enquanto o parser/mapeador evolui.

## Criação, progressão e consumo do domínio

Pontos principais auditados:

- criação: `app/characters/new.tsx`, `src/characters/creationData.ts`, `creationDraft.ts`;
- custom background: `src/characters/customBackgroundRules.ts`;
- proficiências: `src/characters/proficiencyRules.ts` e fluxo de criação;
- progressão: `src/characters/progressionReconciliation.ts`, `progressionTransaction.ts`, telas de level-up;
- spellcasting: `spellcastingRules.ts`, `spellSlotProgression.ts`, `spellbookRules.ts`;
- combate: `src/rules-engine/actions`, `damage`, `effects`, `resources`;
- bridge catálogo/personagem: `src/catalog/characterChoiceTypes.ts` e serviços relacionados.

O levantamento automático encontrou **117 arquivos TS/TSX** que acessam `payload`, `rawJson` ou `normalizedJson`. O detalhamento está em `artifacts/compendium-import-v2-domain-audit.json`.

## PHB 2024 atual

Pacote auditado:

`assets/compendium/phb-2024-full-consolidated-import-pack-v5-complete-invocations.json`

Total: **1.284 entidades**.

| kind | itens |
|---|---:|
| feature | 546 |
| spell | 391 |
| feat | 75 |
| creatureStatBlock | 66 |
| subclass | 48 |
| equipment | 42 |
| weapon | 38 |
| condition | 24 |
| background | 16 |
| armor | 13 |
| class | 12 |
| species | 10 |
| magicItem | 3 |

Os 13 kinds já coincidem com o enum do importador atual. Não foi encontrado motivo para criar novos entity kinds somente para Invocations: no pacote atual elas permanecem `feature` com `sourceType: eldritchInvocation`.

## Campos reais já presentes no PHB

### class

Presente em todas as 12 classes:

- `level`, `hitDie`, `primaryAbilities`;
- `savingThrowProficiencies`;
- `skillProficienciesChoice`;
- `weaponProficiencies`, `armorTraining`, `toolProficiencies`;
- `featureIds`, `progression`;
- `spellcasting`, `resources`, `equipmentOptions`.

### subclass

Todas possuem `classId`, `featureIds` e `progression`.

### background

Todas possuem `abilityScoreOptions`, `abilityScoreIncreaseRule`, `featIds`, `featChoice`, `skillProficiencies`, `toolProficiencies`, `equipmentOptions`, `grantsFeatureIds` e `engineKey`.

### spell

As 391 possuem `level`, `school`, `classes`, `castingTime`, `range`, `duration`, attack/save/damage/healing, targets, concentration, slot metadata, scaling, area, effects, actions, mechanics e engine key. Componentes estruturados ainda não estão uniformes em todas.

### weapon / armor / equipment

Weapons já possuem `weaponCategory` simple/martial e custo; armor possui categoria/AC/DEX/STR/stealth/cost; equipment possui quantity/weight/cost/tags e, em vários casos, actions/effects.

### creatureStatBlock

Os 66 stat blocks possuem size/type/AC/HP/speed/challenge/PB/abilities/saves/skills/resistances/immunities/senses/languages/traits/actions/bonusActions/reactions/mechanics.

## Divergências que exigem normalização, não mudança de runtime

### Action cost

Runtime canônico:

`action | bonusAction | reaction | movement | free | special`

O PHB importado também contém valores como:

`passive`, `magicAction`, `helpAction`, `attackReplacement`, `finishLongRest`, `none`.

V2 não deve simplesmente ampliar o enum runtime para caber no arquivo. A Etapa 4 definirá aliases/semântica de normalização ou promoverá novos conceitos somente se já existirem funcionalmente no app.

### Ability em armas

Há armas com `STR_OR_DEX`, enquanto `AbilityScore` é estritamente STR/DEX/CON/INT/WIS/CHA. Isso representa uma escolha/regra, não uma nova ability.

### Damage type

Há valores compostos/variáveis em payloads antigos. V2 deve separar damage type canônico de escolha/combinação em estrutura própria quando isso for mecânica conhecida.

### Currency

O PHB atual usa strings como `1 SP` e `2 GP`. O custom background faz parsing dessas strings. V2 introduziu `CurrencyValue` na camada compartilhada, inicialmente aceitando string também para permitir migração incremental.

## Implementação iniciada nesta entrega

Foram adicionados:

- `src/compendium/importDomain.ts` — tipos compartilhados por kind e enums canônicos;
- `src/compendium/importV2Schemas.ts` — envelope V2 e `z.discriminatedUnion('kind', ...)` para os 13 kinds;
- `src/compendium/importVersion.ts` — detecção V1/V2/legacy sem versão;
- `src/compendium/importSemanticValidation.ts` — primeira camada semântica;
- `src/tests/compendiumImportV2Foundation.test.ts` — testes iniciais;
- `scripts/audit-compendium-import-domain.js` — auditoria reproduzível;
- `artifacts/compendium-import-v2-domain-audit.json` — inventário gerado.

Os módulos V2 ainda **não substituem** o caminho V1 de produção nesta fase. Essa decisão é intencional para evitar big bang e preservar compatibilidade enquanto normalização e migração não estão completas.
