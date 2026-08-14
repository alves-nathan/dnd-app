# APP-20 validation report

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
| Contratos APP-02 a APP-19 | PASS |
| Contratos APP-20 | PASS |
| Parsing TypeScript | 345/345 |
| Typecheck isolado do núcleo/coordenador/repositório | PASS |
| Typecheck isolado da store | PASS |
| Typecheck isolado do teste | PASS |
| Harness APP-20 | 41/41 |
| Linha de base herdada | 40 verificações PASS |
| Regressão linear atual | 26/26 |
| Assinatura CLI no bundle real | PASS |
| Layout real de download | 81 blocos · 10.549.386 bytes |
| Fluxos Maestro encontrados | 47/47 |

## Comportamentos confirmados

- manifesto de distribuição assinado e vinculado à confiança local;
- no mínimo dois mirrors HTTPS;
- rejeição de mirror desatualizado;
- rejeição de mirror conflitante;
- ranking por prioridade assinada e latência;
- download em blocos;
- persistência após interrupção;
- retomada sem repetir blocos íntegros;
- redownload de bloco ausente ou adulterado;
- fallback entre mirrors;
- bloqueio por política de rede;
- materialização somente após checksum integral;
- nova validação da assinatura do envelope;
- cache offline sem aplicação automática;
- encaminhamento do cache ao preview transacional;
- evidência de download com checksum próprio.

## Etapas integrais bloqueadas

A instalação foi classificada como `BLOCKED / REGISTRY_PACKAGE_MISSING` porque o registry interno não possui `zustand@5.0.14`.

Consequentemente:

- `npm run typecheck` ficou bloqueado pela ausência da base Expo e dos tipos de Jest, Node e React;
- `npm run test:ci` não iniciou porque `jest` não está instalado;
- o gate Android não executou porque dependências, ADB, Maestro e dispositivo não estão disponíveis.

Todos os 47 arquivos Maestro foram encontrados. Nenhum bloqueio foi promovido a sucesso.
