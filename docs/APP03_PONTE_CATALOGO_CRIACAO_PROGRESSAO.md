# APP-03 — Ponte do catálogo para criação e progressão

## Estado de entrada

O APP-03 parte da codebase resultante do APP-02, com:

- catálogo consolidado v4.8.0 carregado em modo fail-closed;
- 5.841 entidades, 15.385 dependências, 57 categorias e 127 aliases;
- filtros por livro, categoria e entidade persistidos;
- compêndio SQLite local preservado como camada editável;
- criação de personagem e progressão já baseadas no compêndio local;
- revisão editorial preservada para conteúdo oficial sinalizado;
- preview e commit separados no gerenciamento de conteúdo.

## Objetivo

Criar uma camada única de consulta para criação e progressão que combine:

1. entidades oficiais do catálogo consolidado;
2. itens válidos do compêndio local;
3. filtros e hard gates ativos;
4. aliases e equivalências;
5. proveniência, revisão editorial e snapshot do catálogo.

A ponte deve impedir duplicação entre conteúdo oficial já presente no catálogo e cópias equivalentes importadas no compêndio local, sem apagar ou reescrever o compêndio.

## Decisões de arquitetura

### 1. Nova abstração de escolha

Criar `CharacterChoiceItem`, independente de tela e de persistência:

```ts
export type CharacterChoiceOrigin = 'catalog' | 'compendium';

export interface CharacterChoiceItem {
  choiceId: string;
  entityId: string;
  kind: CharacterChoiceKind;
  name: string;
  sourceBookId?: string;
  sourceLabel: string;
  origin: CharacterChoiceOrigin;
  catalogSnapshotId?: string;
  catalogEntityId?: string;
  compendiumItemId?: string;
  ownerIds: string[];
  searchableText: string;
  available: boolean;
  blockedReasons: CharacterChoiceBlockReason[];
  manualReviewRequired: boolean;
  payload: Record<string, unknown>;
  provenance: CharacterChoiceProvenance;
}
```

`choiceId` deve ser namespaced:

- `catalog:<entityId>`;
- `compendium:<itemId>`.

A identidade persistida continua sendo o ID da entidade, acompanhada de proveniência e `catalogSnapshotId` quando originada no catálogo.

### 2. Serviço de consulta unificada

Criar `src/catalog/characterChoiceBridge.ts` com operações puras:

```ts
listCharacterChoices(input): CharacterChoiceQueryResult
resolveCharacterChoice(choiceId, input): CharacterChoiceResolution
previewCharacterChoiceApplication(input): CharacterChoiceApplicationPreview
applyCharacterChoice(input): CharacterChoiceApplicationResult
```

A UI não deve consultar diretamente `catalogStore` e `compendiumStore` para montar listas de criação ou progressão.

### 3. Precedência e deduplicação

Aplicar a seguinte ordem:

1. hard gate do livro no catálogo;
2. disponibilidade efetiva da entidade oficial;
3. alias/equivalência canônica;
4. item oficial do catálogo;
5. item local explicitamente marcado como override autorizado;
6. item local suplementar ou homebrew;
7. colisões não resolvidas permanecem separadas e recebem rótulo de fonte.

Chaves de deduplicação:

1. `catalogEntityId` explícito no item local;
2. alias oficial resolvido pelo catálogo;
3. ID canônico coincidente;
4. somente como fallback, tupla `kind + sourceBookId + normalizedName`.

Nunca deduplicar apenas por nome quando a fonte ou o proprietário diferirem.

### 4. Política de revisão

- Conteúdo oficial com `manualReviewRequired` pode aparecer e ser aplicado, mas deve mostrar aviso e proveniência.
- Conteúdo local continua exigindo status `validated` para aplicação automática.
- Item local `needsReview` pode aparecer somente em modo diagnóstico/revisão, nunca como escolha normal.
- Nenhum aviso editorial pode ser removido durante adaptação ou aplicação.

### 5. Compatibilidade com o mapper existente

Criar `src/catalog/catalogCompendiumAdapter.ts` para materializar uma visão transitória compatível com o mapper atual, sem persistir a entidade oficial no SQLite:

```ts
catalogChoiceToMapperItem(choice): StoredCompendiumItem
```

O adapter deve:

- preservar o ID canônico;
- gerar fonte imutável do catálogo;
- marcar o item transitório como validado para fins do mapper;
- transportar `manualReviewRequired` em metadados e issues;
- impedir que esse item seja salvo no repositório local;
- gerar `CharacterCompendiumLink` ou uma nova referência equivalente com origem `catalog`.

Se a adaptação do mapper exigir muitas exceções, evoluir para `CharacterContentReference` com união discriminada:

```ts
type CharacterContentReference =
  | { origin: 'catalog'; entityId: string; catalogSnapshotId: string }
  | { origin: 'compendium'; itemId: string; sourceId: string; packId: string };
```

## Arquivos novos

- `src/catalog/characterChoiceTypes.ts`
- `src/catalog/characterChoiceBridge.ts`
- `src/catalog/catalogCompendiumAdapter.ts`
- `src/catalog/characterChoiceDeduplication.ts`
- `src/catalog/characterChoiceApplication.ts`
- `src/tests/catalogCharacterChoiceBridge.test.ts`
- `src/tests/catalogCharacterChoiceApplication.test.ts`
- `src/tests/catalogCharacterProgressionIntegration.test.ts`
- `docs/APP03_CATALOG_CHARACTER_BRIDGE_REPORT.md`

## Arquivos a alterar

### `app/characters/new.tsx`

- substituir consultas diretas de classes, espécies, backgrounds, subclasses, feats, magias e equipamentos pelo bridge;
- manter os oito passos atuais e o draft existente;
- armazenar `choiceId` no draft enquanto a criação estiver em andamento;
- resolver IDs canônicos antes do commit;
- mostrar fonte, origem, revisão editorial e motivo de bloqueio;
- ocultar duplicatas oficiais importadas no compêndio;
- manter criação manual em segundo plano.

### `app/characters/[id]/level-up.tsx`

- consultar progressão e escolhas pelo bridge;
- aplicar filtros do snapshot usado pelo personagem;
- gerar preview de features, subclass, feats, magias, slots e recursos;
- impedir commit quando uma escolha ficou indisponível após alteração do catálogo;
- oferecer migração explícita para snapshot mais novo, sem alteração silenciosa.

### `src/compendium/classProgression.ts`

- receber um provider abstrato de entidades;
- remover dependência direta de arrays exclusivos do compêndio;
- resolver referências por ID, alias e proprietário.

### `src/characters/spellcastingRules.ts`

- aceitar `CharacterChoiceItem` ou interface mínima equivalente;
- filtrar magias por classe, nível e disponibilidade efetiva;
- preservar desambiguação por fonte.

### `src/characters/speciesChoiceRules.ts`

- resolver traits e escolhas por IDs oficiais;
- aplicar gates de nível e dependências do catálogo;
- manter escolhas persistidas compatíveis ao voltar etapas.

### `src/characters/startingEquipmentRules.ts`

- resolver armas, armaduras e equipamentos pelo provider unificado;
- não criar cópias quando o mesmo item oficial já existe no catálogo;
- registrar proveniência no inventário resultante.

### `src/compendium/mapper.ts`

- aceitar item transitório do catálogo ou uma referência de conteúdo unificada;
- não exigir `validated` para entidade oficial do catálogo já validada estruturalmente;
- converter `manualReviewRequired` em warning, não em bloqueio;
- impedir links duplicados por identidade canônica.

### `src/types.ts`

Adicionar, conforme a estratégia escolhida:

- `CharacterContentReference`;
- `catalogSnapshotId` no agregado de personagem;
- proveniência canônica nas entidades aplicadas;
- status editorial preservado.

### `src/storage/characterMigrations.ts`

- normalizar referências antigas do compêndio;
- adicionar campos novos sem alterar entidades existentes;
- manter saves antigos acessíveis;
- não inferir automaticamente que um item local antigo corresponde a entidade oficial quando houver ambiguidade.

## Fluxo de criação após APP-03

1. carregar snapshot do catálogo;
2. recuperar preferências e disponibilidade efetiva;
3. carregar itens locais validados;
4. construir índice unificado;
5. resolver aliases e duplicatas;
6. exibir escolhas por etapa;
7. validar dependências e pré-requisitos;
8. produzir preview completo;
9. confirmar commit atômico;
10. persistir IDs, proveniência e snapshot.

## Fluxo de progressão após APP-03

1. abrir personagem com seu `catalogSnapshotId`;
2. calcular progressão usando o mesmo snapshot;
3. consultar escolhas legais e indisponíveis com razões;
4. preservar escolhas já realizadas;
5. gerar diff de nível;
6. confirmar commit;
7. registrar transação de progressão e origem de cada mudança;
8. permitir reversão pela transação, sem reconstrução por nome.

## Casos de teste obrigatórios

### Consulta e filtros

- classe oficial ativa aparece;
- classe de livro desativado não aparece;
- entidade individualmente desativada não aparece;
- conteúdo protegido permanece disponível;
- item local de fonte desativada não aparece;
- `needsReview` local não aparece no fluxo normal;
- oficial com revisão editorial aparece com warning.

### Deduplicação

- cópia local com `catalogEntityId` é ocultada em favor do oficial;
- alias oficial e ID legado resultam em uma escolha;
- mesmo nome em livros diferentes permanece separado;
- homebrew com nome de item oficial permanece separado quando a fonte difere;
- colisão ambígua exige desambiguação e não é mesclada.

### Aplicação

- classe, espécie e background oficiais são aplicados;
- subclasse encontra a classe proprietária correta;
- feat e feature preservam origem;
- magia oficial é atribuída à classe correta;
- equipamento não é duplicado;
- aplicação repetida é idempotente;
- warning editorial chega à revisão final.

### Progressão

- level-up usa o snapshot do personagem;
- mudança de filtros não corrompe personagem existente;
- nova escolha indisponível bloqueia o commit com razão;
- item já aplicado permanece visível como indisponível legado;
- level-down remove somente mudanças registradas pela progressão;
- migração de snapshot exige preview e confirmação.

### Migração

- personagem antigo sem `catalogSnapshotId` continua abrindo;
- links locais antigos permanecem válidos;
- correspondência inequívoca pode ser sugerida, mas não aplicada silenciosamente;
- colisão de nome não gera migração automática.

## Gates de conclusão

O APP-03 será considerado concluído quando:

- criação e progressão consumirem o provider unificado;
- filtros do catálogo afetarem todas as escolhas novas;
- o compêndio local continuar editável e independente;
- nenhuma entidade oficial for persistida como cópia local;
- duplicatas oficiais forem eliminadas da seleção;
- aliases e colisões forem tratados explicitamente;
- personagens persistirem IDs, proveniência e snapshot;
- conteúdo editorialmente pendente exibir aviso;
- testes unitários, integração, migração, shape e acessibilidade passarem;
- `npm run typecheck` e a suíte Jest completa forem executados no ambiente local quando o registry estiver disponível.

## Comandos de validação previstos

```bash
npm run check:shape
npm run check:a11y
npm run typecheck
npx jest src/tests/catalogCharacterChoiceBridge.test.ts --runInBand
npx jest src/tests/catalogCharacterChoiceApplication.test.ts --runInBand
npx jest src/tests/catalogCharacterProgressionIntegration.test.ts --runInBand
npm run test:ci
npm run release:validate
```

## Próximo passo de execução

Aplicar este lote sobre `dnd-combat-math-mvp-app02-content-management.zip`, começando pelo provider unificado e pelos testes de consulta/deduplicação antes de alterar as telas.
