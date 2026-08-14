# APP-23 — Agregação verificável de saúde e decisão de release em quórum

## Objetivo

Consolidar evidências opt-in de múltiplas instalações sem transportar sinais brutos ou dados pessoais, aplicar limites mínimos de anonimato, produzir um relatório consolidado assinado e exigir aprovações criptográficas independentes antes de considerar uma decisão operacional pronta.

O APP-23 não executa automaticamente expansão, promoção, pausa ou rollback. Uma decisão aprovada apenas registra que o quórum foi atingido. As ações continuam dependentes dos documentos operacionais assinados e dos fluxos transacionais implementados nos lotes anteriores.

## Contratos adicionados

- `dnd-catalog-rollout-health-submission.v1`;
- `dnd-catalog-rollout-aggregation-policy.v1`;
- `dnd-catalog-rollout-aggregate-report.v1`;
- `dnd-catalog-release-approval.v1`;
- `dnd-catalog-release-quorum-decision.v1`.

## Submissões anônimas

Cada instalação mantém um segredo aleatório local. Ao exportar uma evidência do APP-22, o aplicativo deriva um token SHA-256 específico para a combinação de publicação e política de saúde.

O segredo local não é exportado. A submissão contém:

- token opaco;
- evidência opt-in íntegra;
- horário de envio;
- checksum próprio.

O mesmo contribuidor produz o mesmo token apenas dentro do contexto daquela publicação e política. Isso permite deduplicação sem revelar o identificador original da instalação.

## Política de agregação assinada

A política define:

- publicação e canal avaliados;
- política de saúde de origem;
- quantidade mínima de contribuidores únicos;
- quantidade mínima de contribuidores por coorte;
- idade máxima aceita para uma evidência;
- limites consolidados de saúde;
- aprovadores autorizados;
- número mínimo de aprovações independentes.

O limite mínimo permitido é três contribuidores. O quórum mínimo permitido é duas chaves independentes.

## Agregação

O agregador:

1. valida o checksum da submissão e da evidência;
2. rejeita publicação, canal, política ou revisão divergentes;
3. rejeita evidências antigas;
4. mantém apenas a contribuição mais recente de cada token;
5. exige o limite de anonimato da política;
6. soma as métricas operacionais;
7. recalcula taxas consolidadas;
8. suprime coortes abaixo do limite mínimo;
9. remove tokens e sinais brutos do relatório;
10. assina o relatório consolidado.

O relatório preserva somente os checksums das evidências aceitas.

## Decisão em quórum

Cada aprovação é vinculada ao checksum exato do relatório agregado e contém:

- aprovador;
- chave utilizada;
- ação avaliada;
- rollout ou canal alvo, quando aplicável;
- voto de aprovação ou rejeição;
- justificativa;
- assinatura.

A política impede que duas identidades usem a mesma chave para ampliar artificialmente o quórum. Aprovações duplicadas também não aumentam a contagem.

A decisão pode terminar como:

- `pending`;
- `approved`;
- `rejected`.

O campo `automaticExecution` é fixado em `false` e faz parte do checksum.

## Interface

Foi adicionada a rota:

`app/catalog-rollout-aggregation.tsx`

Ela permite:

- gerar e compartilhar submissões anônimas;
- importar a política assinada;
- importar o relatório consolidado;
- importar votos independentes;
- avaliar o quórum;
- consultar coortes suprimidas;
- compartilhar relatórios;
- revisar a auditoria local.

Há acesso pela tela de Ajustes e alerta na Home quando decisões estão pendentes ou rejeitadas.

## Persistência

Foi adicionada a store:

`src/store/catalogRolloutAggregationStore.ts`

Versão: 1.

Ela persiste:

- segredo local de contribuição;
- políticas;
- submissões;
- relatórios;
- aprovações;
- decisões;
- eventos de auditoria.

## Ferramentas operacionais

- `catalog:rollout:aggregation:policy:sign`;
- `catalog:rollout:aggregate`;
- `catalog:release:approval:sign`;
- `catalog:rollout:aggregation:check`;
- `catalog:rollout:aggregation:harness`.

As ferramentas foram exercitadas com chaves temporárias armazenadas fora da codebase.

## Validação

Passaram:

- regressão linear de 32 verificações atuais;
- 124 verificações herdadas;
- parsing de 358 arquivos TS/TSX;
- typecheck estrito isolado do núcleo;
- typecheck estrito isolado da store;
- typecheck estrito isolado do teste;
- harness APP-23 com 46 asserções;
- assinatura CLI de política, relatório e duas aprovações;
- scanner de material criptográfico privado;
- localização dos 59 fluxos Maestro.

O harness confirmou quatro contribuidores únicos, uma duplicata removida, uma evidência antiga rejeitada, supressão de coorte pequena e quórum aprovado por duas chaves independentes.

## Limitações ambientais

O `npm ci` continua bloqueado porque o registry interno não possui `zustand@5.0.14`. Sem a árvore `node_modules`, o typecheck integral, Jest e a execução Android não puderam ser concluídos.

O gate nativo também não encontrou ADB, Maestro ou dispositivo/emulador Android. Nenhum bloqueio foi convertido em aprovação.
