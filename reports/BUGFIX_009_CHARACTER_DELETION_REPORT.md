# BUGFIX-009 — Exclusão de personagem

Data: 2026-08-10
Baseline: BUGFIX-008

## Sintoma

O botão **Excluir personagem** não removia o personagem, especialmente no fluxo Web.

## Causa

A tela `app/characters/[id]/index.tsx` dependia de `Alert.alert` com uma lista de botões e colocava a exclusão dentro do callback do botão destrutivo. Esse contrato de UI não era adequado como confirmação cross-platform para o fluxo Web do aplicativo.

Além disso, `removeCharacter` removia a ficha principal, drafts e planos de compatibilidade, mas não havia uma operação única para remover dados persistidos pertencentes exclusivamente ao personagem em stores independentes, como cenários de combate e snapshots de histórico.

## Correção

1. A confirmação foi substituída por um painel de confirmação dentro da própria tela.
2. Foram adicionados `testID`s para o fluxo de exclusão:
   - `delete-character-button`
   - `delete-character-confirmation`
   - `cancel-delete-character`
   - `confirm-delete-character`
3. Foi criado `deleteCharacterData`, responsável pela exclusão coordenada de:
   - ficha;
   - cenários de combate;
   - snapshots do histórico da build.
4. `CombatScenarioStore` recebeu `removeCharacterScenarios(characterId)`.
5. `CharacterStore.removeCharacter` também limpa entradas de quarentena e recovery associadas ao personagem.
6. Build presets são preservados intencionalmente, porque são templates reutilizáveis e não registros pertencentes exclusivamente à ficha.

## Regressão

Novo teste: `src/tests/characterDeletion.test.ts`.

Ele valida:

- remoção da ficha;
- remoção de cenários associados;
- remoção de snapshots associados;
- retorno de falha para IDs inexistentes;
- presença da confirmação in-app;
- ausência do antigo `Alert.alert('Excluir personagem?')`.

## Validação executada neste ambiente

- `node scripts/check-typescript-syntax.js`: PASS — 395 arquivos
- `node scripts/check-accessibility-contracts.js`: PASS
- `node scripts/check-release-readiness.js`: PASS
- `node scripts/check-app30-production-release.js`: PASS

A suíte Jest completa não foi executada porque a entrega não inclui `node_modules`.
