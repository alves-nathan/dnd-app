import { Alert, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import { Button } from '../src/components/Button';
import { Card } from '../src/components/Card';
import { MetricTile } from '../src/components/MetricTile';
import { Screen } from '../src/components/Screen';
import { useCatalogStore } from '../src/store/catalogStore';
import { useAppTheme } from '../src/theme';

const formatDate = (value: string): string => {
  try {
    return new Intl.DateTimeFormat('pt-BR', {
      dateStyle: 'short',
      timeStyle: 'short'
    }).format(new Date(value));
  } catch {
    return value;
  }
};

const originLabels: Record<string, string> = {
  book: 'Livro',
  category: 'Categoria',
  entity: 'Entidade',
  profile: 'Perfil',
  reset: 'Padrão',
  import: 'Importação',
  restore: 'Restauração',
  manual: 'Manual'
};

export default function CatalogHistoryScreen() {
  const { colors } = useAppTheme();
  const status = useCatalogStore((state) => state.status);
  const history = useCatalogStore((state) => state.history);
  const revision = useCatalogStore((state) => state.revision);
  const previewHistoryRestore = useCatalogStore((state) => state.previewHistoryRestore);

  const restore = (commitId: string, target: 'before' | 'after') => {
    try {
      previewHistoryRestore(commitId, target);
      router.replace('/content-management');
    } catch (error) {
      Alert.alert(
        'Restauração indisponível',
        error instanceof Error ? error.message : String(error)
      );
    }
  };

  return (
    <Screen
      eyebrow="Auditoria local"
      title="Histórico do catálogo"
      subtitle="Cada restauração abre um novo preview preventivo. Nenhum estado anterior é aplicado silenciosamente."
      onBack={() => router.back()}
    >
      <Card variant="hero" title={`Revisão atual ${revision}`} subtitle={`${history.length} commit(s) local(is) preservado(s), limitado(s) aos 50 mais recentes.`}>
        <View style={styles.metrics}>
          <MetricTile label="Commits" value={history.length} />
          <MetricTile label="Revisão" value={revision} />
          <MetricTile label="Status" value={status === 'ready' ? 'Pronto' : status} />
        </View>
      </Card>

      {!history.length ? (
        <Card variant="filled" title="Nenhum commit registrado" subtitle="A próxima alteração confirmada em livros, categorias, entidades, perfis ou importações iniciará o histórico." />
      ) : history.slice().reverse().map((entry) => (
        <Card
          key={entry.id}
          title={`#${entry.revision} · ${entry.label}`}
          subtitle={`${originLabels[entry.origin] ?? entry.origin} · ${formatDate(entry.committedAt)} · ${entry.author.displayName}`}
        >
          <View style={styles.metrics}>
            <MetricTile label="Ativas" value={`${entry.impact.beforeEnabled} → ${entry.impact.afterEnabled}`} />
            <MetricTile label="Desativadas" value={entry.impact.disabledCount} />
            <MetricTile label="Quebras" value={entry.impact.hardDependencyBreakCount} />
          </View>
          <Text style={[styles.muted, { color: colors.onSurfaceVariant }]}> 
            Alterações: {entry.changes.bookIds.length} livro(s), {entry.changes.categoryIds.length} categoria(s) e {entry.changes.entityIds.length} entidade(s).
          </Text>
          <Text style={[styles.muted, { color: colors.onSurfaceVariant }]}> 
            Reconhecimento preventivo: {entry.acknowledgement.required ? (entry.acknowledgement.acknowledged ? 'confirmado' : 'não confirmado') : 'não exigido'} · {entry.acknowledgement.affectedCharacterIds.length} ficha(s) afetada(s).
          </Text>
          {entry.acknowledgement.obsoletePreventivePlanCharacterIds.length || entry.acknowledgement.preservedPreventivePlanCharacterIds.length ? (
            <Text testID={`catalog-history-reconciliation-${entry.revision}`} style={[styles.warning, { color: colors.warning }]}>Planos preventivos reconciliados: {entry.acknowledgement.obsoletePreventivePlanCharacterIds.length} removido(s) e {entry.acknowledgement.preservedPreventivePlanCharacterIds.length} preservado(s) para revisão.</Text>
          ) : null}
          {entry.restoredFromCommitId ? (
            <Text style={[styles.warning, { color: colors.warning }]}> 
              Esta entrada foi criada por restauração do commit {entry.restoredFromCommitId}.
            </Text>
          ) : null}
          {entry.portableImport ? (
            <View testID={`catalog-history-portable-import-${entry.revision}`} style={styles.auditBox}>
              <Text style={[styles.warning, { color: colors.warning }]}>Backup portátil {entry.portableImport.comparison}: catálogo {entry.portableImport.sourceCatalogVersion}, revisão {entry.portableImport.sourceRevision}, {entry.portableImport.sourceHistory.length} commit(s) de origem.</Text>
              <Text style={[styles.muted, { color: colors.onSurfaceVariant }]}>Auditoria de origem: {entry.portableImport.sourceHistoryChecksum}. {entry.portableImport.conflictingCommitIds.length} conflito(s) de ID preservado(s) sem sobrescrever o histórico local.</Text>
            </View>
          ) : null}
          <Button
            testID={`catalog-history-restore-before-${entry.revision}`}
            label="Restaurar configuração anterior"
            icon="return-up-back-outline"
            variant="outlined"
            onPress={() => restore(entry.id, 'before')}
          />
          <Button
            testID={`catalog-history-restore-after-${entry.revision}`}
            label="Reaplicar estado deste commit"
            icon="refresh-outline"
            variant="text"
            onPress={() => restore(entry.id, 'after')}
          />
        </Card>
      ))}
    </Screen>
  );
}

const styles = StyleSheet.create({
  metrics: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  muted: { fontSize: 13, lineHeight: 19 },
  warning: { fontSize: 13, lineHeight: 19, fontWeight: '800' },
  auditBox: { gap: 6, paddingVertical: 4 }
});
