# Autorização operacional do catálogo

O APP-24 separa decisão, autorização e execução.

## Barreiras obrigatórias

1. Uma decisão de quórum íntegra precisa estar no estado `approved`.
2. Uma autoridade operacional assina `dnd-catalog-operational-authorization.v1`.
3. O executor designado assina `dnd-catalog-executor-confirmation.v1` com outra chave.
4. O operador revisa a ação e confirma manualmente no aplicativo.
5. O aplicativo executa a ação uma única vez e gera `dnd-catalog-operational-execution-receipt.v1`.

A existência do quórum ou da autorização nunca executa uma ação automaticamente.

## Separação de responsabilidades

A chave do executor não pode ter participado das aprovações que formaram o quórum. A chave que assina a autorização também precisa ser diferente da chave do executor.

## Uso único e replay

A autorização contém `nonce`, `maximumUses: 1`, validade temporal e vínculo exato com:

- publicação;
- relatório agregado;
- decisão de quórum;
- ação e alvo;
- executor.

Qualquer recibo, inclusive de falha, consome a autorização. O checksum da autorização e o nonce são usados para rejeitar replay.

## Ações

- `expand`: instala um override operacional auditável de rollout.
- `pause`: reduz o rollout operacional para 0%.
- `promote`: realiza a migração explícita do canal selecionado.
- `rollback`: chama o rollback transacional da sessão de atualização indicada.

Falhas em expansão, pausa ou promoção restauram o checkpoint operacional anterior. O rollback usa o checkpoint do APP-17.

## Comandos

```bash
npm run catalog:operation:authorization:sign -- --input authorization.json --private-key authorizer.json --output authorization.signed.json
npm run catalog:operation:confirmation:sign -- --input confirmation.json --private-key executor.json --output confirmation.signed.json
npm run catalog:operation:check
npm run catalog:operation:harness
npm run app24:linear
```

Chaves privadas não devem ser incluídas na codebase, APK, backups, relatórios ou artefatos do gate.
