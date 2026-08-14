# APP-29 — Hardening e ensaio do release candidate

## Objetivo

Validar a codebase final antes do build de produção sem transformar bloqueios ambientais em aprovação.

## Ordem obrigatória

1. `npm run app28:gate`
2. `npm run app28:gate:verify`
3. `npm run app29:linear`
4. `npm run app29:gate`
5. `npm run app29:gate:verify`

O APP-29 é vinculado ao fingerprint da codebase e ao SHA-256 do `package-lock.json`. Qualquer alteração posterior exige repetir APP-28 e APP-29.

## Migrações

- Presets existentes são preservados e sanitizados.
- Estado de distribuição v1 é preservado em v2.
- Sessões de atualização v1 em andamento são descartadas porque não possuem checkpoints de confiança e transparência; recibos históricos são mantidos.
- Bancos SQLite permanecem migrados de forma incremental até `user_version=3`.

## Orçamentos

- Catálogo runtime: até 12 MiB.
- Parse p95 em Node de referência: até 1.500 ms.
- SHA-256 p95: até 1.500 ms.
- Código runtime TypeScript/JavaScript: até 4 MiB.
- Mínimo de 5.000 entidades e 15.000 dependências no catálogo consolidado.

Os números de Node são sentinelas contra regressões patológicas; o desempenho nativo final continua exigindo o dispositivo do APP-28.

## Resultado bloqueado

`BLOCKED` significa que o ensaio local passou, mas o APP-28 ainda não foi aprovado na mesma codebase. Não é autorização de release.
