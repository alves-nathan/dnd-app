# D&D Combat Math — Compendium Import V2 Phase 04

## Escopo

Phase 04 implementa a Etapa 7 do roadmap: **preview/diff, fingerprint de conteúdo e plano determinístico de upsert**, sem executar qualquer escrita no storage.

Baseline: `dnd-combat-math-mvp-import-v2-phase03-semantic-validation`.

## Objetivos concluídos

- fingerprint canônico por entidade;
- comparação entre conteúdo V2 recebido e catálogo já instalado;
- classificação `create | update | unchanged | conflict`;
- paths alterados em updates;
- política explícita de conflitos de identidade;
- suporte a conteúdo existente ainda armazenado no shape V1;
- validação semântica de packs incrementais usando referências do catálogo existente;
- plano de upsert imutável, ainda sem persistência;
- auditoria integral com as 1.284 entidades do PHB 2024.

## Arquivos principais adicionados

### `src/compendium/importContentHash.ts`

Responsável por:

- serialização estável com chaves ordenadas;
- remoção apenas de metadados transitórios (`importedAt`, `updatedAt`, review metadata, `contentHash`, `checksum`, `importId` etc.);
- fingerprint runtime-portable sem dependência de `node:crypto`;
- `createCompendiumImportItemContentHash()` para entidades canônicas.

O hash **não é assinatura criptográfica** e não substitui a trust chain do catálogo. Sua função é diff/deduplicação determinística.

### `src/compendium/importPreview.ts`

Implementa `buildCompendiumImportV2Preview()`.

Resultado inclui:

- `valid`;
- `itemsFound`;
- `byKind`;
- `creates`;
- `updates`;
- `unchanged`;
- `conflicts`;
- decisões por item;
- `incomingHash` / `existingHash`;
- `changedPaths`;
- `errors`, `warnings`, `infos`;
- resultado da validação semântica.

O catálogo existente é normalizado pelo mesmo modelo canônico antes da comparação. Dessa forma, uma entidade armazenada a partir de V1 pode ser reconhecida como igual à mesma entidade V2.

### `src/compendium/importUpsertPlan.ts`

Implementa `createCompendiumImportV2UpsertPlan()`.

Transforma um preview válido em intenções determinísticas:

- creates;
- updates;
- unchanged IDs;
- conflict IDs;
- hashes;
- storage ID da linha existente quando houver update;
- changed paths.

Nenhuma escrita é executada nesta fase.

### `src/compendium/parseImportPreview.ts`

Combina:

```text
parse/version detection
        ↓
V1 → V2 migration / V2 normalization
        ↓
structural validation
        ↓
preview with installed-catalog context
        ↓
semantic validation
        ↓
diff
```

A validação semântica é deliberadamente adiada nesta rota até que o catálogo existente esteja disponível, permitindo que packs incrementais referenciem classes/features/conditions já instaladas.

## Arquivos alterados

### `src/compendium/importSemanticValidation.ts`

A validação semântica passou a depender do shared import domain (`CompendiumImportItem`) em vez de usar o tipo inferido diretamente do Zod como domínio interno.

Isso reduz a divergência entre schema e domínio e também deixa a camada semântica reutilizável fora do parser Zod.

### `src/compendium/parseImportPack.ts`

Adicionada opção:

```ts
{ validateSemantics?: boolean }
```

O comportamento padrão permanece inalterado. `parseAndPreviewImportPack()` usa `validateSemantics: false` e executa a semântica depois, com contexto do catálogo existente.

### `src/tests/compendiumImportV2Preview.test.ts`

Cobertura adicionada para:

- hash estável;
- metadados transitórios ignorados;
- create;
- unchanged;
- update;
- changed paths;
- source conflict;
- duplicate existing canonical IDs;
- plano de upsert;
- V1 → V2 → preview;
- pack incremental referenciando entidade já instalada;
- replay completo das 1.284 entidades do PHB.

### Scripts

- `scripts/run-compendium-import-v2-preview-harness.js`
- `scripts/audit-compendium-import-v2-preview.js`

### `package.json`

Novos comandos:

```text
npm run test:compendium-import-v2-preview
npm run test:compendium-import-v2-phase04
npm run compendium:import-v2:preview-harness
npm run compendium:import-v2:preview-audit
```

## Política determinística de diff

### Create

ID canônico não existe no catálogo.

### Unchanged

ID existe e o conteúdo canônico produz o mesmo fingerprint.

### Update

ID existe, `kind`, `source.id` e `rulesEra` continuam compatíveis, mas o conteúdo canônico mudou.

Mudanças em `source.version` são tratadas como update e não como cópia nova, desde que a identidade canônica permaneça a mesma.

### Conflict

O preview bloqueia auto-upsert quando:

- o mesmo canonical ID aparece mais de uma vez no catálogo existente;
- a entidade existente não pode ser normalizada com segurança;
- o mesmo ID muda de `kind`;
- o mesmo ID aponta para outro `source.id`;
- o mesmo ID tenta mudar de `rulesEra` (`2024` ↔ `legacy`).

Nomes nunca são usados como chave de deduplicação.

## Stored hash

Se no futuro o storage possuir `contentHash`, o preview não confia cegamente nele. O conteúdo canônico é recalculado e diferenças entre hash armazenado e hash calculado geram warning.

Isso evita que um hash obsoleto transforme conteúdo alterado em falso `unchanged`.

## PHB 2024 — auditoria integral

Arquivo:

`artifacts/compendium-import-v2-phase04-preview-report.json`

Resultados:

### Catálogo vazio

- items: 1.284
- creates: **1.284**
- updates: 0
- unchanged: 0
- conflicts: 0
- valid: true

### Replay contra o mesmo catálogo V1

- creates: 0
- updates: 0
- unchanged: **1.284**
- conflicts: 0
- executable upsert plan: true

Isso prova que a migração V1 → V2 não gera updates artificiais apenas pela mudança do formato de importação.

### Uma entidade alterada

Foi alterado apenas o `summary` de uma entidade no pack canônico.

- creates: 0
- updates: **1**
- unchanged: **1.283**
- conflicts: 0
- changed path: `summary`
- executable upsert plan: true

## Distribuição por kind preservada

- feature: 546
- spell: 391
- feat: 75
- creatureStatBlock: 66
- subclass: 48
- equipment: 42
- weapon: 38
- condition: 24
- background: 16
- armor: 13
- class: 12
- species: 10
- magicItem: 3

## Validações executadas

```text
compendium:import-v2:semantic-harness .... PASS
compendium:import-v2:semantic-audit ...... PASS
compendium:import-v2:preview-harness ..... PASS
compendium:import-v2:preview-audit ....... PASS
strict TS core Phase 04 .................. PASS
TypeScript syntax ........................ PASS — 415 arquivos
Project shape ............................ PASS
Accessibility contracts ................. PASS
Bundled compendium ....................... PASS — 1.284/1.284
Release readiness ........................ PASS
APP-30 isolated typecheck ................ PASS
```

O `npm test`/`tsc --noEmit` completo não foi executado neste ambiente porque a entrega não contém `node_modules`. Os módulos centrais da Phase 04 foram verificados com `tsc --strict` usando o shared domain, e todos os arquivos TypeScript passaram pelo syntax gate do projeto.

## Persistência

**Nenhuma migration ou escrita de storage foi adicionada nesta fase.**

- compêndio local existente não é apagado;
- IDs não são modificados;
- personagens não são migrados;
- links existentes não são tocados;
- `package-lock.json` não foi alterado.

## Próxima etapa — Phase 05

Etapa 8 do roadmap: persistência/mapper.

Objetivos:

1. adaptar o repository para aceitar um `CompendiumImportV2UpsertPlan`;
2. executar creates/updates atomicamente;
3. preservar `StoredCompendiumItem.id` para updates existentes;
4. persistir o `contentHash` junto da linha;
5. não recriar entidades unchanged;
6. bloquear qualquer plan com conflict;
7. manter links de personagens válidos;
8. fornecer rollback/transaction semantics para SQLite e fallback key-value;
9. fazer o importer V2 coexistir com o caminho V1 até o cutover final.
