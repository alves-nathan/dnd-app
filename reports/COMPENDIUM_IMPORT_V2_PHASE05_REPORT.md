# Compendium Import V2 — Phase 05

## Escopo

Phase 05 implementa a Etapa 8 do roadmap: persistência transacional do modelo
canônico V2 e compatibilidade com o mapper/runtime existente, sem realizar ainda
o cutover da UI ou do bootstrap para o novo caminho.

Baseline: `dnd-combat-math-mvp-import-v2-phase04-preview-diff-upsert`.

## Arquitetura implementada

O fluxo executável passa a ser:

```text
JSON V1/V2
  ↓
parse/migrate/normalize
  ↓
schema + semantic validation
  ↓
preview/diff
  ↓
immutable upsert plan
  ↓
atomic persistence adapter
```

A função pura `applyCompendiumImportV2PlanToSnapshot()` constrói o próximo
estado sem I/O. Isso permite validar todas as invariantes antes do commit e
fornece a mesma semântica aos backends KeyValue e SQLite.

## Persistência KeyValue

`KeyValueCompendiumRepository.saveImportV2Json()`:

1. carrega o snapshot atual;
2. executa parse + preview com contexto do catálogo instalado;
3. recusa conflitos/erros;
4. gera o plano determinístico;
5. constrói o próximo snapshot integralmente em memória;
6. realiza uma única chamada `saveSnapshot()`.

Se a escrita falhar, o resultado retorna o snapshot anterior e a operação não é
considerada commitada.

## Persistência SQLite

`SQLiteCompendiumRepository.saveImportV2Json()` usa `withTransactionAsync()` e
UPSERT incremental para:

- sources envolvidos no pack;
- metadados do pack;
- creates;
- updates;
- backfill de `contentHash` em unchanged legacy rows.

O método não executa `DELETE FROM compendium_items` ou `DELETE FROM
compendium_packs` durante o import V2. Uma exceção dentro da transação faz o
SQLite efetuar rollback.

## Preservação de identidade

Updates preservam:

- `StoredCompendiumItem.id`;
- `importItemId` canônico;
- `createdAt`;
- pack owner original da entidade.

A preservação do storage ID é crítica porque personagens e outras estruturas de
runtime podem manter `compendiumLink.itemId` apontando para esse ID.

Packs incrementais podem atualizar uma entidade sem “roubar” a propriedade do
pack base. O patch continua registrado como pack importado, enquanto o item
mantém seu owner original.

## Content hash

`StoredCompendiumItem` ganhou `contentHash?: string`.

- create/update persistem o fingerprint V2;
- unchanged em dados V1 faz backfill do fingerprint sem alterar `updatedAt`;
- o hash também é incluído em `normalizedJson` como metadata;
- o preview continua recalculando o hash, não confiando cegamente no valor
  armazenado.

## Estado editorial local

Um item localmente `disabled` não é reativado por um update V2. A decisão de
review local (`rejected`, notes, reviewedBy/reviewedAt) é preservada nesse caso.

Para conteúdo novo/atualizado que exige revisão, o estado é `needsReview` e a
aprovação anterior não é reutilizada silenciosamente.

## Mapper

Não foi criado `V2Mapper` paralelo. `buildStoredCompendiumV2Item()` produz
`normalizedJson` com o payload canônico e metadata compatível com o mapper
existente.

O teste `compendiumImportV2MapperIntegration.test.ts` valida que uma spell V2
persistida passa por `applyCompendiumItemToCharacter()` e cria um
`compendiumLink` usando o storage ID preservável.

## Compatibilidade

`saveImportJson()` V1 permanece inalterado e disponível. O novo
`saveImportV2Json()` foi adicionado ao contrato de repository para migração
incremental. Nenhuma UI foi redirecionada nesta fase.

Não houve migration destrutiva de SQLite. `contentHash` fica no JSON do item,
logo snapshots e bancos existentes continuam legíveis sem ALTER TABLE.

## PHB 2024

Auditoria de persistência sobre 1.284 entidades:

### Catálogo vazio

- creates: 1.284;
- persisted items: 1.284;
- storage IDs únicos: sim;
- contentHash presente: 1.284/1.284.

### Replay V2 sobre catálogo V1 semanticamente idêntico

- creates: 0;
- updates: 0;
- unchanged: 1.284;
- conflicts: 0;
- content hashes backfilled: 1.284;
- storage IDs preservados: sim.

### Uma entidade alterada

- updates: 1;
- unchanged: 1.283;
- storage ID do update preservado: sim;
- changed path detectado: `summary`.

## Arquivos principais alterados

- `src/compendium/types.ts` — `contentHash` e raw item V1/V2.
- `src/compendium/importUpsertPlan.ts` — hashes de unchanged para backfill.
- `src/storage/compendiumV2Persistence.ts` — executor puro e builders V2.
- `src/storage/compendiumRepository.ts` — commit V2 no backend KeyValue.
- `src/storage/sqliteCompendiumRepository.ts` — commit transacional incremental.
- `src/storage/index.ts` — export do novo módulo.
- `src/tests/compendiumImportV2Persistence.test.ts` — identidade, hash, review e stale plan.
- `src/tests/compendiumImportV2PersistenceContract.test.ts` — contrato SQLite/no-delete e coexistência V1/V2.
- `src/tests/compendiumImportV2MapperIntegration.test.ts` — integração V2 → mapper → personagem.
- `src/tests/compendiumRepository.test.ts` — integração KeyValue V2 e falha de escrita.
- `scripts/run-compendium-import-v2-persistence-harness.js` — harness runtime sem node_modules.
- `scripts/audit-compendium-import-v2-persistence.js` — auditoria PHB 1.284 itens.

## Validações executadas

- project shape: PASS;
- accessibility contracts: PASS;
- bundled compendium: PASS (1.284/1.284 IDs únicos);
- semantic harness/audit: PASS;
- preview harness/audit: PASS;
- persistence harness: PASS;
- persistence PHB audit: PASS;
- TypeScript syntax: PASS (419 arquivos);
- isolated typecheck do boundary de persistência: PASS;
- isolated typecheck dos repositories com stubs de backend: PASS;
- APP-30 isolated typecheck: PASS;
- release readiness: PASS.

A suíte Jest completa e o `npm run typecheck` do projeto dependem do
`node_modules` da máquina do usuário, que não está presente nesta cópia de
trabalho.

## Próxima etapa

Phase 06 — Export V2 + round-trip:

- exportar `dnd-combat-import.v2` diretamente do domínio persistido;
- preservar extensões/payloads;
- export → JSON → parse/import → equivalência semântica;
- round-trip dos 13 kinds;
- preparar a substituição posterior do export V1.
