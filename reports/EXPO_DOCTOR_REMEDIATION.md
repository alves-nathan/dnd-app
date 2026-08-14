# Expo Doctor remediation — App 30

## Scope

Correção das quatro falhas informadas pelo `npx expo-doctor` no SDK 57:

1. conflito entre `app.json` e `app.config.js`;
2. `eas-cli` instalado nas dependências do projeto;
3. módulos nativos Expo duplicados;
4. versões incompatíveis/desatualizadas para o SDK 57 instalado.

## Changes applied

- `app.config.js` agora recebe e estende o objeto `config` resolvido pelo Expo, preservando integralmente os valores do `app.json`.
- `eas-cli` foi removido de `devDependencies`.
- Os scripts npm de EAS usam `npx --yes eas-cli@21.0.0`.
- Os scripts Node de beta, preflight, build e submit aceitam EAS global e usam `npx` como fallback reproduzível.
- As dependências informadas pelo Expo Doctor foram alinhadas às versões esperadas do SDK 57.
- O gate interno de dependências foi atualizado para React Native `0.86.2`.
- Foram adicionados os comandos `npm run doctor` e `npm run expo:install:check`.

## Validation completed in the delivery environment

- Project shape: PASS
- Accessibility contracts: PASS
- Bundled compendium: PASS — 1,284 items and 1,284 unique IDs
- Dynamic config inheritance: PASS
- Release readiness: PASS
- Beta readiness logic: PASS; only native evidence warnings remain
- TypeScript syntax scan: PASS — 380 files
- Changed JavaScript files: syntax PASS

## Required local dependency reconciliation

The delivery environment could not access the public npm registry, so it could not download the updated tarballs and regenerate their `package-lock.json` integrity hashes. Run these commands once in the project root:

```bash
rm -rf node_modules
npm install
npm dedupe
npm run expo:install:check
npm run doctor
npm run dependencies:lock:check
```

Expected result after the registry-backed installation:

- no local `eas-cli` warning;
- no app config conflict;
- no duplicate `expo-constants`, `expo-file-system`, or `expo-font` installations;
- all SDK 57 dependency versions accepted;
- dependency lock gate passing with regenerated integrity hashes.

Do not run `npx expo install --fix` after this delivery unless Expo reports a new expected version set, because this project intentionally pins exact versions for reproducible release gates.
