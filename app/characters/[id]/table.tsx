import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { Text, View } from 'react-native';
import { Screen } from '../../../src/components/Screen';
import { Card } from '../../../src/components/Card';
import { Button } from '../../../src/components/Button';
import { BottomNavigation } from '../../../src/components/BottomNavigation';
import { StatRow } from '../../../src/components/StatRow';
import { IssueList } from '../../../src/components/IssueList';
import { useCharacterStore } from '../../../src/store/characterStore';
import { useCombatScenarioStore } from '../../../src/store/combatScenarioStore';
import { buildTableModeSummary, tableModeRestLabel, TableModeRotationCard } from '../../../src/table/tableMode';
import { RestType } from '../../../src/types';
import { getArmorClass, getInitiative, getProficiencyBonus, getTotalLevel } from '../../../src/rules-engine/characters/derivedStats';
import { formatNumber } from '../../../src/utils/format';
import { getCharacterDisplayName } from '../../../src/ui/characterIdentity';

const getId = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);

const statusLabel = (status: TableModeRotationCard['status']): string => {
  if (status === 'ready') return 'pronta';
  if (status === 'warning') return 'com aviso';
  return 'bloqueada';
};

const statusColor = (status: TableModeRotationCard['status']): string => {
  if (status === 'ready') return '#166534';
  if (status === 'warning') return '#92400e';
  return '#991b1b';
};

const compactScenarioText = (summary: ReturnType<typeof buildTableModeSummary>): string => {
  const state = summary.scenario.combatState;
  const ac = state.targetAC === undefined ? 'sem CA' : `CA ${state.targetAC}`;
  return `${summary.scenario.name} · ${ac} · ${state.targetCount} alvo(s) · ${state.rollMode} · resistência ${state.resistanceMultiplier}`;
};

export default function TableModeScreen() {
  const id = getId(useLocalSearchParams().id);
  const character = useCharacterStore((state) => state.characters.find((item) => item.id === id));
  const updateCharacter = useCharacterStore((state) => state.updateCharacter);
  const spendRotationResources = useCharacterStore((state) => state.spendRotationResources);
  const applyRest = useCharacterStore((state) => state.applyRest);
  const removeActiveEffect = useCharacterStore((state) => state.removeActiveEffect);
  const clearConcentration = useCharacterStore((state) => state.clearConcentration);
  const allScenarios = useCombatScenarioStore((state) => state.scenarios);
  const scenarios = useMemo(
    () =>
      allScenarios.filter(
        (scenario) => scenario.characterId === id
      ),
    [allScenarios, id]
  );
  const ensureDefaultScenario = useCombatScenarioStore((state) => state.ensureDefaultScenario);
  const [selectedScenarioId, setSelectedScenarioId] = useState<string | undefined>();
  const [showAllRotations, setShowAllRotations] = useState(false);
  const [lastAction, setLastAction] = useState('');

  useEffect(() => {
    if (!id) return;
    const scenario = ensureDefaultScenario(id);
    setSelectedScenarioId((current) => current ?? scenario.id);
  }, [id, ensureDefaultScenario]);

  const selectedScenario = scenarios.find((scenario) => scenario.id === selectedScenarioId) ?? scenarios[0];
  const summary = useMemo(() => (character ? buildTableModeSummary(character, selectedScenario) : undefined), [character, selectedScenario]);

  if (!character || !id || !summary) {
    return <Screen title="Mesa rápida"><Button label="Voltar" onPress={() => router.back()} /></Screen>;
  }

  const visibleRotations = showAllRotations ? summary.rotationCards : (summary.favoriteCards.length ? summary.favoriteCards : summary.rotationCards.slice(0, 3));

  const executeRotation = (card: TableModeRotationCard) => {
    if (!card.canExecute) return;
    spendRotationResources(character.id, card.rotationId);
    setLastAction(`Gasto registrado: ${card.name}`);
  };

  const runRest = (restType: RestType) => {
    applyRest(character.id, restType);
    setLastAction(`${tableModeRestLabel(restType)} aplicado.`);
  };

  const toggleFavorite = (card: TableModeRotationCard) => {
    updateCharacter(character.id, (current) => ({
      ...current,
      rotations: current.rotations.map((rotation) =>
        rotation.id === card.rotationId ? { ...rotation, favorite: !rotation.favorite } : rotation
      )
    }));
  };

  return (
    <Screen
      eyebrow={getCharacterDisplayName(character)}
      title="Modo mesa"
      subtitle="Ações favoritas, recursos e efeitos com poucos toques durante a sessão."
      onBack={() => router.push(`/characters/${character.id}`)}
      footer={(
        <BottomNavigation
          activeKey="table"
          items={[
            { key: 'sheet', label: 'Ficha', icon: 'person', onPress: () => router.push(`/characters/${character.id}`) },
            { key: 'table', label: 'Mesa', icon: 'dice', onPress: () => undefined },
            { key: 'damage', label: 'Dano', icon: 'analytics', onPress: () => router.push(`/characters/${character.id}/analysis`) }
          ]}
        />
      )}
    >
      <Card title={getCharacterDisplayName(character)} subtitle={compactScenarioText(summary)}>
        <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
          <View style={{ flex: 1, minWidth: 110 }}><StatRow label="Nível" value={getTotalLevel(character)} /></View>
          <View style={{ flex: 1, minWidth: 110 }}><StatRow label="PB" value={`+${getProficiencyBonus(character)}`} /></View>
          <View style={{ flex: 1, minWidth: 110 }}><StatRow label="CA" value={getArmorClass(character)} /></View>
          <View style={{ flex: 1, minWidth: 110 }}><StatRow label="Iniciativa" value={getInitiative(character)} /></View>
        </View>
        {lastAction ? <Text style={{ color: '#166534', fontWeight: '800' }}>{lastAction}</Text> : null}
      </Card>

      <Card title="Atalhos de turno" subtitle="Use no início do turno ou quando o grupo fizer descanso.">
        <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
          <View style={{ flex: 1, minWidth: 120 }}><Button label="Início do turno" onPress={() => runRest('turnStart')} /></View>
          <View style={{ flex: 1, minWidth: 120 }}><Button label="Descanso curto" secondary onPress={() => runRest('shortRest')} /></View>
          <View style={{ flex: 1, minWidth: 120 }}><Button label="Descanso longo" secondary onPress={() => runRest('longRest')} /></View>
        </View>
      </Card>

      <IssueList issues={summary.quickWarnings} />

      <Card title="Rotações favoritas" subtitle="Registrar gasto consome recursos e spell slots cadastrados para aquela rotação.">
        {visibleRotations.length === 0 ? <Text style={{ color: '#64748b' }}>Nenhuma rotação criada.</Text> : null}
        {visibleRotations.map((card) => (
          <Card key={card.rotationId} title={card.name} subtitle={`${card.actionCount} ação(ões) · ${card.attackCount} ataque(s) · ${statusLabel(card.status)}`}>
            <Text style={{ fontSize: 34, fontWeight: '900', color: statusColor(card.status) }}>
              {formatNumber(card.weightedAverage ?? card.average)}
            </Text>
            <Text style={{ color: '#64748b' }}>{card.weightedAverage === undefined ? 'média bruta' : 'média ponderada'}</Text>
            <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
              <View style={{ flex: 1, minWidth: 95 }}><StatRow label="Min" value={card.min} /></View>
              <View style={{ flex: 1, minWidth: 95 }}><StatRow label="Max" value={card.max} /></View>
              <View style={{ flex: 1, minWidth: 95 }}><StatRow label="Garantido" value={card.guaranteedAverage} /></View>
            </View>
            <Text style={{ color: '#475569' }}>Recursos: {card.resourceText}</Text>
            <Text style={{ color: '#475569' }}>Slots: {card.spellSlotText}</Text>
            <IssueList issues={card.issues.slice(0, 4)} />
            <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
              <View style={{ flex: 1, minWidth: 130 }}>
                <Button label="Registrar gasto" onPress={() => executeRotation(card)} disabled={!card.canExecute} />
              </View>
              <View style={{ flex: 1, minWidth: 130 }}>
                <Button label="Ver análise" secondary onPress={() => router.push(`/characters/${character.id}/analysis`)} />
              </View>
            </View>
            <Button label={card.favorite ? 'Remover dos favoritos' : 'Favoritar'} secondary onPress={() => toggleFavorite(card)} />
          </Card>
        ))}
        <Button label={showAllRotations ? 'Mostrar só favoritas' : 'Mostrar todas as rotações'} secondary onPress={() => setShowAllRotations((current) => !current)} />
        <Button label="Criar nova rotação" secondary onPress={() => router.push(`/characters/${character.id}/rotations/new`)} />
      </Card>

      <Card title="Recursos e slots" subtitle="Estado atual usado pela validação das rotações.">
        {summary.resources.length === 0 ? <Text style={{ color: '#64748b' }}>Nenhum recurso ou spell slot cadastrado.</Text> : null}
        {summary.resources.map((resource) => (
          <View key={resource.id} style={{ borderTopWidth: 1, borderTopColor: '#e2e8f0', paddingTop: 8 }}>
            <StatRow label={resource.label} value={`${resource.current} / ${resource.max}`} />
            <Text style={{ color: resource.status === 'empty' || resource.status === 'low' ? '#92400e' : '#475569' }}>
              {resource.status} · {resource.subtitle}
            </Text>
          </View>
        ))}
        <Button label="Gerenciar recursos" secondary onPress={() => router.push(`/characters/${character.id}/resources`)} />
      </Card>

      <Card title="Efeitos ativos" subtitle="Condições e concentração entram automaticamente na engine.">
        <StatRow label="Concentração" value={summary.concentrationName ?? 'Nenhuma'} />
        {summary.activeEffects.length === 0 ? <Text style={{ color: '#64748b' }}>Nenhum efeito ativo.</Text> : null}
        {summary.activeEffects.map((effect) => (
          <View key={effect.id} style={{ borderTopWidth: 1, borderTopColor: '#e2e8f0', paddingTop: 8, gap: 4 }}>
            <Text style={{ fontWeight: '900', color: '#111827' }}>{effect.concentration ? '◎ ' : ''}{effect.name}</Text>
            <Text style={{ color: effect.urgency === 'soon' ? '#92400e' : '#475569' }}>{effect.durationText} · {effect.conditionText}</Text>
            <Button label="Encerrar efeito" secondary onPress={() => removeActiveEffect(character.id, effect.id, 'Encerrado pelo modo mesa')} />
          </View>
        ))}
        <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
          <View style={{ flex: 1, minWidth: 130 }}><Button label="Efeitos" secondary onPress={() => router.push(`/characters/${character.id}/effects`)} /></View>
          <View style={{ flex: 1, minWidth: 130 }}><Button label="Efeitos derivados" secondary onPress={() => router.push(`/characters/${character.id}/derived-effects`)} /></View>
        </View>
        <Button label="Encerrar concentração" secondary onPress={() => clearConcentration(character.id, 'Concentração encerrada pelo modo mesa')} disabled={!summary.concentrationName} />
      </Card>

      <Card title="Sugestões rápidas">
        {summary.suggestedNextSteps.map((step) => <Text key={step} style={{ color: '#475569' }}>• {step}</Text>)}
      </Card>

      {scenarios.length > 1 ? (
        <Card title="Cenário usado no modo mesa" subtitle="A média grande usa o cenário selecionado quando houver CA configurada.">
          {scenarios.map((scenario) => (
            <Button
              key={scenario.id}
              label={`${scenario.id === selectedScenario?.id ? '✓ ' : ''}${scenario.name}`}
              secondary={scenario.id !== selectedScenario?.id}
              onPress={() => setSelectedScenarioId(scenario.id)}
            />
          ))}
          <Button label="Editar cenários" secondary onPress={() => router.push(`/characters/${character.id}/comparison`)} />
        </Card>
      ) : (
        <Button label="Criar/editar cenários" secondary onPress={() => router.push(`/characters/${character.id}/comparison`)} />
      )}

    </Screen>
  );
}
