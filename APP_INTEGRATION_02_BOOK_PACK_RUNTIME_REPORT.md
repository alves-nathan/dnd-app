# APP-INTEGRATION-02 — Book Pack Runtime Integration

## Status

**PASS parcial com bloqueio explícito de dependência legacy para Tasha.**

A codebase atual foi usada como baseline. Forge of the Artificer 2025 e Spelljammer 2022 foram convertidos para `dnd-combat-import.v2`, validados, exercitados no preview/upsert real do app e adicionados ao bundle nativo para instalações novas. Tasha 2020 também foi convertido para V2 estruturalmente válido, mas permanece propositalmente fora do bundle automático até existirem os owners do PHB 2014 exigidos pelas subclasses/features legacy.

## Resultado do runtime de importação

| Etapa | Resultado |
| --- | --- |
| PHB 2024 bundled | 1.284 creates, válido |
| Forge 2025 | 200 creates, 0 conflicts, válido |
| Spelljammer 2022 | 182 creates, 0 conflicts, válido |
| Snapshot após os três packs válidos | **1.666 itens / 3 packs** |
| Replay Forge | 0 creates / 0 updates / **200 unchanged** |
| Replay Spelljammer | 0 creates / 0 updates / **182 unchanged** |
| Tasha 2020 | bloqueado atomicamente; snapshot não alterado |
| Blockers Tasha | **233 erros de owner → 13 IDs legacy ausentes** |

Os 13 owners são as 12 classes do PHB 2014 e `phb-2014-subclass-ranger-beast-master`. Não foi criado alias PHB 2014 → PHB 2024, porque isso alteraria progressão/semântica legacy.

## Remediações realizadas no importador

1. **V1 explícito passa pela fronteira V2.** `compendiumStore` agora roteia arquivos `dnd-combat-import.v1` versionados pelo pipeline V1→V2/preview/upsert; apenas payload realmente não-versionado usa a rota legacy histórica.
2. **Resources legacy não são mais descartados por falta de ID.** IDs determinísticos são gerados e fórmulas comuns são promovidas para scaling V2. Foram preservados 9 resources de Forge e 44 de Tasha que antes poderiam cair na normalização.
3. **Scaling é materializado no personagem.** O mapper entende PB, class/character-level steps e ability modifier para `ResourcePool.maximum`.
4. **Idempotência cross-pack corrigida.** O preview não reinterpreta cada spell instalada usando classes de outros livros; Forge e Spelljammer agora reproduzem 100% `unchanged` na segunda importação.
5. **Shapes legacy de Tasha foram normalizados sem perda mecânica:**
   - 46 owner IDs opcionais vazios removidos;
   - 19 `levelGained: null` omitidos sem inventar nível;
   - 10 objetos de ASI de feats convertidos para array V2 com aliases `abilities`/`max` para o runtime; 5 objetos ASI vazios omitidos;
   - escolhas de equipamento do Artificer preservadas em `legacyEntries`/extensions em vez de serem achatadas incorretamente;
   - `goldAlternative.currency: "gp"` preservado como `currencyUnit` porque `currency` V2 é reservado a `CurrencyValue[]`;
   - resistências condicionais do Elemental Spirit preservadas como `conditionalResistances`, sem convertê-las em resistências incondicionais.
6. **PHB 2024 V2 foi regenerado com o normalizador atualizado.** 65 itens mudaram apenas em forma canônica (por exemplo, `PB` custom → `proficiencyBonus` e remoção de arrays vazios); a auditoria confirmou **1.284/1.284 semantic hashes preservados**.

## Validação estrutural

Os três packs V2 passaram sem erros em `docs/dnd-combat-import-v2.schema.json`:

- Forge: 200/200, 0 schema errors.
- Spelljammer: 182/182, 0 schema errors.
- Tasha: 475/475, 0 schema errors.

O relatório reproduzível está em `artifacts/compendium/integration/schema-validation-report.json`.

## Bundle nativo

`BUNDLED_COMPENDIUM_PACKS` agora contém, nesta ordem:

1. PHB 2024 — 1.284 itens;
2. Forge of the Artificer 2025 — 200 itens;
3. Spelljammer: Adventures in Space 2022 — 182 itens.

Assim, um compêndio realmente vazio é inicializado com **1.666 itens**. A política de segurança existente foi mantida: instalações com compêndio persistido não recebem silenciosamente novos bundles; nesses casos, os novos packs devem entrar pelo fluxo explícito de catálogo/importação.

Tasha foi **intencionalmente excluído** de `BUNDLED_COMPENDIUM_PACKS` até o core legacy ser instalado.

## Gates executados

- `node scripts/stage-extracted-book-packs-v2.js --check` — **PASS**
- `node scripts/check-extracted-book-pack-integration.js` — **PASS**
- `node scripts/check-bundled-compendium.js` — **PASS** para PHB + Forge + Spelljammer e IDs globais sem colisão
- `npm run compendium:import-v2:release-gate` — **PASS**
- `node scripts/check-project-shape.js` — **PASS**
- `tsc --noEmit ... importNormalization.ts importPreview.ts` — **PASS**
- transpile syntax check de `bundledCompendium.ts`, `compendiumStore.ts` e `mapper.ts` — **PASS**
- JSON Schema Draft 2020-12 dos três packs — **PASS**

### Jest/typecheck completo

O ZIP enviado não contém `node_modules`. `npm ci --offline` não pôde restaurar as dependências (`ENOTCACHED` para `react-native`), portanto **não foi alegado um novo Jest completo nesta execução**. Foram adicionados testes Jest de regressão para a normalização, scaling, idempotência cross-pack, parse Zod dos três packs staged e comportamento de Tasha; eles ficam prontos para execução assim que `npm ci` puder acessar o registry/cache completo.

## Arquivos principais adicionados

- `scripts/stage-extracted-book-packs-v2.js`
- `scripts/check-extracted-book-pack-integration.js`
- `src/tests/extractedBookPackIntegration.test.ts`
- `artifacts/compendium/integration/source-v1/*`
- `artifacts/compendium/integration/v2/*`
- `artifacts/compendium/integration/stage-report.json`
- `artifacts/compendium/integration/runtime-integration-report.json`
- `artifacts/compendium/integration/schema-validation-report.json`
- `assets/compendium/forge-artificer-2025-full-consolidated-import-pack-v2-canonical.json`
- `assets/compendium/spelljammer-2022-full-consolidated-import-pack-v2-canonical.json`

## Próximo passo — APP-INTEGRATION-03

Adicionar o **core legacy PHB 2014** necessário ao grafo de Tasha, mantendo IDs legacy separados do PHB 2024. O gate mínimo para desbloqueio é materializar as 12 classes `phb-2014-class-*` e `phb-2014-subclass-ranger-beast-master` com progressões reais; o caminho recomendado é importar/extrair o PHB 2014 completo para também resolver as dependências de spells/feats/equipment de Tasha e outros livros legacy. Depois disso: preview de Tasha → upsert transacional → smoke de subclass/optional feature/feat/summon/magic item/sidekick → Jest/typecheck completo.
