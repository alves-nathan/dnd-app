# BUGFIX-007 — Detalhes e seleção posterior de magias

## Solicitação

1. Exibir a descrição da magia ao selecioná-la.
2. Permitir concluir a criação sem preencher todas as escolhas de magia.
3. Permitir completar as escolhas posteriormente na ficha.

## Causa do bloqueio

A tela de criação chamava `validateSpellAssignments` com `requireExact: true`. Com isso, qualquer quantidade abaixo dos limites de cantrips, magias preparadas/conhecidas ou spellbook era tratada como erro e bloqueava a navegação e a conclusão.

Além disso, a tela de magias removia manualmente a pendência recebida pela rota após a primeira magia adicionada, mesmo quando ainda havia outras escolhas faltantes.

## Alterações

- Criado `SpellChoiceDetails`, usado na criação e na tela de magias da ficha.
- O último item tocado exibe resumo, nível, escola, tempo de conjuração, alcance, duração, componentes, concentração e ritual quando esses dados estão disponíveis.
- A criação usa validação não exata para bloquear somente referências inválidas, magias inelegíveis, relações inválidas com spellbook e quantidades acima dos limites.
- A validação exata continua sendo calculada apenas para apresentar as escolhas que ficarão pendentes.
- Quantidades incompletas não impedem avançar ou concluir o personagem.
- `reconcileCharacterBuild` continua gerando uma pendência `spellSelection` por classe com as quantidades restantes.
- A tela de magias não remove mais a pendência depois de apenas uma adição; a reconciliação a mantém até que os requisitos sejam efetivamente concluídos.
- O modo não exato de `validateSpellAssignments` também aceita spellbook incompleto.

## Arquivos principais

- `app/characters/new.tsx`
- `app/characters/[id]/spells.tsx`
- `src/components/SpellChoiceDetails.tsx`
- `src/characters/spellcastingRules.ts`
- `src/tests/spellcastingRules.test.ts`
- `src/tests/deferredSpellSelectionUi.test.ts`

## Validação executada

- `npm run typescript:syntax:check`: PASS — 391 arquivos.
- `npm run check:shape`: PASS.
- `npm run check:a11y`: PASS.
- `npm run compendium:bundled:check`: PASS — 1.284 itens e IDs únicos.
- `npm run release:check`: PASS.
- Harness isolado de validação de magia: PASS.
  - modo não exato aceita zero escolhas;
  - modo exato informa os três grupos incompletos do Wizard.
- Harness isolado de reconciliação: PASS.
  - personagem Wizard sem magias recebe pendência `Completar magias de Wizard`;
  - a pendência lista cantrips, spellbook e magias preparadas restantes.

## Validação local recomendada

```bash
npm run typecheck
npm test -- --runInBand \
  src/tests/spellcastingRules.test.ts \
  src/tests/buildReconciliation.test.ts \
  src/tests/deferredSpellSelectionUi.test.ts
npm test -- --runInBand
```
