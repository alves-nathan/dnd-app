# Distribuição resiliente do catálogo

## Objetivo

O APP-20 separa publicação, download, verificação e aplicação. Um manifesto de distribuição assinado fixa a sequência, os checksums, os blocos e pelo menos dois mirrors HTTPS. Importar esse manifesto não baixa nem aplica conteúdo.

## Fluxo operacional

1. Gere um envelope assinado com `npm run catalog:sign`.
2. Crie um JSON com pelo menos dois mirrors. Cada item precisa de `mirrorId`, `label`, `priority`, `statusUrl` e `chunkUrlTemplate` contendo `{index}`.
3. Gere o manifesto:

```bash
npm run catalog:distribution:sign -- \
  --bundle catalog-signed.json \
  --mirrors mirrors.json \
  --private-key catalog-private.jwk.json \
  --out catalog-distribution.json
```

4. Publique cada bloco exatamente como foi dividido pelo manifesto. O endpoint de status deve responder `dnd-catalog-mirror-status.v1` com sequência, checksums, tamanho e quantidade de blocos.
5. Importe o manifesto na tela **Distribuição offline do catálogo**.
6. Verifique os mirrors e faça o download. O cache só é marcado como verificado depois da validação dos blocos, do checksum integral e da assinatura do envelope.
7. Abra o preview transacional. Nenhum download altera o catálogo ativo por conta própria.

## Segurança

- Mirrors atrasados ou conflitantes nunca entram no ranking.
- Cada bloco possui SHA-256 assinado.
- O envelope completo é revalidado offline antes de entrar no cache.
- Retomadas reutilizam somente blocos já verificados.
- A evidência de download registra os mirrors utilizados e possui checksum próprio.
- O modo assistido respeita limites de tamanho e políticas de dados móveis, roaming e rede desconhecida.
