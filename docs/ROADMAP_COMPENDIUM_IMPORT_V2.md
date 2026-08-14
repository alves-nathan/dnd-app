# Roadmap — Reestruturação do modelo de importação V2

Baseline: `BUGFIX-011 custom background`

Objetivo: introduzir `dnd-combat-import.v2` como representação serializável do domínio real do D&D Combat Math, sem simplificar o runtime, sem apagar o compêndio existente e sem quebrar V1 durante a transição.

## Estratégia

A execução foi concluída incrementalmente. Após equivalência funcional, migração explícita e regressão integral do PHB 2024, o bootstrap de produção foi promovido para V2 na Phase 10. V1 permanece como entrada compatível e fixture histórica.

| Etapa | Escopo | Critério de saída | Status |
|---|---|---|---|
| 1 | Auditoria do domínio/importador/PHB | inventário reproduzível de tipos, schemas, storage, payload e 1.284 itens | **Concluída nesta entrega** |
| 2 | Shared import domain | tipos compartilhados, enums canônicos e payloads tipados por `kind` | **Concluída — Phase 02** |
| 3 | Schemas V2 | `z.discriminatedUnion('kind', ...)`, envelope V2, erros por path | **Concluída — Phase 02** |
| 4 | Normalização canônica | aliases de ActionCost/Ability/Skill/DamageType/currency e valores legacy | **Concluída — Phase 02** |
| 5 | Compatibilidade V1 | `detect version` + `migrateImportV1ToV2()` isolado | **Concluída — Phase 02** |
| 6 | Validação semântica | referências, duplicidade, owner class/subclass, invariantes por entidade | **Concluída — Phase 03** |
| 7 | Preview/diff/upsert | creates/updates/unchanged/conflicts + hash estável | **Concluída — Phase 04** |
| 8 | Persistência/mapper | importar V2 no mesmo armazenamento sem migrar personagens à força | **Concluída — Phase 05** |
| 9 | Export V2/round-trip | export → JSON → import semanticamente equivalente | **Concluída — Phase 06** |
| 10 | Template/prompt/docs/schema | template V2, extractor prompt, documentação e JSON Schema | **Concluída — Phase 07** |
| 11 | Migração do PHB 2024 | converter/normalizar 1.284 entidades, manter IDs e relações | **Concluída — Phase 08** |
| 12 | Regressões funcionais | criação, custom background, progressão, spellcasting, combate | **Concluída — Phase 09** |
| 13 | Cutover controlado | V2 padrão, V1 somente compatibilidade, gates de release | **Concluída — Phase 10** |

## Ordem detalhada

### Etapa 1 — Auditoria

- inventariar schemas Zod atuais;
- inventariar `StoredCompendiumItem`, SQLite e snapshot key-value;
- localizar consumidores de `payload`, `rawJson` e `normalizedJson`;
- catalogar payload keys reais do PHB por `kind`;
- comparar enums importados com enums do runtime;
- localizar fluxos de criação, progressão, spellcasting, combate e custom background.

### Etapa 2 — Shared domain

- reutilizar `AbilityScore`, `ActionCost`, `DamageFormula`, `DiceTerm` e `ActiveEffectTemplate` do runtime;
- centralizar `CompendiumEntityKind`, skills, damage types e currency;
- tipar payloads para os 13 kinds já existentes;
- manter extensibilidade via `unknown`, nunca `any`;
- não alterar o mapper existente ainda.

### Etapa 3 — Schema V2

- envelope com `templateVersion: dnd-combat-import.v2`;
- payload discriminado por `kind`;
- preservar extensões desconhecidas com `.passthrough()` enquanto são auditadas;
- adicionar testes de envelope, kind, class, spell, feature, weapon, background e creature.

### Etapa 4 — Normalização

Criar adapters explícitos antes do modelo canônico para divergências reais encontradas na auditoria, incluindo:

- `passive`, `magicAction`, `attackReplacement`, `finishLongRest` e outros action costs não-runtime;
- `STR_OR_DEX` em armas;
- nomes/aliases de skills;
- damage types compostos ou variáveis;
- preços string (`"2 GP"`) → `CurrencyValue`;
- spell class names → referência canônica que preserve compatibilidade atual.

**Implementado na Phase 02:** adapters centrais para action timing, casting time,
ability references, skills, damage types compostos/variáveis, currency,
resources/recovery, equipment options, scaling e velocidades condicionais de
creatures. O pacote PHB V1 completo passa pelo normalizador preservando 1.284
IDs e resolve todas as 391 listas de classes de spells para `classIds`.

### Etapa 5 — V1 → V2

Fluxo alvo:

```text
V1/unversioned -> parse legacy -> migrateImportV1ToV2 -> normalize -> V2 canonical
V2             -> parse V2 ---------------------------> normalize -> V2 canonical
```

A partir daí nenhum mapper/persistência deve conhecer a versão original.

**Implementado na Phase 02:** `migrateImportV1ToV2()` e `parseImportPack()` já
convergem V1, legacy sem versão e V2 para a mesma estrutura canônica. O caminho
de persistência de produção ainda não foi redirecionado; isso permanece
deliberadamente para a Etapa 8, depois de preview/diff e validação semântica
completa.

### Etapa 6 — Validação semântica

Separar `error`, `warning` e `info` para:

- IDs duplicados;
- references ausentes;
- subclass sem class;
- feature com class/subclass incompatíveis;
- spell level/classes inválidos;
- weapon invariants;
- condition IDs;
- equipment/currency;
- progression e spellcasting.

**Concluída na Phase 03.** Foi criado um resultado semântico estruturado com
`errors`, `warnings`, `infos`, paths e resumo por código. A validação cobre
ownership de classes/subclasses/species, progressão e nível inicial de features,
prerequisites estruturados, resources, spellcasting/Pact Magic, spell classIds,
cantrips/slots/scaling, weapons/armor/equipment, equipment option itemIds,
granted-action spell/item/condition references e conditionIds de stat blocks.
Pacotes incrementais podem fornecer `externalItems` para resolver dependências
já existentes no catálogo sem repetir o grafo completo.

O PHB 2024 completo, depois do boundary V1 → V2, passa com **0 errors, 0 warnings**
e apenas **1 info** referente ao pseudo-resource runtime `pactMagicSlot`. Durante
esta etapa também foi corrigido um defeito real do normalizador: arrays legacy
`maxByLevel` com 21 entradas usam índice 0 como sentinel e agora geram apenas
níveis 1–20.

### Etapa 7 — Preview / diff / upsert

- hash normalizado por item;
- create/update/unchanged/conflict;
- deduplicação por ID/source/version, nunca só por nome;
- preview antes de tocar no storage.

**Concluída na Phase 04.** Foi criado um fingerprint canônico por entidade que
ignora apenas metadados transitórios de importação/revisão, preservando a ordem
de arrays e toda a semântica do payload. O preview classifica cada item como
`create`, `update`, `unchanged` ou `conflict`, reporta paths alterados e aplica
uma política de identidade segura: mesmo ID com `kind`, `source.id` ou
`rulesEra` incompatível vira conflito em vez de sobrescrever conteúdo.

O catálogo existente é normalizado pelo mesmo boundary V2 antes da comparação,
o que permite reconhecer um pack V1 já instalado como semanticamente idêntico
ao seu equivalente V2. Packs incrementais também podem resolver referências
contra o catálogo instalado durante o preview. A Phase 04 produz ainda um plano
de upsert imutável (`createCompendiumImportV2UpsertPlan`) com operações de
create/update e hashes, mas **não executa nenhuma escrita**; a execução atômica
fica reservada para a Etapa 8.

Auditoria com o PHB 2024 completo:

- catálogo vazio: **1.284 creates**;
- replay sobre o mesmo catálogo V1: **1.284 unchanged**;
- uma entidade modificada: **1 update + 1.283 unchanged**;
- conflitos: **0** nos três cenários válidos.

### Etapa 8 — Persistência e mapper

- preservar `compendium_items.id`, `importItemId`, source e pack;
- não apagar packs existentes;
- manter compatibilidade com links de personagens;
- promover gradualmente campos hoje lidos de `Record<string, unknown>`.

**Concluída na Phase 05.** O plano produzido pela Phase 04 agora possui um
executor puro (`applyCompendiumImportV2PlanToSnapshot`) e dois adapters de
persistência. O KeyValue repository constrói o próximo snapshot inteiro antes
de efetuar uma única escrita; o SQLite executa apenas UPSERTs necessários
dentro de `withTransactionAsync`, sem apagar itens/packs não mencionados.

Updates preservam `StoredCompendiumItem.id`, `createdAt` e a associação original
ao pack, protegendo referências já gravadas em personagens. O novo
`contentHash` fica persistido no item e também é backfilled em linhas V1
semanticamente unchanged. Decisões locais `disabled` permanecem desabilitadas
durante updates, evitando reativação silenciosa de conteúdo pelo importador.

O caminho legado `saveImportJson()` continua disponível. A nova API
`saveImportV2Json()` usa `parse → semantic validation → preview → plan → atomic
commit`, mas ainda não é o default da UI/bootstrap. O mapper existente não foi
duplicado: itens V2 persistidos alimentam o mesmo `normalizedJson` consumido
pelo runtime, com teste de integração provando aplicação de spell e preservação
do `compendiumLink.itemId`.

Auditoria com o PHB 2024:

- primeira instalação V2: **1.284 creates / 1.284 itens persistidos**;
- IDs de storage únicos e hashes presentes em **1.284/1.284** itens;
- replay sobre catálogo V1: **1.284 unchanged**, com **1.284 hashes backfilled**;
- uma entidade alterada: **1 update + 1.283 unchanged**;
- storage ID do item atualizado: **preservado**.

### Etapa 9 — Export e round-trip

- exportar `dnd-combat-import.v2`;
- round-trip dos 13 kinds;
- preservar extensões ainda não formalizadas;
- comparar equivalência semântica, não timestamps.

**Concluída na Phase 06.** A exportação user-facing (`buildCompendiumPackageExport`)
agora gera exclusivamente `dnd-combat-import.v2`; V1 permanece suportada como
entrada por `parseImportPack()` e `migrateImportV1ToV2()`. O exportador reconstrói
cada item a partir do estado de runtime (`normalizedJson`) e usa `rawJson` apenas
como trilha de auditoria/source fallback, evitando perder correções feitas no
editor de mapping.

Metadados de storage/revisão não são injetados em `payload`. Quando solicitados,
ficam em `metadata.storageOrigins` e `metadata.review`, de modo que backup e
reimportação não alterem a semântica da entidade. Em exports com múltiplas fontes,
o envelope usa uma fonte sintética, mas **cada item preserva sua própria source**.

Foi criado um verificador explícito de round-trip:

```text
Stored/runtime domain
        ↓
canonical V2 export
        ↓
JSON.stringify
        ↓
parseImportPack(V2)
        ↓
item content hash equivalence
```

A auditoria do PHB 2024 comprovou:

- **1.284/1.284** itens exportados;
- **13/13** entity kinds preservados;
- **1.284/1.284** hashes semânticos iguais entre storage e export;
- **1.284/1.284** hashes iguais após export → JSON → parse;
- **0** itens ausentes, inesperados ou semanticamente alterados;
- fontes individuais preservadas em **1.284/1.284** itens;
- metadata de origem/revisão presente em **1.284/1.284** itens quando habilitada;
- **0 errors / 0 warnings** na auditoria do pacote completo.

Durante o round-trip foi encontrado e corrigido um defeito de idempotência no
normalizador de `creatureStatBlock.speed`: velocidades condicionais já
estruturadas eram descartadas em uma segunda normalização. O boundary agora
preserva objetos `{ value/formula, condition, original }`, cobrindo summons como
Otherworldly Steed e os Spirit stat blocks.

### Etapa 10 — Documentação, prompt e JSON Schema

- `docs/compendium-import-v2.md`;
- `dnd-combat-import-v2.schema.json` derivado ou validado contra Zod;
- `buildImportSchemaDocumentation()`;
- prompt de extração montado a partir de enums/documentação, sem schema duplicado manualmente;
- template V2 autocertificado pelo mesmo schema.

**Concluída na Phase 07.** O template user-facing agora emite `dnd-combat-import.v2` por padrão, enquanto V1 permanece exclusivamente como formato de entrada compatível. O template mínimo inclui exemplos conectados de class, feature, spell, background, feat e equipment; o completo cobre os 13 kinds e é validado pelo mesmo `parseImportPack()` usado no boundary de importação.

Foi criado `buildImportSchemaDocumentation()` a partir dos enums e do catálogo de payloads do shared domain. `buildExtractorPrompt()` reutiliza essa documentação em vez de ensinar um schema V1/manual independente. A tela de templates também passa a oferecer **Guia V2** e **JSON Schema**.

`buildImportV2JsonSchema()` usa `z.toJSONSchema(compendiumImportV2Schema)` do Zod 4, garantindo uma fonte estrutural única. O arquivo `docs/dnd-combat-import-v2.schema.json` foi versionado para ferramentas externas e há um gerador (`npm run compendium:import-v2:schema:generate`) para rematerializá-lo diretamente do schema do app. A documentação canônica está em `docs/compendium-import-v2.md` e cobre envelope, kinds, IDs, source, payloads, enums, custom background, validation, preview/merge, V1 compatibility e round-trip.

### Etapa 11 — Migração formal PHB 2024

**Concluída na Phase 08.** O pacote V1 original permanece preservado e foi
materializado um artefato V2 canônico determinístico em
`assets/compendium/phb-2024-full-consolidated-import-pack-v2-canonical.json`.
A migração mantém o mesmo pack ID e os **1.284/1.284 IDs**, nomes, kinds, source IDs
e hashes semânticos, com **0 erros e 0 warnings semânticos**. O único `info`
continua sendo o pseudo-resource runtime `pactMagicSlot`.

A proveniência `_importMeta` dos 1.284 itens deixa de ser descartada: V2 a
preserva em `item.metadata.legacyImport`, fora do gameplay payload e fora do
hash semântico. `extractionInstructions` e `consolidationMeta` também deixam o
root legado e ficam em `metadata.legacyExtensions`. Um checksum SHA-256 e um
relatório de migração reproduzível acompanham o artefato.

A validação independente contra o JSON Schema V2 materializado retornou **0
erros** para as 1.284 entidades. Durante esse gate, o schema de spell foi
alinhado ao dado real: `specificMaterial` aceita `boolean | string`, refletindo
o PHB atual sem forçar o domínio a caber num schema artificial.

Na Phase 08 o bootstrap ainda permanecia em V1 de propósito. A troca foi realizada posteriormente na Phase 10, após a regressão funcional completa da Etapa 12.

### Etapa 12 — Regressões

**Concluída na Phase 09.** O PHB V1 e o artefato V2 canônico foram exercitados
lado a lado por um audit de runtime com **13/13 grupos funcionais aprovados** sobre
os mesmos 1.284 itens. A regressão inclui montagem representativa completa de um
Warlock nível 1, background Criminal, proficiências, equipamento inicial, Origin
Feat, spell, custom background com orçamento de 50 GP, Wizard/Warlock
spellcasting, seleção adiada de spells, Action Economy, progressão Warlock nos
níveis 1/3/5/7/10/20, Eldritch Invocations, Pact Chain, resources/actions/effects
e creature stat blocks.

A fase encontrou e corrigiu cinco incompatibilidades de consumidores V1 com o
modelo canônico: `CurrencyValue`, `equipmentOptions` estruturadas, `castingTime`
estruturado, `AbilityReference` de weapons e velocidades estruturadas de
creatures. Essa equivalência foi o gate que permitiu o cutover posterior da Etapa 13.

### Etapa 13 — Cutover

**Concluída na Phase 10.** O manifesto bundled de produção agora carrega
`phb-2024-full-consolidated-import-pack-v2-canonical.json`, mantendo o mesmo
pack ID lógico do V1. Instalações novas usam `saveImportV2Json()` diretamente.

Instalações existentes com o PHB bundled V1 passam por `reconcileBundledCompendium()`.
A promoção automática só ocorre quando o preview canônico retorna **0 creates,
0 updates e 0 conflicts**; nesse caso os 1.284 storage IDs permanecem iguais e
os `contentHash` são preenchidos sem substituir `normalizedJson`, revisão ou
preferências locais. Divergência raw adia o cutover daquele pack e preserva o
snapshot local.

O caminho user-facing `saveImportJson()` tornou-se version-aware: V2 é roteado
para a persistência V2 transacional e V1/legacy continua usando o importador
compatível. Preview de arquivo e preview manual também usam `parseImportPack()`.

O gate permanente `compendium:import-v2:release-gate` verifica o bundle V2,
migração determinística do PHB, equivalência funcional V1 × V2 e contratos de
cutover antes do restante da validação de release.

## Phase 11 — estabilização pós-cutover

**Status: concluída em 2026-08-11.** Esta fase de manutenção não altera o roadmap original de 13 etapas; ela endurece o estado final após o cutover.

- gates de runtime/character bridge e harness APP-04 agora consomem o PHB V2 canônico, em vez do artefato V1 de compatibilidade;
- o teste de dados reais `catalogCharacterChoiceRealData.test.ts` passou a usar o pacote canônico V2;
- V1 permanece somente como artefato explícito de migração, compatibilidade e comparação V1 × V2;
- foi criado `compendium:import-v2:post-cutover:check` e incluído no release gate permanente;
- os gates históricos das Phases 08/09 foram endurecidos para exigir bootstrap V2 após o cutover;
- `catalog:character-bridge:check`, APP-04 runtime harness e o release gate V2 foram executados com sucesso contra as 1.284 entidades V2.


## Phase 12 — baseline final e remoção de superfícies V1 residuais

**Status: concluída em 2026-08-11.** Hardening final após a estabilização do
cutover. Esta fase não muda o domínio nem a persistência; ela elimina sinais
residuais de V1 em superfícies que representam o formato atual e torna a
separação V1/V2 explícita no código.

- o card de exportação na UI passa a anunciar `dnd-combat-import.v2`;
- o template estático em `docs/import-templates/` foi migrado para V2 e contém
  exemplos conectados de class, feature, spell, background, feat e equipment;
- `LEGACY_IMPORT_TEMPLATE_VERSION_V1` passa a ser a constante explícita usada
  nos boundaries de detecção/migração; o nome histórico
  `STANDARD_IMPORT_TEMPLATE_VERSION` permanece apenas como alias deprecated para
  compatibilidade de source;
- foi criado `compendium:import-v2:final-baseline:check`, incorporado ao release
  gate permanente;
- o gate garante que nenhuma tela do app anuncie V1 como formato atual e que o
  template estático permaneça em V2;
- foi adicionado `compendiumImportV2FinalBaseline.test.ts` para validar o
  template estático pelo parser canônico e proteger a UI/contrato de versões.

A partir desta baseline, V1 existe somente como **entrada legada e fixture de
migração/compatibilidade**. Todo material novo user-facing — bundle, export,
template, documentação e prompt — representa V2.
