# APP-11 — Impacto preventivo das alterações do catálogo

## Objetivo

Integrar os manifestos de compatibilidade ao gerenciamento de conteúdo para identificar, antes do commit de um filtro, quais personagens ficariam incompatíveis. O lote impede desativações silenciosas, exige reconhecimento explícito e pode iniciar planos preventivos sem escolher substituições, remover referências ou modificar fichas automaticamente.

O APP-11 preserva os princípios dos lotes anteriores:

- o preview não altera filtros nem personagens;
- somente problemas novos são atribuídos à alteração pendente;
- problemas preexistentes continuam visíveis, mas não contaminam o impacto preventivo;
- cada personagem mantém seu próprio plano e seu próprio commit;
- um plano já existente é preservado;
- nenhuma decisão de remediação é criada automaticamente.

## Auditoria do APP-10

O APP-10 já oferecia recuperação, quarentena, visão agregada e commits independentes dos planos. O gerenciamento do catálogo, porém, ainda conseguia confirmar uma desativação conhecendo apenas o impacto sobre entidades e dependências do catálogo. Ele não informava quais fichas utilizavam esse conteúdo nem oferecia um caminho preventivo para remediação.

## Implementação

### Motor de impacto preventivo

O módulo `src/characters/catalogChangeImpact.ts` compara, para cada personagem, dois manifestos completos:

1. o manifesto com os filtros atualmente confirmados;
2. o manifesto projetado com a alteração pendente.

A comparação produz o schema `dnd-catalog-character-impact.v1` e registra:

- personagens examinados e afetados;
- referências que passam de disponíveis para desativadas;
- bloqueios e avisos introduzidos pela alteração;
- entidades, livros e categorias relacionados;
- relatórios antes e depois para cada ficha;
- grupos compartilhados por entidade, livro e categoria.

Atribuição preventiva usa diferença de issues e transição de status. Assim, uma incompatibilidade anterior não é apresentada como consequência da nova alteração.

### Reconhecimento explícito

A rota `app/content-management.tsx` passou a exibir um **Preview preventivo** sempre que existe uma alteração pendente.

Quando há personagens afetados ou dependências obrigatórias quebradas, o commit fica bloqueado até o usuário reconhecer explicitamente o impacto. O usuário pode:

- cancelar e descartar a alteração;
- aplicar somente a configuração;
- aplicar a configuração e iniciar planos preventivos.

Cancelar mantém filtros, personagens e planos inalterados.

### Planos preventivos

`createPreventiveCompatibilityPlans` cria um plano apenas para personagens afetados que ainda não possuem plano ativo.

O plano recebe:

- origem `preventiveCatalogChange`;
- label da alteração;
- snapshot do catálogo;
- entidades, livros e categorias afetados;
- manifesto posterior à alteração;
- zero decisões de substituição, remoção ou migração.

Planos existentes são ignorados e preservados. O plano preventivo apenas abre o trabalho de revisão; a ficha continua exigindo as decisões e o commit individual do APP-09/APP-10.

### Interface dos planos

As telas individual e global distinguem planos de diagnóstico de planos preventivos e deixam explícito que nenhuma decisão foi tomada automaticamente.

### Persistência

Não foi necessária nova migração. A store permanece na versão **23** porque `origin` e `preventiveContext` são campos opcionais e retrocompatíveis no schema do plano.

### Fluxos E2E

Foram adicionados três fluxos Maestro:

1. visualizar o personagem afetado antes de desativar uma entidade;
2. cancelar a alteração e remover o preview sem alterar o estado confirmado;
3. reconhecer o impacto, aplicar a desativação e iniciar um plano preventivo.

O gate nativo passou a reconhecer onze fluxos transacionais no total.

## Segurança

O harness confirmou que:

- construir o preview não modifica personagens;
- apenas incompatibilidades novas são contadas;
- ativar conteúdo não cria impacto de remediação;
- um plano já existente não é substituído;
- planos novos começam sem decisões;
- nenhuma ficha é alterada ao criar planos preventivos;
- os commits continuam independentes por personagem.

## Validação executada

Passaram:

- shape do projeto;
- contratos mínimos de acessibilidade;
- pacote mecânico incluído com 1.284 itens;
- catálogo v4.8.0 com 5.841 entidades e 15.385 dependências;
- contratos APP-02 a APP-10;
- contratos estáticos APP-11;
- parsing sintático de 308 arquivos TS/TSX;
- typecheck estrito isolado do núcleo;
- harness APP-11 com 23 asserções;
- descoberta dos onze fluxos do gate nativo.

### Cenário do harness

O harness desativou `Acid Splash` no catálogo real e avaliou três personagens. Duas fichas utilizavam a magia e passaram a ter um bloqueio novo cada. O resultado agrupou corretamente a mesma entidade, o livro `phb-2024` e a categoria `phb-2024-spells`.

Um personagem já possuía plano ativo e foi preservado; o outro recebeu um plano preventivo sem decisões. A operação inversa, reativando a entidade, não produziu impacto de remediação.

## Limitações do ambiente

O typecheck integral e a suíte Jest completa foram tentados, mas `node_modules` não está disponível.

O typecheck ficou bloqueado pela ausência de:

- `expo/tsconfig.base`;
- tipos de Jest;
- tipos de Node;
- tipos de React.

A suíte Jest não iniciou porque o executável `jest` não está instalado.

O gate nativo encontrou corretamente os onze fluxos, mas ficou bloqueado por:

- dependências integrais ausentes;
- ADB indisponível;
- Maestro indisponível;
- nenhum dispositivo Android acessível.

Nenhum bloqueio foi convertido em aprovação.

## Próximo lote recomendado

**APP-12 — histórico transacional das configurações do catálogo**:

- registrar cada commit de livro, categoria e entidade;
- vincular a alteração ao preview preventivo reconhecido;
- exibir autor local, horário, filtros anteriores e posteriores;
- permitir restaurar uma configuração anterior por nova transação;
- recalcular impacto antes da restauração;
- reconciliar planos preventivos que se tornarem obsoletos;
- impedir rollback silencioso que volte a afetar personagens;
- adicionar fluxos E2E de histórico, restauração, cancelamento e revalidação.
