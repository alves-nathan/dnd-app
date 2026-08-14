# APP-07 — Estabilização de dependências e gate obrigatório de release

## Objetivo

Fechar a preparação do gate nativo iniciado no APP-06, tornar a instalação de dependências determinística e impedir que uma build Android beta-candidate seja criada sem evidência válida de typecheck, Jest e execução dos quatro cenários Maestro.

## Resultado

A implementação do APP-07 foi concluída sobre a codebase do APP-06. O gate está funcional, fail-closed e integrado ao fluxo de beta-candidate.

A execução integral permanece **BLOCKED** neste ambiente porque o registry interno não contém `zustand@5.0.14`, não há ADB, Maestro nem dispositivo Android disponível. Esse bloqueio é preservado nos relatórios e impede corretamente a criação de uma evidência `PASS`.

## Dependências determinísticas

Todas as 35 dependências diretas e de desenvolvimento foram fixadas às versões já resolvidas pelo `package-lock.json`.

Foram removidas declarações como `latest`, `^` e `~` das dependências diretas. Também foram adicionados:

- `packageManager: npm@10.9.2`;
- engines explícitos para Node e npm;
- `.npmrc` com `save-exact=true` e `package-lock=true`.

O verificador `scripts/check-dependency-lock.js` confirma:

- lockfile v3;
- igualdade entre `package.json` e a raiz do lockfile;
- versões diretas exatas;
- versões críticas esperadas;
- URLs HTTPS;
- integridade SHA registrada para todos os pacotes do registry.

Resultado atual:

- 35 dependências diretas;
- 1.199 entradas do registry;
- 1.199 entradas com integrity;
- nenhuma URL externa ao registry;
- nenhum erro estrutural.

## Diagnóstico de instalação

`scripts/install-locked-dependencies.js` executa `npm ci` sem `--force` ou `--legacy-peer-deps` e classifica separadamente:

- pacote ausente no registry;
- registry inacessível;
- timeout;
- conflito de resolução;
- árvore instalada divergente.

Neste ambiente, a tentativa foi classificada como `REGISTRY_PACKAGE_MISSING` porque o mirror interno retornou 404 para `zustand@5.0.14`.

## Evidência vinculada à codebase

`scripts/lib/app07-release-evidence.js` calcula um fingerprint SHA-256 determinístico dos arquivos que afetam o aplicativo e o pipeline:

- `app/`;
- `src/`;
- `scripts/`;
- `.maestro/`;
- configurações do Expo, TypeScript, Jest, Babel, Metro, npm e EAS;
- `package.json` e `package-lock.json`.

Diretórios de resultados, relatórios, builds e dependências não entram no fingerprint.

A evidência também registra o commit Git quando o repositório está disponível.

## Gate de release

`scripts/run-app07-release-gate.js` executa e registra:

1. auditoria do lockfile;
2. smoke suite APP-06;
3. typecheck integral;
4. Jest integral;
5. gate nativo APP-06.

O resultado é salvo em `artifacts/app07-release-gate.json` com digest próprio.

O status só pode ser `PASS` quando todas as cinco etapas passam. Ausência de dependências, ferramentas ou dispositivo gera `BLOCKED`, nunca sucesso.

## Evidência nativa reforçada

O gate nativo passou para o schema `dnd-combat-app06-native-gate.v2` e agora exige:

- árvore integral de dependências;
- ADB;
- dispositivo autorizado;
- aplicativo instalado;
- `versionName` e `versionCode` iguais a `app.json`;
- Maestro;
- execução dos quatro fluxos de recuperação;
- JUnit;
- logcat;
- screenshot PNG final.

O APP-07 registra tamanho e SHA-256 de JUnit, logcat e screenshot. A verificação rejeita artefatos ausentes ou alterados depois do gate.

## Validação da evidência

`scripts/verify-app07-release-gate.js` rejeita:

- status diferente de `PASS`;
- digest inválido;
- evidência expirada;
- horário futuro;
- fingerprint divergente;
- commit divergente;
- etapa obrigatória não aprovada;
- JUnit com falhas ou erros;
- JUnit, logcat ou screenshot ausente;
- screenshot que não seja PNG;
- hash ou tamanho de artefato divergente;
- versão Android não validada.

O harness passou com 18 asserções, incluindo alteração de código, expiração, adulteração do relatório, alteração de artefato, falha no JUnit e ausência de evidência nativa.

## Integração obrigatória ao beta-candidate

O gate foi integrado em dois pontos:

- `scripts/run-beta-local-gate.js` verifica a evidência antes das demais etapas;
- `scripts/build-android-beta-candidate.js` verifica novamente a evidência antes de chamar o EAS.

Não foi criado bypass para o gate APP-07.

Quando o build for aprovado, uma cópia de `app07-release-gate.json` será incluída no diretório do APK e o manifesto `build-artifact.json` armazenará:

- schema do gate;
- data da evidência;
- fingerprint da codebase;
- SHA-256 da evidência.

## Arquivos novos

- `.npmrc`;
- `scripts/lib/app07-release-evidence.js`;
- `scripts/check-dependency-lock.js`;
- `scripts/install-locked-dependencies.js`;
- `scripts/run-app07-release-gate.js`;
- `scripts/verify-app07-release-gate.js`;
- `scripts/check-app07-release-gate.js`;
- `scripts/run-app07-runtime-harness.js`;
- `docs/APP07_RELEASE_GATE_RUNBOOK.md`.

## Arquivos alterados

- `package.json`;
- `package-lock.json`;
- `scripts/run-app06-native-gate.js`;
- `scripts/run-beta-local-gate.js`;
- `scripts/build-android-beta-candidate.js`.

## Validação executada

Passaram:

- shape do projeto;
- contratos mínimos de acessibilidade;
- pacote PHB incluído com 1.284 itens;
- catálogo v4.8.0 com 5.841 entidades e 15.385 dependências;
- contratos APP-02 a APP-06;
- parsing sintático de 296 arquivos TS/TSX;
- harness APP-05 com 24 asserções;
- harness APP-06 com 21 asserções;
- auditoria determinística das dependências;
- contratos APP-07;
- harness APP-07 com 18 asserções;
- bloqueio do beta local quando a evidência não está aprovada;
- bloqueio do build candidate quando a evidência não está aprovada.

## Bloqueios do ambiente

- `npm ci`: registry interno retorna 404 para `zustand@5.0.14`;
- typecheck integral: dependências e tipos não instalados;
- Jest integral: executável não instalado;
- ADB: indisponível;
- Maestro: indisponível;
- Android: nenhum dispositivo consultável.

Esses itens estão marcados como `BLOCKED`. Nenhuma versão foi reduzida, substituída ou instalada de forma não determinística.

## Execução no ambiente do proprietário

Consulte `docs/APP07_RELEASE_GATE_RUNBOOK.md`.

A sequência é:

```bash
npm run app07:dependencies:install
npm run app07:smoke
npm run app07:release:gate
npm run app07:release:gate:verify
npm run beta:android:build-candidate -- --message "Descrição do candidato"
```

## Próximo lote recomendado

**APP-08 — manifesto de compatibilidade de regras e diagnóstico de personagens:** registrar quais livros, snapshots e entidades cada personagem utiliza, identificar conteúdo desativado ou removido antes de abrir a ficha e oferecer uma resolução guiada sem modificar automaticamente o personagem.
