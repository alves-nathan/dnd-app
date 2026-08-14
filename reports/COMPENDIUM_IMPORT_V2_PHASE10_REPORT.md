# Compendium Import V2 — Phase 10 Controlled Cutover Report

## Objetivo

A Phase 10 conclui o roadmap de migração para `dnd-combat-import.v2` realizando o cutover controlado do PHB 2024 bundled. O objetivo é fazer instalações novas utilizarem V2 desde o bootstrap, preservar instalações existentes que ainda possuem o PHB V1 e manter V1 como formato de entrada compatível.

## Baseline

- Base: Import V2 Phase 09.
- PHB V1 preservado: `assets/compendium/phb-2024-full-consolidated-import-pack-v5-complete-invocations.json`.
- PHB V2 canônico de produção: `assets/compendium/phb-2024-full-consolidated-import-pack-v2-canonical.json`.
- Pack ID lógico preservado: `phb-2024-full-consolidated-import-pack-v5-complete-invocations`.
- Itens: 1.284 V1 / 1.284 V2.

## Cutover do bundle

`src/compendium/bundledCompendium.ts` agora carrega o artefato V2 canônico e declara explicitamente `importFormat: 'v2'`.

O `require()` do asset V1 foi removido do manifesto de produção, mas o arquivo V1 permanece versionado para:

- compatibilidade de importação;
- regressões V1 × V2;
- migração reproduzível;
- auditoria histórica.

## Instalação nova

`initializeBundledCompendium()` passa a rotear packs bundled pela versão declarada.

Para o PHB V2:

```text
bundle V2
  ↓
saveImportV2Json()
  ↓
preview/diff
  ↓
upsert transacional
  ↓
prepareCoreCharacterContentSnapshot()
```

O pack persistido deve terminar com `schemaVersion = dnd-combat-import.v2`.

## Upgrade seguro de instalações V1

Foi criado `reconcileBundledCompendium()`.

A reconciliação só é tentada quando:

1. o pack bundled lógico já existe localmente;
2. o pack local ainda não foi promovido para V2;
3. o preview canônico consegue comparar o V2 bundled contra os itens locais.

A promoção automática **somente** ocorre quando o preview retorna:

```text
creates   = 0
updates   = 0
conflicts = 0
```

Nesse cenário:

- os 1.284 `StoredCompendiumItem.id` permanecem estáveis;
- `importItemId` permanece estável;
- `contentHash` é preenchido quando ausente;
- `normalizedJson` local não é substituído em itens `unchanged`;
- decisões de revisão continuam preservadas;
- o pack é promovido para `schemaVersion = dnd-combat-import.v2`.

Se o conteúdo raw local divergir, ou se houver item ausente/conflitante, o cutover automático daquele pack é adiado e nenhum dado é sobrescrito.

## Hidratação

`loadCompendiumSnapshotWithLegacyFallback()` agora cobre três cenários:

### SQLite já populado

- carrega snapshot;
- procura o pack bundled V1 equivalente;
- executa reconciliação segura se aplicável.

### Instalação totalmente vazia

- instala o PHB V2 diretamente.

### Snapshot legado migrado do AsyncStorage

- persiste o snapshot legado no SQLite;
- tenta promover o mesmo pack bundled para V2 sem alterar storage IDs.

Fallback somente-leitura para AsyncStorage continua sem tentativa de escrita quando SQLite está indisponível.

## Importação user-facing V1 + V2

`useCompendiumStore.saveImportJson()` tornou-se version-aware.

```text
V2 -> saveImportV2Json()
V1 / legacy -> saveImportJson()
```

A API da store mantém o nome histórico para não quebrar telas, mas agora retorna `itemCount` e `importFormat` de forma comum aos dois caminhos.

Foram atualizadas as telas:

- `app/compendium/index.tsx`;
- `app/compendium/file-import.tsx`;
- `app/compendium/assistant.tsx`.

O preview manual e o preview de arquivos JSON passaram a usar o boundary version-aware. Quando o catálogo local é conhecido, o preview inclui as entidades instaladas como contexto para permitir packs incrementais que referenciem conteúdo já existente.

## Gate permanente de release

Foi criado:

```bash
npm run compendium:import-v2:release-gate
```

O gate executa:

1. validação do PHB bundled V2;
2. verificação determinística V1 → V2 do PHB;
3. equivalência funcional V1 × V2 da Phase 09;
4. auditoria do cutover da Phase 10.

O gate foi incorporado a `npm run validate`.

## Auditoria de cutover

`scripts/audit-compendium-import-v2-cutover.js` comprovou:

```text
PHB V2 bundled ...................... 1.284 itens
IDs únicos .......................... 1.284
Pack ID V1 == V2 ................... sim
Canonical IDs V1 == V2 ............. sim
Kinds V1 == V2 ..................... sim
Source IDs V1 == V2 ................ sim
Storage IDs determinísticos ........ preservados
V1 asset ............................ preservado
V1 user import ...................... suportado
V2 user import ...................... suportado
Fresh install ....................... V2
Existing V1 ......................... safe reconciliation
Functional parity Phase 09 .......... PASS 13/13
```

## Testes criados/alterados

- `src/tests/compendiumImportV2Cutover.test.ts`
  - bundle de produção V2;
  - fresh install V2;
  - upgrade real do PHB V1 para V2 sem mudar storage IDs;
  - V1 permanece compatível;
  - user-facing import roteia V2.
- `src/tests/bundledCompendiumBootstrap.test.ts`
  - bootstrap V2;
  - rollback;
  - promoção V1 → V2;
  - preservação de mapping local;
  - defer em divergência raw.
- `src/tests/fileImport.test.ts`
  - JSON V2;
  - preview incremental com referências ao catálogo instalado.
- `src/tests/compendiumImportV2PersistenceContract.test.ts`
  - legado V1 explicitamente preservado como compatibilidade pós-cutover.

## Gates executados neste ambiente

```text
TypeScript syntax ................... PASS — 427 arquivos
Project shape ....................... PASS
Accessibility contracts ............ PASS
Release readiness ................... PASS
Bundled PHB V2 ...................... PASS — 1.284/1.284
PHB migration deterministic check .. PASS
Functional parity ................... PASS — 13/13
Phase 10 cutover audit .............. PASS
Phase 10 contract check ............. PASS
Import V2 release gate .............. PASS
```

`npm run typecheck` não pôde ser concluído porque esta entrega não contém `node_modules`; o compilador global interrompeu em typings ausentes de `jest`, `node`, `react` e `expo/tsconfig.base`. Jest completo também depende da instalação local.

## Resultado

O roadmap de migração do Import V2 está concluído. O PHB bundled de produção agora usa V2, V1 permanece compatível, upgrades existentes preservam IDs e conteúdo local, e releases passam a possuir um gate permanente de regressão do novo pipeline.
