# Canais, rollout e compatibilidade do catálogo

O APP-21 separa publicação, distribuição e aplicação.

1. O publicador assina uma publicação vinculada ao checksum exato do manifesto de distribuição.
2. A publicação define canal (`stable`, `beta` ou `preview`), versões mínima/máxima do aplicativo, rollout percentual, salt de coorte e notas de versão verificadas.
3. O usuário escolhe explicitamente o canal no dispositivo.
4. O dispositivo calcula localmente uma coorte determinística. O identificador bruto não entra nas evidências; apenas seu SHA-256 é persistido.
5. O download só pode começar quando canal, versão, coorte e estado remoto estiverem elegíveis.
6. Download e cache não aplicam o catálogo. A aplicação continua passando pelo preview transacional do APP-17.

## Publicação

```bash
npm run catalog:publication:sign -- \
  --distribution catalog-distribution-manifest.json \
  --private-key /caminho/seguro/root-private-jwk.json \
  --notes release-notes.pt-BR.json \
  --channel stable \
  --min-app-version 0.1.0 \
  --max-app-version 0.2.0 \
  --rollout 25 \
  --cohort-salt "valor-aleatorio-com-pelo-menos-8-caracteres" \
  --out catalog-publication.json
```

## Pausa, retomada ou retirada

```bash
npm run catalog:publication:control:sign -- \
  --publication catalog-publication.json \
  --private-key /caminho/seguro/root-private-jwk.json \
  --action pause \
  --revision 1 \
  --reason "Pausa preventiva" \
  --out catalog-publication-control.json
```

A retirada (`withdraw`) é terminal. Uma publicação retirada não pode ser retomada; deve ser substituída por uma nova publicação assinada.

## Rollout

A coorte é calculada por SHA-256 sobre publicador, publicação, canal, salt e identificador local. O resultado fica entre 0 e 9999. Um rollout de 25% inclui scores de 0 a 2499. A mesma combinação sempre gera a mesma decisão.

## Migração entre canais

Mudar o canal somente altera publicações futuras elegíveis. O catálogo ativo, caches e fichas não são alterados, removidos ou migrados automaticamente.
