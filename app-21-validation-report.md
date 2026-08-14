# APP-21 validation report

Status: **PASS_WITH_FULL_SUITE_BLOCKED_BY_REGISTRY_AND_NATIVE_ENVIRONMENT**

## Executado com sucesso

| Verificação | Resultado |
|---|---:|
| Shape do projeto | PASS |
| Contratos de acessibilidade | PASS |
| Compêndio incluído | PASS — 1.284 itens |
| Catálogo de runtime | PASS — v4.8.0 |
| Entidades do catálogo | 5.841 |
| Dependências do catálogo | 15.385 |
| Linha de base herdada do APP-20 | 66 verificações PASS |
| Regressão linear atual | 28/28 |
| Contratos APP-21 | PASS |
| Parsing TypeScript | 350/350 |
| Typecheck isolado do núcleo | PASS |
| Typecheck isolado da store de publicação | PASS |
| Typecheck isolado da store de distribuição | PASS |
| Typecheck isolado do teste | PASS |
| Harness APP-21 | 34/34 |
| Assinatura CLI de publicação | PASS |
| Assinatura CLI de controle | PASS |
| Fluxos Maestro encontrados | 51/51 |
| Material privado na codebase | Nenhum arquivo encontrado |

## Comportamentos confirmados

- canais `stable`, `beta` e `preview`;
- mudança de canal somente após confirmação explícita;
- nenhuma alteração automática do catálogo ativo;
- versão mínima e máxima do aplicativo;
- rollout percentual assinado;
- coorte determinística por instalação;
- persistência apenas do hash da coorte nas evidências;
- notas de versão com checksum próprio;
- rejeição de notas adulteradas;
- rejeição de assinatura adulterada;
- vínculo exato com o manifesto de distribuição;
- pausa e retomada por controles monotônicos;
- retirada terminal da publicação;
- bloqueio do download e do cache quando inelegível;
- evidência de elegibilidade com checksum próprio;
- manutenção do preview transacional como único caminho de aplicação.

## Etapas integrais bloqueadas

A instalação foi classificada como `BLOCKED / REGISTRY_PACKAGE_MISSING` porque o registry interno não possui `zustand@5.0.14`.

Consequentemente:

- `npm run typecheck` ficou bloqueado pela ausência da base Expo e dos tipos de Jest, Node e React;
- `npm run test:ci` não iniciou porque `jest` não está instalado;
- o gate Android não executou porque dependências, ADB, Maestro e dispositivo não estão disponíveis.

Todos os 51 arquivos Maestro foram encontrados. Nenhum bloqueio foi promovido a sucesso.
