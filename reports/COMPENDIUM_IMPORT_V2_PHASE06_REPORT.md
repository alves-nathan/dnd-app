# Compendium Import V2 — Phase 06 Report

## Escopo

Phase 06 executa a Etapa 9 do roadmap: **Export V2 + round-trip semântico**.

Baseline: `dnd-combat-math-mvp-import-v2-phase05-transactional-persistence`.

Objetivos desta fase:

- tornar `dnd-combat-import.v2` o formato gerado pela exportação do compêndio;
- preservar V1 como formato de entrada compatível;
- exportar o estado efetivamente consumido pelo runtime, não apenas o `rawJson` de auditoria;
- manter metadados de storage/revisão fora do payload de regras;
- garantir `export -> JSON -> parseImportPack -> V2` sem perda semântica;
- provar round-trip para todos os 13 kinds e para o PHB 2024 completo.

## Modelo anterior

A função `buildCompendiumPackageExport()` ainda gerava `dnd-combat-import.v1`.

Além disso, a exportação anterior reconstruía o item principalmente a partir de
`rawJson`. Isso tinha duas limitações:

1. alterações editoriais/mappings gravadas em `normalizedJson` podiam não aparecer
   no arquivo exportado, embora `normalizedJson` seja o estado consumido pelo
   runtime;
2. metadados de origem/revisão eram injetados em `payload.exportMetadata`, fazendo
   informação de storage contaminar a semântica da entidade.

Em exports com múltiplas fontes, o V1 também substituía a `source` dos itens por
uma fonte mesclada, preservando a origem apenas em metadata dentro do payload.

## Arquitetura implementada

### `src/compendium/importV2Export.ts`

Novo boundary dedicado para exportação canônica V2.

Responsabilidades:

- reconstruir `CompendiumImportItem` a partir de `StoredCompendiumItem`;
- usar `normalizedJson` como fonte de verdade do payload do runtime;
- usar `rawJson`/snapshot apenas para identidade/source fallback e auditoria;
- remover chaves transitórias de storage do payload;
- preservar `source` individual de cada entidade;
- armazenar informações de storage/review somente no envelope `metadata`;
- validar semântica contra o catálogo existente para permitir export de subsets;
- verificar round-trip JSON através de `parseImportPack()`;
- comparar hashes semânticos por item.

### Metadata V2 de exportação

Quando solicitado:

```text
metadata.export
metadata.storageOrigins
metadata.review
```

`storageOrigins` preserva `storedItemId`, `canonicalItemId`, `packId` e
`sourceId`. `review` preserva status/decisão/notas sem alterar a entidade.

Nenhum desses dados é adicionado ao `payload`.

### Export com múltiplas fontes

O envelope pode utilizar uma source sintética para representar o pacote exportado,
mas cada item mantém a própria source canônica. A identidade de uma entidade não
é reescrita apenas porque o arquivo reúne mais de uma fonte.

### `forceNeedsReview`

A opção continua disponível. Quando ativada, ela altera deliberadamente a source
do envelope e dos itens para:

```text
status: needsReview
confidence: importedNeedsReview
```

Esse comportamento é explícito e o round-trip continua válido.

## Export padrão do aplicativo

`src/compendium/packageExport.ts` passou a gerar exclusivamente:

```text
dnd-combat-import.v2
```

A UI `app/compendium/export.tsx` foi atualizada para apresentar o formato V2.

V1 **não foi removida do importador**. Arquivos V1 continuam passando por:

```text
parseImportPack
  -> detect version
  -> migrateImportV1ToV2
  -> canonical V2
```

Portanto, esta fase muda a saída nova sem quebrar arquivos existentes.

## Round-trip

Foi criada `verifyCompendiumImportV2RoundTrip()`.

Fluxo:

```text
canonical V2 pack
      ↓
JSON.stringify
      ↓
parseImportPack(V2)
      ↓
canonical V2 pack
      ↓
content hash por entidade
```

A equivalência é medida pela identidade semântica de cada item, e não por
metadados temporários como timestamps de exportação.

O verificador retorna:

- quantidade original e reparseada;
- hashes iguais;
- IDs ausentes;
- IDs inesperados;
- IDs semanticamente diferentes;
- hash do pacote antes/depois para auditoria.

## Correção encontrada pelo round-trip

A auditoria identificou um bug real de idempotência no normalizador de
`creatureStatBlock.speed`.

Velocidades condicionais V1 eram corretamente promovidas para objetos V2:

```json
{
  "value": 40,
  "condition": "Air only",
  "original": "40 Air only"
}
```

Porém uma segunda passagem pelo normalizador aceitava apenas número/string e
acabava descartando esses objetos já canônicos.

Isso afetava seis stat blocks do PHB usados por summons:

- Otherworldly Steed;
- Aberrant Spirit;
- Bestial Spirit;
- Elemental Spirit;
- Fiendish Spirit;
- Undead Spirit.

`normalizeCreatureSpeed()` agora reconhece e preserva valores estruturados V2,
tornando esse trecho do boundary idempotente.

Foi adicionado teste de regressão específico.

## Estado do runtime vs rawJson

A exportação V2 usa `normalizedJson` para o payload porque esse é o estado que o
mapper/engine consome hoje.

Exemplo coberto por teste:

```text
rawJson.damageFormula        = 1d6
normalizedJson.damageFormula = 1d8
normalizedJson.mastery       = Sap
```

O export V2 contém `1d8` e `Sap`, preservando a edição do usuário. O `rawJson`
continua intacto como trilha de auditoria local.

## Testes adicionados/alterados

### Novos

- `src/tests/compendiumImportV2ExportRoundTrip.test.ts`
  - round-trip dos 13 entity kinds;
  - equivalência de hash;
  - storage/review metadata fora do payload;
  - export de mudanças em `normalizedJson`;
  - `forceNeedsReview`.

- `src/tests/compendiumImportV2ExportContract.test.ts`
  - export user-facing é V2;
  - V1 não é gerada por `packageExport`;
  - metadata não é injetada em payload;
  - round-trip usa `parseImportPack()` e hash canônico.

- `scripts/run-compendium-import-v2-export-harness.js`
  - harness sem `node_modules` cobrindo 13 kinds.

- `scripts/audit-compendium-import-v2-export-roundtrip.js`
  - auditoria do PHB completo.

### Atualizados

- `src/tests/packageExport.test.ts` — contrato de exportação V2.
- `src/tests/compendiumImportV2Normalization.test.ts` — idempotência de speed
  estruturado.

## PHB 2024 — resultado da auditoria

Pacote utilizado:

`phb-2024-full-consolidated-import-pack-v5-complete-invocations`

### Totais

- entrada canônica: **1.284** itens;
- exportados: **1.284** itens;
- IDs únicos: **1.284**;
- entity kinds: **13**;
- round-trip: **1.284/1.284 hashes iguais**;
- storage/runtime -> export: **1.284/1.284 hashes iguais**;
- itens ausentes: **0**;
- itens inesperados: **0**;
- itens semanticamente alterados: **0**;
- source divergente: **0**;
- vazamento de `exportMetadata` no payload: **0**;
- metadata `storageOrigins`: **1.284** entradas;
- metadata `review`: **1.284** entradas;
- errors: **0**;
- warnings: **0**;
- infos: **2**.

Os dois infos são esperados:

1. pacote contém múltiplas sources, com source sintética apenas no envelope;
2. `pactMagicSlot` permanece identificado como resource externo/runtime.

### Distribuição por kind

- feature: 546
- spell: 391
- feat: 75
- creatureStatBlock: 66
- subclass: 48
- equipment: 42
- weapon: 38
- condition: 24
- background: 16
- armor: 13
- class: 12
- species: 10
- magicItem: 3

A distribuição antes e depois da exportação é idêntica.

## Validações executadas neste ambiente

- TypeScript syntax: PASS — **422 arquivos**;
- isolated strict typecheck do boundary Phase 06 com stubs externos: PASS;
- semantic harness: PASS — 13 assertions;
- semantic PHB audit: PASS — 0 errors / 0 warnings;
- preview harness: PASS — 17 assertions;
- preview PHB audit: PASS;
- persistence harness: PASS — 14 assertions;
- persistence PHB audit: PASS;
- export harness: PASS — 13 kinds / 13 round-trip;
- export PHB audit: PASS — 1.284/1.284;
- project shape: PASS;
- accessibility contracts: PASS;
- bundled compendium: PASS — 1.284/1.284;
- release readiness: PASS.

A cópia entregue não contém `node_modules`, portanto `npm test` e o `npm run
typecheck` completos devem ser executados na máquina do usuário.

Comandos adicionados:

```bash
npm run compendium:import-v2:export-harness
npm run compendium:import-v2:export-audit
npm run test:compendium-import-v2-export
npm run test:compendium-import-v2-phase06
```

## Migração/storage

Nenhuma migration de banco foi adicionada nesta fase.

- itens existentes não são apagados;
- storage IDs não são alterados;
- personagens não são migrados;
- links ao compêndio não são modificados;
- `contentHash` da Phase 05 continua intacto;
- `package-lock.json` não recebeu alteração de dependência.

A única alteração funcional persistente é que **novas exportações** passam a ser
V2.

## Arquivos principais alterados

- `src/compendium/importV2Export.ts` — novo boundary de export/round-trip.
- `src/compendium/packageExport.ts` — export user-facing agora V2.
- `src/compendium/importNormalization.ts` — idempotência de speeds estruturados.
- `app/compendium/export.tsx` — texto/opções alinhados ao V2.
- `src/tests/compendiumImportV2ExportRoundTrip.test.ts` — round-trip 13 kinds.
- `src/tests/compendiumImportV2ExportContract.test.ts` — contrato estrutural.
- `src/tests/packageExport.test.ts` — regressão do export público.
- `src/tests/compendiumImportV2Normalization.test.ts` — regressão do speed.
- `scripts/run-compendium-import-v2-export-harness.js` — harness runtime.
- `scripts/audit-compendium-import-v2-export-roundtrip.js` — auditoria PHB.
- `package.json` — scripts Phase 06.
- `docs/ROADMAP_COMPENDIUM_IMPORT_V2.md` — roadmap atualizado.

## Próxima etapa

**Phase 07 — Template, extractor prompt, documentação e JSON Schema.**

Escopo planejado:

- transformar o template padrão para V2;
- criar exemplos validados de class, feature, spell, background, feat e equipment;
- implementar `buildImportSchemaDocumentation()`;
- atualizar `buildExtractorPrompt()` para derivar enums/documentação do domínio;
- criar `docs/compendium-import-v2.md`;
- gerar/validar `dnd-combat-import-v2.schema.json`;
- manter V1 apenas como formato de entrada legado;
- autocertificar template e exemplos pelo mesmo pipeline V2.
