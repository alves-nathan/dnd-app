# Assinatura e cadeia de confiança do catálogo

## Princípios

O aplicativo aceita atualizações de catálogo apenas quando recebe um envelope `dnd-signed-catalog-bundle.v1` cuja assinatura, origem, sequência e vínculo com o último bundle aceito possam ser verificados localmente.

A chave privada nunca deve ser incluída no aplicativo, no repositório Git, em builds, backups compartilhados ou tickets. O aplicativo contém apenas a chave pública fixada e o respectivo fingerprint.

## Publicador oficial inicial

- Publicador: `dnd-combat-official`
- Chave: `root-2026-01`
- Algoritmo: `ECDSA_P256_SHA256`
- Curva: P-256
- Fingerprint público: `6c36087606050d42e5ccef7f4b4490351b62e811a0074ffdd812ccca451391a6`
- Âncora inicial: catálogo 4.8.0, sequência 0

## Gerar uma nova chave

```bash
npm run catalog:key:generate -- \
  --publisher-id dnd-combat-official \
  --publisher-name "D&D Combat Official Catalog" \
  --publisher-kind official \
  --key-id root-2027-01 \
  --output /caminho/offline/root-2027-01.private.jwk.json
```

O arquivo é criado com permissão `0600` quando o sistema operacional permitir. Transfira-o imediatamente para armazenamento offline protegido.

## Assinar um catálogo

A sequência deve ser exatamente a sequência anterior + 1. `--previous-checksum` deve ser o checksum canônico do último bundle aceito pelo publicador.

```bash
npm run catalog:sign -- \
  --catalog ./runtime-bundle-v4.9.0.json \
  --private-key /caminho/offline/root-2026-01.private.jwk.json \
  --output ./runtime-bundle-v4.9.0.signed.json \
  --sequence 1 \
  --previous-checksum 0728e21b17ce768039d9873da7ee32d80b36480ab871297143944ad7fce50c43
```

O comando calcula a versão, o snapshot, o checksum canônico e a assinatura. Não edite manualmente o envelope gerado.

## Rotacionar a chave

Primeiro gere a nova chave. Depois assine a declaração de rotação com a chave atualmente ativa:

```bash
npm run catalog:key:admin -- rotate \
  --current-private-key /offline/root-2026-01.private.jwk.json \
  --new-private-key /offline/root-2027-01.private.jwk.json \
  --publisher-id dnd-combat-official \
  --current-key-id root-2026-01 \
  --new-key-id root-2027-01 \
  --sequence 1 \
  --output ./rotation-root-2027-01.json
```

Importe a declaração na tela **Cadeia de confiança** antes de distribuir bundles assinados pela nova chave. A chave anterior passa a `retired`; bundles antigos continuam auditáveis, mas novos bundles devem usar a chave nova.

## Revogar uma chave

```bash
npm run catalog:key:admin -- revoke \
  --current-private-key /offline/root-2027-01.private.jwk.json \
  --publisher-id dnd-combat-official \
  --current-key-id root-2027-01 \
  --revoked-key-id community-key-01 \
  --reason "Chave comprometida" \
  --sequence 2 \
  --output ./revocation-community-key-01.json
```

Para revogar o publicador inteiro, use `--publisher` no lugar de `--revoked-key-id`.

## Publicadores comunitários

Um publicador comunitário só é aceito depois que o usuário confirma manualmente o fingerprint da chave pública. A aprovação é local e não transforma o publicador em oficial.

## Regras anti-replay e anti-rollback

- a sequência precisa avançar exatamente uma unidade;
- o bundle precisa apontar para o checksum do último bundle aceito;
- chaves revogadas ou retiradas não podem assinar novos bundles;
- assinaturas futuras, expiradas ou anteriores à validade da chave são rejeitadas;
- alterar catálogo ou proveniência invalida a assinatura;
- o registro de confiança participa do checkpoint e do rollback transacional.

## Verificação local

```bash
npm run catalog:trust:check
npm run catalog:trust:harness
```

O primeiro comando valida os contratos estáticos. O segundo executa assinatura válida, adulteração, replay, rotação, revogação e política comunitária contra o catálogo real.
