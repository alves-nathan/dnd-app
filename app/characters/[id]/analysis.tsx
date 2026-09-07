import { router, useLocalSearchParams } from 'expo-router';
import { useMemo, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { BottomNavigation } from '../../../src/components/BottomNavigation';
import { Button } from '../../../src/components/Button';
import { Card } from '../../../src/components/Card';
import { Chip } from '../../../src/components/Chip';
import { Field } from '../../../src/components/Field';
import { IssueList } from '../../../src/components/IssueList';
import { MetricTile } from '../../../src/components/MetricTile';
import { Screen } from '../../../src/components/Screen';
import { defaultCombatState } from '../../../src/data/mockData';
import { activeEffectConditionIds, getActiveConcentrationEffect } from '../../../src/rules-engine/effects/activeEffects';
import { spellSlotLabel } from '../../../src/rules-engine/resources/spellSlotManager';
import { analyzeTurnRotation } from '../../../src/rules-engine/turns/analyzeTurn';
import { useCharacterStore } from '../../../src/store/characterStore';
import { useAppTheme } from '../../../src/theme';
import { CombatState, CoverLevel, CreatureSize, RollMode } from '../../../src/types';
import { formatNumber, formatPercent } from '../../../src/utils/format';
import { getCharacterDisplayName } from '../../../src/ui/characterIdentity';

const getId = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);
type ResistanceChoice = 'immune' | 'resistant' | 'normal' | 'vulnerable';
const resistanceMultiplier: Record<ResistanceChoice, 0 | 0.5 | 1 | 2> = { immune: 0, resistant: 0.5, normal: 1, vulnerable: 2 };

export default function AnalysisScreen() {
  const { colors } = useAppTheme();
  const id = getId(useLocalSearchParams().id);
  const character = useCharacterStore((state) => state.characters.find((item) => item.id === id));
  const spendRotationResources = useCharacterStore((state) => state.spendRotationResources);
  const [targetAC, setTargetAC] = useState('');
  const [targetCount, setTargetCount] = useState('1');
  const [targetDistanceFeet, setTargetDistanceFeet] = useState('5');
  const [targetSize, setTargetSize] = useState<CreatureSize>('Medium');
  const [cover, setCover] = useState<CoverLevel>('none');
  const [lineOfSight, setLineOfSight] = useState(true);
  const [adjacentSecondaryTarget, setAdjacentSecondaryTarget] = useState(false);
  const [rollMode, setRollMode] = useState<RollMode>('normal');
  const [resistance, setResistance] = useState<ResistanceChoice>('normal');
  const [expandedRotationId, setExpandedRotationId] = useState<string>();
  const concentrationEffect = character ? getActiveConcentrationEffect(character) : undefined;
  const activeConditions = character ? activeEffectConditionIds(character) : [];

  const combatState: CombatState = useMemo(() => ({
    ...defaultCombatState,
    targetAC: targetAC ? Number(targetAC) : undefined,
    targetCount: Math.max(1, Number(targetCount) || 1),
    targetDistanceFeet: targetDistanceFeet ? Math.max(0, Number(targetDistanceFeet) || 0) : undefined,
    targetSize,
    cover,
    lineOfSight,
    adjacentSecondaryTarget,
    rollMode,
    resistanceMultiplier: resistanceMultiplier[resistance],
    activeConditionIds: activeConditions,
    concentratingOn: concentrationEffect?.name
  }), [activeConditions, adjacentSecondaryTarget, concentrationEffect?.name, cover, lineOfSight, resistance, rollMode, targetAC, targetCount, targetDistanceFeet, targetSize]);

  if (!character || !id) return <Screen title="Personagem não encontrado" onBack={() => router.back()} />;

  const footer = (
    <BottomNavigation
      activeKey="damage"
      items={[
        { key: 'sheet', label: 'Ficha', icon: 'person', onPress: () => router.push(`/characters/${character.id}`) },
        { key: 'table', label: 'Mesa', icon: 'dice', onPress: () => router.push(`/characters/${character.id}/table`) },
        { key: 'damage', label: 'Dano', icon: 'analytics', onPress: () => undefined }
      ]}
    />
  );

  return (
    <Screen
      eyebrow={getCharacterDisplayName(character)}
      title="Dano por turno"
      subtitle="Ajuste o alvo e compare cada rotação com mínimo, máximo, média e chance de acerto."
      onBack={() => router.push(`/characters/${character.id}`)}
      footer={footer}
    >
      <Card variant="hero" title="Cenário do alvo" subtitle="A média ponderada aparece quando uma CA é informada.">
        <View style={styles.fieldRow}>
          <View style={styles.field}><Field label="CA do alvo" value={targetAC} onChangeText={setTargetAC} keyboardType="number-pad" placeholder="Opcional" /></View>
          <View style={styles.field}><Field label="Quantidade de alvos" value={targetCount} onChangeText={setTargetCount} keyboardType="number-pad" /></View>
          <View style={styles.field}><Field label="Distância em pés" value={targetDistanceFeet} onChangeText={setTargetDistanceFeet} keyboardType="number-pad" placeholder="Opcional" /></View>
        </View>
        <Text style={[styles.controlLabel, { color: colors.onPrimaryContainer }]}>Tamanho do alvo</Text>
        <View style={styles.chips}>
          {(['Tiny', 'Small', 'Medium', 'Large', 'Huge', 'Gargantuan'] as CreatureSize[]).map((value) => <Chip key={value} label={value} selected={targetSize === value} onPress={() => setTargetSize(value)} />)}
        </View>
        <Text style={[styles.controlLabel, { color: colors.onPrimaryContainer }]}>Cobertura e posição</Text>
        <View style={styles.chips}>
          {([['none', 'Nenhuma'], ['half', 'Meia'], ['threeQuarters', '3/4'], ['total', 'Total']] as Array<[CoverLevel, string]>).map(([value, label]) => <Chip key={value} label={label} selected={cover === value} onPress={() => setCover(value)} />)}
          <Chip label="Linha de visão" selected={lineOfSight} onPress={() => setLineOfSight((current) => !current)} />
          <Chip label="Alvo adjacente para Cleave" selected={adjacentSecondaryTarget} onPress={() => setAdjacentSecondaryTarget((current) => !current)} />
        </View>
        <Text style={[styles.controlLabel, { color: colors.onPrimaryContainer }]}>Rolagem de ataque</Text>
        <View style={styles.chips}>
          <Chip label="Normal" selected={rollMode === 'normal'} onPress={() => setRollMode('normal')} />
          <Chip label="Vantagem" selected={rollMode === 'advantage'} onPress={() => setRollMode('advantage')} />
          <Chip label="Desvantagem" selected={rollMode === 'disadvantage'} onPress={() => setRollMode('disadvantage')} />
        </View>
        <Text style={[styles.controlLabel, { color: colors.onPrimaryContainer }]}>Resposta ao dano</Text>
        <View style={styles.chips}>
          <Chip label="Normal" selected={resistance === 'normal'} onPress={() => setResistance('normal')} />
          <Chip label="Resistente" selected={resistance === 'resistant'} onPress={() => setResistance('resistant')} />
          <Chip label="Imune" selected={resistance === 'immune'} onPress={() => setResistance('immune')} />
          <Chip label="Vulnerável" selected={resistance === 'vulnerable'} onPress={() => setResistance('vulnerable')} />
        </View>
      </Card>

      {activeConditions.length || concentrationEffect ? (
        <Card variant="filled" title="Efeitos aplicados automaticamente" subtitle={`${concentrationEffect ? `Concentração: ${concentrationEffect.name}` : 'Sem concentração'} · ${activeConditions.length} condição(ões)`}>
          <Button label="Gerenciar efeitos" icon="sparkles-outline" variant="text" onPress={() => router.push(`/characters/${character.id}/effects`)} />
        </Card>
      ) : null}

      {character.rotations.length === 0 ? (
        <Card variant="filled" title="Nenhuma rotação criada" subtitle="Uma rotação representa o conjunto de ações executado em um turno.">
          <Button label="Criar primeira rotação" icon="add" onPress={() => router.push(`/characters/${character.id}/rotations/new`)} />
        </Card>
      ) : null}

      {character.rotations.map((rotation) => {
        const result = analyzeTurnRotation(rotation, character, combatState);
        const primaryAverage = result.weightedAverage ?? result.total.average;
        const expanded = expandedRotationId === rotation.id;
        const issues = [...result.validation.issues, ...result.resourceAvailability.issues, ...result.spellSlotAvailability.issues, ...(result.ammunitionAvailability?.issues ?? [])];
        return (
          <Card key={rotation.id} variant={rotation.favorite ? 'elevated' : 'outlined'} title={`${rotation.favorite ? '★ ' : ''}${result.rotationName}`} subtitle={`${result.actions.length} ações · ${result.attackCount} ataques/efeitos`}>
            <View style={styles.damageHeader}>
              <View style={styles.damageText}>
                <Text style={[styles.damageValue, { color: issues.some((issue) => issue.severity === 'error') ? colors.error : colors.primary }]}>{formatNumber(primaryAverage)}</Text>
                <Text style={[styles.damageLabel, { color: colors.onSurfaceVariant }]}>{result.weightedAverage === undefined ? 'média bruta por turno' : 'média ponderada por acerto'}</Text>
              </View>
              <View style={[styles.status, { backgroundColor: result.resourceAvailability.ok && result.spellSlotAvailability.ok && (result.ammunitionAvailability?.ok ?? true) ? colors.successContainer : colors.warningContainer }]}>
                <Text style={{ color: result.resourceAvailability.ok && result.spellSlotAvailability.ok && (result.ammunitionAvailability?.ok ?? true) ? colors.success : colors.warning, fontWeight: '900', fontSize: 12 }}>{result.resourceAvailability.ok && result.spellSlotAvailability.ok && (result.ammunitionAvailability?.ok ?? true) ? 'PRONTA' : 'REVISAR'}</Text>
              </View>
            </View>
            <View style={styles.metrics}>
              <MetricTile label="Mínimo" value={formatNumber(result.total.min)} />
              <MetricTile label="Máximo" value={formatNumber(result.total.max)} />
              <MetricTile label="Ataques" value={result.attackCount} />
            </View>
            {rotation.activations?.length ? <Text style={[styles.detail, { color: colors.primary }]}>Ativações: {rotation.activations.map((activation) => activation.name).join(', ')}</Text> : null}
            {issues.length ? <IssueList issues={issues.slice(0, expanded ? undefined : 2)} /> : null}
            <Button label={expanded ? 'Ocultar detalhamento' : 'Ver dano por ação'} icon={expanded ? 'chevron-up' : 'chevron-down'} variant="outlined" onPress={() => setExpandedRotationId(expanded ? undefined : rotation.id)} />
            {expanded ? result.actions.map((action) => (
              <Card key={action.id} variant="filled" title={action.name} subtitle={action.formula}>
                <View style={styles.metrics}>
                  <MetricTile label="Média" value={formatNumber(action.total.average)} />
                  <MetricTile label="Por acerto" value={formatNumber(action.hitDependent.average)} />
                  <MetricTile label="Garantido" value={formatNumber(action.guaranteed.average)} />
                </View>
                {action.hitChance ? <Text style={[styles.detail, { color: colors.onSurfaceVariant }]}>Acerto {formatPercent(action.hitChance.hitChance)} · crítico {formatPercent(action.hitChance.critChance)}</Text> : null}
                {action.conditioned.average ? <Text style={[styles.detail, { color: colors.onSurfaceVariant }]}>Dano condicionado: {formatNumber(action.conditioned.average)}</Text> : null}
                {action.saveDependent.average ? <Text style={[styles.detail, { color: colors.onSurfaceVariant }]}>Dano dependente de salvaguarda: {formatNumber(action.saveDependent.average)}</Text> : null}
                {action.spellSlotsConsumed.length ? <Text style={[styles.detail, { color: colors.onSurfaceVariant }]}>Slots: {action.spellSlotsConsumed.map((slot) => `${slot.amount}× ${spellSlotLabel(slot.slotLevel)}`).join(', ')}</Text> : null}
                {action.ammunitionConsumed?.length ? <Text style={[styles.detail, { color: colors.onSurfaceVariant }]}>Munição: {action.ammunitionConsumed.map((cost) => `${cost.amount}× ${cost.label}`).join(', ')}</Text> : null}
                {action.masteryEffects?.map((effect) => <Text key={`${action.id}-${effect}`} style={[styles.detail, { color: colors.primary }]}>• {effect}</Text>)}
                <IssueList issues={action.warnings} />
              </Card>
            )) : null}
            {result.resourcesConsumed.length || result.spellSlotsConsumed.length || (result.ammunitionAvailability?.costs.length ?? 0) ? (
              <Button
                label="Registrar gasto desta rotação"
                icon="remove-circle-outline"
                variant="tonal"
                onPress={() => spendRotationResources(character.id, rotation.id)}
                disabled={!result.resourceAvailability.ok || !result.spellSlotAvailability.ok || !(result.ammunitionAvailability?.ok ?? true)}
              />
            ) : null}
          </Card>
        );
      })}

      <Button label="Nova rotação" icon="add" onPress={() => router.push(`/characters/${character.id}/rotations/new`)} />
      <Button label="Comparar cenários e rotações" icon="git-compare-outline" variant="outlined" onPress={() => router.push(`/characters/${character.id}/comparison`)} />
      <Button label="Relatórios e exportação" icon="document-text-outline" variant="text" onPress={() => router.push(`/characters/${character.id}/report`)} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  fieldRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  field: { flex: 1, minWidth: 140 },
  controlLabel: { fontSize: 12, lineHeight: 17, fontWeight: '900', marginTop: 4 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  damageHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 },
  damageText: { flex: 1 },
  damageValue: { fontSize: 44, lineHeight: 49, fontWeight: '900', letterSpacing: -1.2 },
  damageLabel: { fontSize: 12, lineHeight: 17, fontWeight: '700' },
  status: { borderRadius: 999, paddingHorizontal: 12, paddingVertical: 7 },
  metrics: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  detail: { fontSize: 13, lineHeight: 19 }
});
