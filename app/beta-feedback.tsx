import Constants from 'expo-constants';
import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import { Alert, Platform, Share, StyleSheet, Text, View } from 'react-native';
import { Button } from '../src/components/Button';
import { Card } from '../src/components/Card';
import { Chip } from '../src/components/Chip';
import { Field } from '../src/components/Field';
import { Screen } from '../src/components/Screen';
import {
  BetaFeedbackCategory,
  BetaFeedbackPlatform,
  BetaFeedbackSeverity,
  betaFeedbackExportToJson,
  createBetaFeedbackExport
} from '../src/release/betaFeedback';
import { useBetaFeedbackStore } from '../src/store/betaFeedbackStore';
import { useAppTheme } from '../src/theme';

const categories: Array<{ value: BetaFeedbackCategory; label: string }> = [
  { value: 'characterCreation', label: 'Criação' },
  { value: 'progression', label: 'Progressão' },
  { value: 'compendium', label: 'Compêndio' },
  { value: 'combat', label: 'Combate' },
  { value: 'performance', label: 'Performance' },
  { value: 'accessibility', label: 'Acessibilidade' },
  { value: 'backup', label: 'Backup' },
  { value: 'other', label: 'Outro' }
];

const severities: Array<{ value: BetaFeedbackSeverity; label: string }> = [
  { value: 'low', label: 'Baixa' },
  { value: 'medium', label: 'Média' },
  { value: 'high', label: 'Alta' },
  { value: 'blocking', label: 'Bloqueante' }
];

const platformValue: BetaFeedbackPlatform =
  Platform.OS === 'android' || Platform.OS === 'ios' || Platform.OS === 'web'
    ? Platform.OS
    : 'unknown';

export default function BetaFeedbackScreen() {
  const { colors } = useAppTheme();
  const entries = useBetaFeedbackStore((state) => state.entries);
  const addEntry = useBetaFeedbackStore((state) => state.addEntry);
  const updateStatus = useBetaFeedbackStore((state) => state.updateStatus);
  const removeEntry = useBetaFeedbackStore((state) => state.removeEntry);
  const clearResolved = useBetaFeedbackStore((state) => state.clearResolved);

  const [category, setCategory] = useState<BetaFeedbackCategory>('characterCreation');
  const [severity, setSeverity] = useState<BetaFeedbackSeverity>('medium');
  const [summary, setSummary] = useState('');
  const [steps, setSteps] = useState('');
  const [expected, setExpected] = useState('');
  const [actual, setActual] = useState('');
  const [device, setDevice] = useState('');
  const [notes, setNotes] = useState('');

  const appVersion = Constants.expoConfig?.version ?? 'unknown';
  const feedbackExport = useMemo(() => createBetaFeedbackExport(entries), [entries]);

  const save = () => {
    try {
      addEntry({
        platform: platformValue,
        severity,
        category,
        summary,
        steps,
        expected,
        actual,
        device,
        appVersion,
        notes
      });
      setSummary('');
      setSteps('');
      setExpected('');
      setActual('');
      setNotes('');
      Alert.alert('Feedback salvo', 'O registro foi armazenado somente neste dispositivo.');
    } catch (error) {
      Alert.alert('Feedback incompleto', error instanceof Error ? error.message : 'Preencha o resumo.');
    }
  };

  const share = async () => {
    await Share.share({
      title: 'Feedback beta D&D Combat',
      message: betaFeedbackExportToJson(feedbackExport)
    });
  };

  return (
    <Screen
      eyebrow="Beta"
      title="Feedback local"
      subtitle="Registre problemas sem telemetria remota. O conteúdo só sai do dispositivo quando você usa Compartilhar."
      onBack={() => router.back()}
    >
      <Card variant="hero" title="Novo registro" subtitle={`Plataforma: ${platformValue} · versão ${appVersion}`}>
        <Text style={[styles.label, { color: colors.onPrimaryContainer }]}>Categoria</Text>
        <View style={styles.chips}>
          {categories.map((entry) => (
            <Chip key={entry.value} label={entry.label} selected={category === entry.value} onPress={() => setCategory(entry.value)} />
          ))}
        </View>
        <Text style={[styles.label, { color: colors.onPrimaryContainer }]}>Severidade</Text>
        <View style={styles.chips}>
          {severities.map((entry) => (
            <Chip key={entry.value} label={entry.label} selected={severity === entry.value} onPress={() => setSeverity(entry.value)} />
          ))}
        </View>
        <Field label="Resumo" value={summary} onChangeText={setSummary} placeholder="O que aconteceu?" testID="beta-feedback-summary" />
        <Field label="Passos para reproduzir" value={steps} onChangeText={setSteps} multiline style={styles.textarea} />
        <Field label="Resultado esperado" value={expected} onChangeText={setExpected} multiline style={styles.textareaSmall} />
        <Field label="Resultado atual" value={actual} onChangeText={setActual} multiline style={styles.textareaSmall} />
        <Field label="Aparelho e sistema" value={device} onChangeText={setDevice} placeholder="Ex.: Pixel 7 · Android 15" />
        <Field label="Notas adicionais" value={notes} onChangeText={setNotes} multiline style={styles.textareaSmall} />
        <Button label="Salvar feedback local" icon="save-outline" testID="beta-feedback-save" onPress={save} />
      </Card>

      <Card
        title={`Registros (${entries.length})`}
        subtitle={`${feedbackExport.summary.open} aberto(s) · ${feedbackExport.summary.blocking} bloqueante(s)`}
      >
        {entries.length ? entries.map((entry) => (
          <View key={entry.id} style={[styles.entry, { borderColor: colors.outlineVariant }]}>
            <Text style={[styles.entryTitle, { color: colors.onSurface }]}>{entry.summary}</Text>
            <Text style={[styles.meta, { color: colors.onSurfaceVariant }]}>{entry.category} · {entry.severity} · {entry.status} · {entry.platform}</Text>
            {entry.actual ? <Text style={[styles.body, { color: colors.onSurfaceVariant }]}>{entry.actual}</Text> : null}
            <View style={styles.actions}>
              <Button
                label={entry.status === 'resolved' ? 'Reabrir' : entry.status === 'triaged' ? 'Resolver' : 'Marcar triagem'}
                compact
                variant="text"
                onPress={() => updateStatus(entry.id, entry.status === 'resolved' ? 'open' : entry.status === 'triaged' ? 'resolved' : 'triaged')}
              />
              <Button label="Remover" compact variant="danger" onPress={() => removeEntry(entry.id)} />
            </View>
          </View>
        )) : <Text style={[styles.body, { color: colors.onSurfaceVariant }]}>Nenhum feedback registrado.</Text>}
      </Card>

      <Button label="Compartilhar feedback em JSON" icon="share-outline" variant="outlined" disabled={!entries.length} onPress={() => void share()} />
      <Button label="Limpar resolvidos" icon="trash-outline" variant="text" disabled={!entries.some((entry) => entry.status === 'resolved' || entry.status === 'wontFix')} onPress={clearResolved} />
      <Text style={[styles.notice, { color: colors.onSurfaceVariant }]}>Revise os campos livres antes de compartilhar; eles podem conter informações digitadas por você.</Text>
    </Screen>
  );
}

const styles = StyleSheet.create({
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  label: { fontSize: 13, lineHeight: 18, fontWeight: '900' },
  textarea: { minHeight: 120, textAlignVertical: 'top' },
  textareaSmall: { minHeight: 88, textAlignVertical: 'top' },
  entry: { borderTopWidth: 1, paddingTop: 12, gap: 5 },
  entryTitle: { fontSize: 15, lineHeight: 21, fontWeight: '900' },
  meta: { fontSize: 12, lineHeight: 17, fontWeight: '700' },
  body: { fontSize: 13, lineHeight: 19 },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  notice: { fontSize: 12, lineHeight: 17, textAlign: 'center' }
});
