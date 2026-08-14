# APP-21 — Canais de publicação, rollout gradual e compatibilidade do aplicativo

## Objetivo

Adicionar uma camada assinada de publicação entre a distribuição remota do APP-20 e o download do catálogo. Essa camada determina se um manifesto de distribuição pode ser oferecido a um dispositivo com base no canal escolhido, na versão do aplicativo, na coorte determinística do rollout e no estado remoto da publicação, sem baixar ou aplicar o catálogo automaticamente.

## Separação de responsabilidades

O fluxo agora possui três etapas independentes:

1. **Publicação:** define canal, compatibilidade, rollout e notas de versão.
2. **Distribuição:** baixa o envelope assinado por mirrors e blocos verificáveis.
3. **Aplicação:** continua sendo executada exclusivamente pelo preview transacional do APP-17.

Mudar canal, importar uma publicação ou gerar uma evidência de elegibilidade não modifica o catálogo ativo, caches, personagens ou snapshots.

## Publicação assinada

Foi criado `src/catalog/catalogPublication.ts` com o schema:

- `dnd-catalog-publication.v1`.

Cada publicação preserva:

- identificador da publicação;
- publicador e chave;
- canal `stable`, `beta` ou `preview`;
- sequência;
- checksum exato do manifesto de distribuição;
- checksums do catálogo e do bundle;
- versão e snapshot;
- versão mínima e máxima do aplicativo;
- percentual de rollout;
- salt da coorte;
- notas de versão com checksum próprio;
- data de emissão, expiração opcional e assinatura ECDSA P-256.

A validação rejeita assinatura inválida, publicador não confiável, chave revogada, chave fora da validade, checksums inválidos, canal desconhecido, rollout fora de 0–100%, intervalo de versões invertido, notas adulteradas e divergência com o manifesto de distribuição.

## Canais e migração explícita

O dispositivo mantém um canal selecionado:

- `stable`;
- `beta`;
- `preview`.

Toda mudança exige confirmação explícita. A interface informa se a migração é para um canal mais experimental ou mais conservador.

A mudança de canal somente altera futuras publicações elegíveis. Ela não remove um catálogo já aplicado, não descarta caches, não migra personagens e não inicia download.

## Compatibilidade do aplicativo

Foi criado `src/config/appMetadata.ts`, mantido em sincronia com `app.json` por contrato automatizado.

A elegibilidade compara semanticamente:

- versão atual do aplicativo;
- versão mínima da publicação;
- versão máxima opcional.

Dispositivos fora do intervalo recebem evidência explícita `appTooOld` ou `appTooNew` e não podem baixar ou preparar o bundle.

## Rollout gradual e coortes

Cada instalação possui um identificador local persistido. A coorte é calculada por SHA-256 sobre:

- identificador local;
- publicador;
- publicação;
- canal;
- salt assinado.

O resultado permanece entre 0 e 9999. Uma publicação de 25% inclui scores entre 0 e 2499.

A decisão é determinística: a mesma instalação permanece na mesma coorte enquanto os parâmetros da publicação não mudarem. O identificador bruto não é exportado; as evidências preservam somente seu SHA-256.

## Notas de versão verificadas

As notas de versão incluem:

- locale;
- título;
- resumo;
- itens;
- checksum canônico.

Alterar o texto depois da assinatura invalida a publicação. A interface mostra as notas antes do download.

## Pausa, retomada e retirada

Foi criado o schema:

- `dnd-catalog-publication-control.v1`.

Controles assinados e revisionados permitem:

- `pause`;
- `resume`;
- `withdraw`.

As revisões precisam ser contíguas. Pausas repetidas, retomadas repetidas e saltos de revisão são rejeitados. `withdraw` é terminal: uma publicação retirada não pode ser reativada e deve ser substituída por uma nova publicação.

O controle é verificado novamente antes do download e antes de encaminhar um cache ao preview transacional.

## Evidência de elegibilidade

Cada avaliação pode gerar:

- `dnd-catalog-publication-eligibility.v1`.

A evidência registra:

- publicação e publicador;
- canal publicado e canal selecionado;
- versão atual e intervalo permitido;
- hash da coorte;
- score da coorte;
- percentual do rollout;
- estado ativo, pausado ou retirado;
- motivo da decisão;
- checksum do manifesto de distribuição;
- checksum próprio.

Alterações posteriores invalidam a evidência.

## Integração com o APP-20

`catalogDistributionStore` passou para a versão 2 e agora exige uma publicação elegível antes de:

- iniciar ou retomar download;
- materializar um cache no preview transacional.

Manifestos sem publicação correspondente, publicações de outro canal, versões incompatíveis, dispositivos fora do rollout, publicações pausadas ou retiradas são bloqueados.

A integração não adiciona aplicação automática. Depois do download, o usuário ainda precisa abrir o preview do APP-17 e confirmar a transação.

## Interface

Foi adicionada a rota:

- `app/catalog-publication.tsx`.

Ela permite:

- escolher o canal explicitamente;
- importar publicação assinada;
- importar controles assinados;
- consultar compatibilidade e rollout;
- ler notas verificadas;
- gerar evidência de elegibilidade;
- compartilhar evidências;
- consultar eventos locais.

Também foram adicionados acessos em Ajustes, Distribuição offline e Home.

## Ferramentas operacionais

Foram adicionados:

- `npm run catalog:publication:sign`;
- `npm run catalog:publication:control:sign`;
- `npm run catalog:publication:check`;
- `npm run catalog:publication:harness`;
- `npm run app21:linear`.

O guia operacional está em:

- `docs/CATALOG_PUBLICATION_CHANNELS.md`.

As ferramentas foram exercitadas com uma chave temporária externa à codebase. Publicação `stable` com rollout de 25% e controle de pausa foram assinados e validados.

## Testes E2E

Foram adicionados quatro fluxos Maestro:

1. migração explícita entre canais;
2. importação e evidência de rollout;
3. pausa assinada;
4. retirada e bloqueio de publicação.

O gate reconhece agora 51 fluxos transacionais.

## Validação

Passaram:

- linha de base herdada do APP-20: 66 verificações;
- passagem linear atual: 28/28;
- parsing TS/TSX: 350/350;
- typecheck estrito isolado do núcleo;
- typecheck estrito isolado da store de publicação;
- typecheck estrito isolado da store de distribuição;
- typecheck estrito isolado do teste;
- contratos APP-21;
- harness APP-21: 34/34;
- assinatura CLI da publicação;
- assinatura CLI do controle;
- busca por material privado na codebase: nenhum arquivo encontrado;
- localização dos 51 fluxos Maestro.

O harness confirmou canais, comparação de versões, notas adulteradas, assinatura adulterada, distribuição divergente, coorte determinística, rollout zero, evidência adulterada, pausa, retomada, retirada terminal e migração explícita entre canais.

## Limitações do ambiente

O registry interno não disponibiliza `zustand@5.0.14`. A instalação integral permaneceu classificada como `BLOCKED / REGISTRY_PACKAGE_MISSING` sem alterar o lockfile.

Por isso:

- o typecheck integral não encontrou `expo/tsconfig.base` e os tipos de React, Node e Jest;
- a suíte Jest não iniciou porque o executável não está instalado;
- o gate Android não executou por ausência de ADB, Maestro e dispositivo ou emulador.

Nenhum bloqueio ambiental foi convertido em aprovação.

## Próximo lote sugerido

**APP-22 — saúde do rollout e promoção assinada entre canais**

O próximo lote pode adicionar métricas locais de adoção e falha, evidências opt-in sem dados pessoais, limites de saúde assinados, expansão ou redução de rollout por revisão monotônica, promoção `preview → beta → stable`, recomendação de pausa sem ação automática, comparação entre coortes e rollback operacional preservando toda a cadeia de auditoria.
