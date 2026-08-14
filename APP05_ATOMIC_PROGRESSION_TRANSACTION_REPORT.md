# APP-05 — Transação atômica de progressão

## Objetivo

Consolidar level-up e resolução de escolhas pendentes em uma única transação persistida, com preview completo, validação conjunta, confirmação única, detecção de conflito, descarte seguro, auditoria de antes/depois e rollback controlado.

## Resultado

O APP-05 foi implementado sobre a codebase do APP-04. O personagem publicado não é mais alterado enquanto o usuário distribui níveis ou resolve escolhas decorrentes da progressão. Todas as mudanças permanecem em um rascunho separado até o commit.

O fluxo cobre tanto level-up quanto pendências antigas abertas fora do level-up. Nesses casos, a Central de progressão cria automaticamente uma transação do tipo `pendingResolution` antes de encaminhar o usuário ao editor correspondente.

## Núcleo transacional

`src/characters/progressionTransaction.ts` introduz o modelo de transação de progressão.

Cada `CharacterProgressionDraft` armazena:

- identificador da transação e do personagem;
- tipo da transação;
- snapshot base completo;
- snapshot de trabalho completo;
- fingerprint do personagem publicado no início da operação;
- snapshot-alvo do catálogo, quando aplicável;
- autorização explícita para migração de snapshot;
- operações registradas para auditoria;
- estado `draft`, `ready` ou `blocked`.

Os snapshots não incluem o próprio histórico transacional. Isso impede que a inclusão de uma entrada de auditoria provoque falso conflito ou altere a identidade do estado mecânico do personagem.

## Preview

`validateProgressionDraft` produz um preview que contém:

- nível anterior e projetado;
- alterações por classe;
- entidades adicionadas e removidas;
- campos alterados;
- escolhas pendentes antes e depois;
- snapshot do catálogo antes e depois;
- operações registradas;
- erros bloqueantes e avisos.

A comparação detecta mudanças mesmo quando uma coleção mantém o mesmo tamanho, como a substituição de uma magia, feat, item ou subclass.

## Validações antes do commit

O commit é bloqueado quando ocorre qualquer uma destas situações:

- o personagem foi alterado depois que a transação começou;
- o identificador do personagem não corresponde ao rascunho;
- a soma dos níveis de classe não corresponde ao nível total;
- existe classe com nível inválido;
- o snapshot-alvo não foi aplicado integralmente;
- uma migração de snapshot ainda não foi aprovada;
- existe escolha obrigatória não resolvida;
- uma coleção mecânica contém IDs duplicados;
- não existe alteração real no preview.

Trocas opcionais de magia permanecem como aviso e não bloqueiam o commit.

## Detecção de conflito

`characterProgressionFingerprint` calcula uma assinatura determinística do estado publicado, excluindo somente o histórico transacional.

No commit, a assinatura atual é comparada com `baseFingerprint`. Caso outra tela, sincronização ou processo tenha alterado o personagem durante a progressão, o commit retorna `PROGRESSION_TRANSACTION_CONFLICT`, mantém o rascunho e exige recriação ou descarte do preview.

## Store persistida

`src/store/characterStore.ts` passou a persistir `progressionDrafts` e expõe:

- `beginProgressionTransaction`;
- `updateProgressionDraft`;
- `discardProgressionTransaction`;
- `commitProgressionTransaction`;
- `rollbackProgressionTransaction`.

O commit ocorre em uma única atualização do Zustand:

1. recupera o personagem publicado e o rascunho;
2. valida o conjunto completo;
3. em caso de erro, mantém o personagem intacto e preserva o draft bloqueado;
4. em caso de sucesso, troca o personagem pelo snapshot projetado e remove o draft na mesma atualização.

Excluir um personagem também remove seu rascunho pendente.

## Sessão transacional dos editores

`src/characters/useCharacterProgressionSession.ts` fornece uma visão única para os editores:

- sem transação, retorna o personagem publicado e grava normalmente;
- com transação ativa, retorna o snapshot de trabalho e redireciona todas as alterações para o draft;
- oferece resolução padronizada de `CharacterPendingChoice`.

Foram adaptados:

- classes;
- identidade;
- proficiências;
- equipamento;
- feats;
- magias;
- Eldritch Invocations;
- Pact Weapon;
- poderes especializados de Warlock;
- seletor do compêndio do personagem.

Os editores retornam à Central de progressão quando operam dentro de uma transação.

## Level-up

`app/characters/[id]/level-up.tsx` não grava mais diretamente na ficha.

O fluxo agora:

1. monta a versão projetada do personagem;
2. registra a operação de level-up;
3. registra reconciliações mecânicas aplicadas;
4. registra eventual migração de snapshot;
5. cria a transação persistida;
6. encaminha para o preview da Central de progressão.

Uma transação já aberta não pode ser substituída silenciosamente por outro level-up.

## Central de progressão

`app/characters/[id]/progression.tsx` tornou-se o ponto único de controle da transação.

A tela apresenta:

- métricas de antes e depois;
- mudanças por classe;
- coleções adicionadas ou removidas;
- migração de snapshot;
- operações de auditoria;
- issues bloqueantes e avisos;
- escolhas ainda pendentes;
- ações de confirmar tudo ou descartar;
- histórico transacional;
- rollback da última transação elegível.

Pendências antigas iniciadas fora de um level-up também passam por esse fluxo antes de serem editadas.

## Auditoria e rollback

Cada commit cria um `CharacterProgressionAuditEntry` contendo:

- transação original;
- tipo;
- autor lógico da ação;
- timestamps;
- snapshot completo anterior;
- snapshot completo posterior;
- resumo das alterações;
- operações registradas;
- status `committed`.

O histórico é limitado às 20 entradas mais recentes para impedir crescimento indefinido do save.

O rollback:

- somente aceita a última transação confirmada ainda não revertida;
- é recusado quando existe draft ativo;
- verifica se o personagem ainda corresponde exatamente ao estado posterior auditado;
- restaura o snapshot anterior integralmente;
- acrescenta uma entrada `rolledBack` ligada à transação original.

## Migração

A store de personagens passou para a versão 20.

A migração:

- inicializa `progressionTransactions` em personagens antigos;
- inicializa `progressionDrafts` no estado persistido;
- preserva personagens, escolhas, snapshots e conteúdo existente;
- mantém compatibilidade com a versão 8 dos rascunhos de criação.

## Arquivos principais

### Novos

- `src/characters/progressionTransaction.ts`;
- `src/characters/useCharacterProgressionSession.ts`;
- `src/tests/characterProgressionTransaction.test.ts`;
- `scripts/check-progression-transaction.js`;
- `scripts/run-app05-runtime-harness.js`.

### Alterados

- `src/types/index.ts`;
- `src/store/characterStore.ts`;
- `src/storage/characterMigrations.ts`;
- `app/characters/[id]/level-up.tsx`;
- `app/characters/[id]/progression.tsx`;
- editores secundários de personagem;
- `package.json`;
- testes de integração de progressão.

## Validação executada

Passaram:

- shape do projeto;
- contratos mínimos de acessibilidade;
- integridade do compêndio incluído;
- checksum e contagens do catálogo v4.8.0;
- contratos dos APP-02, APP-03 e APP-04;
- contratos transacionais do APP-05;
- parsing sintático de 293 arquivos TS/TSX;
- typecheck estrito isolado do núcleo transacional;
- typecheck estrito isolado da store e do hook de sessão;
- harness transacional com 24 asserções.

O harness confirmou:

- personagem publicado intacto antes do commit;
- commit atômico;
- bloqueio por escolha obrigatória;
- manutenção de escolha opcional como aviso;
- detecção de edição concorrente;
- exigência de aprovação da migração de snapshot;
- rollback exato do estado anterior;
- inclusão do histórico de commit e rollback.

## Limitação do ambiente

O arquivo-fonte recebido não contém `node_modules`. Por isso:

- `npm run typecheck` integral não consegue resolver `expo/tsconfig.base` e os tipos de React, Node e Jest;
- a suíte Jest não inicia porque o executável `jest` não está instalado.

Nenhuma dependência ou versão foi alterada para ocultar esse bloqueio. Os logs estão em:

- `reports/app-05-full-typecheck-blocker.log`;
- `reports/app-05-jest-blocker.log`.

## Próximo lote recomendado

**APP-06 — recuperação transacional e gate nativo de integração:** restaurar as dependências no ambiente de desenvolvimento, executar typecheck e Jest integrais como gate obrigatório, adicionar testes de retomada após reinício/crash, validar persistência de drafts no dispositivo e criar cenários E2E para commit, descarte, conflito e rollback.
