# PHB 2014 — delta legacy compatível com PHB 2024

## Resultado

Status: **PASS / READY_FOR_RUNTIME_PREVIEW**.

A extração foi deliberadamente delta-only. O PHB 2014 não foi reimportado como um segundo core completo; apenas as opções legacy que permanecem relevantes no perfil 2024-first foram materializadas.

## Escopo materializado

12 opções de usuário:

- Cleric: Knowledge Domain, Nature Domain, Tempest Domain;
- Wizard: School of Conjuration, School of Enchantment, School of Necromancy, School of Transmutation;
- Species: Half-Elf, Half-Orc;
- Feats: Dungeon Delver, Linguist, Martial Adept.

O pack contém **56 registros**:

- 44 `feature`;
- 7 `subclass`;
- 2 `species`;
- 3 `feat`.

Páginas impressas consultadas: **38–41, 59–63, 116–119 e 166–168**.

## Compatibilidade 2024

- Todas as 7 subclasses usam como owner runtime `phb-2024-class-cleric` ou `phb-2024-class-wizard`.
- Features legacy de subclass que surgiam antes do nível 3 são entregues no nível 3 do chassis 2024.
- Divine Strike/Potent Spellcasting legacy não são materializados como ramo paralelo; o runtime usa `phb-2024-feature-cleric-blessed-strikes`.
- Half-Elf e Half-Orc preservam os ASIs originais apenas como proveniência; o perfil runtime marca `ignoreLegacySpeciesAbilityScoreIncrease=true`.
- Domain spells e spells referenciadas por features apontam para os IDs canônicos do PHB 2024 quando disponíveis.
- Martial Adept usa o Battle Master 2024 como catálogo-base e inclui os 7 maneuvers adicionais de Tasha já presentes no bundle.

## Errata reconciliada

Foram aplicadas as correções oficiais mecanicamente relevantes para o escopo:

- Half-Elf e Half-Orc: remoção do campo de Alignment;
- Acolyte of Nature: o Druid cantrip escolhido conta como Cleric cantrip e não consome o limite de cantrips conhecidos/preparados correspondente;
- Minor Conjuration: o objeto termina também ao tomar ou causar dano;
- Dungeon Delver: wording de fast pace/passive Perception;
- Martial Adept: um superiority die d6 que se soma a superiority dice de outras fontes.

## Validação estrutural

- 56/56 IDs únicos;
- 56/56 IDs kebab-case;
- 12/12 opções planejadas presentes;
- 0 referências externas quebradas;
- 0 owners `phb-2014-class-*` em runtime;
- `phb-2014-class-cleric` e `phb-2014-class-wizard` aparecem somente como proveniência (`originalClassId`);
- 45 dependências externas runtime resolvidas contra PHB 2024/Tasha;
- V2 aceito pelo parser/preview real do app.

## Integração no app

O bundle passa de **1.933 / 4 packs** para **1.989 itens / 5 packs**:

- PHB 2024: 1.284;
- Forge of the Artificer 2025: 200;
- Spelljammer 2022: 182;
- Tasha 2020 — perfil 2024-first: 267;
- PHB 2014 delta: 56.

Preview/import do delta: **56 creates, 0 updates, 0 conflicts, 0 errors**. Replay: **56 unchanged**.

Smoke 2024 + legacy ampliado: **24/24 PASS**, incluindo as sete novas subclasses legacy em chassis 2024, Blessed Strikes, ausência de owners 2014 em runtime e resolução do Martial Adept.

Gates executados:

- `compendium:legacy:phb2014:delta:check`: PASS;
- `compendium:books:integration:check`: PASS;
- `compendium:legacy:2024:smoke`: 24/24 PASS;
- `custom-feat-feature:smoke`: 5/5 PASS;
- `compendium:bundled:check`: PASS;
- `compendium:import-v2:release-gate`: PASS;
- `typescript:syntax:check`: PASS (442 arquivos);
- `check:shape`: PASS.

Jest completo não foi executado neste ambiente porque a codebase distribuída não contém `node_modules`.
