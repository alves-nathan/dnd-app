# APP-30 — Runbook de release de produção

## Princípio

Preparação, build, submissão, revisão da loja e disponibilidade pública são estados diferentes. Nenhum estado posterior pode ser declarado apenas porque o anterior foi concluído.

## Pré-requisitos bloqueantes

1. Trabalhar em uma árvore limpa e no commit destinado à release.
2. Instalar exatamente o `package-lock.json` com `npm ci`.
3. Aprovar o APP-28 na fingerprint atual.
4. Aprovar o APP-29 na mesma fingerprint e dentro da janela de validade.
5. Confirmar `EXPO_PUBLIC_E2E_SEED_ENABLED=false` no perfil production.
6. Confirmar versão, package Android, bundle identifier iOS e `runtimeVersion`.
7. Manter credenciais, keystores, arquivos `.p8`, `.p12`, service accounts e tokens fora do repositório e do pacote de entrega.

## Sequência Android

```bash
npm run app28:dependencies:install
npm run app28:gate
npm run app28:gate:verify
npm run app29:linear
npm run app29:gate
npm run app29:gate:verify
npm run app30:prepare
npm run app30:verify
npm run app30:build:android -- --execute
```

Após o build, registre o AAB e o JSON de metadados:

```bash
npm run app30:gate -- \
  --android-artifact /caminho/app-release.aab \
  --build-metadata /caminho/build-metadata.json \
  --allow-blocked
```

A submissão exige ação explícita e nunca é chamada pelo gate:

```bash
npm run app30:submit:android -- \
  --artifact /caminho/app-release.aab \
  --build-metadata /caminho/build-metadata.json \
  --execute
```

Depois da revisão/publicação, exporte um recibo operacional da loja e execute novamente o gate com `--publication-receipt`.

## Sequência iOS

O mesmo princípio se aplica ao iOS. A build e a submissão exigem conta Apple, credenciais e dispositivos/ambiente que não fazem parte da codebase. Não reutilize recibos Android para encerrar a plataforma iOS.

## Critérios de encerramento

O APP-30 só recebe `PASS` quando:

- APP-28 e APP-29 estão aprovados na mesma fingerprint;
- o artefato final existe e corresponde aos metadados do build;
- o recibo de publicação corresponde ao mesmo artefato e versão;
- a documentação operacional está íntegra;
- o pacote de entrega foi criado e verificado;
- nenhuma chave privada foi incluída;
- o recibo final de encerramento foi produzido.

## Proibições

- Não usar `--force` ou `--legacy-peer-deps` para aprovar dependências.
- Não habilitar seed E2E em produção.
- Não publicar uma build cuja fingerprint diverge das evidências.
- Não anunciar disponibilidade apenas porque o upload terminou.
- Não armazenar credenciais no repositório, relatórios ou ZIP de entrega.
