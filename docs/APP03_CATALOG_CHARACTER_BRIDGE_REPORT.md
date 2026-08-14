# APP-03 — Ponte do catálogo para criação e progressão

## Objetivo

Integrar o catálogo oficial imutável do APP-02 às telas de criação e progressão, mantendo o compêndio local independente e evitando duplicação de entidades oficiais.

## Resultado

O APP-03 foi implementado sobre a codebase do APP-02 sem copiar entidades oficiais para o SQLite local. O catálogo fornece identidade canônica, disponibilidade, filtros, aliases e proveniência. O compêndio fornece o payload mecânico já compatível com o mapper, usado apenas em memória como carrier transitório.

## Arquitetura implementada

### `CharacterChoiceBridge`

A nova camada em `src/catalog/` combina:

- snapshot do catálogo v4.8.0;
- preferências ativas do gerenciamento de conteúdo;
- itens do compêndio local;
- fontes locais habilitadas;
- resolução de aliases e identidade canônica.

Os IDs expostos ao fluxo de personagem são namespaced:

- `catalog:<entityId>` para conteúdo oficial;
- `compendium:<storedItemId>` para conteúdo local ou homebrew.

### Deduplicação e colisões

A resolução usa, nesta ordem:

1. ID oficial explícito no payload;
2. alias ativo do catálogo;
3. ID/import ID direto;
4. combinação de tipo, livro e nome normalizado.

Um item local que funciona apenas como payload de uma entidade oficial não aparece como uma segunda escolha. Overrides locais só substituem a escolha oficial quando declaram explicitamente `catalogOverride` ou `overrideOfficial`. Colisões ambíguas permanecem separadas e sinalizadas; não ocorre mesclagem silenciosa apenas pelo nome.

### Disponibilidade

- Entidades oficiais respeitam livro, categoria, override individual e política de conteúdo do APP-02.
- Entidades oficiais com `manualReviewRequired` continuam utilizáveis, com aviso editorial.
- Itens locais exigem fonte habilitada e status `validated`.
- Entidades oficiais sem payload mecânico permanecem resolvíveis, mas indisponíveis para aplicação.
- Escolhas antigas desativadas continuam visíveis como referências bloqueadas para permitir correção do save ou rascunho.

### Aplicação ao personagem

`applyCharacterChoice` adapta a escolha somente em memória para o mapper existente. A aplicação persiste:

- ID namespaced da escolha;
- origem `catalog` ou `compendium`;
- entidade canônica;
- livro/fonte;
- versão e snapshot do catálogo;
- carrier local usado para o payload, quando aplicável.

A aplicação é idempotente por identidade canônica e não duplica links já ativos.

## Integração das telas

### Criação

`app/characters/new.tsx` agora consome a ponte unificada para classes, subclasses, espécies, backgrounds, feats, equipamentos e magias.

Também foram adicionados:

- persistência de `catalogSnapshotId` no personagem;
- retomada segura de rascunhos antigos;
- bloqueio fail-closed enquanto catálogo/compêndio não estiverem prontos;
- bloqueio de rascunhos que contenham escolhas desativadas ou removidas;
- descrição visual de origem, livro e revisão editorial.

### Progressão

`app/characters/[id]/level-up.tsx` agora usa a mesma ponte e:

- exige confirmação explícita ao migrar entre snapshots;
- bloqueia classe existente indisponível;
- bloqueia classe, subclasse, feat, invocation ou escolha vinculada desativada;
- exige subclasse quando uma escolha compatível foi liberada;
- grava o snapshot atual somente após a confirmação do level up.

## Compatibilidade e migrações

- versão do store de personagens: **19**;
- versão do rascunho de criação: **8**;
- IDs oficiais legados `phb-2024-*`, `dmg-2024-*` e `mm-2025-*` são normalizados para `catalog:*`;
- IDs locais compostos são normalizados para `compendium:*`;
- referências simples legadas são preservadas quando não há identidade oficial segura;
- migrações percorrem escolhas aninhadas, equipamentos, magias, feats e invocations;
- migração atual permanece idempotente.

## Dados reais verificados

O harness usou o catálogo completo e o pacote PHB incluído na aplicação:

| Métrica | Resultado |
|---|---:|
| Catálogo | 4.8.0 |
| Entidades | 5.841 |
| Dependências | 15.385 |
| Categorias | 57 |
| Aliases | 127 |
| Escolhas oficiais utilizáveis | 1.066 |
| Total incluindo indisponíveis | 3.988 |
| Duplicatas locais ocultadas | 1.066 |
| Referências indisponíveis preservadas | 2.922 |
| Colisões ambíguas preservadas | 58 |
| Asserções do harness real | 35/35 |

## Validação

Passaram:

- parsing sintático de 287 arquivos TS/TSX;
- typecheck estrito isolado do núcleo APP-03;
- 32 testes compilados e executados em harness isolado;
- harness de integração real com 35 asserções;
- shape do projeto;
- contratos mínimos de acessibilidade;
- integridade do compêndio incluído;
- checksum e contagens do catálogo;
- contratos estáticos do APP-02;
- contratos estáticos da ponte APP-03.

## Limitação do ambiente

O arquivo recebido não contém `node_modules`. Assim:

- `npm run typecheck` integral não pôde resolver `expo/tsconfig.base` e os tipos de Jest, Node e React;
- a suíte Jest integral não iniciou porque o executável `jest` não está instalado.

Nenhuma dependência ou versão foi alterada para mascarar o bloqueio. Os logs estão em `reports/app-03-full-typecheck-blocker.log` e `reports/app-03-jest-blocker.log`.

## Próximo lote recomendado

**APP-04 — fechamento de escolhas e progressão orientada por dependências:** substituir consultas residuais diretas ao compêndio nos editores secundários, resolver escolhas pendentes por dependências do catálogo e ampliar os testes de integração nativos após restaurar as dependências do projeto.
