# Compendium Import V2 — Phase 08 Report

## Escopo

Phase 08 conclui a Etapa 11 do roadmap: migração formal do pacote PHB 2024 para `dnd-combat-import.v2` sem trocar ainda o bootstrap de produção.

Baseline: Phase 07 — template/docs/schema.

## Resultado principal

Foi materializado o artefato canônico:

```text
assets/compendium/phb-2024-full-consolidated-import-pack-v2-canonical.json
```

O V1 original permanece preservado:

```text
assets/compendium/phb-2024-full-consolidated-import-pack-v5-complete-invocations.json
```

O pack lógico mantém exatamente o mesmo ID, evitando criar um segundo pacote apenas por mudança de formato.

## PHB 2024

| Kind | Itens |
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

Garantias verificadas:

- 1.284/1.284 IDs preservados;
- 1.284/1.284 kinds preservados;
- 1.284/1.284 nomes preservados;
- 1.284/1.284 source IDs por item preservados;
- 1.284/1.284 hashes semânticos preservados;
- 0 IDs ausentes;
- 0 IDs inesperados;
- 0 erros semânticos;
- 0 warnings semânticos;
- 1 info esperado para o pseudo-resource runtime `pactMagicSlot`.

SHA-256 do artefato canônico:

```text
a56009f7b229d37b3d077242ca1a6102ef1d973d68f724901bd0ff490cf67c4c
```

## Proveniência V1 preservada

A auditoria revelou que todos os 1.284 itens V1 possuíam `_importMeta`, contendo arquivo/lote de origem. O normalizador anterior descartava esse dado porque ele não fazia parte do item base.

V2 passa a suportar:

```ts
metadata?: Record<string, unknown>
```

por item.

Durante migração:

```text
_importMeta
    ↓
item.metadata.legacyImport
```

Resultado: **1.284/1.284 metadados de proveniência preservados**, sem contaminar `payload` e sem participar do hash semântico da regra.

O exportador V2 também preserva `item.metadata` a partir do `rawJson`, portanto a proveniência continua disponível depois de persistência → exportação.

## Envelope legado

Os dois extensions de envelope V1:

```text
extractionInstructions
consolidationMeta
```

não permanecem no root do artefato formal. Eles são preservados em:

```text
metadata.legacyExtensions
```

O V2 também registra `metadata.canonicalMigration`, incluindo source asset, source SHA-256, pack ID, quantidade de itens e gerador usado.

## Ajuste de domínio encontrado pela validação real

A validação independente do PHB V2 contra `docs/dnd-combat-import-v2.schema.json` encontrou inicialmente 174 spells que não passavam no schema.

Todos os casos eram o mesmo campo:

```text
payload.specificMaterial
```

O PHB real utiliza `boolean` para sinalizar presença/ausência em 174 spells, enquanto o schema havia sido definido apenas como `string`.

A correção seguiu a regra arquitetural do projeto: **o domínio real não foi alterado para caber no importador**. O shared domain/schema passou a refletir os dados reais:

```ts
specificMaterial?: string | boolean
```

Após o ajuste, a validação independente JSON Schema do pacote completo retornou:

```text
1.284 itens
0 erros estruturais
```

## Geração determinística

Foi criado:

```text
scripts/migrate-phb-2024-to-import-v2.js
```

Comandos:

```bash
npm run compendium:import-v2:phb:migrate
npm run compendium:import-v2:phb:check
```

`phb:migrate` gera:

- artefato V2;
- checksum `.sha256`;
- relatório JSON da migração.

`phb:check` regenera tudo em memória e falha caso haja drift em qualquer artefato committed.

## Bootstrap / dados existentes

Nenhuma migração destrutiva foi aplicada.

`BUNDLED_COMPENDIUM_PACKS` continua apontando para o V1 atual. Portanto:

- instalações existentes não são recriadas;
- personagens existentes não perdem links;
- V1 continua suportado;
- o V2 formal fica disponível como fixture/candidato para regressões da próxima fase.

A troca do bundle será avaliada somente após os gates funcionais da Phase 09.

## Arquivos alterados

### Domínio e pipeline

- `src/compendium/importDomain.ts` — metadata opcional por item e `specificMaterial` alinhado ao dado real.
- `src/compendium/importNormalization.ts` — preservação de `_importMeta` como `metadata.legacyImport`.
- `src/compendium/importV2Schemas.ts` — schema de item metadata e `specificMaterial: string | boolean`.
- `src/compendium/importV2Export.ts` — preserva metadata de item no export a partir de `rawJson`.
- `src/compendium/importV2Documentation.ts` — documenta metadata/proveniência no domínio externo.

### Artefatos e documentação

- `assets/compendium/phb-2024-full-consolidated-import-pack-v2-canonical.json` — PHB formal V2.
- `assets/compendium/phb-2024-full-consolidated-import-pack-v2-canonical.json.sha256` — checksum.
- `artifacts/compendium-import-v2-phase08-phb-migration-report.json` — auditoria reproduzível.
- `docs/dnd-combat-import-v2.schema.json` — JSON Schema atualizado.
- `docs/compendium-import-v2.md` — documentação canônica atualizada.
- `docs/PHB_2024_IMPORT_V2_MIGRATION.md` — runbook da migração.
- `docs/ROADMAP_COMPENDIUM_IMPORT_V2.md` — Etapa 11 concluída; Etapa 12 próxima.

### Scripts e testes

- `scripts/migrate-phb-2024-to-import-v2.js` — materialização/check determinístico.
- `scripts/check-compendium-import-v2-phase08.js` — gate estrutural da Phase 08.
- `src/tests/compendiumImportV2PhbMigration.test.ts` — regressão do artefato PHB V2.
- `src/tests/compendiumImportV2Normalization.test.ts` — regressão da proveniência V1.
- `src/tests/compendiumImportV2ExportRoundTrip.test.ts` — metadata de item sobrevive ao export.
- `package.json` — comandos Phase 08.

## Gates executados neste ambiente

```text
PHB V2 migration/check ............. PASS
Phase 08 static contract ........... PASS
JSON Schema Draft-7 validation ..... PASS — 0 errors / 1.284 items
Semantic validation ................ PASS — 0 errors / 0 warnings / 1 info
Semantic runtime harness ........... PASS — 13 assertions
Preview runtime harness ............ PASS — 17 assertions
Persistence runtime harness ........ PASS — 14 assertions
Export runtime harness ............. PASS — 13/13 kinds
TypeScript syntax .................. PASS — 425 files
APP-30 isolated typecheck .......... PASS
Project shape ...................... PASS
Accessibility contracts ............ PASS
Bundled PHB V1 gate ................ PASS — 1.284/1.284
Release readiness .................. PASS
```

O Jest completo e `tsc --noEmit` dependem do `node_modules` da instalação local. Rodar:

```bash
npm run typecheck
npm run compendium:import-v2:phase08:check
npm run test:compendium-import-v2-phase08
npm test -- --runInBand
```

## Próxima fase

**Phase 09 — regressões funcionais usando o PHB V2 formal como fonte principal de teste.**

Gates obrigatórios:

1. criação completa de personagem;
2. background normal;
3. custom background + orçamento de 50 GP;
4. Origin Feats e choices;
5. skills/tools/languages;
6. equipamentos e armas simples/marciais;
7. spell selection e descrições;
8. Warlock, Eldritch Invocations e Pact Magic;
9. level up/progressão;
10. resources/actions/effects;
11. creature stat blocks, familiar/summon/Polymorph/Wild Shape;
12. comparação funcional V1 × V2 para garantir equivalência de comportamento.

Somente depois disso o bootstrap poderá migrar para o asset V2.
