# APP-08 validation report

Status: **PASS_WITH_FULL_SUITE_BLOCKED_BY_MISSING_DEPENDENCIES**

## Executado com sucesso

- smoke suite APP-02 a APP-08: PASS;
- catálogo v4.8.0: 5.841 entidades e 15.385 dependências;
- compêndio incluído: 1.284 itens;
- parsing TS/TSX: 301/301;
- typecheck estrito isolado do manifesto: PASS;
- harness real: 18/18 asserções;
- diagnóstico sem mutação automática: PASS.

## Cenário do harness

- referências: 4;
- disponíveis: 1;
- desativadas: 2;
- ausentes: 1;
- ocorrências: CHARACTER_SNAPSHOT_MISMATCH, CHARACTER_CATALOG_ENTITY_DISABLED, CHARACTER_CATALOG_ENTITY_MISSING, CHARACTER_LOCAL_ITEM_DISABLED.

## Bloqueios do ambiente

O typecheck integral não encontrou Expo e os tipos de React, Node e Jest. A suíte Jest não iniciou porque o executável `jest` não está instalado.
