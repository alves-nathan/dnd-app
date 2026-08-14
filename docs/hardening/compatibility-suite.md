# Fase 27 — Hardening de testes e compatibilidade

Esta fase adiciona uma suíte de smoke tests lógicos para validar se o projeto está pronto para a preparação de dev build/release.

A suíte roda sem depender de conteúdo oficial de D&D. Ela usa os dados locais do usuário e a biblioteca fictícia de exemplos para verificar os principais contratos do app.

## O que é validado

- biblioteca de exemplos;
- importação JSON do compêndio;
- backup/restauração de personagens;
- diagnóstico global;
- análise de rotações pela engine;
- resumo de personagens no modo mesa;
- prontidão pré-engine do compêndio;
- exportação reimportável de pacotes do compêndio;
- gate lógico de release/dev build.

## Tela do app

A tela `Hardening / compatibilidade` fica na home do app e mostra:

- score 0–100;
- status geral;
- gate `ready`, `needsReview` ou `blocked`;
- checks individuais;
- warnings e erros;
- relatório Markdown compartilhável.

## Scripts úteis

```bash
npm run check:shape
npm run typecheck
npm test
```

`check:shape` é uma verificação leve de estrutura do projeto. Ele não substitui o typecheck nem os testes Jest, mas ajuda a detectar arquivos/scritps obrigatórios ausentes antes de preparar uma build.

## Critério recomendado antes da Fase 28

Antes de gerar dev build ou release:

1. `npm run check:shape` deve passar.
2. `npm run typecheck` deve passar.
3. `npm test` deve passar.
4. A tela de hardening deve mostrar gate `ready`, ou no máximo `needsReview` com warnings conhecidos e aceitos.
5. O diagnóstico global não deve conter erros bloqueantes.
