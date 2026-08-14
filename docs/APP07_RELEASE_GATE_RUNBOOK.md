# APP-07 — Runbook do gate de release Android

## Objetivo

Produzir uma evidência reproduzível de que a mesma codebase que será enviada ao EAS passou por:

1. lockfile determinístico;
2. smoke suite completa;
3. typecheck integral;
4. Jest integral;
5. quatro cenários Maestro em Android;
6. captura de JUnit, logcat e screenshot;
7. validação da versão instalada contra `app.json`.

O beta-candidate não pode ser iniciado sem uma evidência APP-07 válida.

## Pré-requisitos

- Node compatível com `package.json#engines`;
- npm 10 ou superior;
- registry npm que contenha todas as versões do `package-lock.json`;
- Android SDK/ADB;
- dispositivo ou emulador autorizado;
- pacote `com.nalves.dndcombatmathmvp` instalado na versão indicada em `app.json`;
- Maestro CLI disponível em `PATH` ou `MAESTRO_PATH`.

## Sequência obrigatória

```bash
npm run app07:dependencies:install
npm run app07:smoke
npm run app07:release:gate
npm run app07:release:gate:verify
npm run beta:android:build-candidate -- --message "Descrição do candidato"
```

O comando de build executa novamente `app07:release:gate:verify`. Não existe flag de bypass para o gate APP-07.

## Diagnóstico sem aprovação

Quando o ambiente ainda não possui todos os pré-requisitos:

```bash
npm run app07:dependencies:diagnose
npm run app07:release:gate:offline
```

Esses comandos produzem relatórios `BLOCKED`, mas não criam uma aprovação utilizável pelo build candidate.

## Evidências geradas

- `artifacts/app07-dependency-lock.json`;
- `artifacts/app07-dependency-install.json`;
- `artifacts/app07-release-gate.json`;
- `artifacts/app06-native-gate.json`;
- `artifacts/maestro/app06-android/junit.xml`;
- `artifacts/maestro/app06-android/logcat.txt`;
- `artifacts/maestro/app06-android/final-screen.png`;
- `artifacts/maestro/app06-android/test-output/`.

A evidência guarda:

- fingerprint SHA-256 da codebase;
- commit Git, quando disponível;
- horário de geração;
- resultado de cada etapa;
- versão Android instalada;
- tamanho e SHA-256 dos artefatos nativos.

## Regras de validade

A verificação rejeita a evidência quando:

- o status não é `PASS`;
- ela possui mais de 24 horas, salvo configuração explícita de `APP07_GATE_MAX_AGE_HOURS`;
- a codebase ou o commit mudou;
- typecheck, Jest ou gate nativo não passaram;
- JUnit contém falhas ou erros;
- JUnit, logcat ou screenshot estão ausentes;
- algum artefato foi alterado após a execução;
- a versão instalada diverge de `app.json`.

## Registry alternativo

O registry pode ser informado sem modificar o lockfile:

```bash
npm run app07:dependencies:install -- --registry https://registry.npmjs.org
```

Não use `--force`, `--legacy-peer-deps`, rebaixamento de versão ou substituição de pacote para transformar um bloqueio de infraestrutura em aprovação.
