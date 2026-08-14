# Correção TypeScript / Expo Doctor / Jest — 2026-08-12

## Escopo

Correções aplicadas sobre `dnd-combat-math-mvp-2024-legacy-app06` a partir dos erros reproduzidos pelo owner em 2026-08-12.

## 1. TypeScript

### ResourceScaling

`ResourceScaling` aceitava `kind: abilityModifier`, mas o contrato TypeScript não declarava os campos que o próprio normalizador/mapper já usa (`ability` e `minimum`). O domínio foi alinhado ao runtime sem afrouxar o discriminador de `kind`.

### metadata.externalDependencies

O metadata do pack estava tipado apenas como `Record<string, unknown>`, o que impedia acesso seguro aos grupos de dependências externas usados pelos packs extraídos. Foi criado um contrato de metadata que expõe `externalDependencies` mantendo extensibilidade.

### ResourceDefinition no teste de integração

O predicate do teste agora estreita `payload.resource` para `ResourceDefinition`, que é o tipo real do domínio, eliminando o predicate incompatível e o falso `possibly undefined`.

## 2. Jest / preview V2

A reimportação do PHB 2024 retornava 391 updates e 893 unchanged em vez de 1284 unchanged.

Causa: a migração V1 -> V2 resolve `spell.payload.classIds` usando as classes do pack completo. A comparação do catálogo existente, porém, normalizava cada item isoladamente para evitar interferência de outros livros. Assim, as 391 spells existentes ficavam sem `classIds` e todas pareciam alteradas.

Correção: a canonicalização do catálogo existente continua isolada por item, mas, durante o preview, replica apenas a resolução de classes que existe no pack recebido. Isso preserva idempotência sem deixar classes de outros livros alterarem fingerprints/hashes.

Validação do gate histórico de preview:

- replay: 0 creates / 0 updates / 1284 unchanged / 0 conflicts;
- mudança real em um item: 1 update / 1283 unchanged.

## 3. Expo SDK 57

Versões diretas alinhadas ao conjunto reportado pelo `expo-doctor` do owner:

- expo 57.0.12
- expo-constants 57.0.10
- expo-dev-client 57.0.11
- expo-file-system 57.0.2
- expo-router 57.0.12
- expo-splash-screen 57.0.6
- jest-expo 57.0.4

O gate interno de dependências também foi atualizado para esperar Expo 57.0.12.

## Validações executadas neste pacote

PASS:

- TypeScript syntax scan — 442 arquivos;
- project shape;
- accessibility contracts;
- bundled compendium — 1991 itens / 6 packs;
- book integration;
- Import V2 preview audit — replay 1284/1284 unchanged;
- Import V2 release gate completo;
- Import V2 functional parity — 13/13;
- 2024 + Legacy character smoke — 24/24;
- custom feat/feature smoke — 5/5.

Também foram executados harnesses TS do preview, mapper de resources e integração dos seis packs.

## Passo obrigatório no ambiente do owner

Este pacote altera versões do `package.json`, mas o ambiente de geração não possui acesso ao registry npm e, portanto, não pode baixar os novos tarballs nem regenerar com segurança os `integrity` do `package-lock.json`.

**Na primeira instalação desta entrega, use `npm install`, não `npm ci`:**

```bash
cd ~/dnd-combat-math-mvp
rm -rf node_modules
npm install
npm dedupe
npm run dependencies:lock:check
npm run typecheck
npm test -- --runInBand
npx expo-doctor
```

Depois que o `npm install` regenerar e o novo `package-lock.json` for salvo/commitado, volte a usar `npm ci` normalmente em instalações limpas e CI.

## Observações

- O warning de peer entre React Native 0.86.2 e `@react-native/virtualized-lists@0.86.0` não é a causa das duas falhas do `expo-doctor` fornecidas pelo owner. Não foi usado `--force` nem `--legacy-peer-deps` para mascará-lo.
- Os avisos de pacotes deprecated e o relatório de vulnerabilidades do npm são uma frente separada; não foi aplicado `npm audit fix --force`, pois isso poderia introduzir upgrades incompatíveis com o SDK 57.
- O log anexado contém somente o trecho final de uma das falhas Jest. A falha reproduzível visível foi corrigida na causa e o gate de preview correspondente passou; a confirmação das outras falhas omitidas pelo recorte deve vir da suíte completa no ambiente com `node_modules` instalado.
