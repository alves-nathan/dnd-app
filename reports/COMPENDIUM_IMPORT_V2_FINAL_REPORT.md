# D&D Combat Math — Compendium Import V2 Final Implementation Report

## Resumo

A reestruturação solicitada foi concluída incrementalmente nas Phases 01–10. O sistema deixou de depender de um importador V1 genérico com `payload` pouco formalizado e passou a possuir um pipeline canônico `dnd-combat-import.v2` alinhado ao domínio real do aplicativo.

O runtime não foi simplificado para caber no importador. O importador, normalizador, validação, preview, persistência, exportação, documentação e prompt foram adaptados ao domínio existente.

## Modelo anterior

As principais limitações encontradas foram:

- `payload` V1 excessivamente genérico;
- schema de importação divergente das estruturas consumidas por criação/progressão/combate;
- strings legacy para currency, action timing e choices;
- relações que podiam depender de nome/alias em vez de IDs;
- ausência de preview/diff determinístico;
- ausência de `contentHash` canônico;
- export/template/prompt ensinando um domínio menor que o runtime;
- bootstrap de produção preso ao artefato V1.

## Arquitetura V2

Pipeline final:

```text
JSON
  ↓
detect version
  ↓
V1 migration / V2 normalization
  ↓
canonical shared domain
  ↓
Zod discriminated schemas
  ↓
semantic validation
  ↓
preview / diff / contentHash
  ↓
deterministic upsert plan
  ↓
transactional persistence
  ↓
runtime mapper
  ↓
export V2 / docs / schema / AI prompt
```

O domínio compartilhado formaliza os 13 kinds atuais:

- class;
- subclass;
- species;
- background;
- feat;
- feature;
- spell;
- weapon;
- armor;
- equipment;
- magicItem;
- condition;
- creatureStatBlock.

## Compatibilidade V1

V1 continua suportada.

```text
V1 / legacy
   ↓
migrateImportV1ToV2()
   ↓
modelo canônico V2
```

A compatibilidade fica isolada no boundary; validação, preview e persistência V2 não precisam conhecer o formato original.

Após o cutover, a store user-facing detecta a versão e roteia:

- V2 → persistência V2 transacional;
- V1/legacy → importador legado compatível.

## Persistência e dados existentes

Nenhuma migração destrutiva do compêndio foi criada.

Updates V2 preservam `StoredCompendiumItem.id`, que é a referência usada por personagens e outras estruturas runtime. Packs incrementais não roubam ownership do pack base.

O cutover bundled mantém o mesmo pack ID do PHB V1. Em instalações existentes a promoção V1 → V2 só acontece quando o preview retorna 0 creates, 0 updates e 0 conflicts. Nesse cenário apenas metadata/hash necessária é preenchida, mantendo IDs e mappings locais.

## Preview / merge

Semântica final:

```text
id inexistente                      -> create
mesmo id + mesmo conteúdo          -> unchanged
mesmo id + mesma identidade + diff -> update
kind/source/rules era incompatível -> conflict
```

Deduplicação não usa nome como identidade.

## Export / round-trip

O exportador produz `dnd-combat-import.v2` e foi validado em round-trip:

```text
domain/storage
  ↓
export V2
  ↓
JSON
  ↓
parseImportPack()
  ↓
canonical V2
```

Para o PHB completo, 1.284/1.284 entidades mantiveram equivalência semântica.

## PHB 2024

Artefato canônico:

`assets/compendium/phb-2024-full-consolidated-import-pack-v2-canonical.json`

Distribuição validada:

| kind | quantidade |
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
| **Total** | **1.284** |

Resultados principais:

- 1.284/1.284 IDs preservados;
- 1.284/1.284 nomes/kinds/source IDs preservados;
- 1.284/1.284 hashes semânticos preservados na migração;
- 0 semantic errors;
- 0 semantic warnings;
- JSON Schema: 0 erros para as 1.284 entidades;
- regressão funcional V1 × V2: 13/13 grupos aprovados;
- fresh install bundled: V2;
- upgrade V1 bundled: storage IDs determinísticos preservados.

## Custom Background

A regressão obrigatória cobre:

- ability score selection;
- skills;
- tools;
- Origin Feat;
- equipamentos elegíveis;
- armas simples;
- budget de 50 GP;
- CurrencyValue estruturado;
- bloqueio de excesso;
- persistência das escolhas.

## Progressão / spellcasting

Foram validados, entre outros:

- class/subclass progression;
- Warlock níveis 1/3/5/7/10/20;
- Eldritch Invocations;
- Pact of the Blade;
- Pact of the Chain;
- Pact Magic;
- Wizard/Warlock spellcasting;
- escolha parcial de spells com conclusão posterior;
- slots/resources/actions/effects.

## Documentação e tooling

Entregues:

- `docs/compendium-import-v2.md`;
- `docs/dnd-combat-import-v2.schema.json` derivado do Zod;
- `buildImportSchemaDocumentation()`;
- `buildExtractorPrompt()` alinhado ao shared domain;
- templates V2 mínimo/completo;
- migração PHB reproduzível;
- audits machine-readable;
- gate permanente `compendium:import-v2:release-gate`.

## Testes e gates

Foram adicionados testes unitários e integrações para envelope, kinds, spells, classes, subclasses, backgrounds, features, weapons, creatures, normalização, V1 migration, semantic validation, preview, persistence, mapper, export, round-trip, PHB migration, functional parity e cutover.

No ambiente desta entrega, os gates executáveis sem `node_modules` ficaram verdes, incluindo:

- PHB bundled V2;
- deterministic PHB migration;
- semantic checks;
- preview/persistence/export audits das fases anteriores;
- functional parity 13/13;
- cutover audit;
- release gate V2;
- syntax/shape/a11y/release-readiness.

A suíte Jest e `tsc --noEmit` completos devem ser executados no checkout local depois de `npm install`/`npm ci`.

## Estruturas ainda extensíveis

Algumas áreas continuam deliberadamente extensíveis porque o domínio real ainda possui variação não promovida para campos de primeira classe:

- `feature.mechanics` e `spell.mechanics` permanecem como extension points tipados como `Record<string, unknown>`;
- `featChoice` ainda aceita estrutura extensível;
- alguns `conditionalDamage`, `area`, `condition.effects/endConditions` e blocos de creature traits/actions mantêm conteúdo pass-through/estruturado parcialmente;
- `pactMagicSlot` continua sendo um pseudo-resource gerenciado pelo runtime de Pact Magic, não uma `ResourceDefinition` independente do PHB.

Esses pontos não causam perda de conteúdo: o schema usa extensibilidade controlada e o round-trip do PHB completo permanece sem alteração semântica.

## Critérios de aceite

Os critérios centrais do prompt foram atendidos:

- `dnd-combat-import.v2` existe e é o formato padrão;
- payloads são discriminados por kind;
- V1 continua suportada;
- V1 → V2 é explícito;
- classes/subclasses/features/species/backgrounds/feats/spells/equipment/creatures são representados;
- costs são estruturados;
- references e duplicidades são validadas;
- preview/diff existe;
- upsert é determinístico;
- export V2 e round-trip existem;
- prompt/template/docs/JSON Schema foram atualizados;
- PHB 2024 completo foi migrado e validado;
- criação/progressão/custom background foram testados V1 × V2;
- bootstrap de produção usa V2;
- instalações V1 existentes têm cutover seguro;
- personagens existentes não precisam ter suas referências recriadas.
