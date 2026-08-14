import { Ionicons } from '@expo/vector-icons';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { BottomNavigation } from '../../../src/components/BottomNavigation';
import { Button } from '../../../src/components/Button';
import { Card } from '../../../src/components/Card';
import { IssueList } from '../../../src/components/IssueList';
import { MetricTile } from '../../../src/components/MetricTile';
import { ProgressBar } from '../../../src/components/ProgressBar';
import { Screen } from '../../../src/components/Screen';
import { defaultCombatState } from '../../../src/data/mockData';
import { getArmorClass, getInitiative, getProficiencyBonus, getTotalLevel } from '../../../src/rules-engine/characters/derivedStats';
import { analyzeTurnRotation } from '../../../src/rules-engine/turns/analyzeTurn';
import { validateCharacterRules } from '../../../src/rules-engine/validators/ruleValidation';
import { useCharacterStore } from '../../../src/store/characterStore';
import { useCompendiumStore } from '../../../src/store/compendiumStore';
import { useAppTheme } from '../../../src/theme';
import { characterClassSummary, characterCompletion, nextCharacterStep } from '../../../src/ui/characterPresentation';
import { formatNumber } from '../../../src/utils/format';
import { getCharacterDisplayName } from '../../../src/ui/characterIdentity';
import { useCharacterCompatibility } from '../../../src/characters/useCharacterCompatibility';
import { deleteCharacterData } from '../../../src/characters/deleteCharacterData';
import { hasPactOfTheBlade } from '../../../src/characters/pactWeaponRules';
import { getCharacterSubclassChoiceSummaries } from '../../../src/characters/subclassChoiceRules';

const getId = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);

const pendingChoiceRoute = (characterId: string, kind: string): string => {
  if (kind === 'feat' || kind === 'featOptions') return `/characters/${characterId}/feats`;
  if (kind === 'spellSelection' || kind === 'spellReplacement') return `/characters/${characterId}/spells`;
  if (kind === 'proficiency') return `/characters/${characterId}/proficiencies`;
  if (kind === 'equipment') return `/characters/${characterId}/equipment`;
  if (kind === 'subclass' || kind === 'subclassOptions') return `/characters/${characterId}/classes`;
  if (kind === 'speciesOption') return `/characters/${characterId}/identity`;
  if (kind === 'pactWeapon') return `/characters/${characterId}/pact-weapon`;
  if (kind === 'eldritchInvocation' || kind === 'eldritchInvocationOptions') return `/characters/${characterId}/invocations`;
  return `/characters/${characterId}/compendium`;
};

export default function CharacterDetailScreen() {
  const { colors, radii } = useAppTheme();
  const { id: idParam, compatibilityReviewed } = useLocalSearchParams();
  const id = getId(idParam);
  const reviewed = getId(compatibilityReviewed);
  const character = useCharacterStore((state) => state.characters.find((item) => item.id === id));
  const progressionDraft = useCharacterStore((state) => id ? state.progressionDrafts[id] : undefined);
  const compendiumItems = useCompendiumStore((state) => state.items);
  const [showMore, setShowMore] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleteError, setDeleteError] = useState<string>();
  const compatibility = useCharacterCompatibility(character);

  useEffect(() => {
    if (!character || reviewed === '1' || compatibility.status !== 'ready' || !compatibility.report?.requiresReview) return;
    router.replace(`/characters/${character.id}/compatibility` as never);
  }, [character, compatibility.report, compatibility.status, reviewed]);

  const subclassChoiceSummaries = useMemo(
    () => character ? getCharacterSubclassChoiceSummaries(character, compendiumItems) : [],
    [character, compendiumItems]
  );
  const pactOfTheBlade = useMemo(
    () => Boolean(character && hasPactOfTheBlade(character, compendiumItems)),
    [character, compendiumItems]
  );

  const damageSummary = useMemo(() => {
    if (!character) return undefined;
    const rotation = character.rotations.find((entry) => entry.favorite) ?? character.rotations[0];
    if (!rotation) return undefined;
    return { rotation, result: analyzeTurnRotation(rotation, character, defaultCombatState) };
  }, [character]);

  if (!character) {
    return <Screen title="Personagem não encontrado" onBack={() => router.replace('/')}><Button label="Voltar aos personagens" onPress={() => router.replace('/')} /></Screen>;
  }

  if (compatibility.status === 'loading' || (compatibility.status === 'ready' && compatibility.report?.requiresReview && reviewed !== '1')) {
    return <Screen eyebrow="Compatibilidade" title="Verificando ficha" subtitle="Comparando as regras usadas pelo personagem antes da abertura." onBack={() => router.replace('/')}><Card variant="filled" title="Diagnóstico em andamento" subtitle="A ficha permanece inalterada." /></Screen>;
  }

  if (compatibility.status === 'failed') {
    return <Screen eyebrow="Compatibilidade" title="Diagnóstico indisponível" subtitle={compatibility.error ?? 'Não foi possível comparar a ficha com as regras atuais.'} onBack={() => router.replace('/')}><Button label="Voltar aos personagens" onPress={() => router.replace('/')} /></Screen>;
  }

  const validation = validateCharacterRules(character);
  const completion = characterCompletion(character);
  const next = nextCharacterStep(character);
  const importedCount = (character.compendiumLinks ?? []).filter((link) => link.status === 'active').length;
  const footer = (
    <BottomNavigation
      activeKey="sheet"
      items={[
        { key: 'sheet', label: 'Ficha', icon: 'person', onPress: () => undefined },
        { key: 'table', label: 'Mesa', icon: 'dice', onPress: () => router.push(`/characters/${character.id}/table`) },
        { key: 'damage', label: 'Dano', icon: 'analytics', onPress: () => router.push(`/characters/${character.id}/analysis`) }
      ]}
    />
  );

  return (
    <Screen
      eyebrow={`Nível ${getTotalLevel(character)}`}
      title={getCharacterDisplayName(character)}
      subtitle={`${characterClassSummary(character)} · ${character.species?.name ?? 'espécie pendente'} · ${character.background?.name ?? 'background pendente'}`}
      onBack={() => router.replace('/')}
      footer={footer}
    >
      {progressionDraft ? (
        <Card
          variant="filled"
          title={progressionDraft.recovery.status === 'recoverable' ? 'Progressão recuperada' : progressionDraft.recovery.status === 'conflicted' ? 'Progressão com conflito' : 'Progressão em andamento'}
          subtitle={progressionDraft.recovery.status === 'active' ? 'A ficha publicada permanece protegida até o commit.' : progressionDraft.recovery.reason}
        >
          <Button label="Abrir central de progressão" icon="git-compare-outline" onPress={() => router.push(`/characters/${character.id}/progression`)} />
        </Card>
      ) : null}

      <Card variant="hero" title={completion === 1 ? 'Ficha essencial pronta' : next.label} subtitle={next.description}>
        <ProgressBar value={completion} showPercent />
        <Button label={next.label} icon="arrow-forward" onPress={() => router.push(next.route as never)} />
      </Card>

      {(character.pendingChoices ?? []).length ? (
        <Card variant="filled" title={`Escolhas pendentes (${character.pendingChoices?.length ?? 0})`} subtitle="A ficha foi preservada e pode ser concluída por partes.">
          {(character.pendingChoices ?? []).slice(0, 6).map((choice) => (
            <View key={choice.id} style={styles.summaryRow}>
              <View style={styles.flex}>
                <Text style={[styles.summaryValue, { color: colors.onSurface, textAlign: 'left' }]}>{choice.title}</Text>
                <Text style={[styles.summaryLabel, { color: colors.onSurfaceVariant }]}>{choice.description}</Text>
              </View>
              <Button label="Resolver" variant="text" onPress={() => router.push(pendingChoiceRoute(character.id, choice.kind) as never)} />
            </View>
          ))}
        </Card>
      ) : null}

      <View style={styles.metrics}>
        <MetricTile label="Nível" value={getTotalLevel(character)} supporting={`PB +${getProficiencyBonus(character)}`} />
        <MetricTile label="CA" value={getArmorClass(character)} />
        <MetricTile label="Iniciativa" value={`${getInitiative(character) >= 0 ? '+' : ''}${getInitiative(character)}`} />
      </View>

      <Card variant="filled" title="Dano por turno" subtitle={damageSummary ? damageSummary.rotation.name : 'Crie uma rotação para transformar ações em um turno completo.'}>
        {damageSummary ? (
          <>
            <Text style={[styles.damageValue, { color: colors.primary }]}>{formatNumber(damageSummary.result.weightedAverage ?? damageSummary.result.total.average)}</Text>
            <Text style={[styles.damageLabel, { color: colors.onSurfaceVariant }]}>{damageSummary.result.weightedAverage === undefined ? 'média bruta' : 'média ponderada por acerto'}</Text>
            <View style={styles.metrics}>
              <MetricTile label="Mínimo" value={formatNumber(damageSummary.result.total.min)} />
              <MetricTile label="Máximo" value={formatNumber(damageSummary.result.total.max)} />
              <MetricTile label="Ataques" value={damageSummary.result.attackCount} />
            </View>
            <Button label="Ver análise completa" icon="analytics-outline" variant="tonal" onPress={() => router.push(`/characters/${character.id}/analysis`)} />
          </>
        ) : (
          <Button label="Criar primeira rotação" icon="add" onPress={() => router.push(`/characters/${character.id}/rotations/new`)} />
        )}
      </Card>

      <Text style={[styles.sectionTitle, { color: colors.onSurface }]}>Construção do personagem</Text>
      <Card variant="outlined" title="Base da ficha" subtitle={`${importedCount} itens vinculados ao compêndio`}>
        <View style={styles.summaryRow}>
          <Text style={[styles.summaryLabel, { color: colors.onSurfaceVariant }]}>Classe</Text>
          <Text style={[styles.summaryValue, { color: colors.onSurface }]}>{characterClassSummary(character)}</Text>
        </View>
        <View style={styles.summaryRow}>
          <Text style={[styles.summaryLabel, { color: colors.onSurfaceVariant }]}>Espécie</Text>
          <Text style={[styles.summaryValue, { color: colors.onSurface }]}>{character.species?.name ?? 'Pendente'}</Text>
        </View>
        <View style={styles.summaryRow}>
          <Text style={[styles.summaryLabel, { color: colors.onSurfaceVariant }]}>Background</Text>
          <Text style={[styles.summaryValue, { color: colors.onSurface }]}>{character.background?.name ?? 'Pendente'}</Text>
        </View>
        <Button label="Adicionar do compêndio" icon="library-outline" onPress={() => router.push(`/characters/${character.id}/compendium`)} />
        <View style={styles.row}>
          <View style={styles.flex}><Button label="Identidade" icon="person-outline" variant="outlined" onPress={() => router.push(`/characters/${character.id}/identity`)} /></View>
          <View style={styles.flex}><Button label="Atributos" icon="options-outline" variant="outlined" onPress={() => router.push(`/characters/${character.id}/attributes`)} /></View>
        </View>
        <View style={styles.row}>
          <View style={styles.flex}><Button label="Equipamento" icon="shield-outline" variant="outlined" onPress={() => router.push(`/characters/${character.id}/equipment`)} /></View>
          <View style={styles.flex}><Button label="Magias" icon="sparkles-outline" variant="outlined" onPress={() => router.push(`/characters/${character.id}/spells`)} /></View>
        </View>
        <View style={styles.row}>
          <View style={styles.flex}><Button label="Proficiências" icon="school-outline" variant="outlined" onPress={() => router.push(`/characters/${character.id}/proficiencies`)} /></View>
          <View style={styles.flex}><Button label="Classes" icon="git-branch-outline" variant="outlined" onPress={() => router.push(`/characters/${character.id}/classes`)} /></View>
        </View>
        <View style={styles.row}>
          <View style={styles.flex}><Button label="Feats" icon="ribbon-outline" variant="outlined" onPress={() => router.push(`/characters/${character.id}/feats`)} /></View>
          <View style={styles.flex}><Button label="Features" icon="star-outline" variant="outlined" onPress={() => router.push(`/characters/${character.id}/features`)} /></View>
        </View>
        {character.classes.some((entry) => entry.name.toLowerCase() === 'warlock') ? (
          <>
          <View style={styles.row}>
            <View style={styles.flex}><Button label="Eldritch Invocations" icon="eye-outline" variant="outlined" onPress={() => router.push(`/characters/${character.id}/invocations`)} /></View>
            {pactOfTheBlade ? (
              <View style={styles.flex}><Button label="Pact Weapon" icon="flash-outline" variant="outlined" onPress={() => router.push(`/characters/${character.id}/pact-weapon`)} /></View>
            ) : null}
          </View>
          <View style={styles.row}>
            <View style={styles.flex}><Button label="Poderes de Warlock" icon="moon-outline" variant="outlined" onPress={() => router.push(`/characters/${character.id}/warlock-special`)} /></View>
            {character.companions?.length ? (
              <View style={styles.flex}><Button label="Pact Familiar" icon="paw-outline" variant="outlined" onPress={() => router.push(`/characters/${character.id}/familiar`)} /></View>
            ) : null}
          </View>
          </>
        ) : null}
      </Card>

      {subclassChoiceSummaries.length ? (
        <Card variant="outlined" title="Configuração de subclasse" subtitle="Escolhas internas que alteram como a subclasse funciona.">
          {subclassChoiceSummaries.map((summary) => (
            <View key={`${summary.subclassItemId}:${summary.title}`} style={styles.summaryRow}>
              <View style={styles.flex}>
                <Text style={[styles.summaryLabel, { color: colors.onSurfaceVariant }]}>{summary.subclassName} · {summary.title}</Text>
                <Text style={[styles.summaryValue, { color: summary.pending ? colors.error : colors.onSurface, textAlign: 'left' }]}>{summary.value ?? 'Configuração pendente'}</Text>
                {summary.detail ? <Text style={[styles.summaryLabel, { color: colors.onSurfaceVariant }]}>{summary.detail}</Text> : null}
              </View>
            </View>
          ))}
          <Button label="Abrir configurações de subclasse" variant="outlined" onPress={() => router.push(`/characters/${character.id}/classes`)} />
        </Card>
      ) : null}

      <Card variant="outlined" title="Combate tático" subtitle="Gerencie alvos persistentes, movimento, terreno difícil, masteries e itens no campo.">
        <Button label="Abrir combate tático" icon="map-outline" onPress={() => router.push(`/characters/${character.id}/tactical`)} />
      </Card>

      <Card variant="outlined" title="Compatibilidade de regras" subtitle={`Snapshot ${character.catalogSnapshotId ?? 'não registrado'} · diagnóstico ${compatibility.report?.status ?? 'indisponível'}`}>
        <Button label="Abrir manifesto da ficha" icon="shield-checkmark-outline" variant="outlined" onPress={() => router.push(`/characters/${character.id}/compatibility`)} />
      </Card>

      <Card variant="outlined" title="Evolução" subtitle="Suba de nível, resolva pendências e acompanhe as alterações da build.">
        <Button label={`Central de progressão${(character.pendingChoices ?? []).length ? ` · ${(character.pendingChoices ?? []).length} pendente(s)` : ''}`} icon="list-outline" onPress={() => router.push(`/characters/${character.id}/progression`)} />
        <Button label="Subir de nível" icon="trending-up" variant="outlined" onPress={() => router.push(`/characters/${character.id}/level-up`)} />
        <Button label="Histórico da build" icon="time-outline" variant="outlined" onPress={() => router.push(`/characters/${character.id}/history`)} />
      </Card>

      <Pressable accessibilityRole="button" accessibilityState={{ expanded: showMore }} onPress={() => setShowMore((current) => !current)} style={styles.moreHeader}>
        <View>
          <Text style={[styles.moreTitle, { color: colors.onSurface }]}>Opções avançadas</Text>
          <Text style={[styles.moreSubtitle, { color: colors.onSurfaceVariant }]}>Recursos, efeitos, presets, relatórios e manutenção</Text>
        </View>
        <View style={[styles.chevron, { backgroundColor: colors.surfaceContainer, borderRadius: radii.full }]}>
          <Ionicons name={showMore ? 'chevron-up' : 'chevron-down'} size={20} color={colors.onSurfaceVariant} />
        </View>
      </Pressable>

      {showMore ? (
        <Card variant="filled">
          <IssueList issues={validation.issues} />
          <Button label="Classes e multiclasse" variant="text" onPress={() => router.push(`/characters/${character.id}/classes`)} />
          <Button label="Recursos e descansos" variant="text" onPress={() => router.push(`/characters/${character.id}/resources`)} />
          <Button label="Efeitos ativos" variant="text" onPress={() => router.push(`/characters/${character.id}/effects`)} />
          <Button label="Efeitos derivados" variant="text" onPress={() => router.push(`/characters/${character.id}/derived-effects`)} />
          <Button label="Presets mecânicos" variant="text" onPress={() => router.push(`/characters/${character.id}/mechanic-presets`)} />
          <Button label="Presets de build" variant="text" onPress={() => router.push(`/characters/${character.id}/presets`)} />
          <Button label="Comparar rotações" variant="text" onPress={() => router.push(`/characters/${character.id}/comparison`)} />
          <Button label="Relatórios e exportação" variant="text" onPress={() => router.push(`/characters/${character.id}/report`)} />
          {confirmDelete ? (
            <View
              testID="delete-character-confirmation"
              accessibilityRole="alert"
              style={[styles.deleteConfirmation, { backgroundColor: colors.errorContainer, borderColor: colors.error, borderRadius: radii.lg }]}
            >
              <Text style={[styles.deleteTitle, { color: colors.error }]}>Excluir {getCharacterDisplayName(character)} permanentemente?</Text>
              <Text style={[styles.deleteDescription, { color: colors.onSurface }]}>A ficha, os cenários de combate e o histórico exclusivo deste personagem serão removidos deste dispositivo.</Text>
              {deleteError ? <Text style={[styles.deleteError, { color: colors.error }]}>{deleteError}</Text> : null}
              <View style={styles.row}>
                <View style={styles.flex}>
                  <Button testID="cancel-delete-character" label="Cancelar" variant="outlined" onPress={() => { setConfirmDelete(false); setDeleteError(undefined); }} />
                </View>
                <View style={styles.flex}>
                  <Button
                    testID="confirm-delete-character"
                    label="Excluir definitivamente"
                    icon="trash-outline"
                    variant="danger"
                    onPress={() => {
                      const result = deleteCharacterData(character.id);
                      if (!result.ok) {
                        setDeleteError('Não foi possível excluir o personagem. Tente novamente.');
                        return;
                      }
                      router.replace('/');
                    }}
                  />
                </View>
              </View>
            </View>
          ) : (
            <Button
              testID="delete-character-button"
              label="Excluir personagem"
              icon="trash-outline"
              variant="danger"
              onPress={() => { setDeleteError(undefined); setConfirmDelete(true); }}
            />
          )}
        </Card>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  metrics: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  damageValue: { fontSize: 44, lineHeight: 50, fontWeight: '900', letterSpacing: -1.2 },
  damageLabel: { marginTop: -8, fontSize: 12, lineHeight: 17, fontWeight: '700' },
  sectionTitle: { marginTop: 6, fontSize: 21, lineHeight: 27, fontWeight: '900' },
  summaryRow: { minHeight: 36, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 12 },
  summaryLabel: { fontSize: 14, lineHeight: 20 },
  summaryValue: { flex: 1, fontSize: 14, lineHeight: 20, fontWeight: '800', textAlign: 'right' },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  flex: { flex: 1, minWidth: 130 },
  moreHeader: { minHeight: 60, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, paddingHorizontal: 2 },
  moreTitle: { fontSize: 17, lineHeight: 23, fontWeight: '800' },
  moreSubtitle: { fontSize: 12, lineHeight: 17 },
  chevron: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  deleteConfirmation: { borderWidth: 1, padding: 16, gap: 10 },
  deleteTitle: { fontSize: 16, lineHeight: 22, fontWeight: '900' },
  deleteDescription: { fontSize: 13, lineHeight: 19 },
  deleteError: { fontSize: 13, lineHeight: 19, fontWeight: '800' }
});
