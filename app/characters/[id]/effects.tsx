import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Text, View } from 'react-native';
import { Screen } from '../../../src/components/Screen';
import { Card } from '../../../src/components/Card';
import { Button } from '../../../src/components/Button';
import { Field } from '../../../src/components/Field';
import { StatRow } from '../../../src/components/StatRow';
import { useCharacterStore } from '../../../src/store/characterStore';
import { ActiveEffect, ActiveEffectDurationUnit, ActiveEffectKind, RestType } from '../../../src/types';
import { createId } from '../../../src/utils/id';
import { manualSource } from '../../../src/data/mockData';
import { activeEffectConditionIds, getActiveConcentrationEffect } from '../../../src/rules-engine/effects/activeEffects';

const getId = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);

const parseKind = (value: string): ActiveEffectKind => {
  if (value === 'buff' || value === 'debuff' || value === 'condition' || value === 'spell' || value === 'feature' || value === 'item' || value === 'manual') return value;
  return 'buff';
};

const parseDurationUnit = (value: string): ActiveEffectDurationUnit => {
  if (value === 'turn' || value === 'round' || value === 'minute' || value === 'hour' || value === 'manual') return value;
  return 'manual';
};

const yes = (value: string): boolean => ['s', 'sim', 'true', '1', 'yes', 'y'].includes(value.trim().toLowerCase());

const durationLabel: Record<ActiveEffectDurationUnit, string> = {
  turn: 'turnos',
  round: 'rodadas',
  minute: 'minutos',
  hour: 'horas',
  manual: 'manual'
};

const restLabel: Record<RestType, string> = {
  turnStart: 'Início do turno',
  shortRest: 'Descanso curto',
  longRest: 'Descanso longo',
  manual: 'Manual'
};

export default function ActiveEffectsScreen() {
  const id = getId(useLocalSearchParams().id);
  const character = useCharacterStore((state) => state.characters.find((item) => item.id === id));
  const addActiveEffect = useCharacterStore((state) => state.addActiveEffect);
  const removeActiveEffect = useCharacterStore((state) => state.removeActiveEffect);
  const updateActiveEffect = useCharacterStore((state) => state.updateActiveEffect);
  const advanceEffects = useCharacterStore((state) => state.advanceEffects);
  const clearConcentration = useCharacterStore((state) => state.clearConcentration);

  const [name, setName] = useState('Novo efeito');
  const [kind, setKind] = useState<ActiveEffectKind>('buff');
  const [conditionIds, setConditionIds] = useState('');
  const [concentration, setConcentration] = useState('não');
  const [durationUnit, setDurationUnit] = useState<ActiveEffectDurationUnit>('manual');
  const [remaining, setRemaining] = useState('');
  const [endsOnShortRest, setEndsOnShortRest] = useState('não');
  const [endsOnLongRest, setEndsOnLongRest] = useState('sim');
  const [notes, setNotes] = useState('');

  if (!character || !id) return <Screen title="Não encontrado"><Button label="Voltar" onPress={() => router.back()} /></Screen>;

  const concentrationEffect = getActiveConcentrationEffect(character);
  const activeConditions = activeEffectConditionIds(character);

  const createEffect = () => {
    const effect: ActiveEffect = {
      id: createId('effect'),
      name: name.trim() || 'Efeito sem nome',
      kind,
      sourceType: kind === 'spell' ? 'spell' : kind === 'item' ? 'magicItem' : kind === 'condition' ? 'condition' : kind === 'debuff' ? 'debuff' : 'buff',
      source: manualSource,
      status: 'active',
      concentration: yes(concentration),
      conditionIds: conditionIds.split(',').map((item) => item.trim()).filter(Boolean),
      duration: {
        unit: durationUnit,
        remaining: remaining.trim() ? Math.max(0, Number(remaining) || 0) : undefined,
        expiresOn: 'turnStart'
      },
      endsOnShortRest: yes(endsOnShortRest),
      endsOnLongRest: yes(endsOnLongRest),
      notes,
      createdAt: new Date().toISOString()
    };
    addActiveEffect(id, effect);
    setName('Novo efeito');
    setKind('buff');
    setConditionIds('');
    setConcentration('não');
    setDurationUnit('manual');
    setRemaining('');
    setEndsOnShortRest('não');
    setEndsOnLongRest('sim');
    setNotes('');
  };

  const restButtons: RestType[] = ['turnStart', 'shortRest', 'longRest'];

  return (
    <Screen title="Efeitos ativos e concentração" subtitle="Controle buffs, debuffs, condições e concentração persistentes. Condições ativas entram automaticamente nos cálculos de dano e rotações.">
      <Card title="Estado atual">
        <Button label="Criar efeito a partir de magia/feature" onPress={() => router.push(`/characters/${id}/derived-effects`)} />
        <StatRow label="Concentração" value={concentrationEffect?.name ?? 'Nenhuma'} />
        <StatRow label="Condições ativas" value={activeConditions.length ? activeConditions.join(', ') : 'Nenhuma'} />
        {concentrationEffect ? <Button label="Encerrar concentração" secondary onPress={() => clearConcentration(id)} /> : null}
      </Card>

      <Card title="Avançar tempo" subtitle="Reduz duração de efeitos e expira efeitos compatíveis com descanso.">
        <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
          {restButtons.map((restType) => (
            <View key={restType} style={{ flex: 1, minWidth: 130 }}>
              <Button label={restLabel[restType]} secondary={restType !== 'turnStart'} onPress={() => advanceEffects(id, restType)} />
            </View>
          ))}
        </View>
      </Card>

      <Card title="Adicionar efeito" subtitle="Informe IDs de condições separados por vírgula. Eles devem bater com os condition.id usados nos componentes de dano importados ou manuais.">
        <Field label="Nome" value={name} onChangeText={setName} />
        <Field label="Tipo: buff | debuff | condition | spell | feature | item | manual" value={kind} onChangeText={(text) => setKind(parseKind(text))} />
        <Field label="IDs de condição ativados" value={conditionIds} onChangeText={setConditionIds} placeholder="ex.: hex, hunters-mark" />
        <Field label="Exige concentração? sim/não" value={concentration} onChangeText={setConcentration} />
        <Field label="Duração: turn | round | minute | hour | manual" value={durationUnit} onChangeText={(text) => setDurationUnit(parseDurationUnit(text))} />
        <Field label="Restante" value={remaining} onChangeText={setRemaining} keyboardType="number-pad" />
        <Field label="Expira no descanso curto? sim/não" value={endsOnShortRest} onChangeText={setEndsOnShortRest} />
        <Field label="Expira no descanso longo? sim/não" value={endsOnLongRest} onChangeText={setEndsOnLongRest} />
        <Field label="Notas" value={notes} onChangeText={setNotes} multiline />
        <Button label="Adicionar efeito ativo" onPress={createEffect} />
      </Card>

      {(character.activeEffects ?? []).length === 0 ? <Card title="Nenhum efeito ativo" subtitle="Use esta tela para Hunter's Mark, Hex, buffs de item, condições importadas, debuffs e qualquer efeito persistente da mesa." /> : null}

      {(character.activeEffects ?? []).map((effect) => (
        <Card key={effect.id} title={effect.name} subtitle={`${effect.kind} · ${effect.concentration ? 'concentração' : 'sem concentração'}`}>
          <StatRow label="Status" value={effect.status} />
          <StatRow label="Duração" value={effect.duration.unit === 'manual' ? 'manual' : `${effect.duration.remaining ?? '?'} ${durationLabel[effect.duration.unit]}`} />
          <StatRow label="Condições" value={(effect.conditionIds ?? []).length ? effect.conditionIds?.join(', ') : 'Nenhuma'} />
          {effect.notes ? <Text style={{ color: '#475569' }}>{effect.notes}</Text> : null}
          <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
            <View style={{ flex: 1, minWidth: 110 }}>
              <Button label="-1 duração" secondary disabled={effect.duration.remaining === undefined || effect.duration.remaining <= 0} onPress={() => updateActiveEffect(id, effect.id, (current) => ({ ...current, duration: { ...current.duration, remaining: Math.max(0, (current.duration.remaining ?? 0) - 1) } }))} />
            </View>
            <View style={{ flex: 1, minWidth: 110 }}>
              <Button label="+1 duração" secondary disabled={effect.duration.remaining === undefined} onPress={() => updateActiveEffect(id, effect.id, (current) => ({ ...current, duration: { ...current.duration, remaining: (current.duration.remaining ?? 0) + 1 } }))} />
            </View>
          </View>
          <Button label="Remover efeito" secondary onPress={() => removeActiveEffect(id, effect.id)} />
        </Card>
      ))}

      <Card title="Histórico recente">
        {(character.activeEffectTransactions ?? []).slice(-8).reverse().map((transaction) => (
          <View key={transaction.id} style={{ borderTopWidth: 1, borderTopColor: '#e2e8f0', paddingVertical: 6 }}>
            <Text style={{ fontWeight: '800', color: '#111827' }}>{transaction.effectName} · {transaction.action}</Text>
            <Text style={{ color: '#64748b' }}>{transaction.reason}</Text>
          </View>
        ))}
        {(character.activeEffectTransactions ?? []).length === 0 ? <Text style={{ color: '#64748b' }}>Nenhum evento de efeito registrado ainda.</Text> : null}
      </Card>

      <Button label="Voltar" secondary onPress={() => router.back()} />
    </Screen>
  );
}
