# Compendium Import V2 — Phase 07 Report

## Escopo

Phase 07 conclui a Etapa 10 do roadmap: template V2, prompt de extração, documentação canônica e JSON Schema consumível externamente.

Baseline: Phase 06 — export V2 + round-trip.

## Alterações

### `src/compendium/importV2Documentation.ts`

Nova fonte compartilhada para documentação do formato:

- catálogo dos 13 `CompendiumEntityKind`;
- campos obrigatórios/importantes/relações por kind;
- estratégia canônica de IDs;
- semântica de merge/upsert;
- enums compartilhados;
- `buildImportSchemaDocumentation()`;
- `buildImportV2JsonSchema()` derivado de `z.toJSONSchema(compendiumImportV2Schema)`;
- `buildImportV2JsonSchemaText()`.

### `src/compendium/importTemplate.ts`

O template user-facing passa a emitir `dnd-combat-import.v2` por padrão.

O template mínimo possui exemplos semanticamente conectados de:

1. class;
2. feature;
3. spell;
4. background;
5. feat;
6. equipment.

O template completo cobre todos os 13 kinds.

`validateStandardImportTemplateJson()` agora usa `parseImportPack()`, portanto exemplos e arquivos gerados atravessam o mesmo boundary estrutural/semântico da importação V2 real.

V1 não foi removido: a constante legacy continua em `importVersions.ts` e `parseImportPack()` permanece aceitando/migrando V1.

### Prompt de extração

`buildExtractorPrompt()` deixa de ensinar o formato V1/manual e reutiliza `buildImportSchemaDocumentation()`.

O prompt passa a explicitar:

- IDs determinísticos;
- relações por ID;
- 2024 x Legacy;
- CurrencyValue;
- abilities/skills/action costs/damage types canônicos;
- mechanics como extensão, não depósito permanente de campos conhecidos;
- `needsReview/importedNeedsReview` para conteúdo extraído por IA.

### UI de templates

`app/compendium/templates.tsx` agora oferece também:

- **Guia V2**;
- **JSON Schema**.

### JSON Schema

Arquivo versionado:

`docs/dnd-combat-import-v2.schema.json`

A API de geração canônica é baseada diretamente no Zod usado pelo importador. Foi adicionado:

`npm run compendium:import-v2:schema:generate`

O comando rematerializa o arquivo a partir de `compendiumImportV2Schema` quando `node_modules` está disponível.

### Documentação

Criado:

`docs/compendium-import-v2.md`

Cobre envelope, kinds, IDs, source, enums, payloads, custom background, CurrencyValue, spells, resources/scaling, creature stat blocks, validação, preview/merge, persistência, V1 compatibility, export/round-trip e JSON Schema.

## Testes adicionados/atualizados

- `src/tests/importTemplate.test.ts`
- `src/tests/compendiumImportV2Documentation.test.ts`

Cobertura inclui:

- template V2 mínimo;
- seis exemplos obrigatórios;
- template completo com 13 kinds;
- validação pelo `parseImportPack()`;
- prompt sem V1;
- cobertura documental de todos os kinds;
- geração JSON Schema via Zod;
- presença/contrato do schema externo;
- documentação V1/custom background/round-trip.

## Gates executados neste ambiente

- Phase 07 static contract: PASS — 13 kinds;
- TypeScript/TSX syntax transpile: PASS — 424 arquivos;
- project shape: PASS;
- accessibility contracts: PASS;
- bundled PHB: PASS — 1.284 itens / 1.284 IDs únicos;
- release readiness: PASS;
- semantic runtime harness: PASS — 13 assertions;
- preview runtime harness: PASS — 17 assertions;
- persistence runtime harness: PASS — 14 assertions;
- export runtime harness: PASS — 13 kinds e 13/13 round-trip.

A árvore entregue não contém `node_modules`; por isso Jest completo, `tsc --noEmit` completo e a rematerialização exata de `z.toJSONSchema()` devem ser executados na máquina de desenvolvimento.

## Compatibilidade

- V2: novo formato padrão para templates e exportações.
- V1: continua aceito como entrada e é migrado pelo boundary existente.
- storage/personagens: nenhuma migration ou alteração destrutiva nesta fase.

## Próxima fase

Phase 08 — migração formal do pacote PHB 2024 para um artefato V2 canônico versionado, mantendo os 1.284 IDs, relações e equivalência semântica, sem substituir automaticamente o compêndio local existente.
