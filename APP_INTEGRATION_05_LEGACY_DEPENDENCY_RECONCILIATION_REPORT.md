# APP-INTEGRATION-05 — Legacy Dependency Reconciliation

Status: **PASS_WITH_TWO_DEFERRED_MONSTER_BASES**

## Objetivo

Reconciliar dependências legacy residuais do catálogo runtime no perfil `2024-first+legacy`, preferindo entidades já disponíveis no PHB 2024 e evitando importar PHB/DMG/MM/Xanathar completos sem necessidade funcional.

## Alterações executadas

### Spelljammer 2022

Foi criado um artefato runtime derivado `spelljammer-2022-2024-compatible-import-pack-v2-canonical.json` mantendo o **mesmo pack id lógico** (`spelljammer-2022-full-consolidated-import-pack-v1`) para upgrade in-place.

- 55 referências PHB 2014 únicas foram mapeadas para PHB 2024;
- 169 ocorrências foram reescritas;
- feats Magic Initiate, Skilled e Tough agora usam as entidades PHB 2024;
- spell references de stat blocks e adventure mechanics agora usam as entidades PHB 2024;
- o stale runtime asset anterior foi removido do bundle.

Correções de evidência da fonte realizadas ainda no estágio canônico:

- Astral Elf Commander: OCR corrompido foi corrigido para `teleport` 2/day;
- Psurlon: `mechanics.spellRefs` foi reconciliado para `disguise self`, `mage armor` e `suggestion`;
- nenhum ID malformado `teleport-t-ee-astral-elves` ou `mage-armor-day-suggestion` permanece no runtime profile.

O upgrade de uma instalação que já possuía o Spelljammer anterior foi simulado pelo runtime real:

- creates: 0;
- updates: 27;
- conflicts: 0;
- item count preservado;
- replay: 182/182 unchanged.

### Tasha 2020

O builder `2024-first` passou a resolver automaticamente referências legacy que possuem equivalente já presente no PHB 2024:

- Zombie -> PHB 2024 Zombie;
- Skeleton -> PHB 2024 Skeleton;
- Cat -> PHB 2024 Cat;
- Giant Spider -> PHB 2024 Giant Spider;
- Potion of Healing -> PHB 2024 Potion of Healing;
- Exhaustion -> PHB 2024 Exhaustion.

Com isso, a dependência executável de Circle of Spores/Fungal Infestation sobre Zombie não exige mais Monster Manual 2014.

As 21 referências DMG/MM ainda presentes em Tasha aparecem exclusivamente em `payload.references[]`: são referências de consulta/display e não owners, stat blocks necessários, spell refs ou dependências de execução.

### Forge 2025

O staging canônico agora corrige o slug antigo `phb-2024-spell-hunters-mark` para a entidade realmente instalada `phb-2024-spell-hunter-s-mark`.

## Auditoria residual

Após a reconciliação, foram classificados 34 usos externos residuais / 26 IDs únicos:

- **runtime-required:** 2 IDs únicos;
- **display-only:** 22 IDs únicos;
- **provenance-only:** 2 IDs únicos;
- **XGtE residual:** 0;
- **PHB 2014 fora de proveniência:** 0;
- **IDs OCR/slug malformados:** 0.

Os dois únicos `runtime-required` remanescentes são:

1. `mm-2014-creature-mage` — base do Aarakocra Spelljammer Variant;
2. `mm-2014-creature-flumph` — base do Flapjack Variant.

Não é necessário importar o DMG 2014, o MM 2014 completo ou Xanathar para fechar o catálogo atual. Esses dois stat blocks devem vir preferencialmente do Monster Manual corrente e, se essa fonte não estiver disponível, podem ser cobertos por um delta legacy mínimo de duas criaturas.

## Gates executados

- `compendium:books:stage:check`: PASS;
- `compendium:legacy:spelljammer:2024:adapt:check`: PASS;
- `compendium:legacy:spelljammer:2024:upgrade:check`: PASS;
- `compendium:legacy:2024:adapt:check`: PASS;
- `compendium:legacy:phb2014:delta:check`: PASS;
- `compendium:legacy:dependencies:audit:check`: PASS;
- `compendium:books:integration:check`: PASS;
- `compendium:legacy:2024:smoke`: 24/24 PASS;
- `custom-feat-feature:smoke`: 5/5 PASS;
- `compendium:bundled:check`: PASS;
- `compendium:import-v2:release-gate`: PASS;
- `typescript:syntax:check`: PASS (442 files);
- `check:shape`: PASS;
- `check:a11y`: PASS.

Jest completo não foi executado nesta rodada porque o pacote distribuído continua sem `node_modules`; os harnesses determinísticos adicionados ao release gate cobrem a transformação, upgrade e auditoria residual.

## Catálogo runtime após APP-INTEGRATION-05

O total permanece **1.989 itens / 5 packs**. O objetivo deste gate foi reconciliação de IDs e dependências, não adição de conteúdo.

## Próximo passo

**APP-INTEGRATION-06 — Monster dependency closure**: materializar apenas os stat blocks atuais de Mage e Flumph e remapear as duas variantes de Spelljammer, mantendo a política 2024-first e sem importar um Monster Manual inteiro desnecessariamente.
