# APP-INTEGRATION-05 — PHB 2014 delta legacy sobre chassis 2024

## Objetivo

Fechar o delta oficial do Player's Handbook 2014 sem transformar o aplicativo em um catálogo duplicado 2014 + 2024. O PHB 2024 continua sendo o core de classes, spells, equipment e regras; apenas conteúdo legacy exclusivo é adicionado.

## Implementação

Foi adicionado o gerador `scripts/build-phb2014-2024-legacy-delta.js`, com saída V1 de proveniência e V2 canônica de runtime. O pack V2 foi adicionado ao `BUNDLED_COMPENDIUM_PACKS` como quinto pacote nativo.

O fluxo de release agora inclui `compendium:legacy:phb2014:delta:check`. O harness de integração importa o delta após PHB 2024, Forge, Spelljammer e Tasha, mede creates/updates/conflicts e repete o pack para provar idempotência.

O smoke de personagem foi ampliado de 11 para 24 contratos. Foram acrescentados cenários para Knowledge, Nature e Tempest Domain e para as quatro Schools of Wizard, além de checks estruturais de species/feats e dependências.

## Resultado de runtime

- 56 novos itens;
- snapshot final: 1.989 itens;
- 5 packs instalados;
- 0 conflicts;
- 0 errors;
- replay do delta: 56 unchanged;
- 0 owners PHB 2014 em runtime;
- 24/24 smoke checks;
- release gate PASS.

## Arquivos principais alterados

- `scripts/build-phb2014-2024-legacy-delta.js`;
- `src/compendium/bundledCompendium.ts`;
- `scripts/check-bundled-compendium.js`;
- `scripts/check-extracted-book-pack-integration.js`;
- `scripts/check-2024-legacy-character-smoke.js`;
- `src/tests/compendiumImportV2Cutover.test.ts`;
- `src/tests/extractedBookPackIntegration.test.ts`;
- `package.json`;
- `assets/compendium/phb-2014-2024-compatible-delta-v2-canonical.json`.

## Limite da execução

O conjunto completo de Jest não foi executado porque `node_modules` não está presente no ZIP. Os caminhos novos e de maior risco foram exercitados pelos harnesses Node/TypeScript integrantes do release gate.

## Próximo risco a tratar

O bundle agora está completo para o delta PHB 2014, mas ainda existem referências legacy em outros livros que devem ser reconciliadas: principalmente referências `phb-2014-*` no Spelljammer e referências `dmg-2014-*` / `mm-2014-*` em Tasha. A próxima etapa deve classificá-las e reescrevê-las somente quando houver entidade 2024 equivalente ou quando o conteúdo realmente exigir um delta adicional.
