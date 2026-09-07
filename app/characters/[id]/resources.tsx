import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { Text, View } from 'react-native';
import { Screen } from '../../../src/components/Screen';
import { Card } from '../../../src/components/Card';
import { Button } from '../../../src/components/Button';
import { Field } from '../../../src/components/Field';
import { StatRow } from '../../../src/components/StatRow';
import { useCharacterStore } from '../../../src/store/characterStore';
import { useCompendiumStore } from '../../../src/store/compendiumStore';
import { useCharacterChoiceBridge } from '../../../src/catalog/useCharacterChoiceBridge';
import { CharacterHitPointMethod, ResourcePool, ResourceRecharge, RestType, SpellSlotLevel, SpellSlotPool, SpellSlotRecharge } from '../../../src/types';
import { createId } from '../../../src/utils/id';
import { manualSource } from '../../../src/data/mockData';
import { isSpellSlotLevel, spellSlotLabel, spellSlotPoolKey, spellSlotPoolLabel } from '../../../src/rules-engine/resources/spellSlotManager';
import { reconcileCharacterHitDice } from '../../../src/characters/hitDiceRules';
import { applyCharacterHitPointConfiguration, calculateCharacterHitPoints, getCharacterHitPointClassPlans, rollMissingCharacterHitPoints } from '../../../src/characters/hitPointRules';
import { getCharacterAbilityUses } from '../../../src/characters/abilityUseRules';
import { checkAbilityUseAvailability } from '../../../src/rules-engine/abilities/abilityUseTransactions';
import { getSelectedSpeciesFeatureChoice } from '../../../src/characters/speciesChoiceRules';
import { getCharacterMetamagicSources } from '../../../src/characters/metamagicRules';
import { useAppTheme } from '../../../src/theme';

const getId = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);

const rechargeFromText = (value: string): ResourceRecharge => {
  if (value === 'turn' || value === 'shortRest' || value === 'longRest' || value === 'day' || value === 'manual') return value;
  return 'longRest';
};

const slotRechargeFromText = (value: string): SpellSlotRecharge => {
  if (value === 'shortRest' || value === 'manual') return value;
  return 'longRest';
};

const restLabel: Record<RestType, string> = {
  turnStart: 'Início do turno',
  shortRest: 'Descanso curto',
  longRest: 'Descanso longo',
  manual: 'Manual'
};

const rechargeLabel: Record<ResourceRecharge, string> = {
  turn: 'por turno',
  shortRest: 'descanso curto',
  longRest: 'descanso longo',
  day: 'dia/descanso longo',
  manual: 'manual'
};

const slotRechargeLabel: Record<SpellSlotRecharge, string> = {
  shortRest: 'descanso curto',
  longRest: 'descanso longo',
  manual: 'manual'
};

export default function ResourcesScreen() {
  const { colors } = useAppTheme();
  const id = getId(useLocalSearchParams().id);
  const character = useCharacterStore((state) => state.characters.find((item) => item.id === id));
  const updateCharacter = useCharacterStore((state) => state.updateCharacter);
  const compendiumItems = useCompendiumStore((state) => state.items);
  const characterChoiceBridge = useCharacterChoiceBridge();
  const characterRuleItems = characterChoiceBridge.items.length ? characterChoiceBridge.items : compendiumItems;
  const addResource = useCharacterStore((state) => state.addResource);
  const updateResource = useCharacterStore((state) => state.updateResource);
  const removeResource = useCharacterStore((state) => state.removeResource);
  const spendResource = useCharacterStore((state) => state.spendResource);
  const recoverResource = useCharacterStore((state) => state.recoverResource);
  const addOrUpdateSpellSlot = useCharacterStore((state) => state.addOrUpdateSpellSlot);
  const updateSpellSlot = useCharacterStore((state) => state.updateSpellSlot);
  const removeSpellSlot = useCharacterStore((state) => state.removeSpellSlot);
  const spendSpellSlot = useCharacterStore((state) => state.spendSpellSlot);
  const recoverSpellSlot = useCharacterStore((state) => state.recoverSpellSlot);
  const applyRest = useCharacterStore((state) => state.applyRest);
  const useAbility = useCharacterStore((state) => state.useAbility);
  const undoAbilityUse = useCharacterStore((state) => state.undoAbilityUse);

  const [name, setName] = useState('Novo recurso');
  const [max, setMax] = useState('1');
  const [current, setCurrent] = useState('1');
  const [recharge, setRecharge] = useState<ResourceRecharge>('longRest');
  const [notes, setNotes] = useState('');
  const [slotLevel, setSlotLevel] = useState('1');
  const [slotMax, setSlotMax] = useState('2');
  const [slotCurrent, setSlotCurrent] = useState('2');
  const [slotRecharge, setSlotRecharge] = useState<SpellSlotRecharge>('longRest');
  const [hpMax, setHpMax] = useState(String(character?.hitPoints?.max ?? 0));
  const [hpCurrent, setHpCurrent] = useState(String(character?.hitPoints?.current ?? 0));
  const [hpTemporary, setHpTemporary] = useState(String(character?.hitPoints?.temporary ?? 0));
  const [hpMethod, setHpMethod] = useState<CharacterHitPointMethod>(character?.hitPoints?.method ?? 'fixed');
  const [abilityFeedback, setAbilityFeedback] = useState('');
  const [hpRollsByClass, setHpRollsByClass] = useState<Record<string, string>>(() => Object.fromEntries(
    Object.entries(character?.hitPoints?.rolledByClass ?? {}).map(([classId, rolls]) => [classId, rolls.join(', ')])
  ));

  const abilityUses = useMemo(() => character ? getCharacterAbilityUses(character, compendiumItems) : [], [character, compendiumItems]);
  const metamagicSources = character ? getCharacterMetamagicSources(character, characterRuleItems) : [];

  useEffect(() => {
    setHpMax(String(character?.hitPoints?.max ?? 0));
    setHpCurrent(String(character?.hitPoints?.current ?? 0));
    setHpTemporary(String(character?.hitPoints?.temporary ?? 0));
    setHpMethod(character?.hitPoints?.method ?? 'fixed');
    setHpRollsByClass(Object.fromEntries(
      Object.entries(character?.hitPoints?.rolledByClass ?? {}).map(([classId, rolls]) => [classId, rolls.join(', ')])
    ));
  }, [character?.id, character?.hitPoints?.method]);

  if (!character || !id) return <Screen title="Não encontrado"><Button label="Voltar" onPress={() => router.back()} /></Screen>;

  const createResource = () => {
    const resource: ResourcePool = {
      id: createId('resource'),
      name: name.trim() || 'Recurso sem nome',
      max: Math.max(0, Number(max) || 0),
      current: Math.max(0, Number(current) || 0),
      recharge,
      notes,
      source: manualSource
    };
    addResource(id, resource);
    setName('Novo recurso');
    setMax('1');
    setCurrent('1');
    setRecharge('longRest');
    setNotes('');
  };

  const saveSpellSlot = () => {
    const numericLevel = Number(slotLevel);
    if (!isSpellSlotLevel(numericLevel)) return;
    const slot: SpellSlotPool = {
      id: createId('spellSlot'),
      level: numericLevel,
      poolKind: 'manual',
      max: Math.max(0, Number(slotMax) || 0),
      current: Math.max(0, Number(slotCurrent) || 0),
      recharge: slotRecharge,
      source: manualSource
    };
    addOrUpdateSpellSlot(id, slot);
  };

  const restButtons: RestType[] = ['turnStart', 'shortRest', 'longRest'];
  const hitDiceCharacter = reconcileCharacterHitDice(character);
  const hitDice = hitDiceCharacter.hitDice ?? [];
  const hpPlans = getCharacterHitPointClassPlans(hitDiceCharacter);
  const parsedRolls = Object.fromEntries(Object.entries(hpRollsByClass).map(([classId, text]) => [
    classId,
    text.split(',').map((entry) => Number(entry.trim())).filter((entry) => Number.isFinite(entry) && entry > 0)
  ]));
  const hpPreview = calculateCharacterHitPoints(hitDiceCharacter, {
    method: hpMethod,
    manualMax: Math.max(0, Math.floor(Number(hpMax) || 0)),
    rolledByClass: parsedRolls
  }, compendiumItems);
  const saveHitPoints = () => {
    const temporaryValue = Math.max(0, Math.floor(Number(hpTemporary) || 0));
    updateCharacter(id, (currentCharacter) => {
      const withDice = reconcileCharacterHitDice(currentCharacter);
      const configured = applyCharacterHitPointConfiguration(withDice, {
        method: hpMethod,
        manualMax: hpMethod === 'manual' ? Math.max(0, Math.floor(Number(hpMax) || 0)) : undefined,
        rolledByClass: hpMethod === 'rolled' ? parsedRolls : undefined
      }, compendiumItems);
      const maxValue = configured.hitPoints?.max ?? Math.max(0, Math.floor(Number(hpMax) || 0));
      const rawCurrent = Number(hpCurrent);
      const firstDefinition = (currentCharacter.hitPoints?.max ?? 0) <= 0;
      const requestedCurrent = hpCurrent.trim() === '' || !Number.isFinite(rawCurrent) || (firstDefinition && rawCurrent === 0)
        ? Math.max(0, Math.min(maxValue, configured.hitPoints?.current ?? 0))
        : Math.max(0, Math.min(maxValue, Math.floor(rawCurrent)));
      return {
        ...configured,
        hitPoints: {
          ...(configured.hitPoints ?? { max: maxValue, current: requestedCurrent, temporary: temporaryValue }),
          current: requestedCurrent,
          temporary: temporaryValue
        }
      };
    });
  };
  const rollHitPoints = () => {
    const rolled = rollMissingCharacterHitPoints({
      ...hitDiceCharacter,
      hitPoints: {
        ...(hitDiceCharacter.hitPoints ?? { current: 0, max: 0, temporary: 0 }),
        rolledByClass: parsedRolls
      }
    });
    setHpRollsByClass(Object.fromEntries(Object.entries(rolled ?? {}).map(([classId, rolls]) => [classId, rolls.join(', ')])));
  };

  return (
    <Screen title="Recursos e descanso" subtitle="Rastreie spell slots estruturados, usos por descanso, recursos por turno e usos manuais. Rotações com recursos indisponíveis são marcadas como inválidas.">
      <Card title="Descanso / recuperação" subtitle="Recupera recursos e slots compatíveis com o tipo de descanso e avança/expira efeitos ativos.">
        <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
          {restButtons.map((restType) => (
            <View key={restType} style={{ flex: 1, minWidth: 130 }}>
              <Button label={restLabel[restType]} secondary={restType !== 'longRest'} onPress={() => applyRest(id, restType)} />
            </View>
          ))}
        </View>
      </Card>

      <Button label="Gerenciar efeitos ativos e concentração" secondary onPress={() => router.push(`/characters/${character.id}/effects`)} />

      {metamagicSources.length ? (
        <Card title="Metamagic" subtitle="Cada fonte mantém suas próprias escolhas e o combate tático usa apenas as opções selecionadas.">
          {metamagicSources.map((source) => (
            <Text key={source.id} style={{ color: colors.onSurfaceVariant }}>
              {source.label}: {source.selectedOptionIds.length}/{source.optionLimit} selecionada(s)
            </Text>
          ))}
          <Button label="Configurar Metamagic" variant="outlined" onPress={() => router.push(`/characters/${character.id}/metamagic`)} />
        </Card>
      ) : null}

      <Card title="Pontos de vida e Hit Dice" subtitle="No 1º nível, use o valor máximo do Hit Die + CON. Depois, RAW permite rolar ou usar o valor fixo da classe; dados cheios e manual ficam disponíveis como alternativas.">
        <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
          {[
            ['rolled', 'RAW · rolar'],
            ['fixed', 'Fixo RAW / média'],
            ['maximum', 'Dados cheios'],
            ['manual', 'Manual']
          ].map(([method, label]) => (
            <View key={method} style={{ flex: 1, minWidth: 130 }}>
              <Button label={label} secondary={hpMethod !== method} onPress={() => setHpMethod(method as CharacterHitPointMethod)} />
            </View>
          ))}
        </View>
        <Text>CON: {hpPreview.constitutionModifier >= 0 ? '+' : ''}{hpPreview.constitutionModifier} · 1º nível: {hpPreview.firstLevelHitPoints ?? 'manual'} PV</Text>
        {hpMethod === 'rolled' ? (
          <>
            {hpPlans.filter((plan) => plan.higherLevelRollsRequired > 0).map((plan) => (
              <Field
                key={plan.classEntityId}
                label={`${plan.className}: ${plan.higherLevelRollsRequired} rolagem(ns) de d${plan.hitDie} acima do 1º nível`}
                value={hpRollsByClass[plan.classEntityId] ?? ''}
                onChangeText={(text) => setHpRollsByClass((current) => ({ ...current, [plan.classEntityId]: text }))}
                placeholder="Ex.: 6, 4, 8"
              />
            ))}
            <Button label="Rolar valores faltantes" secondary onPress={rollHitPoints} />
          </>
        ) : null}
        {hpMethod === 'manual' ? <Field label="PV máximo manual" value={hpMax} onChangeText={setHpMax} keyboardType="number-pad" /> : null}
        {hpPreview.baseMax !== undefined && hpPreview.permanentBonus !== 0 ? <StatRow label="PV por classe + CON" value={String(hpPreview.baseMax)} /> : null}
        {hpPreview.bonuses.map((bonus) => <StatRow key={bonus.sourceName} label={`Bônus permanente · ${bonus.sourceName}`} value={`${bonus.amount >= 0 ? '+' : ''}${bonus.amount}`} />)}
        <StatRow label="PV máximo calculado" value={hpPreview.max !== undefined ? String(hpPreview.max) : 'incompleto'} />
        {hpPreview.issues.map((message) => <Text key={message}>{message}</Text>)}
        <Field label="PV atual" value={hpCurrent} onChangeText={setHpCurrent} keyboardType="number-pad" />
        <Field label="PV temporários" value={hpTemporary} onChangeText={setHpTemporary} keyboardType="number-pad" />
        <Button label="Salvar pontos de vida" onPress={saveHitPoints} disabled={!hpPreview.complete} />
        {hitDice.map((pool) => <StatRow key={pool.id} label={`${pool.className} d${pool.dieSides}`} value={`${pool.current} / ${pool.max}`} />)}
      </Card>

      <Card title="Spell slots" subtitle="Cadastre slots por círculo. Magias de nível 1+ consomem o slot selecionado na rotação.">
        <Field label="Círculo do slot: 1 a 9" value={slotLevel} onChangeText={setSlotLevel} keyboardType="number-pad" />
        <Field label="Máximo" value={slotMax} onChangeText={setSlotMax} keyboardType="number-pad" />
        <Field label="Atual" value={slotCurrent} onChangeText={setSlotCurrent} keyboardType="number-pad" />
        <Field label="Recarga: longRest | shortRest | manual" value={slotRecharge} onChangeText={(text) => setSlotRecharge(slotRechargeFromText(text))} />
        <Button label="Salvar slot" onPress={saveSpellSlot} disabled={!isSpellSlotLevel(Number(slotLevel))} />
      </Card>

      {(character.spellSlots ?? []).length === 0 ? <Card title="Nenhum spell slot" subtitle="Cantrips não consomem slots. Magias de nível 1+ precisam de slots cadastrados para registrar gasto." /> : null}

      {(character.spellSlots ?? []).map((slot) => (
        <Card key={spellSlotPoolKey(slot)} title={spellSlotPoolLabel(slot)} subtitle={`Recarga: ${slotRechargeLabel[slot.recharge]}`}>
          <StatRow label="Atual / máximo" value={`${slot.current} / ${slot.max}`} />
          <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
            <View style={{ flex: 1, minWidth: 95 }}><Button label="Gastar 1" onPress={() => spendSpellSlot(id, slot.level, 1, 'Gasto manual de slot', { poolKind: slot.poolKind, sourceClassId: slot.sourceClassId })} disabled={slot.current <= 0} /></View>
            <View style={{ flex: 1, minWidth: 95 }}><Button label="Recuperar 1" secondary onPress={() => recoverSpellSlot(id, slot.level, 1, 'Recuperação manual de slot', { poolKind: slot.poolKind, sourceClassId: slot.sourceClassId })} disabled={slot.current >= slot.max} /></View>
          </View>
          <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
            <View style={{ flex: 1, minWidth: 95 }}>
              <Button label="Atual = máx" secondary onPress={() => updateSpellSlot(id, slot.level, (currentSlot) => ({ ...currentSlot, current: currentSlot.max }), { poolKind: slot.poolKind, sourceClassId: slot.sourceClassId })} />
            </View>
            <View style={{ flex: 1, minWidth: 95 }}>
              <Button label="Zerar" secondary onPress={() => updateSpellSlot(id, slot.level, (currentSlot) => ({ ...currentSlot, current: 0 }), { poolKind: slot.poolKind, sourceClassId: slot.sourceClassId })} />
            </View>
          </View>
          <Button label="Remover slot" secondary onPress={() => removeSpellSlot(id, slot.level, { poolKind: slot.poolKind, sourceClassId: slot.sourceClassId })} />
        </Card>
      ))}

      {abilityUses.length ? (
        <Card title="Usar habilidades" subtitle="Custos fixos declarados são aplicados atomicamente. Custos variáveis ou regras ainda não estruturadas permanecem manuais.">
          {abilityFeedback ? <Text style={{ color: '#475569' }}>{abilityFeedback}</Text> : null}
          {abilityUses.map((use) => {
            const availability = use.definition ? checkAbilityUseAvailability(character, use.definition) : undefined;
            return (
              <View key={use.id} style={{ gap: 5, paddingVertical: 8 }}>
                <Text style={{ fontWeight: '800' }}>{use.name}</Text>
                <Text style={{ color: '#9f1239' }}>Custo: {use.costLabels.join(' + ') || 'manual'}{use.actionLabel ? ` · ${use.actionLabel}` : ''}</Text>
                {use.description ? <Text style={{ color: '#475569' }}>{use.description}</Text> : null}
                {use.issues.map((entry) => <Text key={`${use.id}:${entry.code}`} style={{ color: '#92400e' }}>{entry.message}</Text>)}
                {use.definition ? (
                  <Button
                    label="Usar habilidade"
                    onPress={() => {
                      const result = useAbility(id, use.definition!);
                      setAbilityFeedback(result?.issues.length ? result.issues.map((entry) => entry.message).join(' · ') : `${use.name}: custo aplicado.`);
                    }}
                    disabled={availability ? !availability.ok : true}
                  />
                ) : null}
              </View>
            );
          })}
          {(character.abilityUseTransactions ?? []).some((transaction) => transaction.status === 'applied') ? (
            <Button
              label="Desfazer último uso de habilidade"
              secondary
              onPress={() => {
                const result = undoAbilityUse(id);
                setAbilityFeedback(result?.issues.length ? result.issues.map((entry) => entry.message).join(' · ') : 'Último uso de habilidade desfeito.');
              }}
            />
          ) : null}
        </Card>
      ) : null}

      <Card title="Adicionar recurso limitado" subtitle="Use para Action Surge, Smite, Bardic Inspiration, Metamagic, cargas de item etc.">
        <Field label="Nome" value={name} onChangeText={setName} />
        <Field label="Máximo" value={max} onChangeText={setMax} keyboardType="number-pad" />
        <Field label="Atual" value={current} onChangeText={setCurrent} keyboardType="number-pad" />
        <Field label="Recarga: turn | shortRest | longRest | day | manual" value={recharge} onChangeText={(text) => setRecharge(rechargeFromText(text))} />
        <Field label="Notas" value={notes} onChangeText={setNotes} multiline />
        <Button label="Adicionar recurso" onPress={createResource} />
      </Card>

      {character.resources.length === 0 ? <Card title="Nenhum recurso" subtitle="Adicione usos de feature, Action Surge, Bardic Inspiration, Ki/Focus ou qualquer recurso limitado que não seja spell slot." /> : null}

      {character.resources.map((resource) => {
        const sourceFeature = character.features.find((feature) => feature.resource?.id === resource.id);
        const selectedSpeciesChoice = sourceFeature ? getSelectedSpeciesFeatureChoice(character, characterRuleItems, sourceFeature.id) : undefined;
        return (
          <Card key={resource.id} title={resource.name} subtitle={`Recarga: ${rechargeLabel[resource.recharge]}`}>
            <StatRow label="Atual / máximo" value={`${resource.current} / ${resource.max}`} />
            {selectedSpeciesChoice ? <Text style={{ color: '#9f1239', fontWeight: '800' }}>Escolha ativa: {selectedSpeciesChoice.option.label}</Text> : null}
            {selectedSpeciesChoice?.description ? <Text style={{ color: '#475569' }}>{selectedSpeciesChoice.description}</Text> : null}
            {resource.notes ? <Text style={{ color: '#475569' }}>{resource.notes}</Text> : null}
            <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
              <View style={{ flex: 1, minWidth: 95 }}><Button label="Gastar 1" onPress={() => spendResource(id, resource.id, 1)} disabled={resource.current <= 0} /></View>
              <View style={{ flex: 1, minWidth: 95 }}><Button label="Recuperar 1" secondary onPress={() => recoverResource(id, resource.id, 1)} disabled={resource.current >= resource.max} /></View>
            </View>
            <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
              <View style={{ flex: 1, minWidth: 95 }}>
                <Button
                  label="Atual = máx"
                  secondary
                  onPress={() => updateResource(id, resource.id, (currentResource) => ({ ...currentResource, current: currentResource.max }))}
                />
              </View>
              <View style={{ flex: 1, minWidth: 95 }}>
                <Button
                  label="Zerar"
                  secondary
                  onPress={() => updateResource(id, resource.id, (currentResource) => ({ ...currentResource, current: 0 }))}
                />
              </View>
            </View>
            <Button label="Remover recurso" secondary onPress={() => removeResource(id, resource.id)} />
          </Card>
        );
      })}

      <Card title="Histórico recente" subtitle="Últimas alterações de recursos, slots e usos de habilidade registradas na ficha.">
        {(character.abilityUseTransactions ?? []).slice(-6).reverse().map((transaction) => (
          <View key={transaction.id} style={{ borderTopWidth: 1, borderTopColor: '#e2e8f0', paddingVertical: 6 }}>
            <Text style={{ fontWeight: '800', color: '#111827' }}>{transaction.abilityName} · {transaction.status === 'undone' ? 'desfeito' : 'usado'}</Text>
            <Text style={{ color: '#64748b' }}>
              {[
                ...transaction.resourceChanges.map((change) => `${change.resourceName} ${change.before} → ${change.after}`),
                ...transaction.spellSlotChanges.map((change) => `Slot ${change.slotLevel}: ${change.before} → ${change.after}`)
              ].join(' · ')}
            </Text>
          </View>
        ))}
        {(character.spellSlotTransactions ?? []).slice(-6).reverse().map((transaction) => (
          <View key={transaction.id} style={{ borderTopWidth: 1, borderTopColor: '#e2e8f0', paddingVertical: 6 }}>
            <Text style={{ fontWeight: '800', color: '#111827' }}>Slot {spellSlotLabel(transaction.slotLevel)}: {transaction.before} → {transaction.after}</Text>
            <Text style={{ color: '#64748b' }}>{transaction.reason} · {transaction.amount > 0 ? '+' : ''}{transaction.amount}</Text>
          </View>
        ))}
        {(character.healingTransactions ?? []).slice(-6).reverse().map((transaction) => (
          <View key={transaction.id} style={{ borderTopWidth: 1, borderTopColor: '#e2e8f0', paddingVertical: 6 }}>
            <Text style={{ fontWeight: '800', color: '#111827' }}>Cura de Lifedrinker: {transaction.amount} PV</Text>
            <Text style={{ color: '#64748b' }}>dado {transaction.dieRoll ?? '—'} + CON {transaction.constitutionModifier ?? '—'}{transaction.hitPointsAfter !== undefined ? ` · PV ${transaction.hitPointsBefore} → ${transaction.hitPointsAfter}` : ''}</Text>
          </View>
        ))}
        {(character.hitDieTransactions ?? []).slice(-6).reverse().map((transaction) => (
          <View key={transaction.id} style={{ borderTopWidth: 1, borderTopColor: '#e2e8f0', paddingVertical: 6 }}>
            <Text style={{ fontWeight: '800', color: '#111827' }}>Hit Die d{transaction.dieSides}: {transaction.before} → {transaction.after}</Text>
            <Text style={{ color: '#64748b' }}>{transaction.reason}</Text>
          </View>
        ))}
        {(character.resourceTransactions ?? []).slice(-6).reverse().map((transaction) => (
          <View key={transaction.id} style={{ borderTopWidth: 1, borderTopColor: '#e2e8f0', paddingVertical: 6 }}>
            <Text style={{ fontWeight: '800', color: '#111827' }}>{transaction.resourceName}: {transaction.before} → {transaction.after}</Text>
            <Text style={{ color: '#64748b' }}>{transaction.reason} · {transaction.amount > 0 ? '+' : ''}{transaction.amount}</Text>
          </View>
        ))}
        {(character.abilityUseTransactions ?? []).length === 0 && (character.resourceTransactions ?? []).length === 0 && (character.spellSlotTransactions ?? []).length === 0 && (character.hitDieTransactions ?? []).length === 0 && (character.healingTransactions ?? []).length === 0 ? <Text style={{ color: '#64748b' }}>Nenhum gasto ou descanso registrado ainda.</Text> : null}
      </Card>

      <Button label="Voltar" secondary onPress={() => router.back()} />
    </Screen>
  );
}
