# Diário operacional, reconciliação e recuperação

O APP-25 registra autorizações e execuções em uma cadeia append-only baseada em SHA-256.

## Encerramento

Uma operação somente pode ser encerrada depois que o estado efetivo for comparado ao resultado do recibo. Divergências bloqueiam o encerramento. Avisos exigem reconhecimento explícito.

## Interrupções

Sessões persistidas como `executing` são classificadas como `interrupted` após a hidratação. A retomada exige nova confirmação humana e reutiliza a mesma autorização de uso único de maneira idempotente.

## Correção e rollback

Correções exigem uma autorização de recuperação assinada, uma confirmação assinada por executor distinto e confirmação humana. A autorização é vinculada ao checksum exato do recibo e da reconciliação e só pode ser consumida uma vez.

## Arquivamento

O diário ativo pode mover um prefixo contínuo para um arquivo verificável. A primeira entrada remanescente continua ancorada ao head do arquivo, preservando a cadeia histórica.
