import { router, useLocalSearchParams } from 'expo-router';
import { useMemo, useState } from 'react';
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Button } from '../../../src/components/Button';
import { Card } from '../../../src/components/Card';
import { Chip } from '../../../src/components/Chip';
import { Field } from '../../../src/components/Field';
import { VirtualizedScreen } from '../../../src/components/VirtualizedScreen';
import { isFeatRepeatable, validateFeatPrerequisites, validateMulticlassPrerequisites } from '../../../src/characters/characterBuildRules';
import { isOriginFeatItem } from '../../../src/characters/creationData';
import { applyAutomaticClassProgression, getCompendiumClassReference, getSubclassUnlockLevel } from '../../../src/compendium/classProgression';
import { CompendiumItemType, StoredCompendiumItem } from '../../../src/compendium/types';
import { applyCharacterChoice } from '../../../src/catalog/characterChoiceApplication';
import { useCharacterChoiceBridge } from '../../../src/catalog/useCharacterChoiceBridge';
import { useCharacterProgressionSession } from '../../../src/characters/useCharacterProgressionSession';
import { useCompendiumStore } from '../../../src/store/compendiumStore';
import { useAppTheme } from '../../../src/theme';
import { getCharacterDisplayName } from '../../../src/ui/characterIdentity';
import { reconcileCharacterBuild } from '../../../src/characters/buildReconciliation';
import { applyAutomaticSpeciesProgression } from '../../../src/characters/speciesChoiceRules';

const getParam = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);
const typeOptions: Array<{ value: CompendiumItemType | 'all'; label: string }> = [
  { value: 'all', label: 'Todos' },
  { value: 'class', label: 'Classes' },
  { value: 'subclass', label: 'Subclasses' },
  { value: 'species', label: 'Espécies' },
  { value: 'background', label: 'Backgrounds' },
  { value: 'feat', label: 'Talentos' },
  { value: 'weapon', label: 'Armas' },
  { value: 'armor', label: 'Armaduras' },
  { value: 'magicItem', label: 'Itens mágicos' },
  { value: 'spell', label: 'Magias' },
  { value: 'feature', label: 'Features' }
];
const typeLabels: Record<string, string> = {
  class: 'Classe', subclass: 'Subclasse', species: 'Espécie', background: 'Background', feat: 'Talento',
  weapon: 'Arma', armor: 'Armadura', equipment: 'Equipamento', magicItem: 'Item mágico', spell: 'Magia', feature: 'Feature'
};

export default function CharacterCompendiumScreen() {
  const { colors, radii } = useAppTheme();
  const params = useLocalSearchParams();
  const id = getParam(params.id);
  const requestedType = getParam(params.type) as CompendiumItemType | undefined;
  const pendingId = getParam(params.pendingId);
  const progressionSession = useCharacterProgressionSession(id);
  const character = progressionSession.character;
  const updateCharacter = progressionSession.updateCharacter;
  const bridge = useCharacterChoiceBridge();
  const { items, searchItems, choiceForItemId } = bridge;
  const setItemStatus = useCompendiumStore((state) => state.setItemStatus);
  const isSaving = useCompendiumStore((state) => state.isSaving);
  const [search, setSearch] = useState('');
  const [activeType, setActiveType] = useState<CompendiumItemType | 'all'>(requestedType ?? 'all');
  const [showNeedsReview, setShowNeedsReview] = useState(false);
  const [showLinked, setShowLinked] = useState(false);
  const [showManual, setShowManual] = useState(false);
  const [lastAppliedItemId, setLastAppliedItemId] = useState<string>();

  const pendingChoice = character?.pendingChoices?.find((choice) => choice.id === pendingId);
  const pendingResolution = character && pendingChoice
    ? bridge.resolvePendingChoice(character, pendingChoice)
    : undefined;
  const pendingCandidateIds = useMemo(
    () => new Set(pendingResolution?.candidateChoices.map((choice) => choice.choiceId) ?? []),
    [pendingResolution]
  );
  const itemForReference = (reference: string | undefined): StoredCompendiumItem | undefined => {
    if (!reference) return undefined;
    const direct = items.find((candidate) => candidate.id === reference);
    if (direct) return direct;
    const choice = choiceForItemId(reference);
    return choice ? items.find((candidate) => candidate.id === choice.choiceId) : undefined;
  };
  const searchableItems = useMemo(
    () => searchItems(search, {
      types: activeType === 'all' ? undefined : [activeType]
    }).filter((item) => {
      if (item.type === 'condition') return false;
      const choice = choiceForItemId(item.id);
      if (!choice) return false;
      if (pendingResolution && !pendingCandidateIds.has(choice.choiceId)) return false;
      return showNeedsReview ? true : choice.available;
    }),
    [activeType, choiceForItemId, pendingCandidateIds, pendingResolution, search, searchItems, showNeedsReview]
  );

  if (!character || !id) return <VirtualizedScreen title="Personagem não encontrado" onBack={() => router.back()} data={[]} renderItem={() => null} />;

  const linkedItems = (character.compendiumLinks ?? [])
    .map((link) => ({ link, item: itemForReference(link.choiceId ?? link.itemId) }))
    .sort((left, right) => left.link.appliedEntityName.localeCompare(right.link.appliedEntityName));

  const applyItem = (item: StoredCompendiumItem) => {
    const choice = choiceForItemId(item.id);
    if (!choice) {
      Alert.alert('Escolha não resolvida', 'O item não possui identidade canônica na ponte do catálogo.');
      return;
    }
    if (!choice.available) {
      Alert.alert('Conteúdo indisponível', choice.blockedReasons.map((reason) => reason.message).join('\n'));
      return;
    }
    if (item.type === 'spell') {
      Alert.alert('Escolha a classe conjuradora', 'Adicione magias pela tela de Magias para aplicar lista, nível máximo e limites da classe.', [
        { text: 'Cancelar', style: 'cancel' },
        { text: 'Abrir Magias', onPress: () => router.push(`/characters/${character.id}/spells`) }
      ]);
      return;
    }

    const linkedClassEntries = character.classes.flatMap((classEntity) => {
      const link = (character.compendiumLinks ?? []).find((entry) => entry.appliedAs === 'class' && entry.appliedEntityId === classEntity.id && entry.status === 'active');
      const classItem = itemForReference(link?.choiceId ?? link?.itemId);
      return classItem ? [{ item: classItem, level: classEntity.level }] : [];
    });

    if (item.type === 'class') {
      const prerequisiteIssues = validateMulticlassPrerequisites([...linkedClassEntries.map((entry) => entry.item), item], character.abilities);
      if (prerequisiteIssues.length) {
        Alert.alert('Pré-requisito de multiclasse', prerequisiteIssues.map((issue) => issue.message).join('\n'));
        return;
      }
    }

    if (item.type === 'feat') {
      const currentCopies = (character.compendiumLinks ?? []).filter((link) => link.appliedAs === 'feat' && link.status === 'active' && (link.choiceId === choice.choiceId || link.catalogEntityId === choice.catalogEntityId || link.itemId === item.id || choice.provenance.legacyItemIds.includes(link.itemId))).length;
      const prerequisiteIssues = validateFeatPrerequisites({
        featItem: item,
        totalLevel: character.level,
        abilities: character.abilities,
        proficiencies: character.proficiencies,
        classEntries: linkedClassEntries,
        allItems: items,
        character,
        currentCopies
      });
      if (prerequisiteIssues.length) {
        Alert.alert('Pré-requisito do feat', prerequisiteIssues.map((issue) => issue.message).join('\n'));
        return;
      }
    }

    if (item.type === 'subclass') {
      const classReference = getCompendiumClassReference(item);
      const binding = linkedClassEntries.find(({ item: classItem }) => classItem.importItemId === classReference || classItem.id === classReference);
      if (!binding || binding.level < getSubclassUnlockLevel(item)) {
        Alert.alert('Subclasse indisponível', `${item.name} exige a classe-base no nível ${getSubclassUnlockLevel(item)} ou superior.`);
        return;
      }
    }

    const result = applyCharacterChoice({ character, choice });
    if (!result.ok) {
      Alert.alert('Não foi possível adicionar', result.issues.map((entry) => entry.message).join('\n'));
      return;
    }
    let next = result.character;
    if (item.type === 'subclass' && result.link) {
      const added = next.subclasses.find((subclass) => subclass.id === result.link?.appliedEntityId);
      if (added) {
        const replaced = new Set(character.subclasses.filter((subclass) => subclass.classId === added.classId).map((subclass) => subclass.id));
        next = { ...next, subclasses: next.subclasses.filter((subclass) => !replaced.has(subclass.id)), compendiumLinks: (next.compendiumLinks ?? []).map((link) => link.appliedAs === 'subclass' && replaced.has(link.appliedEntityId) && link.status === 'active' ? { ...link, status: 'removed' as const } : link) };
      }
    }
    if (isOriginFeatItem(item) && result.link) {
      const previous = character.originFeatId;
      if (previous && previous !== result.link.appliedEntityId) next = { ...next, feats: next.feats.filter((feat) => feat.id !== previous), compendiumLinks: (next.compendiumLinks ?? []).map((link) => link.appliedAs === 'feat' && link.appliedEntityId === previous && link.status === 'active' ? { ...link, status: 'removed' as const } : link) };
      next = { ...next, originFeatId: result.link.appliedEntityId };
    }
    if (item.type === 'class' || item.type === 'subclass') {
      next = applyAutomaticClassProgression(next, items).character;
    }
    if (item.type === 'species') {
      next = applyAutomaticSpeciesProgression(next, items).character;
    }
    next = reconcileCharacterBuild(next, items).character;
    if (pendingId) {
      next = { ...next, pendingChoices: (next.pendingChoices ?? []).filter((entry) => entry.id !== pendingId) };
    }
    updateCharacter(character.id, () => next);
    setLastAppliedItemId(item.id);
    if (result.issues.length) Alert.alert('Adicionado com avisos', result.issues.map((entry) => entry.message).join('\n'));
  };

  return (
    <VirtualizedScreen
      eyebrow={getCharacterDisplayName(character)}
      title="Adicionar conteúdo"
      subtitle="Consulte o catálogo oficial e o compêndio local na mesma lista, com filtros, proveniência e dependências preservados."
      onBack={() => router.push(progressionSession.hasActiveTransaction ? `/characters/${character.id}/progression` : `/characters/${character.id}`)}
      data={searchableItems}
      keyExtractor={(item) => item.id}
      initialNumToRender={12}
      headerContent={(
        <>
          {pendingResolution ? (
            <Card
              variant="hero"
              title={pendingChoice?.title ?? 'Escolha pendente'}
              subtitle={`${pendingResolution.availableCandidateChoices.length} opção(ões) aplicável(is) · ${pendingResolution.blockedCandidateChoices.length} bloqueada(s) · snapshot ${pendingResolution.catalogSnapshotId}`}
            >
              <Text style={[styles.summary, { color: colors.onSurfaceVariant }]}>{pendingChoice?.description}</Text>
            </Card>
          ) : null}
          <Field label="Buscar conteúdo" value={search} onChangeText={setSearch} placeholder="Nome da classe, magia, arma, talento..." />
          <View style={styles.chips}>
            {typeOptions.map((option) => <Chip key={option.value} label={option.label} selected={activeType === option.value} onPress={() => setActiveType(option.value)} />)}
          </View>
          <View style={styles.statusRow}>
            <Text style={[styles.resultCount, { color: colors.onSurfaceVariant }]}>{bridge.status === 'loading' ? 'Carregando catálogo e compêndio...' : `${searchableItems.length} resultado(s) virtualizados`}</Text>
            <Pressable accessibilityRole="checkbox" accessibilityState={{ checked: showNeedsReview }} accessibilityLabel="Mostrar itens pendentes de revisão" focusable onPress={() => setShowNeedsReview((current) => !current)} style={styles.reviewToggle}>
              <Ionicons name={showNeedsReview ? 'checkbox' : 'square-outline'} size={21} color={colors.primary} />
              <Text style={[styles.toggleLabel, { color: colors.primary }]}>Mostrar pendentes</Text>
            </Pressable>
          </View>
        </>
      )}
      renderItem={({ item }) => {
        const choice = choiceForItemId(item.id);
        if (!choice) return null;
        const activeLinkCount = (character.compendiumLinks ?? []).filter((link) => link.status === 'active' && (link.choiceId === choice.choiceId || link.catalogEntityId === choice.catalogEntityId || link.itemId === item.id || choice.provenance.legacyItemIds.includes(link.itemId))).length;
        const alreadyLinked = activeLinkCount > 0;
        const repeatable = item.type === 'feat' && isFeatRepeatable(item);
        const canApply = choice.available && (!alreadyLinked || repeatable);
        return (
          <Card variant="outlined" title={item.name} subtitle={`${typeLabels[item.type] ?? item.type} · ${choice.sourceLabel} · ${choice.origin === 'catalog' ? 'oficial' : 'local'}`}>
            {item.summary ? <Text style={[styles.summary, { color: colors.onSurfaceVariant }]}>{item.summary}</Text> : null}
            <View style={styles.itemMeta}>
              <View style={[styles.badge, { borderRadius: radii.full, backgroundColor: choice.available ? colors.successContainer : colors.warningContainer }]}>
                <Text style={{ color: choice.available ? colors.success : colors.warning, fontSize: 11, fontWeight: '900' }}>{choice.available ? (choice.manualReviewRequired ? 'DISPONÍVEL · REVISÃO' : 'DISPONÍVEL') : 'BLOQUEADO'}</Text>
              </View>
              {lastAppliedItemId === item.id || alreadyLinked ? <Text style={[styles.applied, { color: colors.success }]}>✓ Adicionado à ficha{activeLinkCount > 1 ? ` ×${activeLinkCount}` : ''}</Text> : null}
            </View>
            {choice.origin === 'compendium' && item.status === 'needsReview' && choice.compendiumItemId ? (
              <Button
                label="Revisar e validar item"
                icon="checkmark-circle-outline"
                variant="outlined"
                disabled={isSaving}
                onPress={async () => {
                  const result = await setItemStatus(choice.compendiumItemId!, 'validated');
                  if (!result.ok) Alert.alert('Item não validado', result.issues.map((entry) => entry.message).join('\n'));
                }}
              />
            ) : null}
            <View style={styles.actions}>
              <View style={styles.flex}><Button label="Detalhes" icon="information-circle-outline" variant="text" onPress={() => choice.origin === 'compendium' && choice.compendiumItemId ? router.push({ pathname: '/compendium/[itemId]', params: { itemId: choice.compendiumItemId } }) : Alert.alert(choice.name, [choice.summary, `Fonte: ${choice.sourceLabel}`, choice.manualReviewRequired ? 'Revisão editorial pendente.' : undefined].filter(Boolean).join('\n\n'))} /></View>
              <View style={styles.flex}><Button label={alreadyLinked && !repeatable ? 'Já adicionado' : repeatable && alreadyLinked ? 'Adicionar outra vez' : 'Adicionar'} icon="add" disabled={!canApply || isSaving || bridge.status !== 'ready'} onPress={() => applyItem(item)} /></View>
            </View>
          </Card>
        );
      }}
      emptyContent={(
        <Card variant="filled" title="Nenhum item disponível" subtitle="Ajuste os filtros de conteúdo ou revise a dependência que originou esta escolha.">
          <Button label="Abrir compêndio" icon="library-outline" onPress={() => router.push('/compendium')} />
        </Card>
      )}
      footerContent={(
        <>
          <Pressable accessibilityRole="button" accessibilityState={{ expanded: showLinked }} accessibilityLabel="Conteúdo já vinculado" focusable onPress={() => setShowLinked((current) => !current)} style={styles.disclosure}>
            <View>
              <Text style={[styles.disclosureTitle, { color: colors.onSurface }]}>Conteúdo já vinculado</Text>
              <Text style={[styles.disclosureSubtitle, { color: colors.onSurfaceVariant }]}>{linkedItems.length} item(ns) nesta ficha</Text>
            </View>
            <Ionicons name={showLinked ? 'chevron-up' : 'chevron-down'} size={21} color={colors.onSurfaceVariant} />
          </Pressable>
          {showLinked ? (
            <Card variant="filled">
              {linkedItems.length === 0 ? <Text style={[styles.summary, { color: colors.onSurfaceVariant }]}>Nenhum item vinculado ainda.</Text> : linkedItems.map(({ link, item }) => (
                <View key={link.id} style={[styles.linkedRow, { borderBottomColor: colors.outlineVariant }]}>
                  <Text style={[styles.linkedName, { color: colors.onSurface }]}>{link.appliedEntityName}</Text>
                  <Text style={[styles.linkedMeta, { color: colors.onSurfaceVariant }]}>{typeLabels[link.appliedAs] ?? link.appliedAs} · {item?.rawJson.source.book ?? link.sourceId}</Text>
                </View>
              ))}
            </Card>
          ) : null}

          <Pressable accessibilityRole="button" accessibilityState={{ expanded: showManual }} accessibilityLabel="Criar conteúdo personalizado" focusable onPress={() => setShowManual((current) => !current)} style={styles.disclosure}>
            <View>
              <Text style={[styles.disclosureTitle, { color: colors.onSurface }]}>Criar conteúdo personalizado</Text>
              <Text style={[styles.disclosureSubtitle, { color: colors.onSurfaceVariant }]}>Alternativa para conteúdo que ainda não foi importado</Text>
            </View>
            <Ionicons name={showManual ? 'chevron-up' : 'chevron-down'} size={21} color={colors.onSurfaceVariant} />
          </Pressable>
          {showManual ? (
            <Card variant="filled" subtitle="Entradas personalizadas ficam marcadas como manuais para não serem confundidas com regras validadas.">
              <Button label="Criar espécie ou background" icon="person-outline" variant="outlined" onPress={() => router.push(`/characters/${character.id}/identity`)} />
              <Button label="Criar classe manual" icon="create-outline" variant="outlined" onPress={() => router.push(`/characters/${character.id}/classes`)} />
              <Button label="Criar magia manual" icon="sparkles-outline" variant="outlined" onPress={() => router.push(`/characters/${character.id}/spells`)} />
              <Button label="Criar arma ou equipamento" icon="shield-outline" variant="outlined" onPress={() => router.push(`/characters/${character.id}/equipment`)} />
              <Button label="Criar feature ou recurso" icon="star-outline" variant="outlined" onPress={() => router.push(`/characters/${character.id}/features`)} />
            </Card>
          ) : null}
        </>
      )}
    />
  );
}

const styles = StyleSheet.create({
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  statusRow: { minHeight: 44, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 12 },
  resultCount: { fontSize: 13, lineHeight: 19, fontWeight: '700' },
  reviewToggle: { minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 7 },
  toggleLabel: { fontSize: 13, lineHeight: 18, fontWeight: '800' },
  summary: { fontSize: 14, lineHeight: 21 },
  itemMeta: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 10 },
  badge: { paddingHorizontal: 10, paddingVertical: 6 },
  applied: { fontSize: 12, lineHeight: 17, fontWeight: '900' },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  flex: { flex: 1, minWidth: 130 },
  disclosure: { minHeight: 60, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, paddingHorizontal: 2 },
  disclosureTitle: { fontSize: 16, lineHeight: 22, fontWeight: '800' },
  disclosureSubtitle: { fontSize: 12, lineHeight: 17 },
  linkedRow: { paddingVertical: 9, borderBottomWidth: StyleSheet.hairlineWidth, gap: 2 },
  linkedName: { fontSize: 14, lineHeight: 20, fontWeight: '800' },
  linkedMeta: { fontSize: 12, lineHeight: 17 }
});
