# BUGFIX-002 — Typecheck: E2E seed e ícone de auditoria

Data: 2026-08-05
Baseline: BUGFIX-001 Web Interactive Card

## Sintomas

`npm run typecheck` retornava:

1. `TS2304: Cannot find name 'seed'` em `app/e2e-seed.tsx`.
2. `TS2820` para o nome inexistente `shield-search-outline` em `app/settings.tsx`.

## Causa raiz

A tela de preparação E2E ainda importava o repositório de rascunho, a fixture e as operações do compêndio, mas a função que coordenava essas operações não estava mais declarada. O botão permaneceu referenciando `seed()`.

O segundo erro vinha de um nome de ícone que não existe no conjunto tipado de Ionicons instalado pelo projeto.

## Correções

- Restaurada a função assíncrona `seed`.
- A função limpa o rascunho de criação, remove personagens locais, limpa o compêndio e importa a fixture determinística de criação E2E.
- Falhas de limpeza ou importação são convertidas em mensagem visível na própria tela.
- Preservado o texto `Ambiente E2E preparado.`, exigido pelos fluxos Maestro existentes.
- Substituído `shield-search-outline` por `search-outline`.
- Adicionado `src/tests/e2eSeedScreenContract.test.ts` para proteger a ligação entre botão, função e fixture, além do nome do ícone.

## Validações executadas neste ambiente

- `node scripts/check-typescript-syntax.js`: PASS — 382 arquivos.
- Contrato específico do BUGFIX-002: PASS.
- `node scripts/check-project-shape.js`: PASS.
- `node scripts/check-accessibility-contracts.js`: PASS.
- `node scripts/check-app30-production-release.js`: PASS.
- `package-lock.json`: inalterado.

## Limitação do ambiente

O `tsc --noEmit` completo não pôde ser reproduzido porque o registry npm interno retornou 404 ao tentar obter React Native. A correção foi feita diretamente sobre os dois diagnósticos emitidos pelo TypeScript e deve ser confirmada localmente com:

```bash
npm run typecheck
npm test -- --runInBand src/tests/e2eSeedScreenContract.test.ts
```
