# APP-INTEGRATION-03/04 — Consolidação das codebases e perfil 2024-first + legacy

Data: 2026-08-11

## Resultado executivo

A codebase `custom-feats-features` foi consolidada com a codebase `app-integration-02` por merge de três vias usando `final-jest-remediation` como ancestral comum. O único arquivo-fonte alterado pelos dois ramos foi `src/compendium/mapper.ts`; a versão consolidada preserva simultaneamente o suporte novo a `damageType`/regras customizadas e as correções de resources/scaling/importação da integração de livros. Nenhum marcador de conflito permaneceu no projeto.

A política do compêndio foi ajustada para o objetivo explícito do app: **2024-first + legacy**. O PHB 2024 continua sendo o core. Conteúdo legacy é mantido quando não existe substituto 2024; conteúdo reimpresso/atualizado usa a entidade 2024 e não é duplicado no catálogo ativo.

## Consolidação das duas codebases

Análise contra o ancestral comum:

- ramo APP-INTEGRATION-02: 37 arquivos diferentes do ancestral;
- ramo custom-feats-features: 18 arquivos diferentes do ancestral;
- interseção real: 1 arquivo (`src/compendium/mapper.ts`);
- todos os 17 arquivos exclusivos do ramo custom-feats-features foram preservados byte a byte antes dos ajustes de consolidação;
- 28 dos 36 arquivos exclusivos de APP-INTEGRATION-02 permaneceram byte a byte; os demais foram deliberadamente evoluídos neste passo (manifesto de bundle, checks, testes/scripts e package scripts);
- projeto consolidado: 61 arquivos diferentes do ancestral antes da geração dos artefatos finais deste passo.

Funcionalidades do ramo do usuário preservadas e verificadas:

- editor de Feat/Feature custom;
- preset `Friendly Fire`;
- multiplicadores por damage type;
- triggered damage;
- adição de spells à lista de classe;
- troca de spell por resource/rest;
- `Weapon.damageType`, `Spell.damageType` e action damage types;
- `ChoiceChipSelector.lockedSelectedValues`;
- herança de tool proficiency do background.

O smoke sem Jest passou em 5/5 contratos funcionais, incluindo dano médio do Fire Bolt duplicado de 5,5 para 11 pelo preset, isolamento por damage type, spell-list addition por classe, gasto/restauração do resource de troca de spell e wiring das telas custom.

## Reavaliação do PHB 2014

O PHB 2014 **não é necessário para desbloquear Tasha ou para o runtime atual**. Em vez de instalar as 12 classes 2014 apenas para satisfazer owner IDs antigos, foi gerado um perfil derivado de Tasha compatível com o chassis 2024.

Para **cobertura completa de 2024 + legacy**, o PHB 2014 ainda é útil somente como fonte de um delta pequeno de conteúdo oficialmente não substituído pelo PHB 2024. O próximo lote do PHB 2014 deve, portanto, ser delta-only e não uma reextração integral.

Escopo delta planejado:

1. Knowledge Domain;
2. Nature Domain;
3. Tempest Domain;
4. School of Conjuration;
5. School of Enchantment;
6. School of Necromancy;
7. School of Transmutation;
8. Half-Elf;
9. Half-Orc;
10. Dungeon Delver;
11. Linguist;
12. Martial Adept.

Classes, spells, equipment, backgrounds, species, feats e subclasses do PHB 2014 que possuem substituto no PHB 2024 não serão duplicados no catálogo 2024-first.

## Tasha 2020 → perfil 2024-first + legacy

Entrada raw auditada: 475 itens.

Saída runtime: `tcoe-2020-2024-compatible-import-pack-v2-canonical.json`.

Resultado:

- 267 itens retidos;
- 208 itens suprimidos por terem substituto 2024/Forge ou por pertencerem especificamente ao chassis de classe 2014;
- 18 subclasses legacy mantidas;
- 176 features;
- 47 magic items;
- 12 spells;
- 5 feats;
- 5 creature stat blocks;
- 3 sidekick classes;
- 1 species;
- 0 referências de item para `phb-2014-*`;
- 0 dependências PHB 2014 no metadata runtime.

Correções relevantes do adaptador:

- Artificer 2020 removido em favor de Forge of the Artificer 2025;
- subclasses Tasha reimpressas no PHB 2024 removidas, incluindo Circle of the Stars (mapeamento de nome/slug corrigido nesta rodada);
- feats/spells Tasha reimpressos usam o PHB 2024;
- optional class features específicas do chassis 2014 não são projetadas artificialmente para as classes 2024;
- subclasses legacy restantes apontam para `phb-2024-class-*` e têm unlock inicial no nível 3;
- Cleric legacy usa Blessed Strikes do 2024 e não duplica Divine Strike/Potent Spellcasting;
- Custom Lineage é retido sem ASI de species; a camada 2024 de background fornece ASI;
- oito referências de spells que pareciam PHB 2014 eram apenas diferenças de slug/apóstrofo e foram resolvidas para IDs reais do PHB 2024;
- chaves de mapas estruturados também passam pela reescrita de IDs, evitando refs antigas escondidas em object keys.

## Runtime / smoke

Importação sequencial validada:

- PHB 2024: 1.284 itens;
- Forge 2025: 200 itens;
- Spelljammer 2022: 182 itens;
- Tasha 2020 — perfil 2024-first: 267 itens;
- snapshot final: **1.933 itens / 4 packs**;
- 0 conflitos;
- replay idempotente dos packs extraídos;
- 0 dependências PHB 2014 para Tasha.

Smoke de personagem 2024 + legacy: **11/11 PASS**. Cobertura representativa:

- Barbarian 2024 + Path of the Beast;
- Cleric 2024 + Order Domain em níveis 3 e 8;
- Druid 2024 + Circle of Wildfire;
- Fighter 2024 + Rune Knight;
- Warlock 2024 + The Genie;
- Wizard 2024 + Bladesinging;
- Blessed Strikes substituindo a bifurcação clerical legacy;
- ausência das versões Tasha superseded;
- Custom Lineage sem ASI legacy.

## Gates executados

- `compendium:books:stage:check`: PASS;
- `compendium:legacy:2024:adapt:check`: PASS;
- `compendium:books:integration:check`: PASS;
- `compendium:legacy:2024:smoke`: 11/11 PASS;
- `custom-feat-feature:smoke`: 5/5 PASS;
- `compendium:bundled:check`: PASS;
- `compendium:import-v2:phb:check`: PASS;
- `compendium:import-v2:functional-parity`: 13/13 PASS;
- Phase 10 cutover: PASS;
- post-cutover: PASS;
- final baseline: PASS;
- `compendium:import-v2:release-gate`: PASS;
- `typescript:syntax:check`: PASS (442 arquivos);
- `check-project-shape`: PASS.

Jest completo não foi reexecutado: as codebases fornecidas não incluem `node_modules`, e a instalação de dependências não pôde ser concluída neste ambiente. Foram adicionados harnesses Node/TypeScript independentes de Jest justamente para validar os caminhos novos de maior risco.

## Estado do bundle nativo

O manifesto nativo contém agora quatro packs V2:

1. PHB 2024;
2. Forge of the Artificer 2025;
3. Spelljammer: Adventures in Space 2022;
4. Tasha's Cauldron of Everything 2020 — perfil 2024-first + legacy.

## Próximo passo recomendado

**LEGACY-PHB2014-DELTA-01** — extrair somente as 12 opções legacy do PHB 2014 que não possuem substituto no PHB 2024, adaptando as sete subclasses ao chassis 2024 e sem duplicar o restante do livro.

Esse lote não é blocker do runtime atual, mas é necessário para declarar cobertura completa do delta PHB 2014 dentro do objetivo 2024 + legacy.
