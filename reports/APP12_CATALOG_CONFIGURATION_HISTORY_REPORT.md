# APP-12 — Histórico transacional das configurações do catálogo

## Objetivo

Registrar cada alteração confirmada nos filtros do catálogo como uma transação auditável e permitir a restauração de estados anteriores sem rollback silencioso. Toda restauração volta ao mesmo preview preventivo usado para alterações manuais, recalcula o impacto nas fichas e exige novo reconhecimento quando necessário.

## Auditoria do APP-11

O APP-11 já calculava o impacto preventivo antes de desativar livros, categorias ou entidades e podia iniciar planos de remediação vazios. Entretanto, depois do commit, o aplicativo preservava somente o estado atual dos filtros. Não existia histórico contendo estado anterior/posterior, vínculo com o reconhecimento preventivo ou uma forma segura de restaurar configurações.

## Implementação

### Schema de commit

Foi criado o schema `dnd-catalog-configuration-commit.v1` em `src/catalog/catalogConfigurationHistory.ts`.

Cada commit registra:

- ID e revisão monotônica;
- horário de confirmação;
- autor local (`Usuário local`);
- label e origem da operação;
- versão e snapshot do catálogo;
- filtros anteriores e posteriores;
- livros, categorias e entidades alterados;
- contagens de ativação/desativação e quebras obrigatórias;
- reconhecimento preventivo;
- personagens afetados;
- planos preventivos solicitados;
- planos obsoletos removidos ou preservados;
- commit de origem quando a operação é uma restauração.

As origens suportadas são livro, categoria, entidade, perfil, reset, importação, restauração e operação manual.

### Persistência atômica

O documento de preferências existente foi estendido de forma retrocompatível com:

- `revision`;
- `history`.

O estado atual e o novo commit são gravados no mesmo documento do AsyncStorage. Documentos antigos sem histórico continuam válidos e são hidratados com revisão zero. O histórico é limitado aos 50 commits mais recentes.

### Store do catálogo

`src/store/catalogStore.ts` agora mantém:

- `history`;
- `revision`;
- origem da alteração pendente;
- vínculo de restauração;
- `previewHistoryRestore`;
- ID do commit gerado no resultado da confirmação.

Todas as operações existentes passaram a identificar sua origem. Uma restauração não grava diretamente: ela cria um novo `PendingCatalogFilterChange` e retorna ao preview preventivo.

### Tela de histórico

A nova rota `app/catalog-history.tsx` apresenta:

- revisão atual;
- commits em ordem decrescente;
- autor e horário;
- métricas antes/depois;
- quantidade de livros, categorias e entidades alterados;
- reconhecimento preventivo;
- vínculo com o commit restaurado;
- reconciliação de planos preventivos.

Cada entrada oferece:

- restaurar a configuração anterior ao commit;
- reaplicar o estado posterior daquele commit.

Ambas as ações abrem uma nova transação no gerenciamento de conteúdo.

### Reconciliação de planos preventivos

`reconcilePreventiveCompatibilityPlans` revalida planos contra o estado projetado dos filtros.

- Planos preventivos vazios cuja causa desapareceu são classificados como obsoletos e removidos somente após o commit da configuração.
- Planos que já possuem decisões manuais nunca são removidos automaticamente; permanecem disponíveis e geram aviso para revisão.
- Personagens não são modificados durante a reconciliação.
- O resultado é registrado no commit do catálogo.

### Integração de interface

O gerenciamento de conteúdo agora mostra:

- revisão e quantidade de commits;
- acesso direto ao histórico;
- aviso específico para previews de restauração;
- quantidade de planos que ficarão obsoletos;
- quantidade de planos com decisões que serão preservados.

A tela de Ajustes também recebeu acesso ao histórico das regras.

### Fluxos E2E

Foram adicionados quatro cenários Maestro:

1. visualizar o histórico transacional;
2. iniciar e cancelar uma restauração;
3. confirmar uma restauração como nova transação;
4. revalidar planos preventivos durante a restauração.

O gate nativo reconhece agora 15 fluxos transacionais.

## Segurança

O APP-12 mantém os seguintes contratos:

- consultar o histórico não altera filtros;
- selecionar um commit não altera filtros;
- cancelar a restauração mantém o estado atual;
- restauração sempre passa por preview preventivo;
- novo impacto nas fichas exige novo reconhecimento;
- planos com decisões manuais são preservados;
- fichas permanecem inalteradas;
- a restauração gera novo commit, preservando a cadeia de auditoria.

## Validação executada

Passaram:

- shape do projeto;
- acessibilidade;
- compêndio incluído;
- catálogo v4.8.0 com 5.841 entidades;
- contratos APP-02 a APP-11;
- contratos estáticos APP-12;
- parsing de 311 arquivos TS/TSX;
- typecheck estrito isolado do núcleo APP-12;
- harness APP-12 com 21 asserções;
- descoberta dos 15 fluxos Maestro;
- integridade do pacote final.

O harness confirmou dois commits persistidos, revisão monotônica, vínculo da restauração com o commit original, reconhecimento de personagem afetado e reconciliação diferenciada entre plano vazio e plano com decisão manual.

## Limitações do ambiente

O typecheck integral e a suíte Jest foram solicitados, mas a árvore `node_modules` não está disponível.

O typecheck integral ficou bloqueado pela ausência de `expo/tsconfig.base` e dos tipos de React, Node e Jest. A suíte Jest não iniciou porque o executável `jest` não está instalado.

O gate Android encontrou todos os 15 fluxos, mas ficou bloqueado pela ausência de dependências integrais, ADB, Maestro e dispositivo Android acessível. Nenhum bloqueio foi convertido em aprovação.

## Próximo lote recomendado

**APP-13 — backup portátil do catálogo e auditoria**:

- incluir filtros atuais, revisão e histórico no backup do aplicativo;
- validar integridade e versão do histórico na restauração;
- comparar histórico local e importado;
- tratar conflitos sem sobrescrever silenciosamente;
- oferecer importação como nova transação;
- preservar vínculos com planos preventivos;
- adicionar fluxos E2E de exportação, importação, conflito e cancelamento.
