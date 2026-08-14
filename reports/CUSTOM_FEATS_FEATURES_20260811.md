# Custom Feats & Features — implementação 2026-08-11

## Objetivo

Adicionar suporte de primeira classe a Feats e Features homebrew criadas diretamente na ficha, com regras estruturadas que possam participar da engine em vez de serem apenas texto livre.

## Implementado

### 1. Criação de Feat / Feature personalizada

Nova rota compartilhada:

- `app/characters/[id]/custom-rule.tsx?kind=feat`
- `app/characters/[id]/custom-rule.tsx?kind=feature`

A tela permite configurar:

- nome e descrição;
- multiplicador de dano condicionado a tipo de dano;
- gatilho probabilístico depois de causar determinado tipo de dano;
- raio, salvaguarda e comportamento de dano no sucesso;
- magia concedida diretamente;
- magia adicionada à lista elegível de uma ou mais classes;
- quantidade de trocas de magia por descanso/recarga;
- classes às quais a troca se aplica.

### 2. Preset Friendly Fire

O botão `Preencher exemplo Friendly Fire` configura:

- dano `fire` ×2;
- ao causar dano `fire`, rolar `1d8`;
- disparo no resultado `1`;
- raio de `30 ft`, equivalente aproximado aos `9 m` do material fornecido;
- salvaguarda de DEX;
- metade do dano no sucesso;
- Fire Bolt adicionado à lista de magias da classe, em vez de ser aprendido automaticamente;
- se a ficha possuir Bard, o preset restringe a expansão da lista ao Bard.

O dano dobrado já é aplicado automaticamente pela engine quando a ação possui `damageTypes: ['fire']`. O efeito explosivo fica estruturado e é exibido como regra de gatilho, mas não é somado automaticamente ao DPR total, pois quantidade de criaturas atingidas, resultado do save e posicionamento são contextuais.

### 3. Fire Bolt / expansão de lista

Foi criado `CustomSpellListAdditionRule`.

Uma feature pode adicionar magias que normalmente não pertencem à lista da classe. Essas magias:

- passam a aparecer no seletor da classe;
- continuam contando para o limite de cantrips/magias da classe;
- são preservadas pelo `buildReconciliation` enquanto a feature existir;
- voltam a ser consideradas inválidas se a feature que expandia a lista for removida.

Também continua disponível o modo `Conceder diretamente`, que adiciona a magia à ficha sem consumir o limite normal da classe.

### 4. Troca de magia por descanso

Foi criado `CustomSpellReplacementRule` ligado a um `ResourcePool`.

Exemplo suportado:

- Bard;
- 1 troca;
- recarga em `longRest`.

A tela de Magias reconhece o recurso mesmo para classes de repertório (`known`/`pactKnown`) que normalmente só trocariam magia durante level-up. Ao confirmar a substituição, 1 uso é consumido. `applyRest(..., 'longRest')` restaura o recurso.

A transação de alteração de magia registra `source: 'feature'`.

### 5. Integração com cálculo de dano

Foram adicionados ao modelo:

- `Weapon.damageType`;
- `Spell.damageType`;
- `AttackAction.damageTypes`;
- `SpellAction.damageTypes`.

O mapper do compêndio preserva `damageType` de armas e magias, e o builder de ações o propaga para a engine.

`analyzeActionDamage` agora:

- resolve multiplicadores personalizados pelo tipo de dano;
- aplica o multiplicador aos buckets normal, crítico, once-per-turn e Cleave;
- gera `CUSTOM_DAMAGE_MULTIPLIER_APPLIED`;
- gera `CUSTOM_TRIGGERED_DAMAGE_RULE` para gatilhos contextuais;
- avisa em fórmulas com múltiplos tipos, pois nesse caso o multiplicador ainda é aplicado à fórmula inteira.

Magias manuais agora também possuem seletor de `Tipo de dano`, permitindo que regras homebrew atuem sobre elas.

### 6. Ferramentas herdadas do background

`ChoiceChipSelector` recebeu `lockedSelectedValues`.

Na criação de personagem:

- ferramentas fixas do background;
- ferramentas escolhidas pelo background;
- ferramenta do custom background;

aparecem selecionadas e bloqueadas no seletor posterior da classe quando fizerem parte das opções daquela classe.

Esses valores não consomem as escolhas adicionais da classe. Caso uma ferramenta já tivesse sido escolhida pela classe e depois passe a ser concedida pelo background, ela é removida das escolhas da classe e permanece visualmente marcada como herdada.

### 7. Remoção e persistência

A remoção de Feat/Feature personalizada limpa:

- magias concedidas diretamente pela regra;
- recursos de troca associados;
- links correspondentes do compêndio.

A remoção de uma Feature que apenas expandia a lista também executa reconciliação para remover magias que deixaram de ser elegíveis.

Os campos personalizados são preservados pelos fluxos existentes de storage/backup, que mantêm a estrutura da entidade e normalizam apenas coleções ausentes.

## Arquivos principais

- `app/characters/[id]/custom-rule.tsx`
- `app/characters/[id]/feats.tsx`
- `app/characters/[id]/features.tsx`
- `app/characters/[id]/spells.tsx`
- `app/characters/new.tsx`
- `src/characters/customRuleEffects.ts`
- `src/characters/buildReconciliation.ts`
- `src/components/ChoiceChipSelector.tsx`
- `src/compendium/mapper.ts`
- `src/rules-engine/actions/buildActions.ts`
- `src/rules-engine/damage/calculateDamage.ts`
- `src/types/index.ts`

## Novos testes

- `src/tests/customRuleEffects.test.ts`
- `src/tests/customFeatFeatureUi.test.ts`

Testes existentes ampliados:

- `src/tests/buildReconciliation.test.ts`
- `src/tests/compendiumMapper.test.ts`

## Validação executada neste ambiente

PASS:

- `node scripts/check-typescript-syntax.js` — 441 arquivos;
- `node scripts/check-project-shape.js`;
- `node scripts/check-accessibility-contracts.js`;
- `node scripts/check-release-readiness.js`;
- bundled compendium check — 1.284 itens;
- Import V2 functional parity — 13/13;
- cutover audit/check;
- post-cutover check;
- final baseline check — 74 arquivos de app;
- tactical mobile closure audit — 4/4 runtime + 17/17 contracts;
- smoke test de Friendly Fire — `1d10 fire` passou de média 5,5 para 11 e expôs o gatilho 1d8;
- smoke test de troca por long rest — consumo e recuperação do recurso;
- smoke test de expansão da lista — Fire Bolt fora da lista Bard permaneceu válido via custom feature e propagou `damageType: fire` para a ação.

## Validação ainda necessária no ambiente local com dependências

O pacote distribuído não contém `node_modules`, portanto Jest completo e `tsc --noEmit` devem ser executados no ambiente local:

```bash
npm run typecheck
npm test -- --runInBand
npm run compendium:import-v2:release-gate
npm run tactical:mobile-closure:check
```

Depois disso, a validação Android nativa pode ser retomada.
