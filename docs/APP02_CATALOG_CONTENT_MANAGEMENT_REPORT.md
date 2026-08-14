# APP-02 — Inicialização, store e gerenciamento do catálogo

## Objetivo

Integrar o `CatalogLoader` do APP-01 à codebase real do D&D Combat Math e disponibilizar um fluxo seguro para controlar conteúdo por livro, categoria e entidade.

## Auditoria da codebase recebida

A aplicação já possuía:

- Expo Router e React Native/Expo;
- Zustand para stores locais;
- SQLite e AsyncStorage para persistência;
- compêndio importável com fontes, pacotes, revisão e mapeamento;
- bootstrap de um pacote PHB consolidado;
- telas de criação, progressão e combate;
- scripts locais de formato do projeto, acessibilidade e validação do compêndio.

O compêndio existente e o catálogo consolidado têm responsabilidades distintas:

- **compêndio local:** conteúdo importado, editável, revisável e associado a pacotes;
- **catálogo de regras:** índice consolidado e imutável usado para resolução, filtros e dependências.

O APP-02 mantém essas camadas separadas. Nenhum item local é apagado ou reescrito ao alterar os filtros do catálogo.

## Implementação

### Inicialização

`app/_layout.tsx` inicializa em paralelo:

1. o compêndio SQLite existente;
2. o catálogo consolidado v4.8.0.

O carregamento do catálogo é fail-closed. Versão, contagens, IDs, categorias, aliases e endpoints de dependências são validados antes de o estado passar para `ready`.

### Store

`src/store/catalogStore.ts` fornece:

- estados `idle`, `loading`, `ready` e `failed`;
- restauração das preferências persistidas;
- busca por nome, ID, tipo e fonte;
- avaliação de disponibilidade efetiva;
- prévia de alterações por livro, categoria, entidade e perfil;
- confirmação separada da prévia;
- contagem de dependências obrigatórias quebradas;
- persistência somente após confirmação;
- exportação e importação futura das preferências.

### Persistência

`src/storage/catalogFilterPreferences.ts` persiste apenas o estado dos filtros:

- livros ativos;
- categorias explicitamente ativas ou inativas;
- overrides individuais de entidades.

Ao trocar a versão do catálogo, IDs removidos são descartados e IDs compatíveis são preservados. Personagens, combates, snapshots e conteúdo importado não são modificados.

### Interface

A rota `app/content-management.tsx` oferece:

- métricas do catálogo;
- perfis rápidos;
- controle dos três livros oficiais;
- lista das 57 categorias;
- busca virtualizada de entidades;
- estado individual `Herdar`, `Ativar` ou `Desativar`;
- indicação de revisão editorial;
- prévia do número de entidades afetadas;
- alerta específico para dependências obrigatórias quebradas.

A tela está acessível por **Ajustes** e pelo **Compêndio**.

## Dados integrados

- versão: 4.8.0;
- entidades: 5.841;
- dependências: 15.385;
- categorias: 57;
- aliases: 127;
- bundle JSON: 10.548.880 bytes;
- SHA-256: `8c64d156da2653835ca2052b2618abdb1de93a4f6e6efe14a0afabdbebafed08`.

## Segurança das alterações

A precedência efetiva permanece:

1. livro desativado;
2. entidade protegida;
3. override individual;
4. estado explícito da categoria;
5. padrão da categoria ou entidade.

A prévia não altera o estado ativo. A gravação ocorre somente em `commitPendingChange`.

## Validação executada

Passaram:

- shape do projeto;
- contratos mínimos de acessibilidade;
- pacote PHB incluído;
- checksum e contagens do catálogo;
- contratos estáticos da nova tela/store;
- parsing sintático de 277 arquivos TS/TSX;
- typecheck estrito isolado do núcleo do catálogo, persistência e store;
- harness de runtime com 23 asserções reais.

O harness confirmou que desativar o Monster Manual afeta 2.077 entidades e sinaliza 75 quebras de dependência obrigatória.

## Limitação do ambiente de validação

A instalação integral das dependências não pôde ser concluída neste ambiente:

- o mirror npm disponível retornou 404 para `zustand@5.0.14` e `zod@4.4.3`;
- a tentativa pelo registry público falhou por resolução DNS (`EAI_AGAIN`).

Por isso, o typecheck integral da aplicação e a suíte Jest completa ficaram pendentes para execução no ambiente local do projeto. Nenhuma dependência ou versão do projeto foi alterada para contornar o bloqueio.

## Próximo lote

**APP-03 — ponte do catálogo para criação e progressão:** adaptar consultas de classes, subclasses, espécies, backgrounds, feats, magias e equipamentos para combinar o catálogo oficial com o compêndio local, respeitando filtros e precedência sem duplicar entidades.
