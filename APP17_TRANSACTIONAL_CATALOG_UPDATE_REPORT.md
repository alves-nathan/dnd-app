# APP-17 — Atualização transacional do catálogo e migração de snapshot

## Objetivo

Permitir preparar, validar, comparar, confirmar e reverter uma nova versão do catálogo sem substituir silenciosamente o catálogo ativo e sem migrar fichas antes da confirmação explícita do usuário.

## Resultado

O APP-17 foi implementado sobre a codebase do APP-16. A versão ativa continua atendendo todas as consultas enquanto um bundle candidato é validado e armazenado. O novo catálogo só passa a ser usado durante a sessão de commit, que mantém checkpoint suficiente para retomada idempotente e rollback integral.

## Implementação

### Bundle candidato isolado

`src/storage/catalogPackageRepository.ts` armazena bundles candidatos em blocos de 128 KiB, com índice versionado, tamanho UTF-8, quantidade de blocos, versão, snapshot e SHA-256. O pacote candidato não altera a referência ativa durante o preparo.

### Validação e comparação

`src/catalog/catalogUpdateTransaction.ts`:

- valida JSON, schema, checksum e estrutura usando o `CatalogLoader` real;
- rejeita um bundle idêntico ao catálogo ativo;
- compara entidades adicionadas, removidas e alteradas;
- compara livros, categorias, aliases e arestas de dependência;
- classifica a direção como `upgrade`, `downgrade` ou `sidegrade`;
- projeta os filtros compatíveis no novo snapshot;
- calcula o impacto em personagens e evidências históricas.

### Migração explícita

A migração não ocorre automaticamente. O usuário precisa:

- incluir explicitamente as fichas que exigem troca de snapshot;
- reconhecer o impacto nas fichas;
- reconhecer referências removidas ou desativadas, quando existirem;
- reconhecer o impacto em evidências históricas.

A migração atualiza o `catalogSnapshotId` da ficha e as referências oficiais aplicadas que carregam snapshot, preservando conteúdo local.

### Sessão persistida e retomável

`src/store/catalogUpdateSessionStore.ts` persiste uma sessão no schema `dnd-catalog-update-session.v1` e executa fases idempotentes:

1. pacote candidato preparado;
2. catálogo e filtros projetados ativados;
3. snapshots das fichas migrados;
4. evidências históricas marcadas como alteradas;
5. recibo SHA-256 gerado.

Se o aplicativo for encerrado, a sessão pode retomar a partir da última fase concluída sem duplicar o commit.

### Rollback

Enquanto a atualização não for finalizada, o checkpoint anterior preserva:

- referência do pacote ativo anterior;
- filtros, revisão e histórico do catálogo;
- personagens anteriores;
- registros históricos de evidência anteriores.

O rollback restaura esses quatro conjuntos. Depois da finalização explícita, o pacote anterior armazenado pode ser liberado e o rollback deixa de estar disponível.

### Interface

Foi adicionada a rota `app/catalog-update.tsx`, acessível por Ajustes e Gerenciamento de conteúdo. A tela oferece:

- seleção ou colagem do JSON;
- checksum esperado opcional;
- comparação entre versões;
- impacto preventivo por ficha;
- reconhecimentos explícitos;
- commit, retomada, rollback e finalização;
- histórico dos recibos confirmados.

A Home sinaliza sessões de atualização ativas ou interrompidas.

### Gate nativo

Foram adicionados quatro fluxos Maestro:

- preview da atualização;
- cancelamento sem alteração;
- commit com migração;
- rollback para o catálogo anterior.

O gate passa a reconhecer 35 fluxos transacionais no total.

## Arquivos principais

### Novos

- `src/catalog/catalogBundleDigest.ts`
- `src/catalog/catalogUpdateTransaction.ts`
- `src/storage/catalogPackageRepository.ts`
- `src/store/catalogUpdateSessionStore.ts`
- `app/catalog-update.tsx`
- `src/tests/catalogUpdateTransaction.test.ts`
- `scripts/check-catalog-update-transaction.js`
- `scripts/run-app17-runtime-harness.js`
- `scripts/run-app17-linear-regression.js`
- `.maestro/flows/39-catalog-update-preview.yaml`
- `.maestro/flows/40-catalog-update-cancel.yaml`
- `.maestro/flows/41-catalog-update-commit.yaml`
- `.maestro/flows/42-catalog-update-rollback.yaml`

### Alterados

- `src/store/catalogStore.ts`
- `src/store/portableRestoreSessionStore.ts`
- `src/catalog/index.ts`
- `app/settings.tsx`
- `app/content-management.tsx`
- `app/_layout.tsx`
- `app/index.tsx`
- `app/e2e-seed.tsx`
- `package.json`
- `scripts/run-app06-native-gate.js`
- `scripts/check-portable-restore-evidence-center.js`

## Validação

| Verificação | Resultado |
|---|---:|
| Regressão linear | 36/36 PASS |
| Parsing TS/TSX | 330/330 PASS |
| Typecheck isolado do motor, catálogo e stores | PASS |
| Typecheck isolado do teste | PASS |
| Harness APP-17 | 43/43 PASS |
| Entidades do catálogo atual | 5,841 |
| Entidades do candidato de teste | 5,842 |
| Dependências reais | 15,385 |
| Fluxos Maestro encontrados | 35/35 |

O harness utilizou o catálogo real v4.8.0 e um candidato sintético v4.8.1 criado exclusivamente para validar o mecanismo. Foram detectadas 1 entidade adicionada e 1 alterada. Uma ficha exigiu migração de snapshot e um registro histórico foi marcado como afetado. O commit coordenado, a retomada e o rollback passaram.

## Limitações do ambiente

A instalação integral ficou em `BLOCKED / REGISTRY_PACKAGE_MISSING` porque o registry interno não contém a versão fixada de `zustand`. A codebase não possui `node_modules` neste ambiente.

Por isso:

- o typecheck integral não encontrou `expo/tsconfig.base` nem os tipos de React, Node e Jest;
- a suíte Jest não iniciou porque o executável `jest` não está instalado;
- o gate Android não pôde executar por ausência de dependências, ADB, Maestro e dispositivo.

Todos os 35 arquivos Maestro foram encontrados. Nenhuma limitação ambiental foi convertida em aprovação.
