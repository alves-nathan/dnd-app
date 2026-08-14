import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { Text, View } from 'react-native';
import { Screen } from '../../../src/components/Screen';
import { Card } from '../../../src/components/Card';
import { Button } from '../../../src/components/Button';
import { Field } from '../../../src/components/Field';
import { Chip } from '../../../src/components/Chip';
import { StatRow } from '../../../src/components/StatRow';
import { IssueList } from '../../../src/components/IssueList';
import { useCharacterStore } from '../../../src/store/characterStore';
import { useCombatScenarioStore } from '../../../src/store/combatScenarioStore';
import { compareRotationsForScenario } from '../../../src/rules-engine/turns/compareRotations';
import { CombatScenario, CombatState, CoverLevel, CreatureSize, RollMode, RotationComparisonRow } from '../../../src/types';
import { defaultCombatState } from '../../../src/data/mockData';
import { formatNumber } from '../../../src/utils/format';
import { normalizeCombatScenario } from '../../../src/rules-engine/turns/tacticalCombat';

const getId = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);

const resistanceFromText = (value: string): 0 | 0.5 | 1 | 2 => {
  if (value === '0') return 0;
  if (value === '0.5') return 0.5;
  if (value === '2') return 2;
  return 1;
};

const rollModeFromText = (value: string): RollMode =>
  value === 'advantage' || value === 'disadvantage' || value === 'normal' ? value : 'normal';

const stateFromFields = (fields: {
  targetAC: string;
  targetCount: string;
  rollMode: string;
  resistance: string;
  critRange: string;
  criticalGuaranteed: boolean;
  targetDistanceFeet: string;
  targetSize: CreatureSize;
  cover: CoverLevel;
  lineOfSight: boolean;
  adjacentSecondaryTarget: boolean;
}): Partial<CombatState> => ({
  targetAC: fields.targetAC ? Number(fields.targetAC) : undefined,
  targetCount: Math.max(1, Number(fields.targetCount) || 1),
  rollMode: rollModeFromText(fields.rollMode),
  resistanceMultiplier: resistanceFromText(fields.resistance),
  critRange: Math.min(20, Math.max(1, Number(fields.critRange) || 20)),
  criticalGuaranteed: fields.criticalGuaranteed || undefined,
  targetDistanceFeet: fields.targetDistanceFeet ? Math.max(0, Number(fields.targetDistanceFeet) || 0) : undefined,
  targetSize: fields.targetSize,
  cover: fields.cover,
  lineOfSight: fields.lineOfSight,
  adjacentSecondaryTarget: fields.adjacentSecondaryTarget
});

const describeScenario = (scenario: CombatScenario): string => {
  const normalized = normalizeCombatScenario(scenario);
  const state = normalized.combatState;
  const primary = normalized.targets?.[0];
  const acValue = primary?.armorClass ?? state.targetAC;
  const ac = acValue === undefined ? 'CA não informada' : `CA ${acValue}`;
  const targets = `${state.targetCount} alvo${state.targetCount === 1 ? '' : 's'}`;
  const resistance = state.resistanceMultiplier === 0 ? 'imune' : state.resistanceMultiplier === 0.5 ? 'resistente' : state.resistanceMultiplier === 2 ? 'vulnerável' : 'normal';
  const crit = state.criticalGuaranteed ? 'crítico garantido' : `crítico ${state.critRange ?? 20}+`;
  const distance = primary ? Math.abs(primary.positionFeet - (normalized.actorPositionFeet ?? 0)) : state.targetDistanceFeet;
  const position = `${distance ?? '—'} pés · ${primary?.size ?? state.targetSize ?? 'Medium'} · cobertura ${primary?.cover ?? state.cover ?? 'none'}${(primary?.lineOfSight ?? state.lineOfSight) === false ? ' · sem visão' : ''}`;
  return `${ac} · ${targets} · ${state.rollMode} · ${resistance} · ${crit} · ${position}`;
};

const BestBadge = ({ row, scenario }: { row: RotationComparisonRow; scenario: ReturnType<typeof compareRotationsForScenario> }) => {
  const badges = [
    scenario.bestByAverageRotationId === row.rotationId ? 'maior média bruta' : undefined,
    scenario.bestByWeightedAverageRotationId === row.rotationId ? 'maior média ponderada' : undefined,
    scenario.bestByGuaranteedRotationId === row.rotationId ? 'maior dano garantido' : undefined
  ].filter(Boolean);

  if (!badges.length) return null;
  return <Text style={{ color: '#166534', fontWeight: '800' }}>Melhor em: {badges.join(', ')}</Text>;
};

export default function RotationComparisonScreen() {
  const id = getId(useLocalSearchParams().id);
  const character = useCharacterStore((state) => state.characters.find((item) => item.id === id));
  const allScenarios = useCombatScenarioStore((state) => state.scenarios);

  const scenarios = useMemo(

    () =>

      allScenarios.filter(

        (scenario) => scenario.characterId === id

      ).map(normalizeCombatScenario),

    [allScenarios, id]

  );
  const ensureDefaultScenario = useCombatScenarioStore((state) => state.ensureDefaultScenario);
  const addScenario = useCombatScenarioStore((state) => state.addScenario);
  const updateScenario = useCombatScenarioStore((state) => state.updateScenario);
  const removeScenario = useCombatScenarioStore((state) => state.removeScenario);

  const [selectedScenarioId, setSelectedScenarioId] = useState<string | undefined>();
  const [name, setName] = useState('Novo cenário');
  const [targetAC, setTargetAC] = useState('15');
  const [targetCount, setTargetCount] = useState('1');
  const [rollMode, setRollMode] = useState<RollMode>('normal');
  const [resistance, setResistance] = useState('1');
  const [critRange, setCritRange] = useState('20');
  const [criticalGuaranteed, setCriticalGuaranteed] = useState(false);
  const [targetDistanceFeet, setTargetDistanceFeet] = useState('5');
  const [targetSize, setTargetSize] = useState<CreatureSize>('Medium');
  const [cover, setCover] = useState<CoverLevel>('none');
  const [lineOfSight, setLineOfSight] = useState(true);
  const [adjacentSecondaryTarget, setAdjacentSecondaryTarget] = useState(false);
  const [notes, setNotes] = useState('');

  useEffect(() => {
    if (!id) return;
    const scenario = ensureDefaultScenario(id);
    setSelectedScenarioId((current) => current ?? scenario.id);
  }, [id, ensureDefaultScenario]);

  const selectedScenario = scenarios.find((scenario) => scenario.id === selectedScenarioId) ?? scenarios[0];
  const comparison = useMemo(() => {
    if (!character || !selectedScenario) return undefined;
    return compareRotationsForScenario(character.rotations, character, selectedScenario);
  }, [character, selectedScenario]);

  if (!character || !id) return <Screen title="Não encontrado"><Button label="Voltar" onPress={() => router.back()} /></Screen>;

  const createScenario = () => {
    const scenario = addScenario({
      characterId: id,
      name: name.trim() || 'Cenário sem nome',
      combatState: stateFromFields({ targetAC, targetCount, rollMode, resistance, critRange, criticalGuaranteed, targetDistanceFeet, targetSize, cover, lineOfSight, adjacentSecondaryTarget }),
      notes,
      favorite: true
    });
    setSelectedScenarioId(scenario.id);
  };

  const updateSelectedScenario = () => {
    if (!selectedScenario) return;
    updateScenario(selectedScenario.id, (current) => {
      const normalized = normalizeCombatScenario(current);
      const nextState = {
        ...defaultCombatState,
        ...normalized.combatState,
        ...stateFromFields({ targetAC, targetCount, rollMode, resistance, critRange, criticalGuaranteed, targetDistanceFeet, targetSize, cover, lineOfSight, adjacentSecondaryTarget })
      };
      const primaryId = normalized.targets?.[0]?.id;
      return {
        ...normalized,
        name: name.trim() || normalized.name,
        notes,
        combatState: nextState,
        targets: normalized.targets?.map((target, index) => index === 0 || target.id === primaryId ? {
          ...target,
          armorClass: nextState.targetAC,
          positionFeet: Math.max(0, (normalized.actorPositionFeet ?? 0) + (nextState.targetDistanceFeet ?? Math.abs(target.positionFeet - (normalized.actorPositionFeet ?? 0)))),
          size: nextState.targetSize ?? target.size,
          cover: nextState.cover ?? target.cover,
          lineOfSight: nextState.lineOfSight !== false
        } : target)
      };
    });
  };

  const loadScenarioIntoForm = (scenario: CombatScenario) => {
    const normalized = normalizeCombatScenario(scenario);
    const primary = normalized.targets?.[0];
    setSelectedScenarioId(normalized.id);
    setName(normalized.name);
    setTargetAC((primary?.armorClass ?? normalized.combatState.targetAC) === undefined ? '' : String(primary?.armorClass ?? normalized.combatState.targetAC));
    setTargetCount(String(normalized.combatState.targetCount));
    setRollMode(normalized.combatState.rollMode);
    setResistance(String(normalized.combatState.resistanceMultiplier));
    setCritRange(String(normalized.combatState.critRange ?? 20));
    setCriticalGuaranteed(Boolean(normalized.combatState.criticalGuaranteed));
    const distance = primary ? Math.abs(primary.positionFeet - (normalized.actorPositionFeet ?? 0)) : normalized.combatState.targetDistanceFeet;
    setTargetDistanceFeet(distance === undefined ? '' : String(distance));
    setTargetSize(primary?.size ?? normalized.combatState.targetSize ?? 'Medium');
    setCover(primary?.cover ?? normalized.combatState.cover ?? 'none');
    setLineOfSight(primary?.lineOfSight ?? normalized.combatState.lineOfSight !== false);
    setAdjacentSecondaryTarget(Boolean(normalized.combatState.adjacentSecondaryTarget));
    setNotes(normalized.notes ?? '');
  };

  return (
    <Screen title="Comparador de rotações" subtitle="Salve cenários de combate e compare rotações lado a lado por dano bruto, dano ponderado por acerto e consumo de recursos.">
      <Card title="Criar/editar cenário" subtitle="Use CA vazia para comparar dano bruto sem chance de acerto.">
        <Field label="Nome do cenário" value={name} onChangeText={setName} />
        <Field label="CA do alvo (opcional)" value={targetAC} onChangeText={setTargetAC} keyboardType="number-pad" />
        <Field label="Quantidade de alvos" value={targetCount} onChangeText={setTargetCount} keyboardType="number-pad" />
        <Field label="Distância em pés (opcional)" value={targetDistanceFeet} onChangeText={setTargetDistanceFeet} keyboardType="number-pad" />
        <Text style={{ fontWeight: '800' }}>Tamanho do alvo</Text>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
          {(['Tiny', 'Small', 'Medium', 'Large', 'Huge', 'Gargantuan'] as CreatureSize[]).map((value) => <Chip key={value} label={value} selected={targetSize === value} onPress={() => setTargetSize(value)} />)}
        </View>
        <Text style={{ fontWeight: '800' }}>Cobertura</Text>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
          {([['none', 'Nenhuma'], ['half', 'Meia'], ['threeQuarters', '3/4'], ['total', 'Total']] as Array<[CoverLevel, string]>).map(([value, label]) => <Chip key={value} label={label} selected={cover === value} onPress={() => setCover(value)} />)}
        </View>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
          <Chip label="Linha de visão" selected={lineOfSight} onPress={() => setLineOfSight((current) => !current)} />
          <Chip label="Alvo adjacente para Cleave" selected={adjacentSecondaryTarget} onPress={() => setAdjacentSecondaryTarget((current) => !current)} />
        </View>
        <Field label="Rolagem: normal | advantage | disadvantage" value={rollMode} onChangeText={(text) => setRollMode(rollModeFromText(text))} />
        <Field label="Resistência: 0, 0.5, 1 ou 2" value={resistance} onChangeText={setResistance} />
        <Field label="Crítico a partir de" value={critRange} onChangeText={setCritRange} keyboardType="number-pad" />
        <Field label="Notas" value={notes} onChangeText={setNotes} multiline />
        <Button label={criticalGuaranteed ? 'Crítico garantido: sim' : 'Crítico garantido: não'} secondary={!criticalGuaranteed} onPress={() => setCriticalGuaranteed((current) => !current)} />
        <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
          <View style={{ flex: 1, minWidth: 130 }}><Button label="Salvar novo" onPress={createScenario} /></View>
          <View style={{ flex: 1, minWidth: 130 }}><Button label="Atualizar selecionado" secondary onPress={updateSelectedScenario} disabled={!selectedScenario} /></View>
        </View>
      </Card>

      <Card title="Cenários salvos" subtitle="Toque em um cenário para usá-lo na comparação e carregar seus campos no formulário.">
        {scenarios.length === 0 ? <Text style={{ color: '#64748b' }}>Nenhum cenário salvo.</Text> : null}
        {scenarios.map((scenario) => {
          const active = scenario.id === selectedScenario?.id;
          return (
            <Card key={scenario.id} title={`${active ? '✓ ' : ''}${scenario.name}`} subtitle={describeScenario(scenario)}>
              {scenario.notes ? <Text style={{ color: '#475569' }}>{scenario.notes}</Text> : null}
              <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
                <View style={{ flex: 1, minWidth: 140 }}>
                  <Button label={active ? 'Cenário em uso' : 'Usar cenário'} variant={active ? 'tonal' : 'filled'} onPress={() => loadScenarioIntoForm(scenario)} />
                </View>
                <View style={{ flex: 1, minWidth: 140 }}>
                  <Button label="Remover cenário" variant="danger" onPress={() => removeScenario(scenario.id)} disabled={scenarios.length <= 1} />
                </View>
              </View>
            </Card>
          );
        })}
      </Card>

      {!comparison ? null : (
        <Card title={`Resultado: ${comparison.scenario.name}`} subtitle={describeScenario(comparison.scenario)}>
          {comparison.rows.length === 0 ? <Text style={{ color: '#64748b' }}>Crie rotações para comparar.</Text> : null}
          {comparison.rows
            .slice()
            .sort((left, right) => (right.weightedAverage ?? right.total.average) - (left.weightedAverage ?? left.total.average))
            .map((row) => (
              <View key={row.rotationId} style={{ borderTopWidth: 1, borderTopColor: '#e2e8f0', paddingTop: 10, gap: 4 }}>
                <Text style={{ fontWeight: '900', color: '#111827', fontSize: 16 }}>{row.rotationName}</Text>
                <BestBadge row={row} scenario={comparison} />
                <StatRow label="Ações / ataques" value={`${row.actionCount} / ${row.attackCount}`} />
                <StatRow label="Média bruta" value={row.total.average} />
                <StatRow label="Média ponderada" value={row.weightedAverage} />
                <StatRow label="Mínimo / máximo" value={`${formatNumber(row.total.min)} / ${formatNumber(row.total.max)}`} />
                <StatRow label="Dano garantido" value={row.guaranteed.average} />
                <StatRow label="Dependente de acerto" value={row.hitDependent.average} />
                <StatRow label="Condicionado" value={row.conditioned.average} />
                <StatRow label="Save/mitigação" value={row.saveDependent.average} />
                <StatRow label="Avisos / erros" value={`${row.warningCount} / ${row.errorCount}`} />
                {row.resourcesConsumed.length ? (
                  <Text style={{ color: '#475569' }}>
                    Recursos: {row.resourcesConsumed.map((resource) => `${resource.label} ×${resource.amount}`).join(', ')}
                  </Text>
                ) : (
                  <Text style={{ color: '#64748b' }}>Sem consumo de recurso limitado cadastrado.</Text>
                )}
                <IssueList issues={row.validation.issues} />
              </View>
            ))}
        </Card>
      )}

      <Card title="Leitura rápida" subtitle="A média ponderada só aparece quando existe CA do alvo e bônus de ataque calculável. Magias de save mantêm dano em bucket separado até a regra de save ser configurada.">
        <Text style={{ color: '#475569' }}>Hit/crit são calculados por ação na análise detalhada. Este comparador agrega o resultado de cada rotação no cenário selecionado.</Text>
        {selectedScenario?.combatState.targetAC === undefined ? <Text style={{ color: '#92400e' }}>Sem CA do alvo: comparação usa dano bruto, não chance de acerto.</Text> : null}
      </Card>

      <Button label="Criar nova rotação" onPress={() => router.push(`/characters/${character.id}/rotations/new`)} />
      <Button label="Análise detalhada" secondary onPress={() => router.push(`/characters/${character.id}/analysis`)} />
      <Button label="Gerar relatório" secondary onPress={() => router.push(`/characters/${character.id}/report`)} />
      <Button label="Histórico de evolução" secondary onPress={() => router.push(`/characters/${character.id}/history`)} />
    </Screen>
  );
}
