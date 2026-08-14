# APP-25 — Diário operacional imutável e reconciliação pós-execução

## Objetivo

Fechar o ciclo iniciado pelo APP-24 após o consumo de uma autorização operacional. Uma execução agora precisa ser registrada em cadeia append-only, comparada ao estado efetivo, encerrada explicitamente e acompanhada por evidência verificável. Divergências ou interrupções não podem ser ocultadas por um simples recibo de execução.

## Implementação

### Diário append-only

Foi criado `src/catalog/catalogOperationalJournal.ts` com entradas no schema `dnd-catalog-operational-journal-entry.v1`.

Cada entrada contém:

- sequência monotônica;
- SHA-256 da entrada anterior;
- horário;
- tipo do evento;
- autorização, sessão e recibo relacionados;
- detalhes mínimos da operação;
- SHA-256 próprio.

O diário cobre autorização aceita, executor confirmado, preparação, início, sucesso, falha, interrupção, retomada, reconciliação, recuperação e encerramento.

### Arquivamento verificável

Prefixos contínuos do diário podem ser movidos para `dnd-catalog-operational-journal-archive.v1`. O arquivo preserva a sequência inicial/final, a âncora anterior, o head final e o checksum do conteúdo. O diário ativo precisa continuar exatamente do último arquivo.

### Reconciliação pós-execução

O schema `dnd-catalog-operational-reconciliation.v1` compara o recibo ao estado efetivo das stores:

- canal selecionado;
- publicação alvo;
- percentual efetivo do rollout;
- sessão transacional do catálogo;
- status do rollback.

Uma mudança externa gera códigos específicos, como `OPERATIONAL_ROLLOUT_DRIFT` e `OPERATIONAL_CHANNEL_DRIFT`.

Estados possíveis:

- `passed`;
- `warning`;
- `failed`.

Execuções que falharam geram aviso e exigem reconhecimento explícito. Divergências bloqueantes impedem o encerramento.

### Encerramento e evidência

Uma operação somente é encerrada depois de uma reconciliação aprovada. O schema `dnd-catalog-operational-evidence.v1` preserva:

- recibo original;
- reconciliação;
- entradas relacionadas do diário;
- heads dos arquivos históricos;
- head final do diário;
- checksum próprio.

### Recuperação de interrupções

A store operacional passou para a versão 2. Sessões persistidas como `executing` são classificadas como `interrupted` durante a hidratação. A retomada exige nova confirmação humana e reaplica a operação de forma idempotente. Um rollback do catálogo já concluído não é duplicado.

### Correção ou rollback autorizado

Foram criados:

- `dnd-catalog-operational-recovery-authorization.v1`;
- `dnd-catalog-operational-recovery-confirmation.v1`.

A recuperação fica vinculada ao checksum exato do recibo e da reconciliação. Autoridade e executor usam chaves distintas. A autorização possui validade temporal, nonce, uso máximo igual a 1, confirmação humana obrigatória e `automaticExecution: false`.

Ações suportadas:

- reaplicar o estado esperado;
- restaurar o checkpoint anterior para rollout ou canal.

Reverter um rollback do catálogo continua exigindo uma nova autorização transacional do catálogo, pois não pode ser reduzido a um override local.

### Interface

Foi adicionada `app/catalog-operational-journal.tsx`, acessível pela tela de autorização operacional e por Ajustes. A tela oferece retomada, reconciliação, encerramento, importação de recuperação, compartilhamento de evidências e arquivamento.

## Persistência

- Store operacional: versão 2.
- Compatibilidade com o estado APP-24 por migração aditiva.
- Limites: 1.000 entradas ativas, 20 arquivos, 300 evidências, 200 execuções de recuperação.

## Validação

- regressão herdada: 190 verificações;
- verificações APP-25: 4/4;
- TypeScript/TSX sintático: 365/365;
- typecheck estrito isolado do núcleo: PASS;
- typecheck estrito isolado da store: PASS;
- typecheck estrito isolado do teste: PASS;
- harness: 40/40;
- quatro fluxos Maestro novos;
- 67 fluxos encontrados pelo gate;
- scanner de material privado: PASS.

O harness confirmou detecção de deriva, validação da cadeia, arquivamento, autorização de recuperação, confirmação do executor, bloqueio de replay, fechamento somente após reconciliação e rejeição de evidência adulterada.

## Limitações do ambiente

O typecheck integral e Jest permanecem bloqueados pela ausência de `node_modules`. O registry interno não possui `zustand@5.0.14`. A execução Android permanece bloqueada por ausência de ADB, Maestro e dispositivo conectado.
