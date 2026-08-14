# D&D Combat Math — Compendium Import V2

`dnd-combat-import.v2` é o formato canônico serializável do compêndio. Ele foi modelado a partir do domínio que o aplicativo já consome em criação de personagem, progressão, spellcasting, inventário, combate, custom background e creature stat blocks.

A regra arquitetural é: **runtime, importer, exporter, documentação e prompt de extração compartilham o mesmo domínio**. O formato V2 não cria uma versão simplificada paralela do app.

## 1. Envelope

```json
{
  "templateVersion": "dnd-combat-import.v2",
  "id": "source-pack-id",
  "source": {},
  "metadata": {},
  "items": []
}
```

Campos obrigatórios: `templateVersion`, `id`, `source`, `items`.

`metadata` é reservado a metadados do pacote/exportação. Metadados transitórios de storage/review não devem ser colocados dentro de `payload`.

## 2. Entity kinds

Kinds canônicos atualmente reconhecidos:

- `class`
- `subclass`
- `species`
- `background`
- `feat`
- `weapon`
- `armor`
- `equipment`
- `magicItem`
- `spell`
- `feature`
- `condition`
- `creatureStatBlock`

Eldritch Invocations continuam podendo ser representadas como `feature` especializada através de `sourceType`, porque esse é o modelo utilizado pelo runtime atual.

## 3. Item base

Todo item possui:

```ts
{
  id: string;
  kind: CompendiumEntityKind;
  name: string;
  summary?: string;
  metadata?: Record<string, unknown>;
  source: CompendiumImportSource;
  payload: PayloadDoKind;
}
```

O schema TypeScript/Zod é um union discriminado por `kind`; `payload` não é um `Record<string, unknown>` genérico no boundary canônico. `metadata` é opcional e reservado a proveniência/editorial fora da mecânica. Na migração V1, `_importMeta` é preservado em `metadata.legacyImport`, portanto não é descartado nem misturado ao payload de regras.

## 4. IDs e referências

IDs devem ser estáveis, determinísticos, legíveis e independentes da ordem de importação. Padrão recomendado:

```text
phb-2024-class-warlock
phb-2024-feature-warlock-pact-of-the-blade
phb-2024-spell-fire-bolt
xgte-2017-spell-absorb-elements
```

Não use nome como chave relacional quando houver ID. Relações frequentes usam diretamente `classId`, `subclassId`, `speciesId`, `featureIds`, `featIds`, `classIds` e similares.

Conteúdo 2024 e Legacy pode coexistir. Deduplicação não ocorre apenas por nome.

## 5. Source

```ts
{
  id: string;
  book?: string;
  page?: string;
  version?: string;
  status: "active" | "disabled" | "needsReview";
  confidence: "exact" | "ambiguous" | "manual" | "importedNeedsReview";
  publisher?: string;
  rulesEra?: "2024" | "legacy";
  contentType?: "official" | "third-party" | "homebrew";
  notes?: string;
}
```

Conteúdo extraído por IA deve entrar inicialmente como `needsReview/importedNeedsReview` até revisão humana.

## 6. Enums compartilhados

Abilities:

```text
STR, DEX, CON, INT, WIS, CHA
```

Action costs:

```text
action, bonusAction, reaction, movement, free, special
```

Skills:

```text
Acrobatics, Animal Handling, Arcana, Athletics, Deception, History,
Insight, Intimidation, Investigation, Medicine, Nature, Perception,
Performance, Persuasion, Religion, Sleight of Hand, Stealth, Survival
```

Damage types:

```text
acid, bludgeoning, cold, fire, force, lightning, necrotic,
piercing, poison, psychic, radiant, slashing, thunder
```

Currency units:

```text
CP, SP, EP, GP, PP
```

O parser V1/V2 pode normalizar aliases de entrada, mas o modelo canônico deve manter apenas representações estruturadas/canônicas.

## 7. CurrencyValue

Preços usados em cálculo são estruturados:

```json
{
  "amount": 15,
  "unit": "GP"
}
```

O normalizador V1 ainda converte strings legadas como `"15 GP"`, porém parsing de texto não é o mecanismo principal do V2.

## 8. Class

Campos relevantes:

- `hitDie`
- `primaryAbilities`
- `savingThrowProficiencies`
- `skillChoiceCount`
- `skillProficienciesChoice`
- `weaponProficiencies`
- `armorTraining`
- `toolProficiencies`
- `featureIds`
- `progression`
- `spellcasting`
- `resources`
- `equipmentOptions`

Progression usa IDs:

```json
{
  "level": 3,
  "featureIds": ["phb-2024-feature-example"]
}
```

Spellcasting pode preservar ability, progression, preparation source, cantrips/spells por nível, slots normais, Pact slots, Pact slot level, ritual casting e spellcasting focus quando esses campos existirem no domínio.

## 9. Subclass

`classId` é obrigatório. A associação não depende do nome da classe.

Campos principais: `classId`, `featureIds`, `progression`.

## 10. Species

Campos principais: `creatureType`, `speed`, `size`, `featureIds`, `engineKey`.

Species features podem existir como entidades `feature` e ser referenciadas por `featureIds`.

## 11. Background

Campos principais:

- `abilityScoreOptions`
- `abilityScoreIncreaseRule`
- `featIds`
- `featChoice`
- `skillProficiencies`
- `skillProficiencyChoice`
- `toolProficiencies`
- `toolProficiencyChoice`
- `languageProficiencies`
- `languageProficiencyChoice`
- `equipmentOptions`
- `grantsFeatureIds`
- `engineKey`

Proficiência concedida diretamente não deve ser transformada artificialmente em uma escolha.

### Custom background

O fluxo de custom background depende das próprias entidades do compêndio. Para que um conteúdo importado participe corretamente dele, mantenha pelo menos:

- Origin Feats identificáveis por `feat.category`/metadados atuais;
- skills e tools canônicas;
- equipamento com `cost` estruturado;
- armas com `weaponCategory` (`simple` ou `martial`);
- `equipmentCategory` quando disponível.

## 12. Feat

Campos principais: `category`, `prerequisite`, `abilityScoreIncrease`, `repeatable`, `featureIds`, `mechanics`, `grantsActions`, `effectTemplates`.

`mechanics` continua como escape hatch para regras ainda não promovidas, mas propriedades recorrentes conhecidas devem usar campos tipados.

## 13. Feature

`sourceType` é obrigatório. Campos relevantes incluem:

- `classId`, `subclassId`, `speciesId`
- `levelGained`
- `actionCost`, `actionTiming`
- `prerequisite`
- `requiresConcentration`
- `damageFormula`, `damageType`, `conditionalDamage`
- `resource`, `consumes`
- `grantsActions`
- `effectTemplates`
- `oncePerTurnKey`
- `engineKey`
- `mechanics`

## 14. Weapon

Obrigatórios: `weaponType`, `damageFormula`.

Campos principais:

- `weaponCategory`: `simple | martial`
- `weaponType`
- `attackAbility`, `damageAbility`
- `damageFormula`, `damageDie`, `damageType`
- `properties`, `mastery`
- `range`
- `versatileDamageFormula`
- `magicBonus`, `attacksCount`
- `cost`, `weight`

A validação semântica detecta, entre outras inconsistências, arma versatile sem dano versatile.

## 15. Armor

`baseAC` é obrigatório. Campos principais: `armorCategory`, `baseAC`, `dexCap`, `acBonus`, `strengthRequirement`, `stealthDisadvantage`, `stacksWithArmor`, `weight`, `cost`.

O domínio atual permite representar Shield como `baseAC: 0` com `acBonus` quando adequado ao mapper/runtime.

## 16. Equipment e Magic Item

Equipment pode representar `quantity`, `weight`, `cost`, `equipmentCategory`, `tags`, `grantsActions`, `effectTemplates`.

Magic Item estende essa semântica com campos como `rarity`, `attunement` e `magicBonus`.

## 17. Spell

Obrigatórios: `level`, `classes`, `castingTime`.

Campos principais:

- `level`, `school`
- `classes`, `classIds`
- `castingTime`, `range`, `duration`
- `components`, `specificMaterial` (`boolean` quando o dataset só sinaliza presença/ausência; `string` quando há descrição material estruturada)
- `ritual`, `concentration`
- `requiresAttackRoll`, `saveAbility`
- `damageFormula`, `damageType`, `healingFormula`
- `targets`, `area`
- `consumesSpellSlot`, `minimumSlotLevel`
- `scaling`
- `damageOnSaveSuccess`
- `grantsActions`, `effectTemplates`
- `engineKey`, `mechanics`

A seleção de spells não deve depender de nome/tags/descrição para descobrir a lista da classe; use `classes`/`classIds`.

## 18. Scaling e resources

Scaling canônico suporta `characterLevel`, `classLevel`, `slotLevel` e extensões `custom`.

Resources podem representar `max` fixo ou escalável e recharge por `turn`, `shortRest`, `longRest`, `day` ou `manual`, além de regras de recovery existentes no domínio.

## 19. Conditions

`conditionId` é obrigatório e serve como ID canônico referenciável. Features, spells, effects e creature actions devem usar IDs quando aplicável.

## 20. Creature stat blocks

Obrigatórios: `size`, `creatureType`, `armorClass`, `hitPoints`, `speed`.

O modelo preserva dados suficientes para monsters, Polymorph, Wild Shape, familiars, summons e companions: abilities, saves, skills, defenses, senses, languages, traits, actions, bonus actions e reactions.

## 21. Validação estrutural e semântica

A primeira etapa utiliza o `compendiumImportV2Schema` discriminado por `kind`.

Depois, `analyzeCompendiumImportV2Semantics()` verifica relações e invariantes, produzindo issues `error`, `warning` e `info`. Entre as verificações já existentes estão IDs duplicados, referências ausentes, ownership de features, class/subclass relations, spell class references, progression, resources, weapons e condition references.

Packs incrementais podem validar referências contra entidades já instaladas no catálogo.

## 22. Preview e merge

Antes de persistir, o preview classifica cada entidade como:

```text
create
update
unchanged
conflict
```

Semântica atual:

- ID ausente → `create`
- mesmo ID + mesmo conteúdo canônico → `unchanged`
- mesmo ID + mesma identidade/source + conteúdo diferente → `update`
- mesmo ID + kind/source/rulesEra incompatível → `conflict`

O nome nunca é a chave primária de merge.

## 23. Persistência

O plano de upsert é executado transacionalmente. Updates preservam o storage ID existente, protegendo referências de personagens. `contentHash` pode ser preenchido em itens V1 existentes sem transformar conteúdo semanticamente idêntico em update.

SQLite usa transação incremental; o caminho V2 não precisa apagar/recriar o compêndio inteiro.

## 24.1. Artefato canônico PHB 2024

A migração formal do PHB 2024 mantém o arquivo V1 original e materializa um candidato V2 separado:

```text
assets/compendium/phb-2024-full-consolidated-import-pack-v2-canonical.json
```

O artefato preserva os **1.284 IDs**, os 13 kinds, nomes, fontes por item e hashes semânticos. Os campos legados do envelope `extractionInstructions` e `consolidationMeta` são movidos para `metadata.legacyExtensions`, enquanto os 1.284 `_importMeta` por item são preservados como `items[].metadata.legacyImport`.

A geração é determinística e reproduzível por:

```bash
npm run compendium:import-v2:phb:migrate
npm run compendium:import-v2:phb:check
```

O bootstrap de produção usa o PHB canônico V2 desde a Phase 10. Instalações vazias usam persistência V2 diretamente; instalações com o pack bundled V1 de mesmo ID são promovidas somente quando o preview prova equivalência semântica (`0 creates / 0 updates / 0 conflicts`). V1 continua aceito como formato de entrada compatível.

## 24. Compatibilidade V1

V1 permanece aceito:

```text
dnd-combat-import.v1
        ↓
migrateImportV1ToV2()
        ↓
normalização
        ↓
modelo V2 canônico
```

Depois do boundary `parseImportPack()`, consumidores não precisam conhecer a versão original.

## 25. Export e round-trip

Novas exportações produzem V2. O exportador usa o conteúdo normalizado que o runtime consome e mantém metadados de storage/review fora do payload mecânico.

O gate de round-trip é:

```text
domain/storage
  → export V2
  → JSON
  → parseImportPack()
  → canonical V2
```

Os itens precisam permanecer semanticamente equivalentes pelo fingerprint canônico.

## 26. Template e prompt de extração

`buildStandardImportJsonTemplate()` gera V2 e seus exemplos são verificados pelo mesmo `parseImportPack()` usado no importador.

O template mínimo contém exemplos de:

- class
- feature
- spell
- background
- feat
- equipment

O template completo inclui os 13 kinds.

`buildExtractorPrompt()` reutiliza `buildImportSchemaDocumentation()` para ensinar enums, IDs, relações e payloads, evitando manter uma descrição de schema independente dentro de uma string gigante.

## 27. JSON Schema

Arquivo versionado:

```text
docs/dnd-combat-import-v2.schema.json
```

A API canônica para geração é `buildImportV2JsonSchema()`, que usa `z.toJSONSchema(compendiumImportV2Schema)` (Zod 4). Assim, integrações externas podem regenerar o schema diretamente da mesma validação estrutural usada pelo aplicativo.

## 28. Exemplo mínimo

```json
{
  "templateVersion": "dnd-combat-import.v2",
  "id": "example-pack",
  "source": {
    "id": "example-source",
    "book": "Example Source",
    "version": "2024",
    "status": "needsReview",
    "confidence": "importedNeedsReview",
    "rulesEra": "2024",
    "contentType": "official"
  },
  "items": [
    {
      "id": "example-source-2024-equipment-rope",
      "kind": "equipment",
      "name": "Rope",
      "source": {
        "id": "example-source",
        "book": "Example Source",
        "version": "2024",
        "status": "needsReview",
        "confidence": "importedNeedsReview",
        "rulesEra": "2024",
        "contentType": "official"
      },
      "payload": {
        "quantity": 1,
        "cost": { "amount": 1, "unit": "GP" },
        "equipmentCategory": "Adventuring Gear"
      }
    }
  ]
}
```

## 29. Fonte de verdade

Quando este documento e o código divergirem, a ordem de autoridade é:

1. domínio/runtime atual;
2. `src/compendium/importDomain.ts`;
3. `src/compendium/importV2Schemas.ts`;
4. normalização/validação semântica;
5. este documento e demais artefatos gerados.

A documentação e o prompt devem ser regenerados/atualizados quando o domínio compartilhado evoluir.
