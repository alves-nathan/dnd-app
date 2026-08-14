# Compendium Import V2 — Phase 03

## Escopo

Phase 03 conclui a Etapa 6 do roadmap: validação semântica do modelo canônico
`dnd-combat-import.v2`. A persistência de produção continua intencionalmente
fora deste boundary; a próxima etapa é preview/diff/hash/upsert determinístico.

## Implementação

### Resultado semântico estruturado

`src/compendium/importSemanticValidation.ts` agora expõe:

- `ImportSemanticIssue`, com `itemId`, `itemKind`, `path` e `relatedId`;
- `ImportSemanticValidationResult` com `errors`, `warnings`, `infos` e `summary`;
- `analyzeCompendiumImportV2Semantics()`;
- API compatível `validateCompendiumImportV2Semantics()` para consumidores antigos;
- `externalItems` para validar packs incrementais contra dependências já presentes no catálogo.

`parseImportPack()` passou a devolver `semanticValidation` junto do modelo V2
canônico, sem mudar a regra pública de `ok`: qualquer issue `error` continua
bloqueando o parse.

### Invariantes cobertas

- IDs de itens duplicados;
- `conditionId` duplicado;
- subclass → class;
- feature → class/subclass/species;
- compatibilidade subclass/class;
- feature references por class/subclass/species/background/feat;
- progression ordering, duplicate feature grant na mesma linha, ownership e feature concedida antes de `levelGained`;
- structured prerequisites → class/subclass/feature/feat/spell;
- resources duplicados e scaling fora de 1–20;
- spellcasting tables, slot levels e consistência de Pact Magic;
- spell classes/classIds, cantrip slot consumption, minimum slot level e slot-level scaling;
- background feat references e equipment options;
- weapon category, versatile damage e ranged range;
- armor base AC/dex cap, incluindo shield como `baseAC: 0` + `acBonus`;
- structured equipment cost presence;
- granted actions → spell/item/condition references;
- feature top-level conditionIds/spellRefs;
- creature actions → canonical conditionIds.

### Correção de normalização encontrada pela validação

A auditoria canônica detectou que `sorcerer-sorcery-points` usa `maxByLevel`
com 21 entradas: o índice 0 é um sentinel e os índices 1–20 representam os
níveis de classe. A normalização anterior transformava o último valor em nível
21.

`normalizeResourceDefinition()` agora distingue:

- arrays com 20 entradas: índice 0 → nível 1;
- arrays com 21 entradas: índice 0 é descartado e índice 1 → nível 1.

Isso preserva todas as progressões reais e impede níveis fora do domínio 1–20.

## PHB 2024

Fixture:
`assets/compendium/phb-2024-full-consolidated-import-pack-v5-complete-invocations.json`

Resultado após `migrateImportV1ToV2()` + semantic validation:

- itens: **1.284**;
- IDs únicos: **1.284**;
- kinds: **13**;
- semantic errors: **0**;
- semantic warnings: **0**;
- semantic info: **1**.

A única informação não bloqueante é:

- `IMPORT_V2_RESOURCE_REFERENCE_EXTERNAL_OR_RUNTIME` para
  `phb-2024-feature-warlock-eldritch-smite` → `pactMagicSlot`.

Esse identificador representa o slot de Pact Magic controlado pelo runtime e
não uma entidade/resource definition independente do pack atual. Ele foi
preservado, não inventado nem descartado.

Distribuição:

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

## Testes e gates

Novos testes:

- `src/tests/compendiumImportV2Semantics.test.ts`;
- novo caso de regressão de sentinel em `compendiumImportV2Normalization.test.ts`.

Novos gates reproduzíveis:

- `npm run compendium:import-v2:semantic-harness`;
- `npm run compendium:import-v2:semantic-audit`;
- `npm run test:compendium-import-v2-semantics`;
- `npm run test:compendium-import-v2-phase03`.

Executados neste ambiente:

- TypeScript syntax: PASS — 410 arquivos;
- project shape: PASS;
- accessibility contracts: PASS;
- bundled compendium: PASS — 1.284/1.284;
- APP-30 isolated typecheck: PASS;
- release readiness: PASS;
- semantic runtime harness: PASS — 13 assertions;
- canonical PHB semantic audit: PASS — 0 errors / 0 warnings / 1 info.

Jest completo não foi executado neste runtime porque a entrega não inclui
`node_modules`. Com as dependências instaladas, executar:

```bash
npm run typecheck
npm run test:compendium-import-v2-phase03
npm test -- --runInBand
npm run compendium:import-v2:semantic-audit
```

## Próxima etapa

Phase 04 — preview/diff/hash/upsert determinístico:

1. canonical content hashing;
2. `create/update/unchanged/conflict`;
3. comparação contra catálogo existente sem gravar;
4. `ImportPreview` por kind e por severidade;
5. regras de conflito considerando ID/source/rules era;
6. preparação da transação de upsert, ainda sem cutover V1.
