# EAS build e dev build

Este projeto está preparado para gerar builds com Expo Application Services usando `eas.json`.

## Perfis

| Perfil | Uso | Resultado esperado |
|---|---|---|
| `development` | Testes em Android real/emulador com native modules | APK interno com `expo-dev-client` |
| `development-simulator` | Testes em iOS Simulator | Build iOS Simulator com `expo-dev-client` |
| `preview` | Teste próximo de produção com equipe | Build interno sem ferramentas de dev |
| `beta` | Candidato distribuído ao grupo beta | Build interna versionada; APK Android |
| `production` | Preparação de loja | Android AAB / iOS production build |

## Primeiro setup

```bash
npm install
npx expo install --fix
npm run release:validate
npm run eas:login
npm run eas:init
```

`eas:init` vincula o projeto ao EAS e pode preencher `extra.eas.projectId` no app config. Sem isso, os checks mostram aviso, mas o código do app continua válido.

## Builds úteis

```bash
npm run build:dev:android
npm run build:dev:ios-simulator
npm run build:preview:android
npm run build:preview:ios
npm run build:beta:android
npm run build:beta:ios
npm run build:production:android
npm run build:production:ios
```

## Observações

- Use dev build para testar `expo-sqlite`, `expo-document-picker`, backups, importação local e modo mesa em aparelho real.
- Use preview antes de produção para conferir fluxo offline/local sem ferramentas de desenvolvimento.
- Production Android está configurado para `app-bundle`.
- Production iOS exige conta Apple e configuração de certificados/provisioning pela conta EAS/Apple.

## Prontidão beta

Use `npm run beta:check`. O comando exige configuração EAS e evidências reais por plataforma antes de declarar a beta pronta.
