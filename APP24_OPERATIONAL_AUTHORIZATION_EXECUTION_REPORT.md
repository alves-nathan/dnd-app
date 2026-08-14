# APP-24 — Autorização operacional e execução controlada

## Objetivo

Transformar uma decisão de release aprovada em uma autorização operacional temporária e de uso único, mantendo separação entre aprovadores, autoridade operacional, executor e operador humano.

## Implementação

### Contratos criptográficos

Foram adicionados:

- `dnd-catalog-operational-authorization.v1`;
- `dnd-catalog-executor-confirmation.v1`;
- `dnd-catalog-operational-execution-receipt.v1`.

A autorização vincula publicação, relatório consolidado, decisão de quórum, ação, alvo, executor, nonce e janela temporal. A confirmação do executor referencia o checksum integral da autorização.

### Separação de chaves

A validação rejeita:

- executor cuja chave participou do quórum;
- executor usando a chave da autoridade operacional;
- autorização assinada por chave não confiável, revogada ou fora da validade;
- confirmação emitida por outro executor;
- ação ou alvo divergente da decisão aprovada.

### Confirmação humana

A store somente executa após chamada explícita com `humanConfirmed: true`. A interface apresenta um alerta final informando que a autorização será consumida mesmo em caso de falha.

### Execução

- expansão e pausa utilizam overrides operacionais persistidos no store de saúde;
- promoção usa a migração confirmada do canal de publicação;
- rollback usa a sessão transacional ativa do APP-17;
- falhas restauram o checkpoint de canal e overrides quando aplicável.

### Recibo e replay

Toda tentativa gera recibo com checksum. Autorização e nonce ficam consumidos após sucesso ou falha. Uma segunda tentativa é rejeitada.

## Interface

Nova rota:

`app/catalog-operational-authorization.tsx`

Acesso disponível em Ajustes e na tela de agregação/quórum.

## Validação

- regressão linear atual: 34/34;
- verificações herdadas: 156;
- TypeScript sintático: 362/362;
- typecheck estrito do núcleo: PASS;
- typecheck estrito da store: PASS;
- harness APP-24: 38/38;
- contratos APP-24: PASS;
- fluxos Maestro encontrados: 63/63;
- novos fluxos APP-24: 4/4;
- scanner de chaves privadas: PASS;
- assinatura CLI da autorização e confirmação: PASS.

## Limitações ambientais

O typecheck integral e Jest ficaram bloqueados porque `node_modules` não está disponível. O registry interno não oferece `zustand@5.0.14`. A execução Android permaneceu bloqueada por ausência de ADB, Maestro e dispositivo.
