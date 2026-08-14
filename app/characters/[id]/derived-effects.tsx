import { router, useLocalSearchParams } from 'expo-router';
import { useMemo, useState } from 'react';
import { Text, View } from 'react-native';
import { Screen } from '../../../src/components/Screen';
import { Card } from '../../../src/components/Card';
import { Button } from '../../../src/components/Button';
import { Field } from '../../../src/components/Field';
import { StatRow } from '../../../src/components/StatRow';
import { IssueList } from '../../../src/components/IssueList';
import { useCharacterStore } from '../../../src/store/characterStore';
import { buildDerivedEffectOptions, createActiveEffectFromTemplate } from '../../../src/rules-engine/effects/derivedEffects';

const getId = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);

export default function DerivedEffectsScreen() {
  const id = getId(useLocalSearchParams().id);
  const character = useCharacterStore((state) => state.characters.find((item) => item.id === id));
  const addActiveEffect = useCharacterStore((state) => state.addActiveEffect);
  const [query, setQuery] = useState('');

  const options = useMemo(() => {
    if (!character) return [];
    const normalized = query.trim().toLowerCase();
    return buildDerivedEffectOptions(character).filter((option) => {
      if (!normalized) return true;
      return `${option.label} ${option.sourceLabel} ${(option.template.conditionIds ?? []).join(' ')}`.toLowerCase().includes(normalized);
    });
  }, [character, query]);

  if (!character || !id) return <Screen title="Não encontrado"><Button label="Voltar" onPress={() => router.back()} /></Screen>;

  const startEffect = (optionId: string) => {
    const option = options.find((item) => item.id === optionId);
    if (!option) return;
    addActiveEffect(id, createActiveEffectFromTemplate(option.template));
    router.replace(`/characters/${id}/effects`);
  };

  return (
    <Screen title="Criar efeito derivado" subtitle="Inicie efeitos ativos a partir de magias, features e itens já aplicados à ficha. Use o editor de mapeamento do compêndio para corrigir IDs de condição quando necessário.">
      <Card title="Busca">
        <Field label="Filtrar por nome, origem ou ID de condição" value={query} onChangeText={setQuery} placeholder="hex, hunter, concentração..." />
      </Card>

      <Card title="Resumo">
        <StatRow label="Opções encontradas" value={options.length} />
        <StatRow label="Efeitos ativos atuais" value={(character.activeEffects ?? []).filter((effect) => effect.status === 'active').length} />
      </Card>

      {options.length === 0 ? (
        <Card title="Nenhum efeito derivado disponível" subtitle="Mapeie uma magia, feature ou item com effectTemplates, effectConditionIds ou concentration; ou use a tela de efeitos ativos para adicionar manualmente." />
      ) : null}

      {options.map((option) => (
        <Card key={option.id} title={option.label} subtitle={option.sourceLabel}>
          <StatRow label="Tipo" value={option.template.kind} />
          <StatRow label="Fonte" value={option.template.sourceType} />
          <StatRow label="Concentração" value={option.template.concentration ? 'Sim' : 'Não'} />
          <StatRow label="Condições ativadas" value={(option.template.conditionIds ?? []).length ? option.template.conditionIds?.join(', ') : 'Nenhuma'} />
          <StatRow label="Duração" value={option.template.duration.unit === 'manual' ? 'manual' : `${option.template.duration.remaining ?? '?'} ${option.template.duration.unit}`} />
          {option.template.notes ? <Text style={{ color: '#475569' }}>{option.template.notes}</Text> : null}
          <IssueList issues={option.warnings} />
          <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
            <View style={{ flex: 1, minWidth: 140 }}>
              <Button label={option.alreadyActive ? 'Já ativo' : 'Iniciar efeito'} disabled={option.alreadyActive} onPress={() => startEffect(option.id)} />
            </View>
          </View>
        </Card>
      ))}

      <Button label="Voltar" secondary onPress={() => router.back()} />
    </Screen>
  );
}
