import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { Alert, StyleSheet, Text, View } from 'react-native';
import { Button } from '../../../src/components/Button';
import { Card } from '../../../src/components/Card';
import { Chip } from '../../../src/components/Chip';
import { ChoiceChipSelector } from '../../../src/components/ChoiceChipSelector';
import { Field } from '../../../src/components/Field';
import { MetricTile } from '../../../src/components/MetricTile';
import { PaginatedChipList } from '../../../src/components/PaginatedChipList';
import { getSpellChoiceInlineDescription, SpellChoiceDetails } from '../../../src/components/SpellChoiceDetails';
import { VirtualizedScreen } from '../../../src/components/VirtualizedScreen';
import {
  annotateLatestSpellWithClass,
  countCharacterSpellsForClass,
  getClassSpellcastingProfile,
  isSpellItemEligibleForProfile,
  spellItemLevel
} from '../../../src/characters/spellcastingRules';
import type { StoredCompendiumItem } from '../../../src/compendium/types';
import { manualSource } from '../../../src/data/mockData';
import { parseDamageFormula } from '../../../src/rules-engine/dice/parser';
import { isSpellSlotLevel, toSpellSlotLevel } from '../../../src/rules-engine/resources/spellSlotManager';
import { applyCharacterChoice } from '../../../src/catalog/characterChoiceApplication';
import { useCharacterChoiceBridge } from '../../../src/catalog/useCharacterChoiceBridge';
import { useCharacterProgressionSession } from '../../../src/characters/useCharacterProgressionSession';
import { useCompendiumStore } from '../../../src/store/compendiumStore';
import { useAppTheme } from '../../../src/theme';
import type { Character, Spell, SpellScalingRule } from '../../../src/types';
import { getCharacterDisplayName } from '../../../src/ui/characterIdentity';
import { createId } from '../../../src/utils/id';
import { reconcileCharacterBuild } from '../../../src/characters/buildReconciliation';
import { getSelectableSpellCandidates, itemReferenceMatches } from '../../../src/characters/creationData';
import {
  getSpellbookEntriesForClass,
  learnSpellbookSpell,
  prepareSpellbookSpell,
  removeSpellbookSpell,
  unprepareSpellbookSpell
} from '../../../src/characters/spellbookRules';
import { appendSpellChangeTransaction } from '../../../src/characters/spellChangeAudit';
import { getSpellListAdditionRules, getSpellReplacementRules } from '../../../src/characters/customRuleEffects';
import { spendResources } from '../../../src/rules-engine/resources/resourceManager';
import { getCharacterSubclassSpellListReferences } from '../../../src/characters/subclassChoiceRules';

const getId = (value: string | string[] | undefined) => Array.isArray(value) ? value[0] : value;
const DAMAGE_TYPES = ['acid', 'bludgeoning', 'cold', 'fire', 'force', 'lightning', 'necrotic', 'piercing', 'poison', 'psychic', 'radiant', 'slashing', 'thunder'] as const;

const parseSlotScaling = (baseLevel: number, baseFormula: string, text: string): SpellScalingRule | undefined => {
  const baseSlot = toSpellSlotLevel(baseLevel);
  if (!baseSlot || !text.trim() || !baseFormula.trim()) return undefined;
  const steps = [{ slotLevel: baseSlot, formula: parseDamageFormula(baseFormula, { defaultSourceType: 'spell' as const }) }];
  for (const entry of text.split(',')) {
    const [slotText, formulaText] = entry.split(':').map((part) => part?.trim());
    const slotLevel = toSpellSlotLevel(Number(slotText));
    if (slotLevel && formulaText) steps.push({ slotLevel, formula: parseDamageFormula(formulaText, { defaultSourceType: 'spell' }) });
  }
  return steps.length > 1 ? { kind: 'slotLevel', baseLevel: baseSlot, steps } : undefined;
};

const scalingTextFromSpell = (spell: Spell) =>
  (spell.scaling?.steps ?? [])
    .filter((step) => step.slotLevel !== undefined && step.slotLevel !== spell.level)
    .map((step) => `${step.slotLevel}:${step.formula.raw}`)
    .join(', ');

export default function SpellsScreen() {
  const { colors } = useAppTheme();
  const params = useLocalSearchParams();
  const id = getId(params.id);
  const pendingId = getId(params.pendingId);
  const progressionSession = useCharacterProgressionSession(id);
  const character = progressionSession.character;
  const updateCharacter = progressionSession.updateCharacter;
  const bridge = useCharacterChoiceBridge();
  const { items: compendiumItems, enabledSourceIds, choiceForItemId } = bridge;
  const updateItemsReview = useCompendiumStore((state) => state.updateItemsReview);

  const [search, setSearch] = useState('');
  const [compendiumSearch, setCompendiumSearch] = useState('');
  const [activeClassEntityId, setActiveClassEntityId] = useState<string>();
  const [replacementSpellId, setReplacementSpellId] = useState<string>();
  const [focusedCompendiumSpellId, setFocusedCompendiumSpellId] = useState<string>();
  const [showManual, setShowManual] = useState(false);
  const [editingSpellId, setEditingSpellId] = useState<string>();
  const [name, setName] = useState('');
  const [level, setLevel] = useState('0');
  const [school, setSchool] = useState('');
  const [range, setRange] = useState('');
  const [verbal, setVerbal] = useState(false);
  const [somatic, setSomatic] = useState(false);
  const [material, setMaterial] = useState(false);
  const [materialDescription, setMaterialDescription] = useState('');
  const [duration, setDuration] = useState('Instantaneous');
  const [description, setDescription] = useState('');
  const [formula, setFormula] = useState('');
  const [damageType, setDamageType] = useState('');
  const [targets, setTargets] = useState('1');
  const [area, setArea] = useState('');
  const [slotScaling, setSlotScaling] = useState('');
  const [upcastingDescription, setUpcastingDescription] = useState('');

  const pendingChoice = character?.pendingChoices?.find((choice) => choice.id === pendingId);
  const pendingResolution = character && pendingChoice ? bridge.resolvePendingChoice(character, pendingChoice) : undefined;
  const pendingCandidateIds = useMemo(() => new Set(pendingResolution?.candidateChoices.map((choice) => choice.choiceId) ?? []), [pendingResolution]);
  const itemForReference = (reference: string | undefined): StoredCompendiumItem | undefined => {
    if (!reference) return undefined;
    const direct = compendiumItems.find((candidate) => candidate.id === reference);
    if (direct) return direct;
    const choice = choiceForItemId(reference);
    return choice ? compendiumItems.find((candidate) => candidate.id === choice.choiceId) : undefined;
  };
  const isItemLinked = (item: StoredCompendiumItem): boolean => {
    const choice = choiceForItemId(item.id);
    if (!choice || !character) return false;
    return (character.compendiumLinks ?? []).some((link) => link.status === 'active' && (
      link.choiceId === choice.choiceId ||
      link.catalogEntityId === choice.catalogEntityId ||
      link.itemId === item.id ||
      choice.provenance.legacyItemIds.includes(link.itemId)
    ));
  };


  const classProfiles = useMemo(() => {
    if (!character) return [];
    return character.classes.flatMap((classEntity) => {
      const link = (character.compendiumLinks ?? []).find(
        (entry) => entry.appliedAs === 'class' && entry.appliedEntityId === classEntity.id && entry.status === 'active'
      );
      const classItem = itemForReference(link?.choiceId ?? link?.itemId);
      const profile = classItem ? getClassSpellcastingProfile(classItem, classEntity.level) : undefined;
      return profile ? [{ ...profile, classEntityId: classEntity.id }] : [];
    });
  }, [character, compendiumItems]);

  useEffect(() => {
    if (!classProfiles.length) setActiveClassEntityId(undefined);
    else {
      const preferred = pendingChoice?.sourceEntityId && classProfiles.some((profile) => profile.classEntityId === pendingChoice.sourceEntityId)
        ? pendingChoice.sourceEntityId
        : undefined;
      if (preferred && activeClassEntityId !== preferred) {
        setActiveClassEntityId(preferred);
        setReplacementSpellId(undefined);
      } else if (!activeClassEntityId || !classProfiles.some((profile) => profile.classEntityId === activeClassEntityId)) {
        setActiveClassEntityId(classProfiles[0]?.classEntityId);
        setReplacementSpellId(undefined);
      }
    }
  }, [classProfiles, activeClassEntityId, pendingChoice?.sourceEntityId]);

  const activeProfile = classProfiles.find((profile) => profile.classEntityId === activeClassEntityId);
  const customReplacementRules = character && activeProfile
    ? getSpellReplacementRules(character, activeProfile.className)
    : [];
  const activeCustomReplacementRule = customReplacementRules.find((entry) => entry.available);
  const customSpellListReferences = useMemo(() => {
    if (!character || !activeProfile) return [];
    return Array.from(new Set([
      ...getSpellListAdditionRules(character, activeProfile.className).flatMap((entry) => entry.rule.spellItemIds),
      ...getCharacterSubclassSpellListReferences(character, compendiumItems, activeProfile.classEntityId)
    ]));
  }, [character, activeProfile?.className, activeProfile?.classEntityId, compendiumItems]);
  const activeReplacementChoice = (character?.pendingChoices ?? []).find(
    (choice) => choice.kind === 'spellReplacement' && choice.status === 'pending' && choice.sourceEntityId === activeClassEntityId
  );
  const activeSelectionChoice = (character?.pendingChoices ?? []).find(
    (choice) => choice.kind === 'spellSelection' && choice.status === 'pending' && choice.sourceEntityId === activeClassEntityId
  );
  const activeSpellbookEntries = character && activeClassEntityId
    ? getSpellbookEntriesForClass(character, activeClassEntityId)
    : [];
  const replaceableClassSpells = (character?.spells ?? []).filter(
    (spell) => spell.spellcastingClassId === activeClassEntityId
  );
  const selectableCompendiumSpells = useMemo(
    () => getSelectableSpellCandidates(compendiumItems, enabledSourceIds),
    [compendiumItems, enabledSourceIds]
  );
  const availableCompendiumSpells = useMemo(() => {
    if (!activeProfile) return [];
    const query = compendiumSearch.trim().toLowerCase();
    return selectableCompendiumSpells
      .filter((item) => {
        const customEligible = customSpellListReferences.some((reference) => itemReferenceMatches(item, reference));
        const profileEligible = isSpellItemEligibleForProfile(item, activeProfile, customSpellListReferences);
        const pendingEligible = !pendingResolution || pendingCandidateIds.has(item.id) || customEligible;
        return profileEligible && pendingEligible;
      })
      .filter((item) => !query || item.name.toLowerCase().includes(query));
  }, [activeProfile, compendiumSearch, selectableCompendiumSpells, customSpellListReferences, pendingCandidateIds, pendingResolution]);
  const availableCantrips = availableCompendiumSpells.filter((item) => spellItemLevel(item) === 0);
  const availableSlottedSpells = availableCompendiumSpells.filter((item) => spellItemLevel(item) > 0);
  const focusedCompendiumSpell = focusedCompendiumSpellId
    ? compendiumItems.find((item) => item.id === focusedCompendiumSpellId)
    : undefined;

  const visibleSpells = useMemo(() => {
    if (!character) return [];
    const query = search.trim().toLowerCase();
    return character.spells.filter((spell) => !query || [spell.name, spell.school, spell.description].some((value) => value?.toLowerCase().includes(query)));
  }, [character, search]);

  if (!character || !id) return <VirtualizedScreen title="Personagem não encontrado" onBack={() => router.back()} data={[]} renderItem={() => null} />;

  const activeCounts = activeProfile
    ? countCharacterSpellsForClass(character.spells, activeProfile.classEntityId)
    : { cantrips: 0, prepared: 0 };

  const reset = () => {
    setName('');
    setLevel('0');
    setSchool('');
    setRange('');
    setVerbal(false);
    setSomatic(false);
    setMaterial(false);
    setMaterialDescription('');
    setDuration('Instantaneous');
    setDescription('');
    setFormula('');
    setDamageType('');
    setTargets('1');
    setArea('');
    setSlotScaling('');
    setUpcastingDescription('');
    setEditingSpellId(undefined);
    setShowManual(false);
  };

  const edit = (spell: Spell) => {
    setEditingSpellId(spell.id);
    setName(spell.name);
    setLevel(String(spell.level));
    setSchool(spell.school ?? '');
    setRange(spell.range ?? '');
    setVerbal(spell.components?.verbal ?? false);
    setSomatic(spell.components?.somatic ?? false);
    setMaterial(spell.components?.material ?? false);
    setMaterialDescription(spell.components?.materialDescription ?? '');
    setDuration(spell.duration ?? 'Instantaneous');
    setDescription(spell.description ?? '');
    setFormula(spell.damage?.raw ?? '');
    setDamageType(spell.damageType ?? '');
    setTargets(String(spell.targeting?.targets ?? 1));
    setArea(spell.targeting?.area ?? '');
    setSlotScaling(scalingTextFromSpell(spell));
    setUpcastingDescription(spell.upcastingDescription ?? '');
    setActiveClassEntityId(spell.spellcastingClassId ?? activeClassEntityId);
    setShowManual(true);
  };

  const save = () => {
    if (!name.trim()) return;
    const spellLevel = Math.max(0, Math.min(9, Number(level) || 0));
    const classProfile = classProfiles.find((profile) => profile.classEntityId === activeClassEntityId);
    const spell: Spell = {
      id: editingSpellId ?? createId('spell'),
      name: name.trim(),
      level: spellLevel,
      school: school.trim() || undefined,
      castingTime: 'action',
      range: range.trim() || undefined,
      components: { verbal, somatic, material, materialDescription: materialDescription.trim() || undefined },
      duration: duration.trim() || undefined,
      description: description.trim() || undefined,
      upcastingDescription: upcastingDescription.trim() || undefined,
      requiresAttackRoll: Boolean(formula.trim()),
      targeting: { targets: Math.max(1, Number(targets) || 1), area: area.trim() || undefined },
      damage: formula.trim() ? parseDamageFormula(formula, { defaultSourceType: 'spell' }) : undefined,
      damageType: damageType || undefined,
      scaling: formula.trim() ? parseSlotScaling(spellLevel, formula, slotScaling) : undefined,
      concentration: /concentration/i.test(duration),
      source: manualSource,
      spellcastingClassId: classProfile?.classEntityId,
      spellcastingClassName: classProfile?.className,
      prepared: true
    };
    updateCharacter(id, (current) => {
      const updated = {
        ...current,
        spells: editingSpellId
          ? current.spells.map((entry) => entry.id === editingSpellId ? spell : entry)
          : [...current.spells, spell],
        compendiumLinks: editingSpellId
          ? (current.compendiumLinks ?? []).map((link) =>
              link.appliedAs === 'spell' && link.appliedEntityId === editingSpellId && link.status === 'active'
                ? { ...link, status: 'removed' as const }
                : link
            )
          : current.compendiumLinks
      };
      return reconcileCharacterBuild(updated, compendiumItems).character;
    });
    reset();
  };

  const addImportedSpell = async (item: StoredCompendiumItem) => {
    if (!activeProfile) return;
    const choice = choiceForItemId(item.id);
    if (!choice || !choice.available) {
      Alert.alert('Magia indisponível', choice?.blockedReasons.map((reason) => reason.message).join('\n') ?? 'A magia não foi resolvida pela ponte do catálogo.');
      return;
    }
    if (item.status !== 'validated') {
      if (choice.origin !== 'compendium' || !choice.compendiumItemId) {
        Alert.alert('Revisão editorial', 'Conteúdo oficial com revisão pendente pode ser usado, mas não altera o compêndio local.');
      } else {
        const review = await updateItemsReview([{
          itemId: choice.compendiumItemId,
          update: {
            status: 'validated',
            reviewDecision: 'approved',
            reviewedBy: 'Escolha explícita na tela de magias',
            reviewNotes: 'Aprovado ao ser escolhido explicitamente para a ficha.'
          }
        }]);
        if (!review.ok) {
          Alert.alert('Não foi possível validar a magia', review.issues.map((issue) => issue.message).join('\n'));
          return;
        }
      }
    }
    const levelValue = spellItemLevel(item);
    if (activeProfile.preparationMode === 'spellbook' && levelValue > 0) {
      const alreadyLearned = activeSpellbookEntries.some((entry) => entry.spellItemId === item.id);
      if (alreadyLearned) {
        Alert.alert('Magia já está no spellbook', `${item.name} já foi registrada para ${activeProfile.className}.`);
        return;
      }
      let next = learnSpellbookSpell({
        character,
        spellItem: item,
        profile: activeProfile,
        classEntityId: activeProfile.classEntityId,
        acquisition: activeSelectionChoice ? 'levelUp' : 'copied',
        source: activeSelectionChoice ? 'levelUp' : 'manual'
      });
      next = {
        ...next,
        catalogSnapshotId: choice.catalogSnapshotId ?? next.catalogSnapshotId
      };
      next = reconcileCharacterBuild(next, compendiumItems).character;
      updateCharacter(id, () => next);
      return;
    }
    const count = levelValue === 0 ? activeCounts.cantrips : activeCounts.prepared;
    const limit = levelValue === 0 ? activeProfile.cantripLimit : activeProfile.preparedSpellLimit;
    const atLimit = count >= limit;
    const canFreelyReplace = activeProfile.preparationMode === 'prepared' || activeProfile.preparationMode === 'spellbook';
    const canUseLevelUpReplacement = Boolean(activeReplacementChoice);
    const canUseCustomReplacement = Boolean(activeCustomReplacementRule);

    if (atLimit && !replacementSpellId) {
      Alert.alert(
        'Escolha uma magia para trocar',
        canFreelyReplace
          ? `Selecione uma magia de ${activeProfile.className} na área de troca antes de adicionar ${item.name}.`
          : canUseLevelUpReplacement
            ? `A troca de nível está disponível. Selecione uma magia conhecida antes de adicionar ${item.name}.`
            : canUseCustomReplacement
              ? `${activeCustomReplacementRule?.binding.ownerName} permite uma troca. Selecione uma magia conhecida antes de adicionar ${item.name}.`
              : `${activeProfile.className} atingiu o limite e não possui uma troca disponível.`
      );
      return;
    }
    if (atLimit && !canFreelyReplace && !canUseLevelUpReplacement && !canUseCustomReplacement) {
      Alert.alert('Troca indisponível', 'Classes de repertório só podem trocar magia quando houver uma troca de nível ou uma regra personalizada disponível.');
      return;
    }

    let base = character;
    if (replacementSpellId) {
      const replacement = base.spells.find((spell) => spell.id === replacementSpellId && spell.spellcastingClassId === activeProfile.classEntityId);
      if (!replacement) {
        Alert.alert('Magia de troca inválida', 'Selecione uma magia da mesma classe conjuradora.');
        return;
      }
      base = {
        ...base,
        spells: base.spells.filter((spell) => spell.id !== replacement.id),
        compendiumLinks: (base.compendiumLinks ?? []).map((link) =>
          link.appliedAs === 'spell' && link.appliedEntityId === replacement.id && link.status === 'active'
            ? { ...link, status: 'removed' as const }
            : link
        )
      };
    }

    const result = applyCharacterChoice({ character: base, choice });
    if (!result.ok) {
      Alert.alert('Magia não adicionada', result.issues.map((issue) => issue.message).join('\n'));
      return;
    }
    let next = annotateLatestSpellWithClass(base, result.character, activeProfile.classEntityId, activeProfile.className, activeProfile.ability);
    const replacement = replacementSpellId ? character.spells.find((spell) => spell.id === replacementSpellId) : undefined;
    const replacementLink = replacement
      ? (character.compendiumLinks ?? []).find((link) => link.appliedAs === 'spell' && link.appliedEntityId === replacement.id && link.status === 'active')
      : undefined;
    next = appendSpellChangeTransaction(next, {
      classEntityId: activeProfile.classEntityId,
      className: activeProfile.className,
      classLevel: activeProfile.classLevel,
      kind: replacement ? 'replaced' : 'learned',
      spellItemId: item.id,
      spellName: item.name,
      replacedSpellItemId: replacementLink?.itemId,
      replacedSpellName: replacement?.name,
      source: activeReplacementChoice || activeSelectionChoice ? 'levelUp' : activeCustomReplacementRule && replacement ? 'feature' : 'manual'
    });
    if (replacementSpellId && activeReplacementChoice) {
      next = {
        ...next,
        pendingChoices: (next.pendingChoices ?? []).filter((choice) => choice.id !== activeReplacementChoice.id)
      };
    }
    if (replacement && !canFreelyReplace && !activeReplacementChoice && activeCustomReplacementRule) {
      const spent = spendResources({
        character: next,
        costs: [{
          resourceId: activeCustomReplacementRule.rule.resourceId,
          amount: 1,
          label: activeCustomReplacementRule.rule.label ?? activeCustomReplacementRule.binding.ownerName
        }],
        reason: `Troca de magia por ${activeCustomReplacementRule.binding.ownerName}`
      });
      if (!spent.issues.some((issue) => issue.severity === 'error')) next = spent.character;
    }
    next = reconcileCharacterBuild(next, compendiumItems).character;
    updateCharacter(id, () => next);
    setReplacementSpellId(undefined);
  };

  const remove = (spell: Spell) => Alert.alert(
    'Remover magia?',
    spell.name,
    [
      { text: 'Cancelar', style: 'cancel' },
      {
        text: 'Remover',
        style: 'destructive',
        onPress: () => updateCharacter(id, (current) => {
          const link = (current.compendiumLinks ?? []).find((entry) => entry.appliedAs === 'spell' && entry.appliedEntityId === spell.id && entry.status === 'active');
          let next: Character = {
            ...current,
            spells: current.spells.filter((entry) => entry.id !== spell.id),
            compendiumLinks: (current.compendiumLinks ?? []).map((entry) =>
              entry.appliedAs === 'spell' && entry.appliedEntityId === spell.id && entry.status === 'active'
                ? { ...entry, status: 'removed' as const }
                : entry
            )
          };
          next = appendSpellChangeTransaction(next, {
            classEntityId: spell.spellcastingClassId,
            className: spell.spellcastingClassName,
            classLevel: current.classes.find((entry) => entry.id === spell.spellcastingClassId)?.level,
            kind: 'removed',
            spellItemId: link?.itemId,
            spellName: spell.name,
            source: 'manual'
          });
          return reconcileCharacterBuild(next, compendiumItems).character;
        })
      }
    ]
  );

  const invalidSlot = Number(level) > 0 && !isSpellSlotLevel(Number(level));
  const cantrips = character.spells.filter((spell) => spell.level === 0).length;
  const spellRows = [
    ...(activeProfile?.preparationMode === 'spellbook'
      ? activeSpellbookEntries.map((entry) => ({ kind: 'spellbook' as const, id: `spellbook:${entry.id}`, entry }))
      : []),
    ...visibleSpells.map((spell) => ({ kind: 'spell' as const, id: `spell:${spell.id}`, spell }))
  ];

  return (
    <VirtualizedScreen
      eyebrow={getCharacterDisplayName(character)}
      title="Magias"
      subtitle="Listas de classe, nível máximo e limites conhecidos/preparados são aplicados às magias importadas."
      onBack={() => router.push(progressionSession.hasActiveTransaction ? `/characters/${character.id}/progression` : `/characters/${character.id}`)}
      data={spellRows}
      keyExtractor={(row) => row.id}
      initialNumToRender={12}
      maxToRenderPerBatch={14}
      headerContent={(
        <>
          {pendingResolution ? (
            <Card variant="hero" title={pendingChoice?.title ?? 'Escolha de magia pendente'} subtitle={`${pendingResolution.availableCandidateChoices.length} opção(ões) aplicável(is) · ${pendingResolution.blockedCandidateChoices.length} bloqueada(s)`}>
              <Text style={{ color: colors.onSurfaceVariant }}>{pendingChoice?.description}</Text>
            </Card>
          ) : null}
          <View style={styles.metrics}>
            <MetricTile label="Total" value={character.spells.length} />
            <MetricTile label="Cantrips" value={cantrips} />
            <MetricTile label="Preparadas/conhecidas" value={character.spells.length - cantrips} />
            <MetricTile label="Spellbook" value={(character.spellbookEntries ?? []).length} />
          </View>

          <Card variant="hero" title="Adicionar do compêndio" subtitle="Escolha a classe conjuradora antes da magia.">
            <View style={styles.chips}>
              {classProfiles.map((profile) => (
                <Chip key={profile.classEntityId} label={profile.className} selected={activeClassEntityId === profile.classEntityId} onPress={() => { setActiveClassEntityId(profile.classEntityId); setReplacementSpellId(undefined); }} />
              ))}
            </View>
            {activeProfile ? (
              <>
                <Text style={{ color: colors.onSurfaceVariant }}>
                  Modo {activeProfile.preparationMode} · cantrips {activeCounts.cantrips}/{activeProfile.cantripLimit} · magias ativas {activeCounts.prepared}/{activeProfile.preparedSpellLimit}{activeProfile.preparationMode === 'spellbook' ? ` · spellbook ${activeSpellbookEntries.length}/${activeProfile.spellbookMinimumSpellCount}+` : ''} · nível máximo {activeProfile.maxSpellLevel}
                </Text>
                {(activeProfile.preparationMode === 'prepared' || activeReplacementChoice || activeCustomReplacementRule) && replaceableClassSpells.length ? (
                  <Card variant="outlined" title="Trocar magia" subtitle={activeReplacementChoice ? activeReplacementChoice.description : activeCustomReplacementRule ? `${activeCustomReplacementRule.binding.ownerName}: ${activeCustomReplacementRule.resource?.current ?? 0}/${activeCustomReplacementRule.resource?.max ?? activeCustomReplacementRule.rule.count} uso(s) disponíveis; recarga em ${activeCustomReplacementRule.rule.recharge === 'longRest' ? 'descanso longo' : activeCustomReplacementRule.rule.recharge === 'shortRest' ? 'descanso curto' : 'recarga manual'}.` : 'Selecione uma magia atual e depois a substituta no compêndio.'}>
                    <View style={styles.chips}>
                      {replaceableClassSpells.map((spell) => <Chip key={`replace-${spell.id}`} label={spell.name} selected={replacementSpellId === spell.id} onPress={() => setReplacementSpellId((current) => current === spell.id ? undefined : spell.id)} />)}
                    </View>
                    {replacementSpellId ? <Text style={{ color: colors.warning }}>A próxima magia adicionada substituirá {replaceableClassSpells.find((spell) => spell.id === replacementSpellId)?.name}.</Text> : null}
                  </Card>
                ) : null}
                <Field label="Buscar no compêndio" value={compendiumSearch} onChangeText={setCompendiumSearch} />
                {focusedCompendiumSpell && isSpellItemEligibleForProfile(focusedCompendiumSpell, activeProfile, customSpellListReferences) ? (
                  <SpellChoiceDetails
                    item={focusedCompendiumSpell}
                    selected={
                      activeProfile.preparationMode === 'spellbook' && spellItemLevel(focusedCompendiumSpell) > 0
                        ? activeSpellbookEntries.some((entry) => entry.spellItemId === focusedCompendiumSpell.id)
                        : isItemLinked(focusedCompendiumSpell)
                    }
                    selectionLabel={
                      activeProfile.preparationMode === 'spellbook' && spellItemLevel(focusedCompendiumSpell) > 0
                        ? activeSpellbookEntries.some((entry) => entry.spellItemId === focusedCompendiumSpell.id)
                          ? 'Registrada no spellbook'
                          : 'Detalhes da última magia tocada'
                        : isItemLinked(focusedCompendiumSpell)
                          ? 'Adicionada à ficha'
                          : 'Detalhes da última magia tocada'
                    }
                  />
                ) : null}
                <Text style={{ color: colors.onSurface, fontWeight: '900' }}>Cantrips</Text>
                <PaginatedChipList
                  items={availableCantrips}
                  keyExtractor={(item) => `cantrip-${item.id}`}
                  labelForItem={(item) => item.name}
                  isSelected={(item) => isItemLinked(item)}
                  descriptionForSelectedItem={getSpellChoiceInlineDescription}
                  isDisabled={(item) => isItemLinked(item)}
                  onPressItem={(item) => { setFocusedCompendiumSpellId(item.id); void addImportedSpell(item); }}
                  pageSize={24}
                  resetKey={`${activeProfile.classEntityId}:cantrip:${compendiumSearch}`}
                  emptyText={`Nenhum cantrip de ${activeProfile.className} encontrado.`}
                />
                <Text style={{ color: colors.onSurface, fontWeight: '900' }}>Magias com slot</Text>
                <PaginatedChipList
                  items={availableSlottedSpells}
                  keyExtractor={(item) => `slotted-${item.id}`}
                  labelForItem={(item) => `${activeProfile.preparationMode === 'spellbook' ? 'Copiar · ' : ''}${item.name} · nv ${spellItemLevel(item)}`}
                  isSelected={(item) => activeProfile.preparationMode === 'spellbook'
                    ? activeSpellbookEntries.some((entry) => entry.spellItemId === item.id)
                    : isItemLinked(item)}
                  descriptionForSelectedItem={getSpellChoiceInlineDescription}
                  isDisabled={(item) => activeProfile.preparationMode === 'spellbook'
                    ? activeSpellbookEntries.some((entry) => entry.spellItemId === item.id)
                    : isItemLinked(item)}
                  onPressItem={(item) => { setFocusedCompendiumSpellId(item.id); void addImportedSpell(item); }}
                  pageSize={24}
                  resetKey={`${activeProfile.classEntityId}:slotted:${compendiumSearch}`}
                  emptyText={`Nenhuma magia com slot de ${activeProfile.className} encontrada.`}
                />
              </>
            ) : <Text style={{ color: colors.onSurfaceVariant }}>Nenhuma classe conjuradora importada foi encontrada.</Text>}
          </Card>

          {activeProfile?.preparationMode === 'spellbook' ? (
            <Card variant="hero" title={`Spellbook de ${activeProfile.className}`} subtitle={`Preparadas: ${activeSpellbookEntries.filter((entry) => entry.prepared).length}/${activeProfile.preparedSpellLimit} · Registradas: ${activeSpellbookEntries.length}. Os registros aparecem primeiro na lista virtualizada.`} />
          ) : null}

          {(character.pendingChoices ?? []).filter((entry) => entry.kind === 'spellReplacement' || entry.kind === 'spellSelection').length ? (
            <Card variant="filled" title="Escolhas de magia pendentes" subtitle="Remova e adicione magias nesta tela para concluir as trocas e seleções permitidas.">
              {(character.pendingChoices ?? []).filter((entry) => entry.kind === 'spellReplacement' || entry.kind === 'spellSelection').map((entry) => <Text key={entry.id} style={{ color: colors.onSurfaceVariant }}>• {entry.title}: {entry.description}</Text>)}
            </Card>
          ) : null}

          {character.spells.length ? <Field label="Buscar na ficha" value={search} onChangeText={setSearch} /> : null}
          <Card title="Magias e spellbook" subtitle={`${spellRows.length} registro(s) em lista virtualizada.`} />
        </>
      )}
      renderItem={({ item: row }) => {
        if (row.kind === 'spellbook') {
          const entry = row.entry;
          const spellItem = itemForReference(entry.spellItemId);
          if (!activeProfile) return null;
          return (
            <Card variant="outlined" title={entry.spellName} subtitle={`Spellbook · nível ${entry.spellLevel} · ${entry.acquisition} · ${entry.prepared ? 'preparada' : 'não preparada'}`}>
              <View style={styles.actions}>
                <View style={styles.flex}>
                  <Button label={entry.prepared ? 'Despreparar' : 'Preparar'} variant="outlined" onPress={() => {
                    let next = character;
                    if (entry.prepared) {
                      next = unprepareSpellbookSpell({ character: next, spellItemId: entry.spellItemId, classEntityId: activeProfile.classEntityId, className: activeProfile.className, classLevel: activeProfile.classLevel, source: 'manual' });
                    } else {
                      if (activeSpellbookEntries.filter((candidate) => candidate.prepared).length >= activeProfile.preparedSpellLimit) {
                        Alert.alert('Limite de preparação', `Desprepare uma magia antes de preparar ${entry.spellName}.`);
                        return;
                      }
                      if (!spellItem) return;
                      next = prepareSpellbookSpell({ character: next, spellItem, profile: activeProfile, classEntityId: activeProfile.classEntityId, source: 'manual' });
                    }
                    updateCharacter(id, () => reconcileCharacterBuild(next, compendiumItems).character);
                  }} />
                </View>
                <View style={styles.flex}>
                  <Button label="Remover do spellbook" variant="text" onPress={() => Alert.alert('Remover do spellbook?', entry.spellName, [{ text: 'Cancelar', style: 'cancel' }, { text: 'Remover', style: 'destructive', onPress: () => updateCharacter(id, () => reconcileCharacterBuild(removeSpellbookSpell(character, entry.id), compendiumItems).character) }])} />
                </View>
              </View>
            </Card>
          );
        }

        const spell = row.spell;
        return (
          <Card variant="outlined" title={spell.name} subtitle={`${spell.level === 0 ? 'Cantrip' : `Nível ${spell.level}`} · ${spell.school ?? 'Escola não definida'} · ${spell.spellcastingClassName ?? 'sem classe associada'}`}>
            <Text style={{ color: colors.primary, fontWeight: '900' }}>{spell.damage?.raw ?? 'Sem dano direto'}</Text>
            <Text style={{ color: colors.onSurfaceVariant }}>{spell.range ?? 'alcance não definido'} · {spell.targeting?.area || `${spell.targeting?.targets ?? 1} alvo(s)`} · {spell.duration ?? 'duração não definida'}</Text>
            {spell.description ? <Text>{spell.description}</Text> : null}
            <View style={styles.actions}>
              <View style={styles.flex}><Button label="Editar" variant="outlined" onPress={() => edit(spell)} /></View>
              <View style={styles.flex}><Button label="Remover" variant="text" onPress={() => remove(spell)} /></View>
            </View>
          </Card>
        );
      }}
      emptyContent={<Card variant="filled" title="Nenhuma magia na ficha" subtitle="Adicione pelo compêndio ou crie uma magia manual." />}
      footerContent={(
        <>
          {(character.spellChangeTransactions ?? []).length ? (
            <Card variant="filled" title="Histórico recente de magias" subtitle="Auditoria de aprendizado, cópia, preparação e troca.">
              {(character.spellChangeTransactions ?? []).slice(-8).reverse().map((entry) => <Text key={entry.id} style={{ color: colors.onSurfaceVariant }}>• {entry.kind}: {entry.spellName}{entry.replacedSpellName ? ` no lugar de ${entry.replacedSpellName}` : ''} · nível {entry.characterLevel}</Text>)}
            </Card>
          ) : null}

          <Button label={showManual ? 'Cancelar edição/criação' : 'Criar magia manual'} variant="text" onPress={() => showManual ? reset() : setShowManual(true)} />
          {showManual ? (
            <Card variant="outlined" title={editingSpellId ? 'Editar magia' : 'Magia personalizada'}>
              <Field label="Nome" value={name} onChangeText={setName} />
              <Field label="Nível" value={level} onChangeText={setLevel} keyboardType="number-pad" errorText={invalidSlot ? 'Use 0 a 9.' : undefined} />
              <Field label="Escola de magia" value={school} onChangeText={setSchool} />
              <Field label="Alcance" value={range} onChangeText={setRange} />
              <View style={styles.chips}>
                <Chip label="V" accessibilityLabel="Componente verbal" selected={verbal} onPress={() => setVerbal((value) => !value)} />
                <Chip label="S" accessibilityLabel="Componente somático" selected={somatic} onPress={() => setSomatic((value) => !value)} />
                <Chip label="M" accessibilityLabel="Componente material" selected={material} onPress={() => setMaterial((value) => !value)} />
              </View>
              {material ? <Field label="Componente material" value={materialDescription} onChangeText={setMaterialDescription} /> : null}
              <Field label="Duração" value={duration} onChangeText={setDuration} />
              <Field label="Descrição" value={description} onChangeText={setDescription} multiline style={styles.textarea} />
              <Field label="Dano Base" value={formula} onChangeText={setFormula} />
              <ChoiceChipSelector
                title="Tipo de dano"
                options={DAMAGE_TYPES}
                selectedValues={damageType ? [damageType] : []}
                maximumSelections={1}
                onChange={(values) => setDamageType(values[0] ?? '')}
                supportingText="Necessário para que feats/features personalizadas por tipo de dano sejam aplicadas automaticamente."
                testIDPrefix="manual-spell-damage-type"
              />
              <Field label="Quantidade de alvos" value={targets} onChangeText={setTargets} keyboardType="number-pad" />
              <Field label="Área de efeito" value={area} onChangeText={setArea} />
              <Field label="Escala por slot/upcasting" value={slotScaling} onChangeText={setSlotScaling} placeholder="2:4d6, 3:5d6" />
              <Field label="Descrição do upcasting" value={upcastingDescription} onChangeText={setUpcastingDescription} multiline style={styles.textareaSmall} />
              <Button label={editingSpellId ? 'Salvar alterações' : 'Adicionar magia manual'} onPress={save} disabled={!name.trim() || invalidSlot} />
            </Card>
          ) : null}
        </>
      )}
    />
  );
}

const styles = StyleSheet.create({
  metrics: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  actions: { flexDirection: 'row', gap: 10 },
  flex: { flex: 1 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  textarea: { minHeight: 120, textAlignVertical: 'top' },
  textareaSmall: { minHeight: 80, textAlignVertical: 'top' }
});
