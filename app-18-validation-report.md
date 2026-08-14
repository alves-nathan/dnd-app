# APP-18 validation report

Status: **PASS_WITH_FULL_SUITE_BLOCKED_BY_ENVIRONMENT**

## Executado com sucesso

| Verificação | Resultado |
|---|---:|
| Regressão linear APP-02 a APP-18 | 38/38 PASS |
| Parsing TS/TSX | 335/335 PASS |
| Typecheck estrito do núcleo criptográfico | PASS |
| Contratos da cadeia de confiança | PASS |
| Harness APP-18 | 38/38 PASS |
| Assinatura CLI do bundle real | PASS |
| Geração e rotação CLI de chaves | PASS |
| Fluxos Maestro encontrados | 39/39 |

## Catálogo real

| Métrica | Valor |
|---|---:|
| Versão | 4.8.0 |
| Entidades | 5.841 |
| Dependências | 15.385 |
| Checksum canônico | `0728e21b17ce768039d9873da7ee32d80b36480ab871297143944ad7fce50c43` |

## Segurança validada

- assinatura ECDSA P-256 válida aceita;
- catálogo adulterado rejeitado;
- assinatura inválida rejeitada;
- cadeia incorreta e replay rejeitados;
- publicador desconhecido e chave revogada rejeitados;
- rotação assinada aceita;
- aprovação comunitária exige fingerprint explícito;
- proveniência preservada no recibo e protegida por checksum.

## Material privado

A chave privada oficial inicial **não está incluída no ZIP da codebase**. Ela foi gerada e entregue separadamente, com guia de armazenamento offline.

## Bloqueios ambientais

O typecheck integral não concluiu porque `node_modules`, `expo/tsconfig.base` e os tipos de React, Node e Jest estão ausentes. A suíte Jest não iniciou porque `jest` não está instalado.

O gate Android encontrou todos os 39 fluxos, mas não os executou por ausência de dependências integrais, ADB, Maestro e dispositivo/emulador.

Nenhum bloqueio foi convertido em aprovação.
