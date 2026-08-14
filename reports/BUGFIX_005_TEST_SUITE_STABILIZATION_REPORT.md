# BUGFIX-005 — Estabilização da suíte Jest

## Contexto

A execução completa de `npm test` registrou 111 suítes aprovadas e sete suítes com falhas. As falhas foram divididas em quatro causas independentes, todas localizadas em contratos de teste ou na configuração do ambiente Jest.

## Causas e correções

### 1. Agregação de rollout dependente da data real

A fixture de evidência foi emitida em 4 de agosto de 2026, mas um teste construía o relatório sem fornecer `now`. Depois de 24 horas, todas as submissões eram descartadas por expiração e o teste deixava de medir o comportamento de quórum.

Correção:

- os testes de agregação agora usam relógio fixo;
- o teste de anonimato insuficiente valida a mensagem correspondente;
- os contribuidores foram distribuídos por três bandas distintas, fazendo com que cada coorte permaneça abaixo do limiar de três contribuidores e seja corretamente suprimida.

Nenhuma regra de anonimização ou agregação de produção foi alterada.

### 2. Fixtures sem o perfil obrigatório `full-official`

`ContentPolicyService.createDefaultState()` usa `full-official` como perfil padrão e rejeita snapshots que não o possuem. Duas fixtures declaravam `profiles: []`, embora chamassem o método sem informar outro perfil.

Correção:

- a fixture de `catalogUpdateTransaction.test.ts` recebeu o perfil padrão;
- a fixture de `portableCatalogBackup.test.ts` recebeu o perfil padrão.

O comportamento fail-fast do serviço foi preservado.

### 3. Assertiva histórica de migração desatualizada

O teste APP-03 exigia exatamente a versão 21, enquanto a store já está na versão 23 devido a migrações posteriores. O contrato do teste é confirmar que o limite APP-03 foi alcançado, e não bloquear futuras migrações.

Correção:

- a assertiva agora exige `CHARACTER_STORE_VERSION >= 21`;
- a migração desde a versão 19 continua sendo executada e validada.

### 4. AsyncStorage nativo carregado no ambiente Node do Jest

Alguns testes importam o barrel `src/catalog/index.ts`, que exporta um hook ligado à store. Isso carrega o adaptador AsyncStorage mesmo quando o teste usa apenas serviços puros. O Jest não possui o NativeModule real e interrompia três suítes durante o carregamento.

Correção:

- criado `jest.setup.js` com o mock oficial de `@react-native-async-storage/async-storage`;
- registrado o arquivo em `jest.config.js` por `setupFiles`.

A implementação usada pelo aplicativo Android, iOS e web não foi modificada.

## Arquivos alterados

- `jest.config.js`
- `jest.setup.js`
- `src/tests/catalogRolloutAggregation.test.ts`
- `src/tests/catalogUpdateTransaction.test.ts`
- `src/tests/portableCatalogBackup.test.ts`
- `src/tests/catalogCharacterProgressionIntegration.test.ts`

## Validações executadas neste ambiente

- `node --check jest.config.js`: PASS
- `node --check jest.setup.js`: PASS
- `node scripts/check-typescript-syntax.js`: PASS — 389 arquivos
- `node scripts/check-project-shape.js`: PASS
- `node scripts/check-accessibility-contracts.js`: PASS
- `node scripts/check-bundled-compendium.js`: PASS — 1.284 itens e IDs únicos
- `node scripts/check-app30-production-release.js`: PASS

A suíte Jest completa não foi executada neste ambiente porque o pacote de entrega não inclui `node_modules` e o registry disponível não fornece toda a árvore do Expo/React Native. A validação final deve ser executada na instalação local do projeto.

## Comandos de validação local

```bash
npm run typecheck

npm test -- --runInBand \
  src/tests/catalogRolloutAggregation.test.ts \
  src/tests/catalogUpdateTransaction.test.ts \
  src/tests/portableCatalogBackup.test.ts \
  src/tests/catalogCharacterProgressionIntegration.test.ts \
  src/tests/catalogFilterPreferences.test.ts \
  src/tests/catalogRuntime.test.ts \
  src/tests/catalogStore.test.ts

npm test -- --runInBand
```
