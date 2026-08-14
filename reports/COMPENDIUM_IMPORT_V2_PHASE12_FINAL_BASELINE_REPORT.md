# Compendium Import V2 — Phase 12 Final Baseline

Data: 2026-08-11

## Objetivo

Encerrar o hardening pós-cutover removendo superfícies residuais que ainda
apresentavam V1 como formato atual, sem remover a compatibilidade de leitura V1.

## Achados

A revisão da Phase 11 encontrou duas inconsistências user-facing e uma ambiguidade
interna:

1. `app/compendium/index.tsx` ainda descrevia a exportação como
   `dnd-combat-import.v1`, apesar de `packageExport.ts` já produzir V2.
2. `docs/import-templates/dnd-compendium-import.template.json` ainda era um
   template V1, embora o gerador dentro do app já emitisse V2.
3. o módulo dependency-free de versões ainda chamava V1 de
   `STANDARD_IMPORT_TEMPLATE_VERSION`, o que facilitava novos usos incorretos.

## Alterações

### Superfícies user-facing

- card de exportação atualizado para `dnd-combat-import.v2 canônico`;
- template estático migrado para V2, com seis exemplos mínimos semanticamente
  conectados: class, feature, spell, background, feat e equipment.

### Boundary de versões

Adicionada a constante explícita:

```ts
LEGACY_IMPORT_TEMPLATE_VERSION_V1
```

Os módulos `importVersion.ts`, `parseImportPack.ts` e `importV1Migration.ts`
passaram a usar esse nome. O alias histórico
`STANDARD_IMPORT_TEMPLATE_VERSION` foi mantido deprecated para compatibilidade
com código externo/antigo.

### Gates

Criado:

```bash
npm run compendium:import-v2:final-baseline:check
```

Ele valida:

- constantes V1/V2 explícitas;
- boundaries canônicos usando o identificador legacy explícito;
- ausência de `dnd-combat-import.v1` nas telas do app;
- exportação user-facing anunciando V2;
- template estático V2 com os seis kinds mínimos e IDs únicos;
- inclusão do próprio gate no release gate permanente.

Também foi criado:

```text
src/tests/compendiumImportV2FinalBaseline.test.ts
```

que, em ambiente com dependências instaladas, passa o template estático pelo
`parseImportPack()` real.

## Validação executada

```text
TypeScript syntax .................. PASS — 429 arquivos
Project shape ...................... PASS
Accessibility contracts ........... PASS
Release readiness .................. PASS
Import V2 final baseline ........... PASS
Import V2 release gate ............. PASS
PHB bundled V2 ..................... PASS — 1.284/1.284
PHB migration deterministic ........ PASS
Functional parity V1 × V2 .......... PASS — 13/13
Cutover audit ....................... PASS
Post-cutover gate ................... PASS
```

O `npm test` e `npm run typecheck` completos não foram executados neste ambiente
porque a entrega não inclui `node_modules`. Nenhuma dependência foi alterada.

## Estado final

- **V2**: bundle de produção, import novo, export, templates, documentação,
  prompt e UI.
- **V1**: somente entrada legada, migração e fixtures de compatibilidade.
- storage IDs, personagens e dados existentes continuam preservados.
