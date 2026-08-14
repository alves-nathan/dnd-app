# APP-30 — Release de produção e entrega operacional

## Objetivo

Fechar o plano de desenvolvimento com uma release verificável, separando preparação, build, submissão, revisão e disponibilidade pública.

## Implementação

### Identidade de produção

A codebase foi promovida para a versão pública **1.0.0**. `app.json`, `package.json`, `package-lock.json` e `CURRENT_APP_VERSION` foram sincronizados. O `runtimeVersion` continua usando `appVersion`, e o perfil EAS `production` fixa `EXPO_PUBLIC_E2E_SEED_ENABLED=false`.

### Gate APP-30

Foi criado o contrato `dnd-combat-app30-production-release.v1`. O gate vincula a fingerprint e o lockfile a:

- APP-28 aprovado;
- APP-29 aprovado;
- identidade de produção;
- documentação operacional;
- scanner de material privado;
- AAB e metadados do build;
- recibo de disponibilidade da loja;
- pacote de entrega e confirmação humana.

A publicação automática permanece desabilitada. Build e submissão exigem `--execute` explícito.

### Entrega operacional

Foram incluídos runbook, manual operacional, playbook de incidente/rollback, privacidade, suporte, texto-base da loja, notas da versão e índice de entrega. O pacote operacional contém 21 arquivos e não contém binário ou segredo.

### Interface e E2E

Foi adicionada a tela `app/production-release.tsx` e quatro fluxos Maestro, elevando o gate transacional para 83 fluxos. O projeto possui 90 arquivos Maestro no total.

## Validação

| Verificação | Resultado |
|---|---:|
| Regressão herdada | 208 PASS |
| Verificações APP-30 | 9/9 |
| Total acumulado | 217 PASS |
| TypeScript/TSX sintático | 380/380 |
| Harness APP-30 | 26/26 |
| Documentação operacional | 8/8 |
| Fluxos transacionais exigidos | 83/83 localizados |
| Material privado | Nenhum |
| Pacote operacional | PASS |

## Estado real

O APP-30 permanece **BLOCKED**. Este ambiente não dispõe da árvore completa de dependências, ADB, Maestro, dispositivo Android, AAB de produção ou recibo da loja. O pacote não afirma que houve build, submissão ou publicação.

## Sequência de encerramento no ambiente proprietário

```bash
npm run app28:dependencies:install
npm run app28:gate
npm run app28:gate:verify
npm run app29:linear
npm run app29:gate
npm run app29:gate:verify
npm run app30:linear
npm run app30:prepare
npm run app30:build:android -- --execute
```

Depois do build, execute o gate com o AAB e metadados; depois da disponibilidade real, forneça o recibo da loja e a confirmação humana para obter `PASS`.
