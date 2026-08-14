import { router } from 'expo-router';
import { Alert, StyleSheet, Text, View } from 'react-native';
import { Button } from '../src/components/Button';
import { Card } from '../src/components/Card';
import { MetricTile } from '../src/components/MetricTile';
import { Screen } from '../src/components/Screen';
import { useCharacterStore } from '../src/store/characterStore';
import { useAppTheme } from '../src/theme';
import { getCharacterDisplayName } from '../src/ui/characterIdentity';

const statusLabel = {
  active: 'Em andamento',
  recoverable: 'Rascunho recuperável',
  conflicted: 'Conflito de recuperação'
} as const;

export default function ProgressionRecoveryScreen() {
  const { colors } = useAppTheme();
  const characters = useCharacterStore((state) => state.characters);
  const drafts = useCharacterStore((state) => state.progressionDrafts);
  const recovery = useCharacterStore((state) => state.progressionRecovery);
  const acknowledge = useCharacterStore((state) => state.acknowledgeProgressionRecovery);
  const discard = useCharacterStore((state) => state.discardProgressionTransaction);
  const dismissIssue = useCharacterStore((state) => state.dismissProgressionRecoveryIssue);
  const entries = Object.values(drafts)
    .map((draft) => ({ draft, character: characters.find((character) => character.id === draft.characterId) }))
    .sort((left, right) => right.draft.updatedAt.localeCompare(left.draft.updatedAt));

  const resume = (characterId: string) => {
    if (!acknowledge(characterId)) {
      Alert.alert('Rascunho indisponível', 'Este rascunho não está em estado recuperável.');
      return;
    }
    router.replace(`/characters/${characterId}/progression`);
  };

  const confirmDiscard = (characterId: string, label: string) => Alert.alert(
    'Descartar rascunho?',
    `O rascunho de ${label} será removido. A ficha publicada não será alterada.`,
    [
      { text: 'Cancelar', style: 'cancel' },
      { text: 'Descartar', style: 'destructive', onPress: () => discard(characterId) }
    ]
  );

  return (
    <Screen
      eyebrow="Segurança dos dados"
      title="Recuperação de progressão"
      subtitle="Revise transações preservadas após reinício, encerramento inesperado ou conflito com a ficha publicada."
      onBack={() => router.back()}
    >
      <View style={styles.metrics}>
        <MetricTile label="Recuperáveis" value={recovery.recoverableCharacterIds.length} />
        <MetricTile label="Conflitos" value={recovery.conflictedCharacterIds.length} />
        <MetricTile label="Registros isolados" value={recovery.issues.length} />
      </View>

      {recovery.error ? (
        <Card variant="filled" title="Falha ao ler o armazenamento" subtitle={recovery.error} />
      ) : null}

      {entries.map(({ draft, character }) => {
        const name = character ? getCharacterDisplayName(character) : draft.characterId;
        const recoveryStatus = draft.recovery.status;
        return (
          <Card
            key={draft.id}
            variant={recoveryStatus === 'conflicted' ? 'filled' : 'outlined'}
            title={`${statusLabel[recoveryStatus]} · ${name}`}
            subtitle={`Checkpoint ${draft.recovery.checkpointSequence} · ${new Date(draft.recovery.lastCheckpointAt).toLocaleString('pt-BR')}`}
          >
            <Text style={[styles.body, { color: colors.onSurfaceVariant }]}>
              {draft.recovery.reason ?? 'A transação está ativa e continua protegendo a ficha publicada.'}
            </Text>
            <Text style={[styles.meta, { color: colors.onSurfaceVariant }]}>Transação {draft.id} · nível {draft.baseCharacter.level} → {draft.workingCharacter.level}</Text>
            <View style={styles.actions}>
              {recoveryStatus === 'recoverable' ? (
                <View style={styles.flex}><Button testID={`progression-recovery-resume-${draft.characterId}`} label="Retomar com segurança" icon="refresh" onPress={() => resume(draft.characterId)} /></View>
              ) : null}
              {recoveryStatus === 'active' ? (
                <View style={styles.flex}><Button label="Abrir transação" icon="open-outline" onPress={() => router.push(`/characters/${draft.characterId}/progression`)} /></View>
              ) : null}
              <View style={styles.flex}><Button testID={`progression-recovery-discard-${draft.characterId}`} label="Descartar" variant="outlined" icon="trash-outline" onPress={() => confirmDiscard(draft.characterId, name)} /></View>
            </View>
          </Card>
        );
      })}

      {recovery.issues.map((entry) => (
        <Card key={entry.id} variant="filled" title={entry.kind === 'orphaned' ? 'Rascunho órfão isolado' : 'Registro inválido isolado'} subtitle={entry.reason}>
          <Text style={[styles.meta, { color: colors.onSurfaceVariant }]}>{entry.characterId ? `Personagem: ${entry.characterId}` : 'Personagem não identificado'}{entry.draftId ? ` · Transação: ${entry.draftId}` : ''}</Text>
          <Button label="Remover aviso" variant="text" onPress={() => dismissIssue(entry.id)} />
        </Card>
      ))}

      {!entries.length && !recovery.issues.length ? (
        <Card variant="hero" title="Nenhuma recuperação pendente" subtitle="Não existem transações interrompidas, conflitantes ou registros isolados neste dispositivo." />
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  metrics: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  flex: { flex: 1, minWidth: 150 },
  body: { fontSize: 14, lineHeight: 20 },
  meta: { fontSize: 12, lineHeight: 18 }
});
