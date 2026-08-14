import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { Share, Text, View } from 'react-native';
import { Screen } from '../../../src/components/Screen';
import { Card } from '../../../src/components/Card';
import { Button } from '../../../src/components/Button';
import { Field } from '../../../src/components/Field';
import { StatRow } from '../../../src/components/StatRow';
import { useCharacterStore } from '../../../src/store/characterStore';
import { useCombatScenarioStore } from '../../../src/store/combatScenarioStore';
import { useBuildHistoryStore } from '../../../src/store/buildHistoryStore';
import { compareRotationsForScenario } from '../../../src/rules-engine/turns/compareRotations';
import {
  buildHistoryDiffMarkdown,
  buildHistorySnapshotMarkdown,
  compareBuildHistorySnapshots,
  createBuildHistorySnapshot
} from '../../../src/history/buildHistory';
import { BuildHistorySnapshot, BuildSnapshotKind, CombatScenario } from '../../../src/types';
import { describeCombatScenario } from '../../../src/reports/rotationReport';
import { formatNumber } from '../../../src/utils/format';
import { getCharacterDisplayName } from '../../../src/ui/characterIdentity';

const getId = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);

const snapshotKindLabels: Array<{ value: BuildSnapshotKind; label: string }> = [
  { value: 'manual', label: 'Manual' },
  { value: 'levelUp', label: 'Level up' },
  { value: 'feat', label: 'Feat' },
  { value: 'item', label: 'Item' },
  { value: 'spell', label: 'Magia' },
  { value: 'ruleRevision', label: 'Regra revisada' },
  { value: 'scenario', label: 'Cenário' },
  { value: 'rotation', label: 'Rotação' },
  { value: 'import', label: 'Importação' },
  { value: 'other', label: 'Outro' }
];

const snapshotSubtitle = (snapshot: BuildHistorySnapshot): string => {
  const best = snapshot.rows.find((row) => row.rotationId === snapshot.winners.bestByWeightedAverageRotationId)
    ?? snapshot.rows.find((row) => row.rotationId === snapshot.winners.bestByAverageRotationId);
  const bestText = best ? `${best.rotationName}: ${formatNumber(best.weightedAverage ?? best.total.average)}` : 'sem rotações';
  return `${snapshot.createdAt.slice(0, 16).replace('T', ' ')} · ${getCharacterDisplayName(snapshot.character)} nível ${snapshot.character.level} · melhor ${bestText}`;
};

const scenarioLabel = (scenario: CombatScenario): string => `${scenario.name} · ${describeCombatScenario(scenario)}`;

export default function BuildHistoryScreen() {
  const id = getId(useLocalSearchParams().id);
  const character = useCharacterStore((state) => state.characters.find((item) => item.id === id));
  const allScenarios = useCombatScenarioStore((state) => state.scenarios);

  const scenarios = useMemo(

    () =>

      allScenarios.filter(

        (scenario) => scenario.characterId === id

      ),

    [allScenarios, id]

  );
  const ensureDefaultScenario = useCombatScenarioStore((state) => state.ensureDefaultScenario);
  const allSnapshots = useBuildHistoryStore((state) => state.snapshots);

  const snapshots = useMemo(

    () =>

      allSnapshots.filter(

        (snapshot) => snapshot.characterId === id

      ),

    [allSnapshots, id]

  );
  const addSnapshot = useBuildHistoryStore((state) => state.addSnapshot);
  const removeSnapshot = useBuildHistoryStore((state) => state.removeSnapshot);

  const [selectedScenarioId, setSelectedScenarioId] = useState<string | undefined>();
  const [snapshotName, setSnapshotName] = useState('');
  const [snapshotKind, setSnapshotKind] = useState<BuildSnapshotKind>('manual');
  const [snapshotNotes, setSnapshotNotes] = useState('');
  const [beforeId, setBeforeId] = useState<string | undefined>();
  const [afterId, setAfterId] = useState<string | undefined>();

  useEffect(() => {
    if (!id) return;
    const scenario = ensureDefaultScenario(id);
    setSelectedScenarioId((current) => current ?? scenario.id);
  }, [id, ensureDefaultScenario]);

  useEffect(() => {
    if (!snapshots.length) return;
    setAfterId((current) => current ?? snapshots[0]?.id);
    setBeforeId((current) => current ?? snapshots[1]?.id ?? snapshots[0]?.id);
  }, [snapshots]);

  const selectedScenario = scenarios.find((scenario) => scenario.id === selectedScenarioId) ?? scenarios[0];
  const comparison = useMemo(() => {
    if (!character || !selectedScenario) return undefined;
    return compareRotationsForScenario(character.rotations, character, selectedScenario);
  }, [character, selectedScenario]);

  const currentDraft = useMemo(() => {
    if (!character || !selectedScenario || !comparison) return undefined;
    return createBuildHistorySnapshot({
      character,
      scenario: selectedScenario,
      comparison,
      name: snapshotName || `Snapshot ${new Date().toISOString().slice(0, 10)}`,
      kind: snapshotKind,
      notes: snapshotNotes
    });
  }, [character, comparison, selectedScenario, snapshotKind, snapshotName, snapshotNotes]);

  const before = snapshots.find((snapshot) => snapshot.id === beforeId);
  const after = snapshots.find((snapshot) => snapshot.id === afterId);
  const diff = before && after ? compareBuildHistorySnapshots(before, after) : undefined;

  if (!character || !id) return <Screen title="Não encontrado"><Button label="Voltar" onPress={() => router.back()} /></Screen>;

  const saveSnapshot = () => {
    if (!currentDraft) return;
    addSnapshot(currentDraft);
    setSnapshotName('');
    setSnapshotNotes('');
    setAfterId(currentDraft.id);
    setBeforeId((current) => current ?? snapshots[0]?.id ?? currentDraft.id);
  };

  const shareCurrent = async () => {
    if (!currentDraft) return;
    await Share.share({ title: currentDraft.name, message: buildHistorySnapshotMarkdown(currentDraft) });
  };

  const shareDiff = async () => {
    if (!before || !after) return;
    await Share.share({ title: `Diff ${before.name} -> ${after.name}`, message: buildHistoryDiffMarkdown(before, after) });
  };

  return (
    <Screen title="Histórico de evolução" subtitle="Salve snapshots de comparação e veja como dano, recursos e alertas mudam após level up, feat, item, rotação ou revisão de regra.">
      <Card title="Novo snapshot" subtitle="O snapshot usa todas as rotações atuais contra o cenário selecionado.">
        <Field label="Nome do snapshot" value={snapshotName} onChangeText={setSnapshotName} placeholder="Ex.: Level 5 com novo feat" />
        <Field label="Notas" value={snapshotNotes} onChangeText={setSnapshotNotes} multiline placeholder="O que mudou nesta build?" />
        <Text style={{ color: '#475569', fontWeight: '700' }}>Tipo da mudança</Text>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
          {snapshotKindLabels.map((kind) => (
            <View key={kind.value} style={{ minWidth: 110, flexGrow: 1 }}>
              <Button label={kind.label} secondary={snapshotKind !== kind.value} onPress={() => setSnapshotKind(kind.value)} />
            </View>
          ))}
        </View>
      </Card>

      <Card title="Cenário do snapshot" subtitle="Use cenários diferentes para separar testes de CA, vantagem, resistência e múltiplos alvos.">
        {scenarios.map((scenario) => {
          const active = scenario.id === selectedScenario?.id;
          return (
            <Card key={scenario.id} title={`${active ? '✓ ' : ''}${scenario.name}`} subtitle={scenarioLabel(scenario)} onPress={() => setSelectedScenarioId(scenario.id)} />
          );
        })}
        {scenarios.length === 0 ? <Text style={{ color: '#64748b' }}>Nenhum cenário salvo. O cenário padrão será criado automaticamente.</Text> : null}
      </Card>

      {currentDraft ? (
        <Card title="Preview do snapshot atual" subtitle={snapshotSubtitle(currentDraft)}>
          <StatRow label="Rotações analisadas" value={currentDraft.rows.length} />
          <StatRow label="Avisos / erros" value={`${currentDraft.issueCount.warnings} / ${currentDraft.issueCount.errors}`} />
          <StatRow label="Armas / magias / features" value={`${currentDraft.character.weaponCount} / ${currentDraft.character.spellCount} / ${currentDraft.character.featureCount}`} />
          <Button label="Salvar snapshot" onPress={saveSnapshot} disabled={!comparison || comparison.rows.length === 0} />
          <Button label="Compartilhar preview" secondary onPress={shareCurrent} disabled={!comparison || comparison.rows.length === 0} />
        </Card>
      ) : null}

      <Card title="Snapshots salvos" subtitle="Use os botões de cada snapshot para definir os estados antes e depois.">
        {snapshots.length === 0 ? <Text style={{ color: '#64748b' }}>Nenhum snapshot salvo para este personagem.</Text> : null}
        {snapshots.map((snapshot) => {
          const selectedAsBefore = snapshot.id === beforeId;
          const selectedAsAfter = snapshot.id === afterId;
          return (
            <Card
              key={snapshot.id}
              title={`${selectedAsAfter ? 'Depois · ' : selectedAsBefore ? 'Antes · ' : ''}${snapshot.name}`}
              subtitle={snapshotSubtitle(snapshot)}
            >
              <Text style={{ color: '#475569' }}>Tipo: {snapshot.kind} · Cenário: {snapshot.scenario.name}</Text>
              {snapshot.notes ? <Text style={{ color: '#475569' }}>{snapshot.notes}</Text> : null}
              <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
                <View style={{ flex: 1, minWidth: 120 }}><Button label="Marcar como antes" secondary={!selectedAsBefore} onPress={() => setBeforeId(snapshot.id)} /></View>
                <View style={{ flex: 1, minWidth: 120 }}><Button label="Marcar como depois" secondary={!selectedAsAfter} onPress={() => setAfterId(snapshot.id)} /></View>
              </View>
              <Button label="Remover snapshot" secondary onPress={() => removeSnapshot(snapshot.id)} />
            </Card>
          );
        })}
      </Card>

      {diff ? (
        <Card title="Diferença entre snapshots" subtitle={`${diff.beforeName} → ${diff.afterName}`}>
          <StatRow label="Nível" value={`${before?.character.level} → ${after?.character.level} (${diff.levelDelta >= 0 ? '+' : ''}${diff.levelDelta})`} />
          <StatRow label="Avisos" value={`${before?.issueCount.warnings} → ${after?.issueCount.warnings} (${diff.warningDelta >= 0 ? '+' : ''}${diff.warningDelta})`} />
          <StatRow label="Erros" value={`${before?.issueCount.errors} → ${after?.issueCount.errors} (${diff.errorDelta >= 0 ? '+' : ''}${diff.errorDelta})`} />
          <StatRow label="Vencedores alterados" value={diff.changedWinners.length ? diff.changedWinners.join(', ') : 'Nenhum'} />
          {diff.addedRotations.length ? <Text style={{ color: '#166534' }}>Rotações adicionadas: {diff.addedRotations.join(', ')}</Text> : null}
          {diff.removedRotations.length ? <Text style={{ color: '#92400e' }}>Rotações removidas: {diff.removedRotations.join(', ')}</Text> : null}
          {diff.rotationDeltas.map((delta) => (
            <View key={`${delta.rotationId ?? delta.rotationName}-${delta.status}`} style={{ borderTopWidth: 1, borderTopColor: '#e2e8f0', paddingTop: 8, gap: 4 }}>
              <Text style={{ color: '#111827', fontWeight: '900' }}>{delta.rotationName} · {delta.status}</Text>
              <StatRow label="Média" value={`${delta.average.before ?? '-'} → ${delta.average.after ?? '-'} (${delta.average.delta && delta.average.delta > 0 ? '+' : ''}${formatNumber(delta.average.delta ?? 0)})`} />
              <StatRow label="Média ponderada" value={`${delta.weightedAverage.before ?? '-'} → ${delta.weightedAverage.after ?? '-'} (${delta.weightedAverage.delta && delta.weightedAverage.delta > 0 ? '+' : ''}${formatNumber(delta.weightedAverage.delta ?? 0)})`} />
              <StatRow label="Dano garantido" value={`${delta.guaranteedAverage.before ?? '-'} → ${delta.guaranteedAverage.after ?? '-'} (${delta.guaranteedAverage.delta && delta.guaranteedAverage.delta > 0 ? '+' : ''}${formatNumber(delta.guaranteedAverage.delta ?? 0)})`} />
              {delta.resourceChanges.length ? <Text style={{ color: '#475569' }}>Recursos: {delta.resourceChanges.map((resource) => `${resource.label} ${resource.before}→${resource.after}`).join(', ')}</Text> : null}
            </View>
          ))}
          <Button label="Compartilhar diff Markdown" onPress={shareDiff} />
        </Card>
      ) : null}

      <Button label="Comparador avançado" secondary onPress={() => router.push(`/characters/${character.id}/comparison`)} />
      <Button label="Relatórios e exportação" secondary onPress={() => router.push(`/characters/${character.id}/report`)} />
      <Button label="Voltar para personagem" secondary onPress={() => router.push(`/characters/${character.id}`)} />
    </Screen>
  );
}
