# Roadmap de execução — Prompt-Mestre de extração D&D → D&D Combat Math

## Objetivo

Executar o contrato `dnd-combat-import.v1` sobre os três livros recebidos, produzindo lotes JSON autossuficientes, mecanicamente completos dentro de cada escopo, auditáveis e consolidáveis sem mudança de IDs.

Fontes recebidas:

- **Eberron: Forge of the Artificer** — PDF de 162 páginas; regras 2024/publicação 2025.
- **Spelljammer: Adventures in Space** — PDF bundle de 204 páginas; material legacy/compatível com 2024, com páginas predominantemente rasterizadas e necessidade de inspeção visual sistemática.
- **Tasha’s Cauldron of Everything** — PDF de 194 páginas; material legacy 2020.

## Decisões de normalização antes da extração

1. `kind` será estritamente limitado aos valores do Prompt-Mestre.
2. Mecânicas sem `kind` dedicado, como veículos, navios, Bastion Facilities, hazards, group patrons e regras opcionais, serão representadas como `feature`, com subtipo dentro de `payload.mechanics`/`payload.sourceType` quando útil.
3. `actionCost` usará somente `action`, `bonusAction`, `reaction`, `movement`, `free` ou `special`.
4. Uma **Magic action** das regras 2024 será serializada como `actionCost: "action"` + `mechanics.magicAction: true`.
5. Uma feature passiva será `actionCost: "free"` + `mechanics.passiveFeature: true`; não será usado `actionCost: "passive"`.
6. Features de subclasse serão `kind: "feature"`, sempre com `classId` e `subclassId`; o subtipo será preservado em `sourceType`/`mechanics` sem inventar um novo `kind`.
7. Conteúdo 2024 e legacy coexistirá com IDs diferentes; nenhuma regra legacy será silenciosamente atualizada para 2024.
8. Referências para entidades de outro lote serão explicitamente declaradas como dependências cross-batch; IDs serão fixados desde a primeira emissão.
9. Para conteúdo já extraído anteriormente, serão preservados `source.id` e IDs de entidades existentes sempre que correspondam à mesma entidade; o lote Forge inicia reutilizando o namespace `forge-artificer-2025`.
10. Resumos serão paráfrases mecânicas; números, fórmulas, listas, requisitos, progressões e relações serão preservados.
11. Todo lote terá validação estrutural antes de ser considerado concluído.

## Ordem global

### Fase 0 — Contrato e convenções — CONCLUÍDA

- Auditar Prompt-Mestre.
- Fixar semântica de `kind`, `actionCost`, IDs, refs, 2024 vs legacy e conteúdos sem tipo dedicado.
- Definir política de lotes e validação.

### Fase 1 — Inventário e mapa de cobertura — CONCLUÍDA

Criar matriz de cobertura por fonte, página, entidade e destino de modelagem.

Critérios:

- nada mecânico relevante pode ficar sem destino;
- conteúdo puramente editorial/lore/arte fica fora;
- tabelas narrativas só entram se alterarem regras, escolhas, recursos ou resolução de jogo.

### Fase 2 — Forge of the Artificer — CONCLUÍDA

Motivo: é a fonte mais atual, mais diretamente alinhada ao domínio 2024 e possui texto extraível de alta qualidade.

#### EFOTA-01 — Artificer core, progressão e features de classe — CONCLUÍDO NESTA EXECUÇÃO

Escopo: pp. 10–16.

Inclui:

- Core Artificer Traits;
- multiclass;
- progressão 1–20;
- spellcasting progression;
- Tinker’s Magic;
- Replicate Magic Item, incluindo 56 planos;
- escolha de subclasse;
- ASI;
- Magic Item Tinker;
- Flash of Genius;
- Magic Item Adept;
- Spell-Storing Item;
- Advanced Artifice;
- Magic Item Master;
- Epic Boon;
- Soul of Artifice.

Saída: `forge-artificer-2025-part-01-artificer-core.json`.

#### EFOTA-02 — Artificer spell list + Homunculus Servant — CONCLUÍDO NESTA EXECUÇÃO

Escopo aproximado: pp. 17–19 e 29.

- índice completo da lista de Artificer;
- flags de concentração/ritual/material quando presentes;
- magia Homunculus Servant;
- stat block escalável do Homunculus Servant;
- links conscientes para spells já existentes no PHB 2024.

Resultado desta execução:

- 80 entradas na lista de Artificer (17/14/22/11/10/6 por nível 0–5);
- 79 referências externas para spells já existentes no catálogo PHB 2024, sem duplicação;
- 1 nova spell materializada: `forge-artificer-2025-spell-homunculus-servant`;
- 1 `creatureStatBlock` escalável e ligado bidirecionalmente à spell;
- saída: `forge-artificer-2025-part-02-artificer-spells.json`;
- validação: `forge-artificer-2025-part-02-validation.md`.

#### EFOTA-03 — Subclasses do Artificer — CONCLUÍDO NESTA EXECUÇÃO

Escopo: pp. 20–28 (a p. 29, Homunculus Servant, já pertence ao EFOTA-02).

Resultado desta execução:

- 5 subclasses: Alchemist, Armorer, Artillerist, Battle Smith e Cartographer;
- 33 subclass features mecanicamente estruturadas;
- 1 `creatureStatBlock`: Steel Defender;
- Eldritch Cannon modelado dentro de `feature.mechanics.objectStatBlock`, sem criar `kind` fora do contrato;
- progressões de features 3/5/9/15 e spell grants 3/5/9/13/17;
- diferenças da versão Forge 2025 preservadas sem misturar regras legacy de Tasha;
- `Superior Atlas` conferido visualmente na p. 28;
- saída: `forge-artificer-2025-part-03-artificer-subclasses.json`;
- validação: `forge-artificer-2025-part-03-validation.md`.

#### EFOTA-04 — Dragonmarks, backgrounds, species e feats — CONCLUÍDO NESTA EXECUÇÃO

Escopo: pp. 30–56.

Resultado desta execução:

- 1 regra compartilhada de criação/aquisição de Dragonmarks;
- 17 backgrounds;
- 5 species revisadas: Changeling, Kalashtar, Khoravar, Shifter e Warforged;
- 19 species trait features;
- 28 feats: 13 Dragonmark, 14 General e 1 Epic Boon;
- todas as escolhas de proficiência, tamanho, Shifting, spellcasting ability, spell choice e house affiliation mecanicamente relevantes estruturadas;
- Spells of the Mark e spell grants ligados por IDs PHB 2024 como dependências externas conscientes;
- saída: `forge-artificer-2025-part-04-character-options.json`;
- validação: `forge-artificer-2025-part-04-validation.md`.

#### EFOTA-05 — Bastions e special facilities — CONCLUÍDO NESTA EXECUÇÃO

Escopo aproximado: pp. 57–63.

- Mobile Bastions;
- dez Special Facilities;
- ordens, prerequisitos, custos, hirelings e tabelas de construção/recrutamento.

Modelagem: `kind: "feature"`, `sourceType/mechanics.bastionFacility`.

Resultado EFOTA-05:

- 1 regra estrutural de **Mobile Bastions**;
- 10 Special Facilities, cobrindo integralmente a tabela das pp. 58–63;
- Construct Forge com 8 opções de Construct, tempos e custos;
- Manifest Zone com 11 Manifest Charms;
- Museum com 5 Charms por origem, Research e expansão da instalação;
- viagens estruturadas para Lyrandar Helm, Navigator’s Helm e Orien Helm;
- dependências externas de DMG/MM/Eberron declaradas sem duplicação;
- saída: `forge-artificer-2025-part-05-bastions.json`;
- validação: `forge-artificer-2025-part-05-validation.md`.

#### EFOTA-06 — Campaign systems e stat blocks — CONCLUÍDO NESTA EXECUÇÃO

Escopo: pp. 64–120.

- somente subsistemas reutilizáveis e mecânicas de campanha;
- todos os stat blocks mecanicamente relevantes;
- omitir lore extensa e aventura puramente narrativa.

Resultado EFOTA-06:

- 42 registros: 17 `feature` + 25 `creatureStatBlock`;
- sistema completo de Dragonmarked House Renown + perks específicos das 13 casas;
- benefícios de patrono de Morgrave University;
- Inquisitive Agency patron e tabela Xen’drik Journeys;
- todos os 25 novos stat blocks dos capítulos 4–6;
- saída: `forge-artificer-2025-part-06-campaign-mechanics.json`;
- validação: `forge-artificer-2025-part-06-validation.md`.

#### EFOTA-07 — Elemental Airships — CONCLUÍDO NESTA EXECUÇÃO

Escopo: pp. 121–134.

- operação de airships;
- combate;
- Lyrandar Air Cruiser, Lyrandar Skyskiff, Strider Airship;
- crew stations, movimento, AC/HP, cargo, crew, attacks e upgrades.

Modelagem: `kind: "feature"` para veículos/ships, com schema mecânico de veículo em `payload.mechanics`.


Resultado EFOTA-07:

- 12 registros `feature`, normalizando regras, veículos, estações e upgrades sem criar `kind` fora do contrato;
- operação completa: crew stations, Helm, emergency repairs, crashes e elemental engine/wind wards;
- combate aéreo e boarding;
- 3 veículos completos: Lyrandar Air Cruiser, Lyrandar Skyskiff e Strider Airship;
- 3 upgrade stations: Elemental Thrusters, Repair Clamps e Sky Veil;
- sistema de upgrades de AC/HP/crew stations;
- viagens aéreas com 6 condições de viagem, d10 Airborne Encounters e d4 Environmental Hazards;
- 6/6 dependências cross-batch resolvidas;
- saída: `forge-artificer-2025-part-07-airships.json`;
- validação: `forge-artificer-2025-part-07-validation.md`.

#### EFOTA-08 — Magic Items — CONCLUÍDO NESTA EXECUÇÃO

Escopo aproximado: pp. 135–144.

- todos os novos magic items;
- attunement, charges, actions, reactions, bônus e requisitos.

Resultado EFOTA-08:

- 9/9 magic items do apêndice (pp. 136–144);
- raridade, Attunement/prerequisites, +1 bonuses, charges e recharges;
- Bonus Actions e Reactions estruturadas;
- Dazzling Weapon ligado a `phb-2024-condition-blinded`;
- 9/9 planos correspondentes de Replicate Magic Item ligados por `itemId` ao EFOTA-08;
- páginas 145–162 excluídas por serem apenas Art of Eberron, sem regras;
- saída: `forge-artificer-2025-part-08-magic-items.json`;
- validação: `forge-artificer-2025-part-08-validation.md`.

#### EFOTA-09 — Auditoria e consolidação Forge — CONCLUÍDO NESTA EXECUÇÃO

Resultado EFOTA-09:

- **200 registros / 200 IDs únicos** consolidados;
- validação de `kind`, `actionCost`, `engineKey`, páginas/fontes e referências cross-batch;
- progressão do Artificer 1–20 e das 5 subclasses auditada;
- índice completo de **27 creature stat blocks** conferido (Homunculus + Steel Defender + 25 NPCs);
- **80** entradas da Artificer Spell List e **56** planos de Replicate Magic Item auditados;
- **17 backgrounds** promovidos para os campos canônicos exigidos pelo fluxo atual de criação;
- **28 feats** com envelope canônico completo;
- Steel Defender normalizado para a forma canônica de `creatureStatBlock`;
- 10 Special Facilities, 3 airships e 9 magic items conferidos;
- dependências PHB/DMG/MM/Eberron mantidas externas e explícitas;
- saída consolidada: `forge-artificer-2025-full-consolidated-import-pack-v1.json`;
- validação final: `forge-artificer-2025-part-09-audit-validation.md`.

**Fase Forge of the Artificer: CONCLUÍDA.**


### Estado atual do roadmap

- **Forge of the Artificer:** extração, auditoria e consolidação concluídas.
- Pack recomendado: `forge-artificer-2025-full-consolidated-import-pack-v1.json`.
- SPELLJAMMER-01: concluído e validado estruturalmente.
- SPELLJAMMER-02: concluído e validado estruturalmente.
- SPELLJAMMER-03: concluído e validado estruturalmente.
- SPELLJAMMER-04: concluído e validado estruturalmente.
- SPELLJAMMER-05: concluído e validado estruturalmente.
- SPELLJAMMER-06: concluído e validado estruturalmente com errata oficial aplicada ao escopo LoX.
- Próximo lote: **SPELLJAMMER-07 — Auditoria e consolidação**.

### Fase 3 — Spelljammer: Adventures in Space — CONCLUÍDA

A fonte é predominantemente visual; a execução será por blocos de páginas renderizados, com inspeção visual e transcrição mecânica seletiva, evitando OCR massivo.

#### SPELLJAMMER-01 — Character Options — CONCLUÍDO NESTA EXECUÇÃO

- Astral Drifter;
- Wildspacer;
- Astral Elf;
- Autognome;
- Giff;
- Hadozee;
- Plasmoid;
- Thri-kreen;
- feats ou regras concedidas pelos backgrounds.

Edição: `legacy`, preservando compatibilidade sem convertê-la para o modelo nativo de background 2024.


Resultado SPELLJAMMER-01:

- escopo conferido visualmente: Astral Adventurer’s Guide pp. 7–15 (PDF pp. 9–17);
- 2 backgrounds legacy: Astral Drifter e Wildspacer;
- 2 background features: Divine Contact e Wildspace Adaptation;
- 1 regra compartilhada de criação das espécies (ASI +2/+1 ou +1/+1/+1, idiomas);
- 6 species: Astral Elf, Autognome, Giff, Hadozee, Plasmoid e Thri-kreen;
- 28 species trait features mecanicamente estruturadas;
- Magic Initiate (Cleric) e Tough preservados como dependências PHB 2014, sem substituir pelas versões 2024;
- tipos não-Humanoid preservados: Autognome=Construct, Plasmoid=Ooze, Thri-kreen=Monstrosity;
- saída: `spelljammer-2022-part-01-character-options.json`;
- validação: `spelljammer-2022-part-01-character-options-validation.md`.

#### SPELLJAMMER-02 — Spelljamming core — CONCLUÍDO NESTA EXECUÇÃO

- gravity/air envelopes e regras de viagem;
- spelljamming helm;
- movement/travel;
- regras de combate de ships;
- hazards/regras espaciais mecanicamente relevantes.

Resultado SPELLJAMMER-02:

- escopo visual: Astral Adventurer’s Guide pp. 17–25 (PDF pp. 19–27);
- 17 features de regras ambientais, viagem, spelljamming e combate naval espacial;
- Air Envelopes, Air Quality, Gravity Planes, Drifting/Falling, Fire in Wildspace e Weightlessness estruturados;
- Astral travel/navigation, movimento por pensamento e Astral Fishing estruturados;
- Spelljammer Duels e operação do Spelljamming Helm estruturados sem duplicar o magic item futuro;
- Crew, Starting Encounter Distance, moving/steering, Boarding, Crashing e Ship Repairs estruturados;
- vínculo cross-batch de Wildspace Adaptation → Weightlessness acrescentado ao SPELLJAMMER-01;
- saída: `spelljammer-2022-part-02-spelljamming-core.json`;
- validação: `spelljammer-2022-part-02-spelljamming-core-validation.md`.

#### SPELLJAMMER-03 — Spells, equipment e magic items — CONCLUÍDO NESTA EXECUÇÃO

- magias exclusivas;
- itens, helms e equipamento mecanicamente relevante.

Resultado SPELLJAMMER-03:

- escopo visual: Astral Adventurer’s Guide pp. 22–23 (PDF pp. 24–25);
- 2 spells: Air Bubble e Create Spelljamming Helm;
- 3 magic items: Fish Suit, Spelljamming Helm e Wildspace Orrery;
- Air Bubble com classes, componentes, duração e upcasting de +2 alvos por nível de slot acima do 2º;
- Create Spelljamming Helm com material de 5.000 GP consumido e relação direta com o magic item criado;
- Spelljamming Helm ligado bidirecionalmente à feature operacional do SPELLJAMMER-02;
- nenhum equipment mundano criado porque a seção não apresenta entrada mecânica separada dessa categoria;
- saída: `spelljammer-2022-part-03-spells-equipment-magic-items.json`;
- validação: `spelljammer-2022-part-03-spells-equipment-magic-items-validation.md`.

#### SPELLJAMMER-04 — Ships — CONCLUÍDO NESTA EXECUÇÃO

- cada ship/vehicle como `feature` com estrutura de veículo em `mechanics`;
- AC, HP, threshold, speed, crew, cargo, weapons/stations e ações.


Resultado SPELLJAMMER-04:

- escopo visual: Astral Adventurer’s Guide pp. 26–57;
- **16/16 ships** materializados como `feature` / `spelljammingShip`;
- **9 ship weapons** reutilizáveis deduplicadas e referenciadas por ID;
- AC, HP, Damage Threshold, speeds, cargo, crew, keel/beam, cost e capacidades de água/terra/submersão estruturados;
- Bombard Giant Cannon, rams, Lamprey Grappling Jaws, Scorpion Claws, Nautiloid Tentacles/planar transport e Tyrant Eyestalk Cannons estruturados;
- Living Ship Treant e Turtle underwater rules preservados;
- deck plans referenciados por página e escala de 5 ft, sem inventar um novo `kind` de mapa;
- typo impresso “shrike ship” dentro do Piercing Ram do Squid registrado em `extractionNotes`;
- saída: `spelljammer-2022-part-04-ships.json`;
- validação: `spelljammer-2022-part-04-ships-validation.md`.

#### SPELLJAMMER-05 — Boo’s Astral Menagerie — CONCLUÍDO NESTA EXECUÇÃO

- todos os stat blocks de criaturas;
- ações, bonus actions, reactions, spellcasting, recharge, resistências e movimentos.

Resultado SPELLJAMMER-05:

- Boo’s Astral Menagerie pp. 4–64 processado;
- **72/72 creatureStatBlock**;
- 4 features de regras/tabelas introdutórias;
- 1 `magicItem` (`Talarith`) detectado dentro da seção do Reigar;
- Wildspace/Astral Sea/Ship encounter tables e Initial Attitude estruturados;
- SPELLJAMMER-02 atualizado para Astral Fishing → Space Eel/Gray Scavver por ID;
- saída: `spelljammer-2022-part-05-boos-astral-menagerie.json`;
- validação: `spelljammer-2022-part-05-boos-astral-menagerie-validation.md`.

#### SPELLJAMMER-06 — Light of Xaryxis — CONCLUÍDO NESTA EXECUÇÃO

- apenas entidades e regras mecanicamente reutilizáveis que não estejam cobertas pelos lotes anteriores;
- stat blocks exclusivos;
- hazards/itens/regras específicas quando aplicáveis.

Resultado SPELLJAMMER-06:

- Light of Xaryxis pp. 4–64 revisado com extração mecânica seletiva;
- **18 registros**: 1 `creatureStatBlock` + 17 `feature`;
- Astral Blight completo;
- Aarakocra Spelljammer e Flapjack representados como variantes sem duplicar Mage/Flumph;
- Crystalline Vine, pressão de Astral Blights e Avalanche of Debris estruturados;
- Lassoing and Riding a Kindori estruturado e ligado a Kindori/Gravity Planes;
- Doomspace e Xaryxispace modelados com tabelas de distância/travel;
- Arena Battles, Forming a Coalition, Coalition Fleet, fleet battle losses e Xaryxian crew loyalty estruturados;
- Astral Font, Trial by Combat, Zodar Dying Wish e Destruction of Xaryxis estruturados;
- **errata oficial atual aplicada** a facção Hadozee/T’kitka, Xaryxispace, Astral Font e desfecho de Xaryxis;
- NPCs que são apenas cópias nomeadas de MM/BAM não foram duplicados;
- saída: `spelljammer-2022-part-06-light-of-xaryxis.json`;
- validação: `spelljammer-2022-part-06-light-of-xaryxis-validation.md`.

#### SPELLJAMMER-07 — Auditoria e consolidação — CONCLUÍDO NESTA EXECUÇÃO

- consolidar SPELLJAMMER-01 a SPELLJAMMER-06;
- auditar IDs, referências internas/cross-batch, `kind`, `actionCost`, sources e versões;
- reconciliar **toda a errata oficial atual de Spelljammer** também nos lotes AAG/BAM anteriores antes do pack final;
- verificar criaturas renomeadas/alteradas, thresholds de spelljamming, species traits e outros valores da impressão antiga;
- gerar pack completo recomendado para importação e validação final.

Resultado SPELLJAMMER-07:

- SPELLJAMMER-01 a 06 consolidados;
- errata oficial de 2025-04-30 reconciliada em AAG/BAM/LoX;
- 181 registros pré-auditoria -> **182 registros finais** devido à regra de feat de background adicionada pela errata;
- Aartuk Starhorror/Weedling e Hadozee Dodge canonizados com aliases dos IDs anteriores;
- stat blocks afetados pela errata reestruturados e passados por revisão visual;
- auditoria cross-batch sem IDs duplicados, engineKeys duplicados ou referências Spelljammer quebradas;
- pack final: `spelljammer-2022-full-consolidated-import-pack-v1.json`;
- validação: `spelljammer-2022-part-07-audit-validation.md`.

**Spelljammer: Adventures in Space concluído.**

### Fase 4 — Tasha’s Cauldron of Everything — CONCLUÍDA

A fonte deve permanecer explicitamente `legacy`; não transformar classes/subclasses/features de 2020 em versões 2024.

#### TASHA-01 — Origin customization e regras de personagem — CONCLUÍDO

Escopo: pp. 7–8 impressas (pp. físicas 8–9 do PDF).

- Customizing Your Origin;
- Ability Score Increase reassignment;
- language replacement;
- proficiency swaps (5/5 linhas);
- Custom Lineage como `kind: species`;
- Changing a Skill;
- Changing Your Subclass, Training Time e Sudden Change.

Resultado: **7 registros** (6 `feature` + 1 `species`), todos legacy 2020, sem conversão silenciosa para 2024.

Arquivos: `tcoe-2020-part-01-origin-rules.json` e `tcoe-2020-part-01-origin-rules-validation.md`.

#### TASHA-02 — Artificer legacy — CONCLUÍDO

Escopo: pp. 9–23 impressas (pp. físicas 10–24 do PDF).

- classe Artificer legacy completa, níveis 1–20;
- Spellcasting e lista de **95 spells** por referência estável;
- Alchemist, Armorer, Artillerist e Battle Smith com progressões 3/5/9/15;
- Homunculus Servant e Steel Defender como stat blocks escaláveis;
- **16 Artificer Infusions**;
- Replicate Magic Item com **49 planos tabelados** + alternativa de Common magic item;
- coexistência explícita com o Artificer 2025 através do namespace `tcoe-2020-*`.

Resultado: **62 registros** (1 `class` + 4 `subclass` + 55 `feature` + 2 `creatureStatBlock`).

Arquivos: `tcoe-2020-part-02-artificer.json` e `tcoe-2020-part-02-artificer-validation.md`.

#### TASHA-03 — Optional Class Features — CONCLUÍDO

Escopo: seções de Optional Class Features nas pp. impressas 24–76, incluindo Primal Companion de Beast Master na p. 61.

- 12/12 classes do PHB 2014 cobertas;
- **8** expansões de spell list, com **122** entradas;
- **7** Fighting Styles deduplicados e ligados às classes elegíveis;
- **7** Battle Master maneuvers novos;
- **2** opções de Metamagic;
- Pact of the Talisman + **8** Eldritch Invocations;
- Ranger replacements/progression completos, incluindo Deft Explorer, Favored Foe, Primal Awareness, Nature’s Veil e Primal Companion;
- Beast of the Land/Sea/Sky como 3 stat blocks escaláveis;
- subclasses propriamente ditas permanecem para TASHA-04.

Resultado: **73 registros** (70 `feature` + 3 `creatureStatBlock`).

Arquivos: `tcoe-2020-part-03-optional-class-features.json` e `tcoe-2020-part-03-optional-class-features-validation.md`.

#### TASHA-04 — Subclasses — CONCLUÍDO

- 26/26 subclasses não-Artificer apresentadas/republicadas;
- 12/12 classes legacy cobertas;
- progressões e features por nível estruturadas;
- Dancing Item e Wildfire Spirit como stat blocks escaláveis.

Resultado: **178 registros** (26 `subclass` + 150 `feature` + 2 `creatureStatBlock`).

Arquivos: `tcoe-2020-part-04-subclasses.json` e `tcoe-2020-part-04-subclasses-validation.md`.

#### TASHA-05 — Feats — CONCLUÍDO

Escopo: seção **Feats**, pp. impressas 79-81.

- **15/15** feats materializados;
- prerequisites e ASIs estruturados;
- escolhas de spells, Fighting Styles, Metamagic e Eldritch Invocations modeladas como catálogos dinâmicos legacy;
- ações/regras de Chef, Poisoner e Telekinetic estruturadas;
- dependências PHB/DMG 2014 e cross-batch Tasha explícitas.

Resultado: **15 registros** (`feat`).

Arquivos: `tcoe-2020-part-05-feats.json` e `tcoe-2020-part-05-feats-validation.md`.

#### TASHA-06 — Spells + summon stat blocks — CONCLUÍDO

Escopo: capítulo 3, seção **Spells**, pp. impressas 105-116 (pp. físicas 106-117 do PDF).

- **21/21 spells** materializadas com IDs já reservados nos lotes anteriores;
- casting time, range, components/material costs, concentração, saves/attacks e scaling estruturados;
- **9 summon spells** ligados bidirecionalmente a **9 creatureStatBlock** escaláveis;
- variantes/formas de Aberrant, Bestial, Celestial, Construct, Elemental, Fey, Fiendish, Shadow e Undead Spirit preservadas;
- ações, Bonus Actions, Reactions, imunidades/resistências e fórmulas baseadas no nível do slot estruturadas;
- todos os **21 `tcoe-2020-spell-*`** previamente referenciados por TASHA-02/03/04/05 agora resolvem internamente no conjunto Tasha;
- Personalizing Spells e Traveling to Other Worlds não viraram entidades separadas por serem orientação cosmética/narrativa, enquanto as regras efetivas de Dream of the Blue Veil foram preservadas na própria spell.

Resultado: **30 registros** (21 `spell` + 9 `creatureStatBlock`).

Arquivos: `tcoe-2020-part-06-spells-summons.json` e `tcoe-2020-part-06-spells-summons-validation.md`.

#### TASHA-07 — Magic Items — CONCLUÍDO NESTA EXECUÇÃO

- todos os itens mágicos/tattoos/artifacts mecanicamente relevantes.
- Regras compartilhadas de Magic Tattoos normalizadas como `feature`.
- Mighty Servant of Leuk-o: artifact + stat block de combate ligado por ID.
- Teeth of Dahlver-Nar: tabela integral de 20 dentes estruturada.

Resultado: **49 registros** (47 `magicItem` + 1 `feature` + 1 `creatureStatBlock`).

Arquivos: `tcoe-2020-part-07-magic-items.json` e `tcoe-2020-part-07-magic-items-validation.md`.

#### TASHA-08 — Sidekicks — CONCLUÍDO NESTA EXECUÇÃO

- Expert, Spellcaster e Warrior como estruturas de classe/feature compatíveis com o contrato;
- progressões completas 1–20;
- framework de elegibilidade e aplicação a criaturas-base.

Resultado TASHA-08:

- **29 registros**: 3 `class` + 26 `feature`;
- regra geral de sidekick: criatura com stat block e CR 1/2 ou menor, vínculo de amizade/confiança, classe escolhida para a carreira, nível inicial igual ao nível médio do grupo e progressão sincronizada ao grupo;
- Hit Die herdado do stat block-base, ganho de HP por nível, death saves, PB 1–20 e propagação de ASI para valores derivados do stat block;
- Expert completo com Helpful, Cunning Action, Expertise, Coordinated Strike, Evasion, Inspiring Help, Reliable Talent e Sharp Mind;
- Spellcaster completo com Mage/Healer/Prodigy, cantrips/spells known e slots de 1º–5º círculo em todos os 20 níveis;
- Warrior completo com Martial Role, Second Wind, Improved Critical, Extra Attack, Battle Readiness, Improved Defense e Indomitable;
- saída: `tcoe-2020-part-08-sidekicks.json`;
- validação: `tcoe-2020-part-08-sidekicks-validation.md`.

#### TASHA-09 — Group Patrons — CONCLUÍDO NESTA EXECUÇÃO

Escopo retroativo de cobertura: capítulo 2, pp. impressas 83-104. O capítulo havia ficado sem lote dedicado no roadmap inicial, apesar de `group patrons` já estarem previstos pela política de normalização como `kind: feature`.

- How Patrons Work;
- Academy, Ancient Being, Aristocrat, Criminal Syndicate, Guild, Military Force, Religious Order e Sovereign;
- perks, contacts, assignments, roles e outras regras mecanicamente reutilizáveis;
- Being Your Own Patron quando gerar efeitos/estrutura mecânica aplicável.

Resultado TASHA-09:

- **11 registros `feature`**, incluindo framework geral, Group Assistance, 8 patronos e Being Your Own Patron;
- 8/8 patronos com tabelas completas de type/contact/role/assignment;
- Academy, Ancient Being, Aristocrat, Criminal Syndicate, Guild, Military Force, Religious Order e Sovereign com perks numericamente estruturados;
- Group Assistance preserva advantage 1/Long Rest por membro sem inventar action economy;
- Being Your Own Patron preserva Running a Business coletivo, máximo +30 no performance roll e multiplicador de lucro `4 + participantes`;
- p. impressa 104 confirmada como arte integral, sem mecânica adicional;
- saída: `tcoe-2020-part-09-group-patrons.json`;
- validação: `tcoe-2020-part-09-group-patrons-validation.md`.

#### TASHA-10 — DM tools mecanicamente relevantes — CONCLUÍDO NESTA EXECUÇÃO

Escopo: pp. impressas 148-170 (pp. físicas 149-171).

- Parleying with Monsters + Monster Research/Desires;
- framework de Supernatural Regions + 7 regiões e suas tabelas d100 completas;
- Magical Phenomena: Eldritch Storms, Emotional Echoes, Enchanted Springs, Magic Mushrooms, Mimic Colonies, Primal Fruit e Unearthly Roads;
- Juvenile Mimic como `creatureStatBlock`;
- Natural Hazards: Avalanches, Falling into Water, Falling onto a Creature e 23 equivalências de hazards por spells;
- `Awaken Any Thing` omitido por ser orientação sem regra fixa;
- puzzles iniciados na p.171 permanecem fora do compêndio mecânico.

Resultado: **21 registros** (20 `feature` + 1 `creatureStatBlock`).

Arquivos: `tcoe-2020-part-10-dm-tools.json` e `tcoe-2020-part-10-dm-tools-validation.md`.

#### TASHA-11 — Auditoria e consolidação — CONCLUÍDO

Resultado final:

- **475 registros / 475 IDs únicos** consolidados;
- errata oficial de Tasha reconciliada sem alterar IDs estáveis;
- **0** referências internas de entidade quebradas;
- **0** `actionCost` inválidos;
- **0** `engineKey` duplicados;
- dependências externas PHB/DMG/MM 2014 e XGtE 2017 preservadas por ID;
- sobreposições de Artificer com Forge 2025 preservadas como versões distintas;
- pack final: `tcoe-2020-full-consolidated-import-pack-v1.json`;
- validação final: `tcoe-2020-part-11-audit-validation.md`.


### Fase 5 — Deduplicação sem perda de versão — CONCLUÍDA

- detectar nomes repetidos entre PHB 2024, Forge, Spelljammer e Tasha;
- distinguir `same entity/same rules` de `same name/different rules`;
- preservar 2024 e legacy quando as regras diferirem;
- evitar duplicação acidental de spells/items já existentes no catálogo, preferindo refs externas quando apropriado.

### Fase 6 — Validação de domínio — CONCLUÍDA

Para cada lote e no consolidado:

1. JSON parseável;
2. root completo;
3. IDs únicos/kebab-case;
4. `kind` permitido;
5. `actionCost` permitido;
6. source/version/status/confidence;
7. refs resolvidas ou explicitamente cross-batch/external;
8. progressões completas;
9. escolhas internas estruturadas;
10. spellcasting/slots/preparation;
11. summons/companions/stat blocks;
12. criação de personagem;
13. multiclass;
14. equipamentos e proficiências;
15. compatibilidade 2024 vs legacy.

## Estado após esta execução

- Fase 0: concluída.
- Fase 1: concluída; cobertura fina registrada pelos lotes e auditorias finais.
- EFOTA-01: concluído e validado estruturalmente.
- EFOTA-02: concluído e validado estruturalmente.
- EFOTA-03: concluído e validado estruturalmente.
- EFOTA-04: concluído e validado estruturalmente.
- EFOTA-05: concluído e validado estruturalmente.
- EFOTA-06: concluído e validado estruturalmente.
- EFOTA-07: concluído e validado estruturalmente.
- EFOTA-08: concluído e validado estruturalmente.
- EFOTA-09: concluído; auditoria cross-batch aprovada e pack Forge consolidado gerado.
- **Forge of the Artificer: concluído.**
- SPELLJAMMER-01: concluído e validado estruturalmente.
- SPELLJAMMER-02: concluído e validado estruturalmente.
- SPELLJAMMER-03: concluído e validado estruturalmente.
- SPELLJAMMER-04: concluído e validado estruturalmente.
- SPELLJAMMER-05: concluído e validado estruturalmente.
- SPELLJAMMER-06: concluído e validado estruturalmente com errata oficial atual aplicada ao escopo LoX.
- SPELLJAMMER-07: concluído; errata cross-batch reconciliada e pack consolidado gerado.
- **Spelljammer: Adventures in Space: concluído.**
- TASHA-01: concluído e validado estruturalmente.
- TASHA-02: concluído e validado estruturalmente (62 registros).
- TASHA-03: concluído e validado estruturalmente (73 registros).
- TASHA-04: concluído e validado estruturalmente (178 registros; 26 subclasses).
- TASHA-05: concluído e validado estruturalmente (15 feats).
- TASHA-06: concluído e validado estruturalmente (30 registros; 21 spells + 9 summoned spirit stat blocks).
- Gap de cobertura identificado no capítulo 2: **Group Patrons** agora possui lote dedicado TASHA-09 antes da auditoria final.
- TASHA-07: concluído e validado estruturalmente (49 registros; 47 magic items + Magic Tattoo rules + Mighty Servant stat block).
- TASHA-08: concluído e validado estruturalmente (29 registros; 3 sidekick classes + 26 features).
- TASHA-09: concluído e validado estruturalmente (11 registros; 8 patronos + framework/assistance/self-patron).
- TASHA-10: concluído e validado estruturalmente (21 registros; 20 features + Juvenile Mimic).
- TASHA-11: concluído; errata oficial reconciliada, auditoria cross-batch aprovada e pack consolidado gerado (475 registros).
- **Tasha’s Cauldron of Everything: concluído.**
- **Todos os três livros do roadmap atual estão concluídos.**
- Próximo lote planejado: **nenhum; aguarda nova fonte ou etapa de integração/importação no app.**

## Fase 7 — Integração no app — EM ANDAMENTO

### APP-INTEGRATION-01 — Preflight dos três packs — CONCLUÍDO

- 857 registros / 857 IDs únicos entre Forge, Spelljammer e Tasha;
- 0 colisões globais de ID;
- 0 colisões globais de `engineKey`;
- Forge pronto para preview/import sobre o PHB 2024 bundled;
- Spelljammer pronto para preview/import;
- Tasha depende de PHB 2014 para resolver owner refs hard de subclasses/features;
- relatório: `dnd-content-app-integration-readiness-report.md`;
- dados reproduzíveis: `dnd-content-app-integration-readiness.json`.

### APP-INTEGRATION-02 — Preview/import real e smoke test — CONCLUÍDO COM BLOQUEIO LEGACY EXPLÍCITO

- Codebase atual utilizada como baseline real.
- Forge V2: 200 creates, 0 conflicts; replay 200 unchanged.
- Spelljammer V2: 182 creates, 0 conflicts; replay 182 unchanged.
- Fresh bundle PHB 2024 + Forge + Spelljammer: **1.666 itens / 3 packs**.
- Tasha V2: estruturalmente válido (0 JSON Schema errors), mas bloqueado atomicamente por **233 owner errors reduzidos a 13 IDs legacy ausentes**.
- Não foi criado alias PHB 2014 → PHB 2024.
- 53 resources legacy que poderiam ser descartados agora recebem IDs determinísticos (9 Forge + 44 Tasha).
- Preview cross-pack corrigido para idempotência.
- `npm run compendium:import-v2:release-gate`: PASS.
- Jest completo não reexecutado neste ambiente porque o ZIP não inclui `node_modules` e `npm ci --offline` falha por dependências não cacheadas.
- relatório: `APP_INTEGRATION_02_BOOK_PACK_RUNTIME_REPORT.md`.

### APP-INTEGRATION-03 — Core legacy PHB 2014 + desbloqueio de Tasha — PRÓXIMO

1. obter/importar a fonte PHB 2014;
2. materializar o core legacy com IDs `phb-2014-*`, preservando coexistência com PHB 2024;
3. garantir no mínimo as 12 classes e `phb-2014-subclass-ranger-beast-master`;
4. preferencialmente importar também spells/feats/equipment legacy para fechar o grafo completo;
5. repetir preview/upsert de Tasha até 0 owner errors;
6. executar smoke de subclasses, optional features, feats, summons, magic items e sidekicks;
7. executar Jest/typecheck completo em ambiente com dependências instaladas.

