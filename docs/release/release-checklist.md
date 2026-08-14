# Checklist de release/dev build

## Antes de qualquer build

- [ ] Rodar `npm install`.
- [ ] Rodar `npx expo install --fix`.
- [ ] Rodar `npm run release:validate`.
- [ ] Abrir o app em desenvolvimento e executar `Hardening / compatibilidade`.
- [ ] Abrir `Diagnóstico global` e resolver erros bloqueantes.
- [ ] Confirmar que o compêndio local não contém conteúdo que você não tem direito de distribuir.

## Identidade do app

- [x] `expo.name` definido.
- [x] `expo.slug` definido.
- [x] `expo.android.package` definido.
- [x] `expo.android.versionCode` definido.
- [x] `expo.ios.bundleIdentifier` definido.
- [x] `expo.ios.buildNumber` definido.
- [ ] `extra.eas.projectId` definido após `eas init` ou `npm run eas:configure-project -- <uuid>`.
- [x] EAS CLI executado globalmente ou por `npx`, com versão exata definida em `package.json#config.easCliVersion`.
- [x] perfil interno `beta` configurado.

## Android

- [ ] Testar `npm run build:dev:android` em aparelho real.
- [ ] Testar importação de arquivo local.
- [ ] Testar SQLite após fechar/reabrir o app.
- [ ] Testar backup/restauração.
- [ ] Testar modo mesa com consumo de recursos e spell slots.
- [ ] Gerar `npm run build:preview:android`.
- [ ] Gerar `npm run build:production:android` somente após validações.

## iOS

- [ ] Testar `npm run build:dev:ios-simulator` se houver ambiente Apple.
- [ ] Configurar Apple Developer se quiser build em aparelho/TestFlight.
- [ ] Gerar preview iOS depois de validar Android.
- [ ] Gerar production iOS somente após validações.

## Dados e privacidade

- [ ] Exportar backup antes de atualizar builds usados em mesa.
- [ ] Exportar compêndio local se houver itens revisados.
- [ ] Verificar que nenhum livro/conteúdo protegido foi embutido em fixture ou asset.
- [ ] Revisar `docs/release/privacy-and-content.md`.

## Gate beta

- [ ] `npm run beta:check` sem bloqueios.
- [ ] evidência Android preenchida após execução real.
- [ ] evidência iOS preenchida após execução real.
- [ ] rollback e restauração testados em instalação separada.
