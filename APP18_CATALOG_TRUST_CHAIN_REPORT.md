# APP-18 — Assinatura e cadeia de confiança dos catálogos

## Objetivo

Garantir que uma atualização preparada pelo APP-17 só possa chegar ao preview e ao commit quando sua origem, integridade e continuidade criptográfica forem comprovadas localmente.

## Resultado

O APP-18 foi implementado sobre a codebase do APP-17. Bundles JSON sem envelope assinado são rejeitados no fluxo de produção. O commit transacional preserva a proveniência verificada no recibo e inclui o registro de confiança no checkpoint, permitindo rollback integral da versão do catálogo e da cadeia de confiança.

## Modelo criptográfico

- envelope: `dnd-signed-catalog-bundle.v1`;
- registro: `dnd-catalog-trust-registry.v1`;
- algoritmo: `ECDSA_P256_SHA256`;
- curva: NIST P-256;
- assinatura: IEEE P1363 em base64url;
- checksum: SHA-256 sobre a representação canônica do catálogo;
- cadeia: sequência monotônica e checksum do bundle anteriormente aceito.

A verificação ECDSA e SHA-256 usada no runtime é implementada em TypeScript sem dependência nativa adicional. O harness assina com a implementação criptográfica do Node.js e verifica no motor do aplicativo, oferecendo validação cruzada entre implementações. Como qualquer código criptográfico, o módulo deve receber revisão especializada antes de ser tratado como fronteira de segurança de alto risco.

## Publicador oficial inicial

O aplicativo possui uma raiz pública fixada:

- publicador: `dnd-combat-official`;
- nome: `D&D Combat Official Catalog`;
- chave: `root-2026-01`;
- confiança: `pinned`;
- fingerprint: `6c36087606050d42e5ccef7f4b4490351b62e811a0074ffdd812ccca451391a6`;
- âncora inicial: catálogo 4.8.0, sequência 0;
- checksum canônico da âncora: `0728e21b17ce768039d9873da7ee32d80b36480ab871297143944ad7fce50c43`.

A chave privada correspondente não está incluída na codebase ou no ZIP do aplicativo. Ela é entregue separadamente para armazenamento offline.

## Verificação do bundle

`src/catalog/catalogTrust.ts` rejeita:

- envelope ausente ou incompatível;
- algoritmo não suportado;
- publicador desconhecido ou revogado;
- chave desconhecida, retirada ou revogada;
- fingerprint divergente;
- assinatura futura, expirada ou fora da validade da chave;
- catálogo alterado depois da assinatura;
- versão declarada divergente;
- assinatura ECDSA inválida;
- sequência repetida, pulada ou retrocedida;
- cadeia que não aponta para o último checksum aceito.

## Políticas de publicadores

### Oficial

Publicadores oficiais precisam existir previamente no aplicativo com confiança `pinned`. O usuário não pode transformar um publicador comunitário em oficial pela interface.

### Comunitário

Um publicador comunitário só é adicionado depois que o usuário informa a chave pública e confirma manualmente seu fingerprint. A confiança é `userApproved`, local ao dispositivo e revogável.

## Rotação e revogação

Foram implementadas declarações assinadas:

- `dnd-catalog-key-rotation.v1`;
- `dnd-catalog-key-revocation.v1`.

A rotação:

- precisa ser assinada pela chave ativa atual;
- aposenta a chave anterior;
- registra predecessor, validade e fingerprint da nova chave;
- preserva a verificabilidade dos recibos antigos.

A revogação pode atingir uma chave específica ou o publicador inteiro. Bundles assinados por uma chave revogada são rejeitados antes do preview.

## Integração transacional

`src/store/catalogUpdateSessionStore.ts`:

- verifica o envelope durante o preparo;
- verifica novamente assinatura e cadeia antes do commit;
- atualiza a âncora somente como parte do commit coordenado;
- inclui o registro de confiança no checkpoint;
- restaura o registro anterior durante o rollback;
- impede bypass no fluxo de produção.

O bypass existente é limitado a fixtures internas explicitamente identificadas e não é exposto pela interface.

## Proveniência nos recibos

O recibo do APP-17 passou a preservar:

- publicador e tipo;
- chave e fingerprint;
- algoritmo;
- sequência;
- checksum anterior;
- checksum do catálogo;
- assinatura;
- status da cadeia.

A proveniência participa do checksum do recibo. Alterá-la invalida o documento.

## Ferramentas operacionais

Foram adicionados:

- `scripts/generate-catalog-key.js`;
- `scripts/sign-catalog-bundle.js`;
- `scripts/catalog-key-admin.js`;
- `docs/CATALOG_TRUST_AND_SIGNING.md`.

Os comandos npm correspondentes são:

- `catalog:key:generate`;
- `catalog:sign`;
- `catalog:key:admin`;
- `catalog:trust:check`;
- `catalog:trust:harness`.

O gerador cria arquivos privados com permissão `0600` quando o sistema operacional permite e se recusa a sobrescrever um arquivo existente sem `--overwrite`.

## Interface

Foi adicionada a rota `app/catalog-trust.tsx`, acessível por Ajustes. Ela permite:

- consultar publicadores, chaves e fingerprints;
- visualizar a última âncora aceita;
- aprovar um publicador comunitário;
- importar declarações assinadas de rotação ou revogação;
- consultar o histórico de eventos.

A tela de atualização do catálogo agora apresenta a assinatura validada antes de habilitar o preview.

## Gate nativo

Foram adicionados quatro fluxos Maestro:

- assinatura válida;
- assinatura inválida;
- chave revogada;
- rollback da cadeia de confiança.

O gate passa a reconhecer 39 fluxos no total.

## Arquivos principais

### Novos

- `src/catalog/catalogTrust.ts`
- `src/catalog/catalogTrustDefaults.ts`
- `src/store/catalogTrustStore.ts`
- `app/catalog-trust.tsx`
- `scripts/generate-catalog-key.js`
- `scripts/sign-catalog-bundle.js`
- `scripts/catalog-key-admin.js`
- `scripts/check-catalog-trust-chain.js`
- `scripts/run-app18-runtime-harness.js`
- `scripts/run-app18-linear-regression.js`
- `src/tests/catalogTrust.test.ts`
- `docs/CATALOG_TRUST_AND_SIGNING.md`
- `.maestro/flows/43-catalog-signature-valid.yaml`
- `.maestro/flows/44-catalog-signature-invalid.yaml`
- `.maestro/flows/45-catalog-key-revoked.yaml`
- `.maestro/flows/46-catalog-trust-rollback.yaml`

### Alterados

- `src/catalog/catalogUpdateTransaction.ts`
- `src/store/catalogUpdateSessionStore.ts`
- `src/store/catalogStore.ts`
- `src/store/portableRestoreSessionStore.ts`
- `app/catalog-update.tsx`
- `app/e2e-seed.tsx`
- `app/settings.tsx`
- `app/_layout.tsx`
- `scripts/run-app06-native-gate.js`
- `scripts/run-app07-release-gate.js`
- `scripts/run-app17-runtime-harness.js`
- `scripts/check-catalog-update-transaction.js`
- `src/tests/catalogUpdateTransaction.test.ts`
- `package.json`

## Validação

| Verificação | Resultado |
|---|---:|
| Regressão linear | 38/38 PASS |
| Parsing TS/TSX | 335/335 PASS |
| Typecheck estrito do núcleo criptográfico | PASS |
| Contratos APP-18 | PASS |
| Harness APP-18 | 38/38 PASS |
| Assinatura CLI do bundle real | PASS |
| Geração e rotação CLI de chave | PASS |
| Entidades do catálogo real | 5.841 |
| Dependências reais | 15.385 |
| Fluxos Maestro encontrados | 39/39 |

O harness confirmou assinatura válida, adulteração rejeitada, assinatura inválida rejeitada, cadeia incorreta rejeitada, publicador desconhecido rejeitado, expiração rejeitada, replay rejeitado, rotação válida, revogação válida, aprovação comunitária por fingerprint e proteção da proveniência no recibo.

## Limitações do ambiente

A codebase recebida não contém `node_modules` e o registry interno continua sem `zustand@5.0.14`. Assim:

- o typecheck integral não encontrou `expo/tsconfig.base` nem os tipos de React, Node e Jest;
- a suíte Jest não iniciou porque o executável `jest` não está instalado;
- o gate Android não pôde executar por ausência de dependências, ADB, Maestro e dispositivo.

Todos os 39 arquivos Maestro foram encontrados. Nenhuma limitação ambiental foi convertida em aprovação.
