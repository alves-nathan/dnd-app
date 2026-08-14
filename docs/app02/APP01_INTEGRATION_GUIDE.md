# APP-01 — Guia de integração no D&D Combat Math

## 1. Instalar o overlay

No diretório deste pacote:

```bash
node scripts/install-overlay.cjs ~/dnd-combat-math-mvp --dry-run
node scripts/install-overlay.cjs ~/dnd-combat-math-mvp
```

A instalação copia:

```text
src/catalog/
assets/catalog-v4.8.0/
```

Se esses diretórios já existirem, o instalador aborta. Use `--force` somente após revisar a colisão; nesse modo, ele cria backup em `artifacts/app01-backups/`.

## 2. Inicialização mínima com Metro

O caminho mais simples usa o `require` estático do JSON:

```ts
import { initializeBundledCatalog } from './src/catalog';

const catalog = initializeBundledCatalog();
console.log(catalog.catalogVersion); // 4.8.0
```

Esse caminho valida estrutura e referências, mas não calcula o SHA-256 em runtime.

## 3. Inicialização verificada

Para exigir checksum, leia o asset como texto e forneça um adapter de digest compatível com a plataforma:

```ts
import { CatalogLoader } from './src/catalog';

const snapshot = await new CatalogLoader().initializeFromText(rawBundleText, {
  expectedSha256: '8c64d156da2653835ca2052b2618abdb1de93a4f6e6efe14a0afabdbebafed08',
  digestAdapter
});
```

O pacote inclui `nodeDigestAdapter` apenas para testes Node. No aplicativo, o adapter deve usar uma biblioteca compatível com Expo/React Native já aprovada no projeto.

## 4. Controlador de runtime

```ts
import { CatalogRuntimeController } from './src/catalog';

const controller = new CatalogRuntimeController();
controller.subscribe((state) => {
  // idle | loading | ready | failed
  console.log(state.status);
});

await controller.initialize(rawBundleText, {
  expectedSha256,
  digestAdapter
});

const fireball = controller.query().getById('phb-2024-spell-fireball');
```

Não exponha queries antes do estado `ready`.

## 5. Consultas

```ts
const query = controller.query();

const spells = query.search({
  text: 'fire',
  kinds: ['spell'],
  enabledOnly: true,
  limit: 50
}, filterState);

const alias = query.resolveAlias('phb-2024-glossary-alias-inspiration');
const dependencies = query.dependenciesOf('phb-2024-spell-fireball');
const dependents = query.dependentsOf('phb-2024-spell-fireball');
```

## 6. Filtros de conteúdo

```ts
const policy = controller.policy();
const full = policy.createDefaultState('full-official');

const withoutMonsterManual = {
  ...full,
  bookStates: {
    ...full.bookStates,
    'mm-2025': false
  }
};

const preview = policy.previewImpact(full, withoutMonsterManual);
```

Antes de persistir uma mudança, mostre ao usuário:

- quantas entidades serão ativadas ou desativadas;
- quais dependências obrigatórias ficarão quebradas;
- quais personagens ou combates salvos usam essas entidades.

A última parte depende da store atual do aplicativo e deve ser implementada durante o merge.

## 7. Snapshot da configuração

```ts
import { CatalogSnapshotService } from './src/catalog';

const service = new CatalogSnapshotService(
  controller.snapshot(),
  digestAdapter
);

const saved = await service.create(filterState, referencedEntityIds);
const valid = await service.verify(saved);
```

O snapshot registra versão do catálogo, hash da configuração e IDs referenciados. Ele não copia automaticamente personagens ou combates.

## 8. Integração recomendada com o app atual

A sequência de merge recomendada é:

1. instalar o overlay em uma branch própria;
2. criar uma store fina para `CatalogRuntimeState` e `CatalogFilterState`;
3. inicializar o catálogo antes de liberar telas que dependem dele;
4. manter o compêndio legado funcionando em paralelo;
5. criar adapter de leitura para entidades antigas;
6. migrar uma query vertical por vez, começando por seleção de livros/categorias;
7. adicionar benchmark Android/Hermes;
8. executar a suíte completa e os fluxos mobile;
9. só então tornar o novo loader a fonte padrão.

## 9. Gates mínimos após o merge

```bash
npm run typecheck
npm run test:ci
npm run release:validate
```

Também devem ser executados os testes específicos de importação, storage multi-book, criação de personagem, filtros e combate.
