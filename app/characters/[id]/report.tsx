import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { Share, Text, TextInput, View } from 'react-native';
import { Screen } from '../../../src/components/Screen';
import { Card } from '../../../src/components/Card';
import { Button } from '../../../src/components/Button';
import { Field } from '../../../src/components/Field';
import { StatRow } from '../../../src/components/StatRow';
import { useCharacterStore } from '../../../src/store/characterStore';
import { useCombatScenarioStore } from '../../../src/store/combatScenarioStore';
import { compareRotationsForScenario } from '../../../src/rules-engine/turns/compareRotations';
import { exportRotationReport, RotationReportFormat, describeCombatScenario } from '../../../src/reports/rotationReport';
import { formatNumber } from '../../../src/utils/format';

const getId = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);

export default function RotationReportScreen() {
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

  const [selectedScenarioId, setSelectedScenarioId] = useState<string | undefined>();
  const [format, setFormat] = useState<RotationReportFormat>('markdown');
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

  const exportResult = useMemo(() => {
    if (!character || !comparison) return undefined;
    return exportRotationReport({ character, comparison, format, options: { notes: notes.trim() || undefined } });
  }, [character, comparison, format, notes]);

  if (!character || !id) return <Screen title="Não encontrado"><Button label="Voltar" onPress={() => router.back()} /></Screen>;

  const shareReport = async () => {
    if (!exportResult) return;
    await Share.share({
      title: exportResult.filename,
      message: exportResult.content
    });
  };

  return (
    <Screen title="Relatórios e exportação" subtitle="Gere um relatório Markdown ou JSON com cenário, rotações, médias, recursos e conflitos de regra.">
      <Card title="Formato" subtitle="Markdown é melhor para colar em Obsidian/Discord/WhatsApp. JSON é melhor para backup, automações e comparação externa.">
        <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
          <View style={{ flex: 1, minWidth: 130 }}><Button label="Markdown" secondary={format !== 'markdown'} onPress={() => setFormat('markdown')} /></View>
          <View style={{ flex: 1, minWidth: 130 }}><Button label="JSON" secondary={format !== 'json'} onPress={() => setFormat('json')} /></View>
        </View>
        <Field label="Notas opcionais do relatório" value={notes} onChangeText={setNotes} multiline />
      </Card>

      <Card title="Cenário usado no relatório" subtitle="O relatório usa uma comparação completa de todas as rotações contra o cenário selecionado.">
        {scenarios.map((scenario) => {
          const active = scenario.id === selectedScenario?.id;
          return (
            <Card key={scenario.id} title={`${active ? '✓ ' : ''}${scenario.name}`} subtitle={describeCombatScenario(scenario)} onPress={() => setSelectedScenarioId(scenario.id)}>
              {scenario.notes ? <Text style={{ color: '#475569' }}>{scenario.notes}</Text> : null}
            </Card>
          );
        })}
        {scenarios.length === 0 ? <Text style={{ color: '#64748b' }}>Nenhum cenário salvo. Abra o comparador para criar um cenário.</Text> : null}
      </Card>

      {comparison ? (
        <Card title="Resumo que será exportado" subtitle={`${comparison.rows.length} rotações analisadas`}>
          <StatRow label="Melhor média bruta" value={comparison.rows.find((row) => row.rotationId === comparison.bestByAverageRotationId)?.rotationName ?? '-'} />
          <StatRow label="Melhor média ponderada" value={comparison.rows.find((row) => row.rotationId === comparison.bestByWeightedAverageRotationId)?.rotationName ?? '-'} />
          <StatRow label="Melhor dano garantido" value={comparison.rows.find((row) => row.rotationId === comparison.bestByGuaranteedRotationId)?.rotationName ?? '-'} />
          <StatRow label="Maior média exportada" value={formatNumber(Math.max(0, ...comparison.rows.map((row) => row.weightedAverage ?? row.total.average)))} />
        </Card>
      ) : null}

      <Card title="Preview" subtitle={exportResult?.filename ?? 'Sem conteúdo para exportar'}>
        <TextInput
          value={exportResult?.content ?? 'Crie pelo menos uma rotação e selecione um cenário para gerar o relatório.'}
          editable={false}
          multiline
          style={{
            minHeight: 260,
            borderWidth: 1,
            borderColor: '#cbd5e1',
            borderRadius: 12,
            padding: 10,
            backgroundColor: '#f8fafc',
            color: '#111827',
            fontFamily: 'monospace',
            fontSize: 12,
            textAlignVertical: 'top'
          }}
        />
      </Card>

      <Button label="Compartilhar relatório" onPress={shareReport} disabled={!exportResult} />
      <Button label="Comparador avançado" secondary onPress={() => router.push(`/characters/${character.id}/comparison`)} />
      <Button label="Histórico de evolução" secondary onPress={() => router.push(`/characters/${character.id}/history`)} />
      <Button label="Voltar para personagem" secondary onPress={() => router.push(`/characters/${character.id}`)} />
    </Screen>
  );
}
