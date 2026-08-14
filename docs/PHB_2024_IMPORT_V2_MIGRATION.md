# PHB 2024 — Migração formal para dnd-combat-import.v2

## Objetivo

Materializar o pacote PHB 2024 atualmente distribuído em V1 como um artefato V2 canônico, reproduzível e auditável, sem substituir automaticamente o compêndio local e sem alterar referências de personagens.

## Fonte preservada

```text
assets/compendium/phb-2024-full-consolidated-import-pack-v5-complete-invocations.json
```

O arquivo continua no projeto como fonte legada/compatibilidade.

## Artefato V2

```text
assets/compendium/phb-2024-full-consolidated-import-pack-v2-canonical.json
assets/compendium/phb-2024-full-consolidated-import-pack-v2-canonical.json.sha256
```

O `id` do pack foi mantido como `phb-2024-full-consolidated-import-pack-v5-complete-invocations` para não transformar a mudança de formato em um novo pacote lógico.

## Garantias verificadas

- 1.284 itens de entrada e 1.284 de saída;
- 1.284 IDs preservados;
- 13 entity kinds preservados;
- 1.284 nomes preservados;
- 1.284 source IDs por item preservados;
- 1.284 hashes semânticos preservados entre a migração V1 normalizada e o V2 formal;
- 0 erros semânticos;
- 0 warnings semânticos;
- `_importMeta` preservado em `item.metadata.legacyImport` nos 1.284 itens;
- `extractionInstructions` e `consolidationMeta` movidos para `metadata.legacyExtensions`;
- geração determinística com SHA-256 verificável.

## Distribuição por kind

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

## Comandos

Gerar novamente o artefato e o relatório:

```bash
npm run compendium:import-v2:phb:migrate
```

Verificar se os arquivos committed continuam exatamente iguais ao resultado reproduzível da migração:

```bash
npm run compendium:import-v2:phb:check
```

## Compatibilidade e cutover

Esta fase **não troca** `BUNDLED_COMPENDIUM_PACKS`. O bootstrap continua usando o asset V1 para evitar alterar o caminho de produção antes da regressão funcional completa de criação, custom background, progressão, spellcasting e combate.

A Phase 09 usará o artefato V2 como fixture principal dessas regressões. Somente depois desses gates o cutover poderá apontar o bootstrap para V2.
