import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { Alert, StyleSheet, Text, View } from 'react-native';
import { Button } from '../../../src/components/Button';
import { Card } from '../../../src/components/Card';
import { ChoiceChipSelector } from '../../../src/components/ChoiceChipSelector';
import { Chip } from '../../../src/components/Chip';
import { IssueList } from '../../../src/components/IssueList';
import { MetricTile } from '../../../src/components/MetricTile';
import { PaginatedChipList } from '../../../src/components/PaginatedChipList';
import { PaginatedOptionCardList } from '../../../src/components/PaginatedOptionCardList';
import { EldritchInvocationChoiceEditor } from '../../../src/components/EldritchInvocationChoiceEditor';
import { VirtualizedScreen } from '../../../src/components/VirtualizedScreen';
import {
  applyFeatChoiceEffects,
  emptyFeatChoice,
  getFeatChoiceSchema,
  getFeatGenericSpellChoiceCount,
  isSpellItemEligibleForGenericFeatChoice,
  isWeaponItemEligibleForMastery,
  recalculateCharacterAbilities,
  validateFeatChoice,
  validateFeatChoiceUniqueness
} from '../../../src/characters/featChoiceRules';
import { reconcileCharacterBuild } from '../../../src/characters/buildReconciliation';
import { describeCustomModifier } from '../../../src/characters/customModifierRules';
import { getCompendiumChoiceDescription, getSelectableSpellCandidates } from '../../../src/characters/creationData';
import { spellItemClasses, spellItemLevel } from '../../../src/characters/spellcastingRules';
import { SKILLS } from '../../../src/characters/proficiencies';
import { ALL_TOOL_OPTIONS } from '../../../src/characters/choiceOptions';
import {
  getEldritchAdeptInvocationCandidates,
  getFightingStyleFeatChoiceCandidates
} from '../../../src/characters/featSubchoiceRules';
import {
  describeFeatOption,
  findFeatOptionDefinition,
  getMartialAdeptManeuverOptions,
  getMetamagicFeatOptions
} from '../../../src/characters/featOptionCatalog';
import { getEldritchInvocationMinimumLevel } from '../../../src/characters/eldritchInvocationRules';
import { useCharacterChoiceBridge } from '../../../src/catalog/useCharacterChoiceBridge';
import { useCharacterProgressionSession } from '../../../src/characters/useCharacterProgressionSession';
import { useAppTheme } from '../../../src/theme';
import type { AbilityScore, Character, CharacterFeatChoice, Feat } from '../../../src/types';
import type { StoredCompendiumItem } from '../../../src/compendium/types';
import { ABILITY_ORDER } from '../../../src/characters/abilityGeneration';
import { getCharacterDisplayName } from '../../../src/ui/characterIdentity';

const getId = (value: string | string[] | undefined) => Array.isArray(value) ? value[0] : value;
const normalize = (value: string): string => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase();
const asRecord = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};

export default function FeatsScreen() {
  const { colors } = useAppTheme();
  const params = useLocalSearchParams();
  const id = getId(params.id);
  const pendingId = getId(params.pendingId);
  const requestedEditFeatId = getId(params.editFeatId);
  const progressionSession = useCharacterProgressionSession(id);
  const character = progressionSession.character;
  const updateCharacter = progressionSession.updateCharacter;
  const bridge = useCharacterChoiceBridge();
  const { items, enabledSourceIds, choiceForItemId } = bridge;
  const [editingFeatId, setEditingFeatId] = useState<string>();
  const [draft, setDraft] = useState<CharacterFeatChoice>();


  const pendingChoice = character?.pendingChoices?.find((choice) => choice.id === pendingId);
  const pendingResolution = character && pendingChoice ? bridge.resolvePendingChoice(character, pendingChoice) : undefined;
  const pendingCandidateIds = useMemo(() => new Set(pendingResolution?.candidateChoices.map((choice) => choice.choiceId) ?? []), [pendingResolution]);
  const itemForReference = (reference: string | undefined): StoredCompendiumItem | undefined => {
    if (!reference) return undefined;
    const direct = items.find((candidate) => candidate.id === reference);
    if (direct) return direct;
    const choice = choiceForItemId(reference);
    if (!choice) return undefined;
    return items.find((candidate) => candidate.id === choice.compendiumItemId)
      ?? items.find((candidate) => candidate.id === choice.choiceId)
      ?? items.find((candidate) => choice.provenance.legacyItemIds.includes(candidate.id));
  };
  const spells = useMemo(() => getSelectableSpellCandidates(items, enabledSourceIds).filter((item) => !pendingResolution || pendingCandidateIds.has(item.id)), [items, enabledSourceIds, pendingCandidateIds, pendingResolution]);
  const weapons = useMemo(() => items.filter((item) => item.type === 'weapon' && item.status === 'validated' && (!pendingResolution || pendingCandidateIds.has(item.id))), [items, pendingCandidateIds, pendingResolution]);

  useEffect(() => {
    if (!character || !requestedEditFeatId || editingFeatId) return;
    const feat = character.feats.find((entry) => entry.id === requestedEditFeatId);
    if (!feat) return;
    const link = (character.compendiumLinks ?? []).find((entry) => entry.appliedAs === 'feat' && entry.appliedEntityId === feat.id && entry.status === 'active');
    const item = itemForReference(link?.choiceId ?? link?.itemId);
    if (!item || !getFeatChoiceSchema(item).kinds.length) return;
    const existing = (character.featChoices ?? []).find((entry) => entry.featEntityId === feat.id);
    setEditingFeatId(feat.id);
    setDraft(existing ?? emptyFeatChoice(item.id, feat.id, (character.featChoices ?? []).filter((entry) => entry.featItemId === item.id).length));
  }, [character?.id, requestedEditFeatId, editingFeatId, items]);

  if (!character || !id) return <VirtualizedScreen title="Personagem não encontrado" onBack={() => router.back()} data={[]} renderItem={() => null} />;

  const origin = character.feats.find((feat) => feat.id === character.originFeatId);
  const featData = character.feats.map((feat) => {
    const link = (character.compendiumLinks ?? []).find((entry) => entry.appliedAs === 'feat' && entry.appliedEntityId === feat.id && entry.status === 'active');
    const item = itemForReference(link?.choiceId ?? link?.itemId);
    const choice = (character.featChoices ?? []).find((entry) => entry.featEntityId === feat.id);
    return { feat, item, choice };
  });

  const openEditor = (feat: Feat, itemId?: string) => {
    const item = itemForReference(itemId);
    if (!item) return;
    const existing = (character.featChoices ?? []).find((entry) => entry.featEntityId === feat.id);
    setEditingFeatId(feat.id);
    setDraft(existing ?? emptyFeatChoice(item.id, feat.id, (character.featChoices ?? []).filter((entry) => entry.featItemId === item.id).length));
  };

  const saveChoice = () => {
    const row = featData.find(({ feat }) => feat.id === editingFeatId);
    if (!row?.item || !draft) return;
    const withoutCurrent = recalculateCharacterAbilities({
      ...character,
      featChoices: (character.featChoices ?? []).filter((entry) => entry.featEntityId !== row.feat.id)
    });
    const siblingChoices = (character.featChoices ?? []).filter(
      (entry) => entry.featItemId === row.item?.id && entry.featEntityId !== row.feat.id
    );
    const issues = [
      ...validateFeatChoice(row.item, draft, withoutCurrent.abilities, items, withoutCurrent),
      ...validateFeatChoiceUniqueness(row.item, draft, siblingChoices)
    ];
    if (issues.length) {
      Alert.alert('Escolhas incompletas', issues.map((entry) => entry.message).join('\n'));
      return;
    }
    let next = applyFeatChoiceEffects(character, row.item, { ...draft, featEntityId: row.feat.id, featItemId: row.item.id }, items);
    next = reconcileCharacterBuild(next, items).character;
    if (pendingId) next = { ...next, pendingChoices: (next.pendingChoices ?? []).filter((choice) => choice.id !== pendingId) };
    updateCharacter(id, () => next);
    setEditingFeatId(undefined);
    setDraft(undefined);
  };

  const removeFeat = (feat: Feat) => Alert.alert(
    feat.id === character.originFeatId ? 'Remover Origin Feat?' : 'Remover feat?',
    feat.name,
    [
      { text: 'Cancelar', style: 'cancel' },
      {
        text: 'Remover',
        style: 'destructive',
        onPress: () => updateCharacter(id, (current) => {
          const customResourceIds = new Set((feat.features ?? []).flatMap((feature) =>
            (feature.customRules?.spellReplacement ?? []).map((rule) => rule.resourceId)
          ));
          let next: Character = {
            ...current,
            feats: current.feats.filter((entry) => entry.id !== feat.id),
            featChoices: (current.featChoices ?? []).filter((entry) => entry.featEntityId !== feat.id),
            originFeatId: current.originFeatId === feat.id ? undefined : current.originFeatId,
            resources: current.resources.filter((resource) => !customResourceIds.has(resource.id)),
            compendiumLinks: (current.compendiumLinks ?? []).map((link) =>
              link.appliedAs === 'feat' && link.appliedEntityId === feat.id && link.status === 'active'
                ? { ...link, status: 'removed' as const }
                : link
            )
          };
          next = recalculateCharacterAbilities(next);
          return reconcileCharacterBuild(next, items).character;
        })
      }
    ]
  );

  const editingRow = featData.find(({ feat }) => feat.id === editingFeatId);
  const schema = editingRow?.item ? getFeatChoiceSchema(editingRow.item) : undefined;
  const choice = draft;
  const effectiveGenericSpellChoiceCount = schema ? getFeatGenericSpellChoiceCount(schema, character) : 0;
  const selectedSpellList = normalize(choice?.spellList ?? 'all');
  const allowedSpellLists = schema
    ? schema.allowCombinedSpellLists && selectedSpellList === 'all'
      ? schema.spellListOptions.map(normalize)
      : selectedSpellList && selectedSpellList !== 'all'
        ? [selectedSpellList]
        : schema.spellListOptions.map(normalize)
    : [];
  const spellChoices = editingRow?.item && schema && choice ? spells.filter((spell) => {
    const level = spellItemLevel(spell);
    if (level !== 0 && level !== 1) return false;
    if (allowedSpellLists.length) {
      const classes = spellItemClasses(spell).map(normalize);
      if (!classes.some((className) => allowedSpellLists.includes(className))) return false;
    }
    if (schema.spellChoiceSchools.length && level === 1) {
      const school = String(asRecord(spell.normalizedJson).school ?? '');
      if (!schema.spellChoiceSchools.map(normalize).includes(normalize(school))) return false;
    }
    return true;
  }) : [];
  const cantripChoices = spellChoices.filter((spell) => spellItemLevel(spell) === 0);
  const levelOneSpellChoices = spellChoices.filter((spell) => spellItemLevel(spell) === 1);
  const genericSpellChoices = effectiveGenericSpellChoiceCount > 0 && schema
    ? spells.filter((spell) => isSpellItemEligibleForGenericFeatChoice(spell, schema))
    : [];
  const validateItemForSelection = async (item: StoredCompendiumItem, label: string): Promise<boolean> => {
    const catalogChoice = choiceForItemId(item.id);
    if (!catalogChoice || !catalogChoice.available) {
      Alert.alert(`${label} indisponível`, catalogChoice?.blockedReasons.map((entry) => entry.message).join('\n') ?? `${item.name} não está disponível para uso na ficha.`);
      return false;
    }
    return true;
  };

  const validateSpellForSelection = async (spell: StoredCompendiumItem): Promise<boolean> =>
    validateItemForSelection(spell, 'Magia');

  const toggleDraftSpell = async (spell: StoredCompendiumItem) => {
    if (!choice || !schema) return;
    const selected = (choice.spellItemIds ?? []).includes(spell.id);
    if (!selected && !(await validateSpellForSelection(spell))) return;
    if (!selected && effectiveGenericSpellChoiceCount > 0 && (choice.spellItemIds ?? []).length >= effectiveGenericSpellChoiceCount) return;
    if (effectiveGenericSpellChoiceCount <= 0) {
      const selectedAtLevel = (choice.spellItemIds ?? []).filter((spellId) =>
        spellItemLevel(items.find((item) => item.id === spellId) ?? spell) === spellItemLevel(spell)
      ).length;
      const limit = spellItemLevel(spell) === 0 ? schema.cantripChoiceCount : schema.level1SpellChoiceCount;
      if (!selected && selectedAtLevel >= limit) return;
    }
    setDraft({
      ...choice,
      spellItemIds: selected
        ? (choice.spellItemIds ?? []).filter((entry) => entry !== spell.id)
        : [...(choice.spellItemIds ?? []), spell.id]
    });
  };

  const masteryWeaponChoices = schema?.weaponMasteryChoiceCount
    ? weapons
        .filter((weapon) => isWeaponItemEligibleForMastery(character, weapon))
        .filter((weapon) => Boolean(String(asRecord(weapon.normalizedJson).mastery ?? '').trim()))
        .slice(0, 80)
    : [];
  const fightingStyleChoices = schema?.fightingStyleChoiceCount && editingRow
    ? getFightingStyleFeatChoiceCandidates(items, enabledSourceIds, character, editingRow.feat.id)
    : [];
  const eldritchAdeptInvocationChoices = schema?.eldritchInvocationChoiceCount && editingRow
    ? getEldritchAdeptInvocationCandidates(items, enabledSourceIds, character, editingRow.feat.id)
    : [];
  const metamagicChoices = schema?.metamagicChoiceCount
    ? getMetamagicFeatOptions(enabledSourceIds)
    : [];
  const maneuverChoices = schema?.maneuverChoiceCount
    ? getMartialAdeptManeuverOptions(enabledSourceIds)
    : [];
  const knownWarlockCantripItemIds = character.spells
    .filter((spell) => spell.level === 0 && normalize(spell.spellcastingClassName ?? '') === 'warlock')
    .flatMap((spell) => {
      const link = (character.compendiumLinks ?? []).find((entry) => entry.appliedAs === 'spell' && entry.appliedEntityId === spell.id && entry.status === 'active');
      return link?.itemId ? [link.itemId] : [];
    });

  return (
    <VirtualizedScreen
      eyebrow={getCharacterDisplayName(character)}
      title="Feats"
      subtitle="Adicione, configure, troque ou remova feats sem recriar o personagem."
      onBack={() => router.push(progressionSession.hasActiveTransaction ? `/characters/${character.id}/progression` : `/characters/${character.id}`)}
      data={featData}
      keyExtractor={({ feat }) => feat.id}
      initialNumToRender={8}
      headerContent={(
        <>
          {pendingResolution ? (
            <Card variant="hero" title={pendingChoice?.title ?? 'Escolha pendente'} subtitle={`${pendingResolution.availableCandidateChoices.length} opção(ões) aplicável(is) pelo catálogo`}>
              <Text style={{ color: colors.onSurfaceVariant }}>{pendingChoice?.description}</Text>
            </Card>
          ) : null}
          <View style={styles.metrics}>
            <MetricTile label="Total" value={character.feats.length} />
            <MetricTile label="Origin Feat" value={origin?.name ?? 'Pendente'} />
            <MetricTile label="Escolhas pendentes" value={(character.pendingChoices ?? []).filter((entry) => entry.kind === 'feat' || entry.kind === 'featOptions').length} />
          </View>
          <Card variant="hero" title="Adicionar ou trocar">
            <Button label="Procurar feats disponíveis" onPress={() => router.push(`/characters/${character.id}/compendium?type=feat${pendingId ? `&pendingId=${encodeURIComponent(pendingId)}` : ''}`)} />
            <Button label="Criar feat personalizado" secondary onPress={() => router.push(`/characters/${character.id}/custom-rule?kind=feat`)} />
          </Card>

          {editingRow?.item && schema && choice ? (
            <Card variant="hero" title={`Configurar ${editingRow.feat.name}`} subtitle="As alterações mecânicas serão recalculadas ao salvar.">
              {schema.asiMode ? (
                <>
                  <View style={styles.chips}>
                    <Chip label="+2 em uma" selected={Object.values(choice.abilityScoreIncreases ?? {}).includes(2)} onPress={() => setDraft({ ...choice, abilityScoreIncreases: { STR: 2 } })} />
                    <Chip label="+1 em duas" selected={Object.values(choice.abilityScoreIncreases ?? {}).filter((value) => value === 1).length === 2} onPress={() => setDraft({ ...choice, abilityScoreIncreases: { STR: 1, DEX: 1 } })} />
                  </View>
                  <View style={styles.chips}>{ABILITY_ORDER.map((ability) => {
                    const plusTwo = Object.values(choice.abilityScoreIncreases ?? {}).includes(2);
                    const selected = Boolean(choice.abilityScoreIncreases?.[ability]);
                    return <Chip key={ability} label={`${ability}${selected ? ` +${choice.abilityScoreIncreases?.[ability]}` : ''}`} selected={selected} onPress={() => {
                      if (plusTwo) setDraft({ ...choice, abilityScoreIncreases: { [ability]: 2 } });
                      else {
                        const selectedAbilities = ABILITY_ORDER.filter((entry) => Boolean(choice.abilityScoreIncreases?.[entry]));
                        const nextAbilities = selectedAbilities.includes(ability) ? selectedAbilities.filter((entry) => entry !== ability) : [...selectedAbilities.slice(-1), ability];
                        setDraft({ ...choice, abilityScoreIncreases: Object.fromEntries(nextAbilities.map((entry) => [entry, 1])) });
                      }
                    }} />;
                  })}</View>
                </>
              ) : schema.abilityOptions.length && schema.abilityIncreaseAmount > 0 ? <View style={styles.chips}>{schema.abilityOptions.map((ability) => <Chip key={ability} label={`${ability} +${schema.abilityIncreaseAmount}`} selected={Boolean(choice.abilityScoreIncreases?.[ability])} onPress={() => setDraft({ ...choice, abilityScoreIncreases: { [ability]: schema.abilityIncreaseAmount } })} />)}</View> : null}
              {schema.skillChoiceCount > 0 ? (
                <ChoiceChipSelector
                  title="Perícias"
                  options={SKILLS}
                  selectedValues={choice.skills ?? []}
                  maximumSelections={schema.skillChoiceCount}
                  onChange={(skills) => setDraft({ ...choice, skills })}
                  testIDPrefix={`feat-edit-${editingRow.feat.id}-skill`}
                />
              ) : null}
              {schema.mixedSkillToolChoiceCount > 0 ? <>
                <ChoiceChipSelector
                  title="Perícias"
                  options={SKILLS}
                  selectedValues={choice.skills ?? []}
                  maximumSelections={schema.mixedSkillToolChoiceCount}
                  totalSelectionCount={(choice.skills?.length ?? 0) + (choice.tools?.length ?? 0)}
                  onChange={(skills) => setDraft({ ...choice, skills })}
                  supportingText="A soma entre perícias e ferramentas deve atingir o total indicado."
                  testIDPrefix={`feat-edit-${editingRow.feat.id}-mixed-skill`}
                />
                <ChoiceChipSelector
                  title="Ferramentas"
                  options={schema.toolOptions.length ? schema.toolOptions : ALL_TOOL_OPTIONS}
                  selectedValues={choice.tools ?? []}
                  maximumSelections={schema.mixedSkillToolChoiceCount}
                  totalSelectionCount={(choice.skills?.length ?? 0) + (choice.tools?.length ?? 0)}
                  onChange={(tools) => setDraft({ ...choice, tools })}
                  supportingText="Escolha qualquer combinação válida até completar o total."
                  testIDPrefix={`feat-edit-${editingRow.feat.id}-mixed-tool`}
                />
              </> : null}
              {schema.expertiseChoiceCount > 0 ? (
                <ChoiceChipSelector
                  title="Expertise"
                  options={Array.from(new Set([...character.proficiencies.skills, ...(choice.skills ?? [])]))}
                  selectedValues={choice.expertiseSkills ?? []}
                  maximumSelections={schema.expertiseChoiceCount}
                  onChange={(expertiseSkills) => setDraft({ ...choice, expertiseSkills })}
                  emptyText="Escolha primeiro uma perícia em que o personagem seja proficiente."
                  testIDPrefix={`feat-edit-${editingRow.feat.id}-expertise`}
                />
              ) : null}
              {schema.toolChoiceCount > 0 ? (
                <ChoiceChipSelector
                  title="Ferramentas"
                  options={schema.toolOptions}
                  selectedValues={choice.tools ?? []}
                  maximumSelections={schema.toolChoiceCount}
                  onChange={(tools) => setDraft({ ...choice, tools })}
                  testIDPrefix={`feat-edit-${editingRow.feat.id}-tool`}
                />
              ) : null}
              {schema.languageChoiceCount > 0 ? (
                <ChoiceChipSelector
                  title="Idiomas"
                  options={schema.languageOptions}
                  selectedValues={choice.languages ?? []}
                  maximumSelections={schema.languageChoiceCount}
                  onChange={(languages) => setDraft({ ...choice, languages })}
                  testIDPrefix={`feat-edit-${editingRow.feat.id}-language`}
                />
              ) : null}
              {schema.fightingStyleChoiceCount > 0 ? (
                <>
                  <Text style={{ color: colors.onSurface, fontWeight: '800' }}>Fighting Style ({choice.fightingStyleItemId ? 1 : 0}/{schema.fightingStyleChoiceCount})</Text>
                  <PaginatedOptionCardList
                    items={fightingStyleChoices}
                    keyExtractor={(style) => `fighting-style-${style.id}`}
                    titleForItem={(style) => style.name}
                    descriptionForItem={getCompendiumChoiceDescription}
                    metaForItem={(style) => choice.fightingStyleItemId === style.id ? 'Selecionado' : 'Toque para selecionar'}
                    isSelected={(style) => choice.fightingStyleItemId === style.id}
                    onPressItem={(style) => {
                      void (async () => {
                        if (choice.fightingStyleItemId !== style.id && !(await validateItemForSelection(style, 'Fighting Style'))) return;
                        setDraft({ ...choice, fightingStyleItemId: choice.fightingStyleItemId === style.id ? undefined : style.id });
                      })();
                    }}
                    pageSize={10}
                    resetKey={`${editingRow.feat.id}:fighting-style:${choice.fightingStyleItemId ?? 'none'}`}
                    emptyText="Nenhum Fighting Style elegível foi encontrado."
                  />
                </>
              ) : null}
              {schema.eldritchInvocationChoiceCount > 0 ? (
                <>
                  <Text style={{ color: colors.onSurface, fontWeight: '800' }}>Eldritch Invocation ({choice.eldritchInvocationItemId ? 1 : 0}/{schema.eldritchInvocationChoiceCount})</Text>
                  <PaginatedOptionCardList
                    items={eldritchAdeptInvocationChoices}
                    keyExtractor={(invocation) => `eldritch-adept-${invocation.id}`}
                    titleForItem={(invocation) => invocation.name}
                    descriptionForItem={getCompendiumChoiceDescription}
                    metaForItem={(invocation) => choice.eldritchInvocationItemId === invocation.id
                      ? 'Selecionada por Eldritch Adept'
                      : `Nível mínimo ${getEldritchInvocationMinimumLevel(invocation)} · toque para selecionar`}
                    isSelected={(invocation) => choice.eldritchInvocationItemId === invocation.id}
                    onPressItem={(invocation) => {
                      void (async () => {
                        if (choice.eldritchInvocationItemId !== invocation.id && !(await validateItemForSelection(invocation, 'Eldritch Invocation'))) return;
                        setDraft({
                          ...choice,
                          eldritchInvocationItemId: invocation.id,
                          eldritchInvocationChoice: choice.eldritchInvocationItemId === invocation.id ? choice.eldritchInvocationChoice : undefined
                        });
                      })();
                    }}
                    pageSize={10}
                    resetKey={`${editingRow.feat.id}:eldritch-adept:${choice.eldritchInvocationItemId ?? 'none'}`}
                    emptyText="Nenhuma Eldritch Invocation elegível foi encontrada. Invocations com pré-requisito exigem Warlock que cumpra o pré-requisito."
                  />
                  {choice.eldritchInvocationItemId ? (
                    <EldritchInvocationChoiceEditor
                      items={items}
                      enabledSourceIds={enabledSourceIds}
                      selectedCounts={{ [choice.eldritchInvocationItemId]: 1 }}
                      choices={choice.eldritchInvocationChoice ? [{ ...choice.eldritchInvocationChoice, invocationItemId: choice.eldritchInvocationItemId, instanceIndex: 0 }] : []}
                      onChange={(invocationChoices) => setDraft({ ...choice, eldritchInvocationChoice: invocationChoices[0] })}
                      knownWarlockCantripItemIds={knownWarlockCantripItemIds}
                      selectedOriginFeatItemIds={(character.compendiumLinks ?? [])
                        .filter((link) => link.appliedAs === 'feat' && link.appliedEntityId === character.originFeatId && link.status === 'active')
                        .map((link) => link.itemId)}
                      onBeforeSelectItem={(item) => validateItemForSelection(item, item.type === 'spell' ? 'Magia' : item.type === 'feat' ? 'Feat' : 'Conteúdo')}
                    />
                  ) : null}
                </>
              ) : null}
              {schema.skillUpgradeOptions.length ? <><Text style={{ color: colors.onSurface, fontWeight: '800' }}>Aprimorar perícia</Text><View style={styles.chips}>{schema.skillUpgradeOptions.map((skill) => <Chip key={`upgrade-${skill}`} label={skill} selected={choice.skillUpgrade === skill} onPress={() => setDraft({ ...choice, skillUpgrade: skill })} />)}</View></> : null}
              {schema.weaponMasteryChoiceCount > 0 ? <>
                <Text style={{ color: colors.onSurface, fontWeight: '800' }}>Maestria de arma ({choice.weaponMasterySelections?.length ?? 0}/{schema.weaponMasteryChoiceCount})</Text>
                <PaginatedChipList
                  items={masteryWeaponChoices}
                  keyExtractor={(weapon) => `mastery-${weapon.id}`}
                  labelForItem={(weapon) => `${weapon.name} · ${String(asRecord(weapon.normalizedJson).mastery ?? '')}`}
                  isSelected={(weapon) => (choice.weaponMasterySelections ?? []).some((entry) => entry.weaponItemId === weapon.id)}
                  onPressItem={(weapon) => {
                    const mastery = String(asRecord(weapon.normalizedJson).mastery ?? '');
                    const existing = choice.weaponMasterySelections ?? [];
                    const selected = existing.some((entry) => entry.weaponItemId === weapon.id);
                    if (selected) setDraft({ ...choice, weaponMasterySelections: existing.filter((entry) => entry.weaponItemId !== weapon.id) });
                    else setDraft({ ...choice, weaponMasterySelections: [...existing.slice(-(schema.weaponMasteryChoiceCount - 1)), { id: '', sourceKind: 'feat', weaponItemId: weapon.id, weaponName: weapon.name, mastery }] });
                  }}
                  pageSize={18}
                  resetKey={`${editingRow.feat.id}:${choice.weaponMasterySelections?.length ?? 0}`}
                />
              </> : null}
              {schema.metamagicChoiceCount > 0 ? (
                <>
                  <Text style={{ color: colors.onSurface, fontWeight: '800' }}>Metamagic ({choice.metamagicOptionIds?.length ?? 0}/{schema.metamagicChoiceCount})</Text>
                  <PaginatedOptionCardList
                    items={metamagicChoices}
                    keyExtractor={(option) => `metamagic-${option.id}`}
                    titleForItem={(option) => option.name}
                    descriptionForItem={describeFeatOption}
                    metaForItem={(option) => (choice.metamagicOptionIds ?? []).includes(option.id) ? 'Selecionado' : 'Toque para selecionar'}
                    isSelected={(option) => (choice.metamagicOptionIds ?? []).includes(option.id)}
                    isDisabled={(option) => !(choice.metamagicOptionIds ?? []).includes(option.id) && (choice.metamagicOptionIds ?? []).length >= schema.metamagicChoiceCount}
                    onPressItem={(option) => {
                      const selected = choice.metamagicOptionIds ?? [];
                      setDraft({
                        ...choice,
                        metamagicOptionIds: selected.includes(option.id)
                          ? selected.filter((id) => id !== option.id)
                          : [...selected, option.id]
                      });
                    }}
                    pageSize={10}
                    resetKey={`${editingRow.feat.id}:metamagic:${choice.metamagicOptionIds?.join('|') ?? ''}`}
                    emptyText="Nenhuma opção de Metamagic disponível."
                  />
                </>
              ) : null}
              {schema.maneuverChoiceCount > 0 ? (
                <>
                  <Text style={{ color: colors.onSurface, fontWeight: '800' }}>Battle Master Maneuvers ({choice.maneuverOptionIds?.length ?? 0}/{schema.maneuverChoiceCount})</Text>
                  <PaginatedOptionCardList
                    items={maneuverChoices}
                    keyExtractor={(option) => `maneuver-${option.id}`}
                    titleForItem={(option) => option.name}
                    descriptionForItem={describeFeatOption}
                    metaForItem={(option) => (choice.maneuverOptionIds ?? []).includes(option.id) ? 'Selecionado' : `${option.sourceLabel} · toque para selecionar`}
                    isSelected={(option) => (choice.maneuverOptionIds ?? []).includes(option.id)}
                    isDisabled={(option) => !(choice.maneuverOptionIds ?? []).includes(option.id) && (choice.maneuverOptionIds ?? []).length >= schema.maneuverChoiceCount}
                    onPressItem={(option) => {
                      const selected = choice.maneuverOptionIds ?? [];
                      setDraft({
                        ...choice,
                        maneuverOptionIds: selected.includes(option.id)
                          ? selected.filter((id) => id !== option.id)
                          : [...selected, option.id]
                      });
                    }}
                    pageSize={10}
                    resetKey={`${editingRow.feat.id}:maneuvers:${choice.maneuverOptionIds?.join('|') ?? ''}`}
                    emptyText="Nenhuma Battle Master Maneuver disponível."
                  />
                </>
              ) : null}
              {schema.spellListOptions.length ? (
                <>
                  <Text style={{ color: colors.onSurface, fontWeight: '800' }}>Listas disponíveis</Text>
                  <View style={styles.chips}>
                    {schema.allowCombinedSpellLists ? (
                      <Chip
                        label={`Todas (${schema.spellListOptions.join(' + ')})`}
                        selected={!choice.spellList || normalize(choice.spellList) === 'all'}
                        onPress={() => setDraft({ ...choice, spellList: 'all' })}
                      />
                    ) : null}
                    {schema.spellListOptions.map((list) => (
                      <Chip
                        key={list}
                        label={list}
                        selected={normalize(choice.spellList ?? '') === normalize(list)}
                        onPress={() => setDraft({
                          ...choice,
                          spellList: list,
                          spellItemIds: (choice.spellItemIds ?? []).filter((spellId) => {
                            const spell = items.find((candidate) => candidate.id === spellId);
                            return spell ? spellItemClasses(spell).map(normalize).includes(normalize(list)) : false;
                          })
                        })}
                      />
                    ))}
                  </View>
                  {schema.allowCombinedSpellLists ? (
                    <Text style={{ color: colors.onSurfaceVariant }}>“Todas” permite combinar escolhas de Cleric, Druid e Wizard.</Text>
                  ) : null}
                </>
              ) : null}
              {schema.spellcastingAbilityOptions.length ? <View style={styles.chips}>{schema.spellcastingAbilityOptions.map((ability) => <Chip key={ability} label={ability} selected={choice.spellcastingAbility === ability} onPress={() => setDraft({ ...choice, spellcastingAbility: ability })} />)}</View> : null}
              {schema.cantripChoiceCount > 0 ? (
                <>
                  <Text style={{ color: colors.onSurface, fontWeight: '800' }}>Cantrips ({(choice.spellItemIds ?? []).filter((spellId) => spellItemLevel(items.find((item) => item.id === spellId) ?? editingRow.item!) === 0).length}/{schema.cantripChoiceCount})</Text>
                  <PaginatedChipList
                    items={cantripChoices}
                    keyExtractor={(spell) => `cantrip-${spell.id}`}
                    labelForItem={(spell) => spell.name}
                    isSelected={(spell) => (choice.spellItemIds ?? []).includes(spell.id)}
                    isDisabled={(spell) => {
                      const selected = (choice.spellItemIds ?? []).includes(spell.id);
                      const count = (choice.spellItemIds ?? []).filter((spellId) => spellItemLevel(items.find((item) => item.id === spellId) ?? spell) === 0).length;
                      return !selected && count >= schema.cantripChoiceCount;
                    }}
                    onPressItem={(spell) => { void toggleDraftSpell(spell); }}
                    pageSize={20}
                    resetKey={`${editingRow.feat.id}:cantrips:${choice.spellList ?? 'all'}:${choice.spellItemIds?.length ?? 0}`}
                    emptyText="Nenhum cantrip encontrado nas listas escolhidas."
                  />
                </>
              ) : null}
              {schema.level1SpellChoiceCount > 0 ? (
                <>
                  <Text style={{ color: colors.onSurface, fontWeight: '800' }}>Magias de nível 1 ({(choice.spellItemIds ?? []).filter((spellId) => spellItemLevel(items.find((item) => item.id === spellId) ?? editingRow.item!) === 1).length}/{schema.level1SpellChoiceCount})</Text>
                  <PaginatedChipList
                    items={levelOneSpellChoices}
                    keyExtractor={(spell) => `level1-${spell.id}`}
                    labelForItem={(spell) => spell.name}
                    isSelected={(spell) => (choice.spellItemIds ?? []).includes(spell.id)}
                    isDisabled={(spell) => {
                      const selected = (choice.spellItemIds ?? []).includes(spell.id);
                      const count = (choice.spellItemIds ?? []).filter((spellId) => spellItemLevel(items.find((item) => item.id === spellId) ?? spell) === 1).length;
                      return !selected && count >= schema.level1SpellChoiceCount;
                    }}
                    onPressItem={(spell) => { void toggleDraftSpell(spell); }}
                    pageSize={20}
                    resetKey={`${editingRow.feat.id}:level1:${choice.spellList ?? 'all'}:${choice.spellItemIds?.length ?? 0}`}
                    emptyText="Nenhuma magia de nível 1 encontrada nas listas escolhidas."
                  />
                </>
              ) : null}
              {effectiveGenericSpellChoiceCount > 0 ? (
                <>
                  <Text style={{ color: colors.onSurface, fontWeight: '800' }}>Magia ({choice.spellItemIds?.length ?? 0}/{effectiveGenericSpellChoiceCount})</Text>
                  <PaginatedChipList
                    items={genericSpellChoices}
                    keyExtractor={(spell) => `generic-spell-${spell.id}`}
                    labelForItem={(spell) => `${spell.name} · nv ${spellItemLevel(spell)}`}
                    isSelected={(spell) => (choice.spellItemIds ?? []).includes(spell.id)}
                    isDisabled={(spell) => !(choice.spellItemIds ?? []).includes(spell.id) && (choice.spellItemIds ?? []).length >= effectiveGenericSpellChoiceCount}
                    onPressItem={(spell) => { void toggleDraftSpell(spell); }}
                    pageSize={20}
                    resetKey={`${editingRow.feat.id}:generic-spell:${choice.spellItemIds?.join('|') ?? ''}`}
                    emptyText="Nenhuma magia elegível encontrada."
                  />
                </>
              ) : null}
              {schema.damageTypeOptions.length ? <View style={styles.chips}>{schema.damageTypeOptions.map((type) => <Chip key={type} label={type} selected={choice.damageType === type} onPress={() => setDraft({ ...choice, damageType: type })} />)}</View> : null}
              <Button label="Salvar escolhas" onPress={saveChoice} />
              <Button label="Cancelar" variant="text" onPress={() => { setEditingFeatId(undefined); setDraft(undefined); }} />
            </Card>
          ) : null}
        </>
      )}
      renderItem={({ item: { feat, item, choice: savedChoice } }) => {
        const choiceIssues = item ? validateFeatChoice(item, savedChoice, character.abilities, items, character) : [];
        const customRuleFeatures = feat.features ?? [];
        const damageRules = customRuleFeatures.flatMap((feature) => feature.customRules?.damageMultipliers ?? []);
        const triggerRules = customRuleFeatures.flatMap((feature) => feature.customRules?.triggeredDamage ?? []);
        const replacementRules = customRuleFeatures.flatMap((feature) => feature.customRules?.spellReplacement ?? []);
        const listAdditionRules = customRuleFeatures.flatMap((feature) => feature.customRules?.spellListAdditions ?? []);
        const structuredModifiers = customRuleFeatures.flatMap((feature) => feature.customRules?.modifiers ?? []);
        const grantedSpells = character.spells.filter((spell) => spell.grantedByFeatEntityId === feat.id || (spell.externalSpellGrantSources ?? []).some((source) => source.kind === 'feat' && source.sourceEntityId === feat.id));
        return (
          <Card variant="outlined" title={feat.name} subtitle={`${feat.id === character.originFeatId ? 'Origin Feat' : feat.grantedByFeatEntityId ? `Concedido por ${character.feats.find((entry) => entry.id === feat.grantedByFeatEntityId)?.name ?? 'outro feat'}` : 'Feat'} · ${feat.custom ? 'Personalizado' : feat.source?.book ?? 'Entrada manual'}`}>
            {feat.summary ? <Text style={{ color: colors.onSurfaceVariant }}>{feat.summary}</Text> : null}
            {damageRules.map((rule) => <Text key={rule.id} style={{ color: colors.onSurfaceVariant }}>• Dano {rule.damageType}: ×{rule.multiplier}</Text>)}
            {triggerRules.map((rule) => <Text key={rule.id} style={{ color: colors.onSurfaceVariant }}>• Ao causar {rule.triggerDamageType}: {rule.triggerRoll.count}d{rule.triggerRoll.sides}, dispara em {rule.triggerValues.join('/')} {rule.radiusFeet ? `· raio ${rule.radiusFeet} ft` : ''} {rule.saveAbility ? `· save ${rule.saveAbility}` : ''}</Text>)}
            {replacementRules.map((rule) => {
              const resource = character.resources.find((entry) => entry.id === rule.resourceId);
              return <Text key={rule.id} style={{ color: colors.onSurfaceVariant }}>• Troca de magia: {resource?.current ?? 0}/{resource?.max ?? rule.count} · {rule.recharge}</Text>;
            })}
            {listAdditionRules.map((rule) => <Text key={rule.id} style={{ color: colors.onSurfaceVariant }}>• Lista de magia expandida: {rule.spellItemIds.length} magia(s){rule.classNames?.length ? ` · ${rule.classNames.join(', ')}` : ' · qualquer classe conjuradora'}</Text>)}
            {structuredModifiers.map((rule) => <Text key={rule.id} style={{ color: colors.onSurfaceVariant }}>• {describeCustomModifier(rule)}</Text>)}
            {grantedSpells.length ? <Text style={{ color: colors.onSurfaceVariant }}>• Magias concedidas: {grantedSpells.map((spell) => spell.name).join(', ')}</Text> : null}
            {savedChoice?.abilityScoreIncreases ? <Text style={{ color: colors.onSurfaceVariant }}>Atributos: {Object.entries(savedChoice.abilityScoreIncreases).map(([ability, value]) => `${ability} +${value}`).join(', ')}</Text> : null}
            {savedChoice?.fightingStyleItemId ? <Text style={{ color: colors.onSurfaceVariant }}>• Fighting Style: {itemForReference(savedChoice.fightingStyleItemId)?.name ?? savedChoice.fightingStyleItemId}</Text> : null}
            {savedChoice?.eldritchInvocationItemId ? <Text style={{ color: colors.onSurfaceVariant }}>• Eldritch Invocation: {itemForReference(savedChoice.eldritchInvocationItemId)?.name ?? savedChoice.eldritchInvocationItemId}</Text> : null}
            {savedChoice?.metamagicOptionIds?.length ? <Text style={{ color: colors.onSurfaceVariant }}>• Metamagic: {savedChoice.metamagicOptionIds.map((optionId) => findFeatOptionDefinition(optionId)?.name ?? optionId).join(', ')}</Text> : null}
            {savedChoice?.maneuverOptionIds?.length ? <Text style={{ color: colors.onSurfaceVariant }}>• Maneuvers: {savedChoice.maneuverOptionIds.map((optionId) => findFeatOptionDefinition(optionId)?.name ?? optionId).join(', ')}</Text> : null}
            {choiceIssues.length ? <IssueList issues={choiceIssues} /> : null}
            {item && getFeatChoiceSchema(item).kinds.length ? <Button label={savedChoice ? 'Alterar escolhas' : 'Configurar escolhas'} variant="outlined" onPress={() => openEditor(feat, item.id)} /> : null}
            {feat.grantedByFeatEntityId ? (
              <Text style={{ color: colors.onSurfaceVariant }}>Este feat é concedido por outra escolha e deve ser alterado na origem que o concedeu.</Text>
            ) : (
              <Button label="Remover da ficha" variant="text" onPress={() => removeFeat(feat)} />
            )}
          </Card>
        );
      }}
      emptyContent={<Card variant="filled" title="Nenhum feat escolhido" />}
      footerContent={!origin ? <Text style={{ color: colors.warning }}>O personagem está sem Origin Feat.</Text> : null}
    />
  );
}

const styles = StyleSheet.create({
  metrics: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 }
});
