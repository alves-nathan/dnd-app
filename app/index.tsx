import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { BottomNavigation } from '../src/components/BottomNavigation';
import { Button } from '../src/components/Button';
import { Card } from '../src/components/Card';
import { MetricTile } from '../src/components/MetricTile';
import { ProgressBar } from '../src/components/ProgressBar';
import { Screen } from '../src/components/Screen';
import { useCompendiumStore } from '../src/store/compendiumStore';
import { useCharacterStore } from '../src/store/characterStore';
import { usePortableRestoreSessionStore } from '../src/store/portableRestoreSessionStore';
import { analyzeTurnRotation } from '../src/rules-engine/turns/analyzeTurn';
import { getArmorClass, getProficiencyBonus, getTotalLevel } from '../src/rules-engine/characters/derivedStats';
import { characterClassSummary, characterCompletion, nextCharacterStep } from '../src/ui/characterPresentation';
import { defaultCombatState } from '../src/data/mockData';
import { useAppTheme } from '../src/theme';
import { formatNumber } from '../src/utils/format';
import { getCharacterDisplayName } from '../src/ui/characterIdentity';

export default function HomeScreen() {
  const { colors, radii } = useAppTheme();
  const characters = useCharacterStore((state) => state.characters);
  const progressionDrafts = useCharacterStore((state) => state.progressionDrafts);
  const progressionRecovery = useCharacterStore((state) => state.progressionRecovery);
  const restoreSession = usePortableRestoreSessionStore((state) => state.activeSession);
  const restoreEvidence = usePortableRestoreSessionStore((state) => state.evidenceRecords);
  const compendiumItems = useCompendiumStore((state) => state.items);
  const enabledSources = useCompendiumStore((state) => state.enabledSourceIds);
  const [showTools, setShowTools] = useState(false);
  const evidenceAttention = restoreEvidence.filter((record) => record.validationStatus === 'invalid' || ['changed', 'invalid'].includes(record.comparison?.status ?? '')).length;

  const validatedCount = useMemo(() => compendiumItems.filter((item) => item.status === 'validated').length, [compendiumItems]);

  return (
    <Screen
      eyebrow="D&D Combat"
      title="Seus personagens"
      subtitle="Crie a ficha com dados do compêndio, acompanhe a evolução e leve o dano por turno direto para a mesa."
      headerAction={(
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Criar personagem"
          accessibilityHint="Abrir o fluxo guiado de criação de personagem"
          focusable
          onPress={() => router.push('/characters/new')}
          style={[styles.createIcon, { backgroundColor: colors.primary, borderRadius: radii.full }]}
        >
          <Ionicons name="add" size={26} color={colors.onPrimary} />
        </Pressable>
      )}
      footer={(
        <BottomNavigation
          activeKey="characters"
          items={[
            { key: 'characters', label: 'Personagens', icon: 'people', onPress: () => undefined },
            { key: 'compendium', label: 'Compêndio', icon: 'library', onPress: () => router.push('/compendium') },
            { key: 'settings', label: 'Ajustes', icon: 'settings', onPress: () => router.push('/settings') }
          ]}
        />
      )}
    >
      <Card variant="hero" title={characters.length ? `${characters.length} personagem(ns) pronto(s) para evoluir` : 'Comece pela ficha, não pelos formulários'}>
        <Text style={[styles.heroText, { color: colors.onPrimaryContainer }]}>O fluxo guiado procura primeiro classes, espécies e backgrounds já importados e validados.</Text>
        <View style={styles.row}>
          <View style={styles.flex}><Button label="Novo personagem" icon="person-add" onPress={() => router.push('/characters/new')} /></View>
          <View style={styles.flex}><Button label="Ver compêndio" icon="library-outline" variant="outlined" onPress={() => router.push('/compendium')} /></View>
        </View>
        <Text style={[styles.libraryStatus, { color: colors.onPrimaryContainer }]}>{validatedCount} itens validados · {enabledSources.length} fontes ativas</Text>
      </Card>

      {restoreSession && !['rolledBack', 'discarded'].includes(restoreSession.status) ? (
        <Card
          variant="filled"
          title={`Restauração portátil: ${restoreSession.status}`}
          subtitle={restoreSession.recoveryRequired ? 'Há uma sessão interrompida ou parcialmente aplicada que exige decisão.' : 'Há uma sessão preparada ou confirmada com checkpoint disponível.'}
        >
          <Button testID="open-portable-restore-session" label="Revisar sessão de restauração" icon="cloud-done-outline" onPress={() => router.push('/restore-session')} />
        </Card>
      ) : null}

      {evidenceAttention ? (
        <Card
          variant="filled"
          title={`Evidências históricas para revisar (${evidenceAttention})`}
          subtitle="Há recibos inválidos ou estados que mudaram depois da restauração verificada."
        >
          <Button testID="open-evidence-center" label="Abrir central de evidências" icon="document-lock-outline" onPress={() => router.push('/evidence-center')} />
        </Card>
      ) : null}

      {Object.keys(progressionDrafts).length || progressionRecovery.issues.length ? (
        <Card
          variant="filled"
          title={`Progressões preservadas (${Object.keys(progressionDrafts).length})`}
          subtitle={`${progressionRecovery.recoverableCharacterIds.length} recuperável(is) · ${progressionRecovery.conflictedCharacterIds.length} conflito(s) · ${progressionRecovery.issues.length} registro(s) isolado(s)`}
        >
          <Button testID="open-progression-recovery" label="Revisar recuperação" icon="refresh-circle-outline" onPress={() => router.push('/progression-recovery')} />
        </Card>
      ) : null}

      {characters.length === 0 ? (
        <Card variant="filled" title="Nenhum personagem ainda" subtitle="O assistente define nível, origem, progressão, atributos, proficiências, magias e nome opcional.">
          <View style={styles.steps}>
            {['Níveis e classes', 'Origem', 'Subclasses e feats', 'Atributos', 'Proficiências', 'Magias', 'Nome opcional'].map((label, index) => (
              <View key={label} style={styles.stepRow}>
                <View style={[styles.stepNumber, { backgroundColor: colors.secondaryContainer, borderRadius: radii.full }]}><Text style={{ color: colors.onSecondaryContainer, fontWeight: '900' }}>{index + 1}</Text></View>
                <Text style={[styles.stepText, { color: colors.onSurface }]}>{label}</Text>
              </View>
            ))}
          </View>
        </Card>
      ) : null}

      {characters.map((character) => {
        const completion = characterCompletion(character);
        const next = nextCharacterStep(character);
        const favorite = character.rotations.find((rotation) => rotation.favorite) ?? character.rotations[0];
        const damage = favorite ? analyzeTurnRotation(favorite, character, defaultCombatState) : undefined;
        return (
          <Card
            key={character.id}
            variant="elevated"
            title={getCharacterDisplayName(character)}
            subtitle={`${characterClassSummary(character)} · ${character.species?.name ?? 'espécie pendente'}`}
          >
            <View style={styles.metrics}>
              <MetricTile label="Nível" value={getTotalLevel(character)} supporting={`PB +${getProficiencyBonus(character)}`} />
              <MetricTile label="CA" value={getArmorClass(character)} />
              <MetricTile label="Dano/turno" value={damage ? formatNumber(damage.weightedAverage ?? damage.total.average) : '—'} supporting={favorite?.name ?? 'crie uma rotação'} />
            </View>
            <ProgressBar value={completion} label={completion === 1 ? 'Ficha essencial completa' : next.label} showPercent />
            <View style={styles.row}>
              <View style={styles.flex}><Button label={next.label} icon={next.key === 'ready' ? 'flash' : 'arrow-forward'} onPress={() => router.push(next.route as never)} /></View>
              <View style={styles.flex}><Button label="Modo mesa" icon="dice-outline" variant="tonal" onPress={() => router.push(`/characters/${character.id}/table`)} /></View>
              <View style={styles.flex}><Button label="Abrir ficha" icon="person-circle-outline" variant="outlined" onPress={() => router.push(`/characters/${character.id}`)} /></View>
            </View>
          </Card>
        );
      })}

      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded: showTools }}
        accessibilityLabel="Ferramentas e dados"
        accessibilityHint={showTools ? "Recolher ferramentas e dados" : "Expandir ferramentas e dados"}
        focusable
        onPress={() => setShowTools((current) => !current)}
        style={styles.toolsHeader}
      >
        <View>
          <Text style={[styles.toolsTitle, { color: colors.onSurface }]}>Ferramentas e dados</Text>
          <Text style={[styles.toolsSubtitle, { color: colors.onSurfaceVariant }]}>Backup, diagnóstico e recursos técnicos</Text>
        </View>
        <Ionicons name={showTools ? 'chevron-up' : 'chevron-down'} size={22} color={colors.onSurfaceVariant} />
      </Pressable>
      {showTools ? (
        <Card variant="filled">
          <Button label="Backup e restauração" icon="cloud-download-outline" variant="text" onPress={() => router.push('/backup')} />
          <Button label="Diagnóstico global" icon="pulse-outline" variant="text" onPress={() => router.push('/diagnostics')} />
          <Button label="Biblioteca de exemplos" icon="flask-outline" variant="text" onPress={() => router.push('/examples')} />
          <Button label="Compatibilidade" icon="shield-checkmark-outline" variant="text" onPress={() => router.push('/hardening')} />
          <Button label="Validação de dados da beta" icon="shield-half-outline" variant="text" onPress={() => router.push('/beta-validation')} />
          <Button label="Feedback local da beta" icon="chatbox-ellipses-outline" variant="text" onPress={() => router.push('/beta-feedback')} />
        <Button label="Fechamento do ciclo beta" icon="checkmark-done-outline" variant="text" onPress={() => router.push('/beta-closure')} />
          <Button label="Release e dev build" icon="construct-outline" variant="text" onPress={() => router.push('/release')} />
        </Card>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  createIcon: { width: 48, height: 48, alignItems: 'center', justifyContent: 'center' },
  heroText: { fontSize: 15, lineHeight: 22 },
  libraryStatus: { fontSize: 12, lineHeight: 17, fontWeight: '800' },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  flex: { flex: 1, minWidth: 145 },
  metrics: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  steps: { gap: 10 },
  stepRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  stepNumber: { width: 32, height: 32, alignItems: 'center', justifyContent: 'center' },
  stepText: { fontSize: 15, lineHeight: 21, fontWeight: '700' },
  toolsHeader: { minHeight: 56, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 12, paddingHorizontal: 4 },
  toolsTitle: { fontSize: 17, lineHeight: 23, fontWeight: '800' },
  toolsSubtitle: { fontSize: 12, lineHeight: 17 }
});
