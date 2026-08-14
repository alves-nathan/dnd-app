# Compendium Import V2 — Phase 02

Baseline: `dnd-combat-math-mvp-import-v2-phase01-domain-audit-foundation`

## Objetivo

Executar as Etapas 4 e 5 do roadmap: normalização canônica e compatibilidade explícita V1 → V2, completando os fundamentos das Etapas 2 e 3 sem redirecionar ainda a persistência de produção.

## Resultado

A Phase 02 estabelece um único boundary canônico:

```text
V1 / legacy sem versão ─> parse V1 ─> migrateImportV1ToV2 ─┐
                                                             ├─> normalização ─> schema V2 ─> semantic validation
V2 ──────────────────────────────────────────────────────────┘
```

Depois de `parseImportPack()` nenhum consumidor precisa conhecer a versão original do arquivo.

## Arquivos criados

- `src/compendium/importVersions.ts`
  - concentra os identificadores V1/V2 sem dependência de Zod/UI;
- `src/compendium/importNormalization.ts`
  - adapters canônicos de aliases e estruturas legacy;
- `src/compendium/importV1Migration.ts`
  - boundary explícito V1 → V2;
- `src/compendium/parseImportPack.ts`
  - detecção de versão, parsing, migração, normalização, schema V2 e validação semântica;
- `src/tests/compendiumImportV2Normalization.test.ts`
  - regressões de normalização, migração e PHB 2024;
- `artifacts/compendium-import-v2-phase02-normalization-report.json`
  - evidência reproduzível do dry-run do PHB.

## Arquivos alterados

- `src/compendium/importDomain.ts`
  - promove tipos estruturados para `AbilityReference`, `DamageTypeReference`, `ActionTimingDetail`, `CastingTimeDefinition`, `TargetDefinition`, recovery de resources e velocidades condicionais;
- `src/compendium/importV2Schemas.ts`
  - passa a validar as formas canônicas estruturadas;
  - preço V2 deixa de aceitar string diretamente;
  - spell casting time deixa de ser reduzido a `ActionCost`;
- `src/compendium/importVersion.ts`
  - usa módulo de versões sem dependências;
- `src/compendium/importTemplate.ts`
  - mantém export compatível do identificador V1 usando o módulo central;
- `src/tests/compendiumImportV2Foundation.test.ts`
  - atualiza fixtures para o V2 canônico;
- `package.json`
  - adiciona scripts de teste da Phase 02;
- `docs/ROADMAP_COMPENDIUM_IMPORT_V2.md`
  - marca Etapas 2–5 como concluídas.

## Normalizações implementadas

### Action economy

Aliases do pacote existente são convertidos para `ActionCost` do runtime e a semântica extra é preservada em `actionTiming`.

Exemplos:

- `magicAction` → `action` + subtype `magicAction`;
- `passive` → `free` + subtype `passive`;
- `attackReplacement` → `special` + subtype `attackReplacement`;
- triggers como `freeOnceOnCasterTurn` preservam o trigger original.

### Casting time

Casting time de spell agora consegue representar:

- Action / Bonus Action / Reaction;
- duração em minutos/horas/dias;
- trigger especial;
- alternativa ritual;
- valor original para auditoria.

No PHB atual, após migração:

- 336 spells → casting time por action economy;
- 55 spells → casting time por duração.

### Abilities

- aliases são normalizados para STR/DEX/CON/INT/WIS/CHA;
- `STR_OR_DEX` vira escolha explícita;
- `spellcastingAbility` vira referência estruturada;
- `sameAsAttackAbility` vira referência estruturada;
- valores variáveis são preservados, não descartados.

### Skills

Nomes são normalizados contra as 18 skills canônicas, eliminando diferenças de caixa, espaços e hífens.

### Damage types

- tipos simples usam `DamageType` canônico;
- múltiplos tipos são estruturados;
- choices são estruturadas;
- `sameAsWeapon`, `sameAsAttack` e `sameAsTrigger` viram referências explícitas;
- expressões ainda não formalizáveis viram `custom`/`variable`, preservando o valor original e gerando warning.

### Currency

Preços V1 como `1 SP` e `1,500 GP` passam para:

```json
{ "amount": 1, "unit": "SP" }
```

No modelo canônico V2, item cost não aceita mais string como representação principal.

### Equipment options

Listas legacy como:

```json
["Greataxe", "4 Handaxes", "15 GP"]
```

são promovidas para:

```json
{
  "items": ["Greataxe", "4 Handaxes"],
  "currency": [{ "amount": 15, "unit": "GP" }]
}
```

### Resources

- `maxByLevel` → `ResourceScaling(kind=classLevel)`;
- `maxFormula` e `max: "PB"` → scaling custom;
- regras parciais de recuperação são preservadas em `recoveryRules`;
- objetos vazios de `resource` são tratados como ausência, sem inventar recurso.

### Scaling

Aliases como `characterLevelBeams`, `slotLevelDuration`, `slotTier` e `druidLevel` são promovidos aos kinds canônicos, mantendo o subtype original.

### Spell classes

`classes` permanece para compatibilidade atual e é enriquecido com `classIds` quando a classe existe no mesmo pacote.

No PHB atual: 391/391 spells tiveram seus class IDs resolvidos.

### Creature speed

Velocidades condicionais deixam de ser strings soltas. Exemplo:

```text
"60 if spellLevel >= 4"
```

vira uma estrutura com valor, condição e valor original.

## Dry-run PHB 2024

Fixture: `phb-2024-full-consolidated-import-pack-v5-complete-invocations.json`

Resultado da migração em memória:

- itens de entrada: 1.284;
- itens V2: 1.284;
- IDs únicos: 1.284;
- kinds: 13;
- erros estruturais no harness: 0;
- missing feature references: 0;
- missing subclass owners: 0;
- wrong-kind feature references: 0;
- missing class references: 0;
- unresolved spell class IDs: 0;
- item costs ainda em string após normalização: 0;
- `maxByLevel`/`maxFormula` de resource restantes: 0;
- creature speed condicionais estruturadas: 11.

O normalizador gerou warnings apenas onde a estrutura atual não permite uma tradução completamente semântica sem preservar contexto adicional. O valor original permanece disponível nas formas estruturadas.

## Validação executada neste ambiente

- TypeScript estrito isolado dos módulos dependency-free: PASS;
- transpile/syntax dos novos módulos e testes: PASS;
- dry-run real dos 1.284 itens PHB: PASS;
- referência semântica básica do PHB: PASS;
- `check-project-shape.js`: PASS;
- `check-accessibility-contracts.js`: PASS;
- bundled compendium: PASS — 1.284/1.284 IDs;
- APP-30 contract check: PASS;
- APP-30 isolated typecheck: PASS.

Jest completo e o `tsc --noEmit` do projeto dependem de `node_modules` e devem ser executados na máquina de desenvolvimento.

## Compatibilidade / risco

O importer de produção (`importer.ts` → mapper/storage) continua inalterado nesta fase. Portanto:

- personagens existentes não são migrados;
- banco local não é recriado;
- V1 continua sendo aceito pelo caminho existente;
- o novo `parseImportPack()` está pronto para ser conectado somente depois dos gates de validação semântica e preview/diff.

## Próximo passo

Etapa 6 — validação semântica completa:

1. progressions e ownership class/subclass;
2. spell `classIds`, levels e spellcasting relationships;
3. feature prerequisites/references;
4. condition references;
5. equipment/weapon invariants;
6. resource/action invariants;
7. severity error/warning/info com paths;
8. relatório PHB semântico reproduzível.

Depois disso, Etapa 7 implementará preview/diff/hash/upsert antes de conectar o pipeline V2 à persistência.
