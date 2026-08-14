# BUGFIX-006 — Estabilização das fixtures restantes

Data: 2026-08-05
Baseline: BUGFIX-005

## Resultado recebido

A execução completa do Jest chegou a 116 suítes aprovadas e manteve somente três testes falhando em duas suítes:

- `src/tests/portableCatalogBackup.test.ts` — 2 falhas;
- `src/tests/catalogUpdateTransaction.test.ts` — 1 falha.

## Causas identificadas

### 1. Snapshot manual incompatível com `RuntimeCatalogEntry`

A fixture de `portableCatalogBackup.test.ts` era convertida para `CatalogSnapshot` por meio de `as unknown as CatalogSnapshot`. O objeto usava `categoryId` no singular e omitia propriedades obrigatórias como `categoryIds`, `kind`, `sourceFile`, `status`, `defaultEnabled`, `manualReviewRequired`, `dependencyCounts` e `searchKey`.

`ContentPolicyService.evaluate()` trabalha com `entry.categoryIds`, portanto a fixture inválida produzia `Cannot read properties of undefined (reading 'map')`.

Correção:

- fixture substituída por objetos tipados como `RuntimeCatalogEntry`, `ContentCategory` e `CatalogSnapshot`;
- `categoryById` passou a conter a categoria utilizada pela entidade;
- remoção do cast que ocultava inconsistências estruturais da fixture.

### 2. Cenário chamado de divergência representava `localAhead`

O teste usava histórico local e remoto vazios, revisão local 3 e revisão recebida 2. Pelo contrato de comparação, isso representa `localAhead`, porque não havia commits conflitantes nem commits exclusivos do backup.

Correção:

- criação de um commit recebido real;
- criação de um commit local com o mesmo ID e conteúdo divergente;
- validação explícita de `conflictingCommitIds`;
- preservação da validação de `changedEntityIds`.

O algoritmo de produção não foi alterado.

### 3. Fixture transacional não declarava o bypass interno

`canCommitCatalogUpdate()` exige uma verificação criptográfica confiável para bundles reais. Fixtures internas não assinadas somente podem confirmar uma sessão quando `internalFixtureBypass` está explicitamente habilitado.

Correção:

- `internalFixtureBypass: true` adicionado exclusivamente à sessão criada pelo teste.

O gate criptográfico de produção permaneceu intacto.

## Arquivos alterados

- `src/tests/portableCatalogBackup.test.ts`
- `src/tests/catalogUpdateTransaction.test.ts`

Nenhum arquivo de produção, dependência ou lockfile foi alterado.

## Validações executadas

- `npm run typescript:syntax:check`: PASS — 389 arquivos;
- `npm run backup:portable-catalog:check`: PASS;
- `npm run backup:portable-catalog:harness`: PASS — 27 asserções;
- `npm run catalog:update:check`: PASS;
- `npm run catalog:update:harness`: PASS — 43 asserções;
- `npm run app30:typecheck:isolated`: PASS;
- execução focada das duas suítes por harness TypeScript local: PASS — 4/4 testes.

A execução pelo Jest oficial deve ser repetida na máquina de desenvolvimento, onde `node_modules` está disponível.
