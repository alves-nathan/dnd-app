import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { Text, View } from 'react-native';
import { Screen } from '../../../src/components/Screen';
import { Card } from '../../../src/components/Card';
import { Button } from '../../../src/components/Button';
import { Field } from '../../../src/components/Field';
import { StatRow } from '../../../src/components/StatRow';
import { useCharacterStore } from '../../../src/store/characterStore';
import { ResourcePool, ResourceRecharge, RestType, SpellSlotLevel, SpellSlotPool, SpellSlotRecharge } from '../../../src/types';
import { createId } from '../../../src/utils/id';
import { manualSource } from '../../../src/data/mockData';
import { isSpellSlotLevel, spellSlotLabel, spellSlotPoolKey, spellSlotPoolLabel } from '../../../src/rules-engine/resources/spellSlotManager';
import { reconcileCharacterHitDice } from '../../../src/characters/hitDiceRules';

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
  const id = getId(useLocalSearchParams().id);
  const character = useCharacterStore((state) => state.characters.find((item) => item.id === id));
  const updateCharacter = useCharacterStore((state) => state.updateCharacter);
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

  useEffect(() => {
    setHpMax(String(character?.hitPoints?.max ?? 0));
    setHpCurrent(String(character?.hitPoints?.current ?? 0));
    setHpTemporary(String(character?.hitPoints?.temporary ?? 0));
  }, [character?.id]);

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
  const hitDice = reconcileCharacterHitDice(character).hitDice ?? [];
  const saveHitPoints = () => {
    const maxValue = Math.max(0, Math.floor(Number(hpMax) || 0));
    const currentValue = Math.max(0, Math.min(maxValue, Math.floor(Number(hpCurrent) || 0)));
    const temporaryValue = Math.max(0, Math.floor(Number(hpTemporary) || 0));
    updateCharacter(id, (currentCharacter) => ({
      ...currentCharacter,
      hitPoints: { max: maxValue, current: currentValue, temporary: temporaryValue },
      hitDice
    }));
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

      <Card title="Pontos de vida e Hit Dice" subtitle="Hit Dice são derivados dos níveis de classe. O descanso longo recupera os dados gastos.">
        <Field label="PV máximo" value={hpMax} onChangeText={setHpMax} keyboardType="number-pad" />
        <Field label="PV atual" value={hpCurrent} onChangeText={setHpCurrent} keyboardType="number-pad" />
        <Field label="PV temporários" value={hpTemporary} onChangeText={setHpTemporary} keyboardType="number-pad" />
        <Button label="Salvar pontos de vida" onPress={saveHitPoints} />
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

      <Card title="Adicionar recurso limitado" subtitle="Use para Action Surge, Smite, Bardic Inspiration, Metamagic, cargas de item etc.">
        <Field label="Nome" value={name} onChangeText={setName} />
        <Field label="Máximo" value={max} onChangeText={setMax} keyboardType="number-pad" />
        <Field label="Atual" value={current} onChangeText={setCurrent} keyboardType="number-pad" />
        <Field label="Recarga: turn | shortRest | longRest | day | manual" value={recharge} onChangeText={(text) => setRecharge(rechargeFromText(text))} />
        <Field label="Notas" value={notes} onChangeText={setNotes} multiline />
        <Button label="Adicionar recurso" onPress={createResource} />
      </Card>

      {character.resources.length === 0 ? <Card title="Nenhum recurso" subtitle="Adicione usos de feature, Action Surge, Bardic Inspiration, Ki/Focus ou qualquer recurso limitado que não seja spell slot." /> : null}

      {character.resources.map((resource) => (
        <Card key={resource.id} title={resource.name} subtitle={`Recarga: ${rechargeLabel[resource.recharge]}`}>
          <StatRow label="Atual / máximo" value={`${resource.current} / ${resource.max}`} />
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
      ))}

      <Card title="Histórico recente" subtitle="Últimas alterações de recursos e slots registradas na ficha.">
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
        {(character.resourceTransactions ?? []).length === 0 && (character.spellSlotTransactions ?? []).length === 0 && (character.hitDieTransactions ?? []).length === 0 && (character.healingTransactions ?? []).length === 0 ? <Text style={{ color: '#64748b' }}>Nenhum gasto ou descanso registrado ainda.</Text> : null}
      </Card>

      <Button label="Voltar" secondary onPress={() => router.back()} />
    </Screen>
  );
}
