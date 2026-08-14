# APP-28 — Gate integral de release

O APP-28 é o gate obrigatório que vincula a codebase atual, o `package-lock.json`, o typecheck integral, a suíte Jest e a execução Android dos fluxos Maestro.

## Pré-requisitos

- Node e npm compatíveis com `package.json`;
- acesso a um registry npm completo ou cache npm aquecido para o lockfile;
- Android SDK e `adb`;
- dispositivo/emulador autorizado com a build correspondente ao `app.json`;
- Maestro CLI.

## Execução integral

```bash
npm run app28:gate
npm run app28:gate:verify
```

O primeiro comando instala as dependências, executa typecheck/Jest e roda o gate nativo. O segundo verifica a evidência, o fingerprint da codebase, o lockfile, a validade temporal e os hashes de JUnit, logcat, screenshot e log do Maestro.

## Registry ou cache explícito

```bash
APP28_NPM_REGISTRIES="https://registry.npmjs.org" npm run app28:gate
```

ou:

```bash
APP28_NPM_CACHE=/caminho/cache-npm npm run app28:gate
```

Não use `--force`, `--legacy-peer-deps` ou alteração de versões para fabricar aprovação.

## Diagnóstico sem falso sucesso

```bash
npm run app28:gate:diagnose
```

Esse comando gera `artifacts/app28-integral-gate.json`, mas retorna `BLOCKED` quando o ambiente não possui os pré-requisitos.

## Build candidate

`beta:local-gate` e `beta:android:build-candidate` recusam evidência APP-28 ausente, expirada, referente a outra codebase ou sem os artefatos nativos obrigatórios.
