# Compendium Import V2 — Phase 11 Post-Cutover Stabilization

## Objetivo

Endurecer o estado final depois do cutover da Phase 10. O bootstrap já usava o PHB V2 canônico, porém alguns gates e testes de runtime ainda carregavam diretamente o artefato V1. Isso criava uma lacuna: uma regressão específica do V2 poderia não ser percebida por verificações que se apresentavam como testes de dados reais.

## Alterações

### Runtime-facing gates migrados para V2

Passaram a carregar `phb-2024-full-consolidated-import-pack-v2-canonical.json`:

- `scripts/check-character-choice-bridge.js`;
- `scripts/run-app04-runtime-harness.js`;
- `src/tests/catalogCharacterChoiceRealData.test.ts`.

O artefato V1 permanece disponível para migração, compatibilidade e testes explícitos de paridade.

### Gate pós-cutover

Foi criado:

`npm run compendium:import-v2:post-cutover:check`

O gate verifica:

- manifest bundled usa V2;
- consumidores de runtime não apontam de volta para o PHB V1;
- PHB V2 canônico existe, usa `dnd-combat-import.v2`, possui 1.284 itens e 1.284 IDs únicos;
- PHB V1 continua presente como artefato de compatibilidade;
- o próprio gate está incluído no `compendium:import-v2:release-gate`.

### Teste Jest

Foi adicionado `src/tests/compendiumImportV2PostCutover.test.ts`, cobrindo o contrato acima e o parsing do pacote bundled real.

### Gates históricos endurecidos

As verificações das Phases 08 e 09 agora exigem explicitamente o bootstrap V2 canônico, em vez de aceitarem V1 ou V2.

## Validações executadas

- `compendium:import-v2:post-cutover:check`: PASS;
- `compendium:bundled:check`: PASS — 1.284/1.284;
- `catalog:character-bridge:check`: PASS — 1.284 carrier items e 598 carriers com identidade direta;
- APP-04 runtime harness: PASS;
- Phase 08 check: PASS;
- Phase 09 check: PASS;
- Phase 10 check: PASS;
- TypeScript syntax: PASS — 428 arquivos;
- project shape: PASS;
- accessibility contracts: PASS;
- release readiness: PASS;
- `compendium:import-v2:release-gate`: PASS.

`node_modules` não está presente nesta cópia da codebase, portanto Jest e `tsc --noEmit` completos continuam reservados ao checkout local.

## Resultado

O caminho de produção e os principais gates de runtime agora exercitam o PHB V2 canônico. O V1 deixa de ser um fixture implícito de runtime e permanece apenas onde sua presença é intencional: compatibilidade, migração e comparação de paridade.
