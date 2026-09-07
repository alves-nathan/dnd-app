import type {
  Character,
  CharacterPendingChoice,
  RuleValidationIssue
} from '../types';
import type { StoredCompendiumItem } from '../compendium/types';
import { applyAutomaticClassProgression, findCompendiumItemByReference, getCompendiumClassReference, getSubclassUnlockLevel } from '../compendium/classProgression';
import {
  characterLinkMatchesReference,
  findCompendiumItemForCharacterLink
} from '../compendium/characterLinkIdentity';
import { getFeatCategory, getProgressionFeatChoiceRequirements, validateFeatPrerequisites } from './characterBuildRules';
import { itemReferenceMatches } from './creationData';
import { getFeatChoiceSchema, recalculateCharacterAbilities, validateFeatChoice, validateFeatChoiceUniqueness } from './featChoiceRules';
import { reconcileFeatSubchoiceResources } from './featSubchoiceRules';
import { buildProficiencySelection } from './proficiencyRules';
import { COMMON_LANGUAGE } from './choiceOptions';
import { countCharacterSpellsForClass, getActiveSubclassItemForClass, getClassOrSubclassSpellcastingProfile, isSpellItemEligibleForProfile, spellCountsAgainstNormalClassLimit, type ClassSpellcastingProfile } from './spellcastingRules';
import { reconcileCharacterSpellSlots } from './spellSlotProgression';
import { getStartingEquipmentOptions } from './startingEquipmentRules';
import { getSpellbookEntriesForClass, reconcileSpellbookEntries } from './spellbookRules';
import { applyAutomaticSpeciesProgression, getSpeciesChoiceProficiencyGrants, getSpeciesChoiceRequirements, validateSpeciesChoices } from './speciesChoiceRules';
import { normalizeSpeciesSpellReplacementChoices } from './speciesSpellReplacementRules';
import { createId } from '../utils/id';
import {
  getEldritchInvocationLimit,
  getSelectedWarlockLevel,
  validateEldritchInvocationSelection
} from './eldritchInvocationRules';
import { validateEldritchInvocationChoices } from './eldritchInvocationChoiceRules';
import { clearPactWeapon, hasPactOfTheBlade, validatePactWeaponChoice } from './pactWeaponRules';
import { reconcileCharacterHitDice } from './hitDiceRules';
import { reconcileCharacterHitPoints } from './hitPointRules';
import { reconcileWarlockSpecializedInvocations } from './warlockSpecializedInvocations';
import { CUSTOM_BACKGROUND_ITEM_ID, createCustomBackgroundCompendiumItem } from './customBackgroundRules';
import { getSpellListAdditionRules } from './customRuleEffects';
import { applyCustomProficiencyModifiers } from './customModifierRules';
import {
  getCharacterSubclassSpellListReferences,
  getSubclassChoiceRequirements,
  pruneSubclassChoices,
  validateSubclassChoices
} from './subclassChoiceRules';
import { getCharacterFeatSpellListReferences, getCharacterSpeciesSpellListReferences, getClassSpellListReferences } from './spellListRules';
import {
  applyClassFeatureChoiceAlternativesToFeatRequirements,
  getClassFeatureChoiceProficiencyGrants,
  getSpellAffectingClassFeatureChoiceRequirements,
  pruneClassFeatureChoices
} from './classFeatureChoiceRules';
import { resolveCharacterSpellAccess } from './characterSpellAccess';
import { getCharacterMetamagicSources, metamagicSourceIsComplete, reconcileClassMetamagicChoices } from './metamagicRules';
import { pruneBonusSpellChoices } from './bonusSpellChoiceRules';
import { reconcileAutomaticSpellAccess } from './automaticSpellAccessRules';
import { reconcileExternalSpellGrants } from './externalSpellGrantRules';
import {
  getAutomaticWizardSpellbookGrantReferences,
  getWizardSpellbookFeatureRequirements,
  reconcileWizardSpellbookFeatures,
  validateWizardSpellbookFeatureChoices
} from './wizardSpellbookRules';
import {
  getMysticArcanumRequirements,
  mysticArcanumChoiceForRequirement,
  reconcileMysticArcanum
} from './warlockMysticArcanumRules';

const now = () => new Date().toISOString();

const asRecord = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
const asStringArray = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string' && Boolean(entry.trim())) : [];
const unique = <T,>(values: T[]): T[] => Array.from(new Set(values));

const classEntriesForCharacter = (character: Character, items: StoredCompendiumItem[]) =>
  character.classes.flatMap((entity) => {
    const link = (character.compendiumLinks ?? []).find(
      (entry) => entry.appliedAs === 'class' && entry.appliedEntityId === entity.id && entry.status === 'active'
    );
    const item = link ? findCompendiumItemForCharacterLink(items, link) : undefined;
    return item ? [{ item, level: entity.level, entity }] : [];
  });

const removeLinkedEntities = (
  character: Character,
  appliedAs: 'feat' | 'spell',
  entityIds: Set<string>
): Character => ({
  ...character,
  feats: appliedAs === 'feat' ? character.feats.filter((entry) => !entityIds.has(entry.id)) : character.feats,
  spells: appliedAs === 'spell' ? character.spells.filter((entry) => !entityIds.has(entry.id)) : character.spells,
  compendiumLinks: (character.compendiumLinks ?? []).map((link) =>
    link.appliedAs === appliedAs && entityIds.has(link.appliedEntityId) && link.status === 'active'
      ? { ...link, status: 'removed' as const }
      : link
  )
});

const removeFeatGrantedState = (
  character: Character,
  featEntityIds: Set<string>
): Character => {
  const grantedSpellIds = new Set(
    character.spells
      .filter((spell) => {
        if (!spell.grantedByFeatEntityId || !featEntityIds.has(spell.grantedByFeatEntityId)) return false;
        const hasOtherExternalOwner = (spell.externalSpellGrantSources ?? []).some((source) =>
          source.kind !== 'feat' || !source.sourceEntityId || !featEntityIds.has(source.sourceEntityId)
        );
        return !hasOtherExternalOwner && !(spell.automaticSpellAccessSources?.length);
      })
      .map((spell) => spell.id)
  );
  const grantedFeatIds = new Set(
    character.feats
      .filter((feat) => Boolean(feat.grantedByFeatEntityId && featEntityIds.has(feat.grantedByFeatEntityId)))
      .map((feat) => feat.id)
  );
  const markedEntityIds = new Set(
    (character.compendiumLinks ?? [])
      .filter((link) => link.status === 'active' && Array.from(featEntityIds).some((featEntityId) => link.notes?.includes(`feat-subchoice:${featEntityId}:`)))
      .map((link) => link.appliedEntityId)
  );
  const removedFeatureResourceIds = new Set(
    character.features
      .filter((feature) => markedEntityIds.has(feature.id))
      .map((feature) => feature.resource?.id)
      .filter((id): id is string => Boolean(id))
  );
  return {
    ...character,
    features: character.features.filter((feature) => !markedEntityIds.has(feature.id)),
    feats: character.feats.filter((feat) => !grantedFeatIds.has(feat.id)),
    companions: (character.companions ?? []).filter((companion) => !companion.grantedByFeatEntityId || !featEntityIds.has(companion.grantedByFeatEntityId)),
    spells: character.spells
      .filter((spell) => !grantedSpellIds.has(spell.id))
      .map((spell) => spell.grantedByFeatEntityId && featEntityIds.has(spell.grantedByFeatEntityId)
        ? { ...spell, grantedByFeatEntityId: undefined }
        : spell),
    resources: character.resources.filter((resource) =>
      !resource.sourceFeatEntityId || !featEntityIds.has(resource.sourceFeatEntityId)
    ).filter((resource) =>
      !Array.from(featEntityIds).some((featEntityId) => resource.id === `feat_free_cast_${featEntityId}`)
        && !removedFeatureResourceIds.has(resource.id)
    ),
    weaponMasteries: (character.weaponMasteries ?? []).filter((mastery) =>
      !mastery.sourceEntityId || !featEntityIds.has(mastery.sourceEntityId)
    ),
    compendiumLinks: (character.compendiumLinks ?? []).map((link) =>
      (grantedSpellIds.has(link.appliedEntityId)
        || grantedFeatIds.has(link.appliedEntityId)
        || markedEntityIds.has(link.appliedEntityId))
        && link.status === 'active'
        ? { ...link, status: 'removed' as const }
        : link
    )
  };
};

export interface BuildReconciliationResult {
  character: Character;
  removedFeatCount: number;
  removedSpellCount: number;
  pendingChoiceCount: number;
  issues: RuleValidationIssue[];
}

export const reconcileCharacterBuild = (
  character: Character,
  items: StoredCompendiumItem[]
): BuildReconciliationResult => {
  let next = recalculateCharacterAbilities(character);
  next = applyAutomaticClassProgression(next, items).character;
  next = applyAutomaticSpeciesProgression(next, items).character;
  const issues: RuleValidationIssue[] = [];
  let automaticSpellRemovalCount = 0;
  let externalSpellGrantRemovalCount = 0;
  let wizardSpellbookRemovalCount = 0;
  let mysticArcanumRemovalCount = 0;
  const classEntries = classEntriesForCharacter(next, items);

  if (next.buildChoices) {
    const activeSpeciesLink = (next.compendiumLinks ?? []).find(
      (entry) => entry.appliedAs === 'species' && entry.status === 'active'
    );
    const activeSpeciesItem = activeSpeciesLink
      ? findCompendiumItemForCharacterLink(items, activeSpeciesLink)
      : undefined;
    const normalizedSpeciesChoices = normalizeSpeciesSpellReplacementChoices(
      activeSpeciesItem,
      items,
      next.level,
      next.buildChoices.speciesChoices ?? []
    );
    if (normalizedSpeciesChoices !== next.buildChoices.speciesChoices) {
      next = {
        ...next,
        buildChoices: {
          ...next.buildChoices,
          speciesChoices: normalizedSpeciesChoices
        }
      };
    }
  }

  const activeSubclassRequirements = (next.compendiumLinks ?? [])
    .filter((link) => link.appliedAs === 'subclass' && link.status === 'active')
    .flatMap((link) => {
      const subclassItem = findCompendiumItemForCharacterLink(items, link);
      const subclassEntity = next.subclasses.find((entry) => entry.id === link.appliedEntityId);
      const classLevel = subclassEntity
        ? next.classes.find((entry) => entry.id === subclassEntity.classId)?.level ?? next.level
        : next.level;
      return getSubclassChoiceRequirements(subclassItem, items, classLevel);
    });
  if (next.buildChoices) {
    const subclassChoices = pruneSubclassChoices(next.buildChoices.subclassChoices, activeSubclassRequirements);
    const classFeatureChoiceRequirements = getSpellAffectingClassFeatureChoiceRequirements(
      classEntries.map(({ item, level }) => ({ item, level })),
      items
    );
    const classFeatureChoices = pruneClassFeatureChoices(
      next.buildChoices.classFeatureChoices ?? [],
      classFeatureChoiceRequirements
    );
    const classMetamagicChoices = reconcileClassMetamagicChoices(next, items);
    const activeBonusSpellRequirements = classEntries.flatMap(({ item, level, entity }) => {
      const subclassEntity = next.subclasses.find((entry) => entry.classId === entity.id);
      const subclassLink = subclassEntity
        ? (next.compendiumLinks ?? []).find((entry) =>
            entry.appliedAs === 'subclass' && entry.appliedEntityId === subclassEntity.id && entry.status === 'active'
          )
        : undefined;
      const subclassItem = subclassLink
        ? findCompendiumItemForCharacterLink(items, subclassLink)
        : undefined;
      return resolveCharacterSpellAccess({
        classItem: item,
        classLevel: level,
        items,
        subclassItem,
        subclassChoices,
        classFeatureChoices,
        characterLevel: next.level
      }).activeBonusChoiceRequirements;
    });
    const spellProfiles = classEntries.flatMap(({ item, level, entity }) => {
      const subclassItem = getActiveSubclassItemForClass(next, entity.id, items);
      const profile = getClassOrSubclassSpellcastingProfile(item, level, subclassItem, items);
      return profile ? [profile] : [];
    });
    const selectableSpells = items.filter((item) => item.type === 'spell' && item.status !== 'disabled');
    const bonusSpellChoices = pruneBonusSpellChoices(
      next.buildChoices.bonusSpellChoices ?? [],
      activeBonusSpellRequirements,
      spellProfiles,
      selectableSpells,
      items
    );
    next = {
      ...next,
      buildChoices: {
        ...next.buildChoices,
        subclassChoices,
        classFeatureChoices,
        classMetamagicChoices,
        bonusSpellChoices
      }
    };
  }

  const validBonusSpellChoiceByRequirement = new Map(
    (next.buildChoices?.bonusSpellChoices ?? []).map((choice) => [choice.requirementId, choice] as const)
  );
  const staleBonusSpellEntityIds = new Set<string>();
  for (const spell of next.spells) {
    if (!spell.bonusSpellChoiceId) continue;
    const choice = validBonusSpellChoiceByRequirement.get(spell.bonusSpellChoiceId);
    if (!choice) {
      staleBonusSpellEntityIds.add(spell.id);
      continue;
    }
    const link = (next.compendiumLinks ?? []).find((entry) =>
      entry.appliedAs === 'spell' && entry.appliedEntityId === spell.id && entry.status === 'active'
    );
    if (!link) continue;
    const linkedItem = findCompendiumItemForCharacterLink(items, link);
    const remainsSelected = choice.spellItemIds.some((reference) =>
      characterLinkMatchesReference(items, link, reference) || Boolean(linkedItem && itemReferenceMatches(linkedItem, reference))
    );
    if (!remainsSelected) staleBonusSpellEntityIds.add(spell.id);
  }
  if (staleBonusSpellEntityIds.size) {
    next = removeLinkedEntities(next, 'spell', staleBonusSpellEntityIds);
    issues.push({
      severity: 'warning',
      code: 'BONUS_SPELLS_REMOVED_BY_RECONCILIATION',
      message: `${staleBonusSpellEntityIds.size} magia(s) bônus foi/foram removida(s) porque a feature, opção ou nível correspondente deixou de estar ativo.`
    });
  }

  const invalidFeatEntityIds = new Set<string>();
  const copyCounts = new Map<string, number>();
  for (const link of (next.compendiumLinks ?? []).filter((entry) => entry.appliedAs === 'feat' && entry.status === 'active')) {
    if (link.notes?.includes('feat-subchoice:')) continue;
    const featItem = findCompendiumItemForCharacterLink(items, link);
    if (!featItem) continue;
    const currentCopies = copyCounts.get(featItem.id) ?? 0;
    const abilitiesBeforeThisFeat = recalculateCharacterAbilities({
      ...next,
      featChoices: (next.featChoices ?? []).filter((choice) => choice.featEntityId !== link.appliedEntityId)
    }).abilities;
    const featIssues = validateFeatPrerequisites({
      featItem,
      totalLevel: next.level,
      abilities: abilitiesBeforeThisFeat,
      proficiencies: next.proficiencies,
      classEntries,
      allItems: items,
      character: next,
      currentCopies
    });
    if (featIssues.some((entry) => entry.severity === 'error')) {
      invalidFeatEntityIds.add(link.appliedEntityId);
      issues.push(...featIssues);
    } else {
      copyCounts.set(featItem.id, currentCopies + 1);
    }
  }

  if (invalidFeatEntityIds.size) {
    next = removeLinkedEntities(next, 'feat', invalidFeatEntityIds);
    next = removeFeatGrantedState(next, invalidFeatEntityIds);
    next = {
      ...next,
      featChoices: (next.featChoices ?? []).filter((choice) => !invalidFeatEntityIds.has(choice.featEntityId)),
      originFeatId: next.originFeatId && invalidFeatEntityIds.has(next.originFeatId) ? undefined : next.originFeatId
    };
    next = recalculateCharacterAbilities(next);
    issues.push({
      severity: 'warning',
      code: 'FEATS_REMOVED_BY_PREREQUISITE_RECONCILIATION',
      message: `${invalidFeatEntityIds.size} feat(s) foi/foram removido(s) porque os pré-requisitos deixaram de ser atendidos.`
    });
  }

  const activeFeatEntityIds = new Set(
    (next.compendiumLinks ?? [])
      .filter((link) => link.appliedAs === 'feat' && link.status === 'active')
      .map((link) => link.appliedEntityId)
  );
  const orphanFeatEntityIds = new Set<string>();
  for (const mastery of next.weaponMasteries ?? []) {
    if (mastery.sourceKind === 'feat' && mastery.sourceEntityId && !activeFeatEntityIds.has(mastery.sourceEntityId)) orphanFeatEntityIds.add(mastery.sourceEntityId);
  }
  for (const spell of next.spells) {
    if (spell.grantedByFeatEntityId && !activeFeatEntityIds.has(spell.grantedByFeatEntityId)) orphanFeatEntityIds.add(spell.grantedByFeatEntityId);
  }
  for (const resource of next.resources) {
    if (resource.sourceFeatEntityId && !activeFeatEntityIds.has(resource.sourceFeatEntityId)) orphanFeatEntityIds.add(resource.sourceFeatEntityId);
    const match = resource.id.match(/^feat_free_cast_(.+)$/);
    if (match?.[1] && !activeFeatEntityIds.has(match[1])) orphanFeatEntityIds.add(match[1]);
  }
  for (const companion of next.companions ?? []) {
    if (companion.grantedByFeatEntityId && !activeFeatEntityIds.has(companion.grantedByFeatEntityId)) orphanFeatEntityIds.add(companion.grantedByFeatEntityId);
  }
  for (const feat of next.feats) {
    if (feat.grantedByFeatEntityId && !activeFeatEntityIds.has(feat.grantedByFeatEntityId)) orphanFeatEntityIds.add(feat.grantedByFeatEntityId);
  }
  if (orphanFeatEntityIds.size) next = removeFeatGrantedState(next, orphanFeatEntityIds);

  // Feat option resources are derived from persisted featChoices. Reconcile them
  // after prerequisite/orphan cleanup so valid Metamagic Adept and Martial Adept
  // pools survive creation, restore and later build reconciliation.
  next = reconcileFeatSubchoiceResources(next, items);

  const automaticSpellAccess = reconcileAutomaticSpellAccess(next, items);
  next = automaticSpellAccess.character;
  automaticSpellRemovalCount = automaticSpellAccess.removedSpellCount;
  issues.push(...automaticSpellAccess.issues);

  const externalSpellGrants = reconcileExternalSpellGrants(next, items);
  next = externalSpellGrants.character;
  externalSpellGrantRemovalCount = externalSpellGrants.removedSpellCount;
  issues.push(...externalSpellGrants.issues);

  const wizardSpellbookFeatures = reconcileWizardSpellbookFeatures(next, items);
  next = wizardSpellbookFeatures.character;
  wizardSpellbookRemovalCount = wizardSpellbookFeatures.removedSpellCount;
  issues.push(...wizardSpellbookFeatures.issues);

  const mysticArcanum = reconcileMysticArcanum(next, items);
  next = mysticArcanum.character;
  mysticArcanumRemovalCount = mysticArcanum.removedSpellCount;
  issues.push(...mysticArcanum.issues);

  const validClassEntityIds = new Set(classEntries.map(({ entity }) => entity.id));
  next = reconcileSpellbookEntries(next, validClassEntityIds, items);

  const profileByClassEntityId = new Map<string, ClassSpellcastingProfile | undefined>();
  for (const { item, entity } of classEntries) {
    const subclassItem = getActiveSubclassItemForClass(next, entity.id, items);
    profileByClassEntityId.set(entity.id, getClassOrSubclassSpellcastingProfile(item, entity.level, subclassItem, items));
  }
  const invalidSpellEntityIds = new Set<string>();
  for (const link of (next.compendiumLinks ?? []).filter((entry) => entry.appliedAs === 'spell' && entry.status === 'active')) {
    const entity = next.spells.find((spell) => spell.id === link.appliedEntityId);
    const spellItem = findCompendiumItemForCharacterLink(items, link);
    if (!entity || !spellItem || !entity.spellcastingClassId || !spellCountsAgainstNormalClassLimit(entity)) continue;
    const profile = profileByClassEntityId.get(entity.spellcastingClassId);
    const classEntry = classEntries.find((entry) => entry.entity.id === entity.spellcastingClassId);
    const classSpellReferences = profile && classEntry
      ? getClassSpellListReferences(classEntry.item, items, classEntry.level)
      : [];
    const customSpellReferences = profile ? getSpellListAdditionRules(next, profile.className).flatMap(({ rule }) => rule.spellItemIds) : [];
    const featSpellReferences = profile ? getCharacterFeatSpellListReferences(next, items) : [];
    const subclassSpellReferences = profile
      ? getCharacterSubclassSpellListReferences(next, items, entity.spellcastingClassId)
      : [];
    const speciesSpellReferences = profile
      ? getCharacterSpeciesSpellListReferences(next, items, profile.className)
      : [];
    const additionalSpellReferences = Array.from(new Set([
      ...classSpellReferences,
      ...customSpellReferences,
      ...featSpellReferences,
      ...subclassSpellReferences,
      ...speciesSpellReferences
    ]));
    if (!profile || !isSpellItemEligibleForProfile(spellItem, profile, additionalSpellReferences)) invalidSpellEntityIds.add(entity.id);
  }
  if (invalidSpellEntityIds.size) {
    next = removeLinkedEntities(next, 'spell', invalidSpellEntityIds);
    issues.push({
      severity: 'warning',
      code: 'SPELLS_REMOVED_BY_CLASS_RECONCILIATION',
      message: `${invalidSpellEntityIds.size} magia(s) foi/foram removida(s) porque a classe ou o nível não permite mais prepará-las/conhecê-las.`
    });
  }

  const excessSpellEntityIds = new Set<string>();
  for (const { entity } of classEntries) {
    const profile = profileByClassEntityId.get(entity.id);
    if (!profile) continue;
    const assigned = next.spells.filter((spell) => spell.spellcastingClassId === entity.id && spellCountsAgainstNormalClassLimit(spell));
    const cantrips = assigned.filter((spell) => spell.level === 0);
    const leveled = assigned.filter((spell) => spell.level > 0);
    cantrips.slice(profile.cantripLimit).forEach((spell) => excessSpellEntityIds.add(spell.id));
    leveled.slice(profile.preparedSpellLimit).forEach((spell) => excessSpellEntityIds.add(spell.id));
  }
  if (excessSpellEntityIds.size) {
    next = removeLinkedEntities(next, 'spell', excessSpellEntityIds);
    issues.push({
      severity: 'warning',
      code: 'EXCESS_SPELLS_REMOVED_BY_RECONCILIATION',
      message: `${excessSpellEntityIds.size} magia(s) excedente(s) foi/foram removida(s) após a alteração de nível ou classe.`
    });
  }
  next = reconcileSpellbookEntries(next, validClassEntityIds, items);

  if (!hasPactOfTheBlade(next, items) && next.buildChoices?.pactWeapon) {
    next = clearPactWeapon(next);
    issues.push({
      severity: 'warning',
      code: 'PACT_WEAPON_REMOVED_WITHOUT_INVOCATION',
      message: 'A arma de pacto foi removida porque Pact of the Blade não está mais selecionado.'
    });
  }

  if (next.buildChoices?.startingClassItemId) {
    const starting = classEntries.find((entry) => entry.item.id === next.buildChoices?.startingClassItemId);
    const backgroundLink = (next.compendiumLinks ?? []).find((entry) => entry.appliedAs === 'background' && entry.status === 'active');
    const backgroundItem = next.buildChoices.customBackground
      ? createCustomBackgroundCompendiumItem(next.buildChoices.customBackground)
      : backgroundLink
        ? findCompendiumItemForCharacterLink(items, backgroundLink)
        : undefined;
    const speciesLink = (next.compendiumLinks ?? []).find((entry) => entry.appliedAs === 'species' && entry.status === 'active');
    const speciesItem = speciesLink
      ? findCompendiumItemForCharacterLink(items, speciesLink)
      : undefined;
    const speciesRequirements = getSpeciesChoiceRequirements(speciesItem, items, next.level);
    const speciesGrants = getSpeciesChoiceProficiencyGrants(speciesRequirements, next.buildChoices.speciesChoices ?? []);
    const classFeatureChoiceRequirements = getSpellAffectingClassFeatureChoiceRequirements(
      classEntries.map(({ item, level }) => ({ item, level })),
      items
    );
    const classFeatureProficiencyGrants = getClassFeatureChoiceProficiencyGrants(
      classFeatureChoiceRequirements,
      next.buildChoices.classFeatureChoices ?? []
    );
    const selection = buildProficiencySelection({
      startingClassItem: starting?.item,
      startingClassLevel: starting?.level,
      backgroundItem,
      allItems: items,
      classSkillChoices: next.buildChoices.classSkillChoices,
      classToolChoices: next.buildChoices.classToolChoices,
      backgroundToolChoices: next.buildChoices.backgroundToolChoices ?? [],
      expertiseSkills: next.buildChoices.expertiseSkills,
      languages: next.buildChoices.languages,
      classLanguageChoices: next.buildChoices.classLanguageChoices ?? [],
      fixedLanguages: [COMMON_LANGUAGE],
      speciesSkillGrants: speciesGrants.skills,
      speciesLanguageGrants: speciesGrants.languages,
      classFeatureWeaponGrants: classFeatureProficiencyGrants.weapons,
      classFeatureArmorGrants: classFeatureProficiencyGrants.armor
    });
    issues.push(...selection.issues);
    const activeFeatLinks = (next.compendiumLinks ?? []).filter((link) => link.appliedAs === 'feat' && link.status === 'active');
    const activeFeatItems = activeFeatLinks
      .map((link) => ({ link, item: findCompendiumItemForCharacterLink(items, link) }))
      .filter((entry): entry is { link: typeof activeFeatLinks[number]; item: StoredCompendiumItem } => Boolean(entry.item));
    const activeFeatEntityIdsForChoices = new Set(activeFeatLinks.map((link) => link.appliedEntityId));
    const featChoices = (next.featChoices ?? []).filter((choice) => activeFeatEntityIdsForChoices.has(choice.featEntityId));
    const featSkills = featChoices.flatMap((choice) => choice.skills ?? []);
    const featTools = featChoices.flatMap((choice) => choice.tools ?? []);
    const featLanguages = featChoices.flatMap((choice) => choice.languages ?? []);
    const featExpertise = featChoices.flatMap((choice) => choice.expertiseSkills ?? []);
    const skillUpgradeSkills: string[] = [];
    const skillUpgradeExpertise: string[] = [];
    const knownSkills = new Set([...selection.proficiencies.skills, ...featSkills].map((value) => value.toLowerCase()));
    for (const choice of featChoices) {
      if (!choice.skillUpgrade) continue;
      if (knownSkills.has(choice.skillUpgrade.toLowerCase())) skillUpgradeExpertise.push(choice.skillUpgrade);
      else {
        skillUpgradeSkills.push(choice.skillUpgrade);
        knownSkills.add(choice.skillUpgrade.toLowerCase());
      }
    }
    const featArmor = activeFeatItems.flatMap(({ item }) => asStringArray(asRecord(asRecord(item.normalizedJson).mechanics).armorTrainingGranted));
    const featWeapons = activeFeatItems.flatMap(({ item }) => asStringArray(asRecord(asRecord(item.normalizedJson).mechanics).weaponProficiencyGranted));
    const directFeatTools = activeFeatItems.flatMap(({ item }) => {
      const tool = asRecord(item.normalizedJson).mechanics;
      const value = typeof tool === 'object' && tool && !Array.isArray(tool) ? asRecord(tool).toolProficiency : undefined;
      return typeof value === 'string' && value.trim() ? [value.trim()] : [];
    });
    const featSavingThrows = activeFeatItems.flatMap(({ link, item }) => {
      const granted = asRecord(asRecord(item.normalizedJson).mechanics).savingThrowProficiencyGranted;
      if (typeof granted !== 'string') return [];
      const choice = featChoices.find((entry) => entry.featEntityId === link.appliedEntityId);
      const selectedAbility = Object.keys(choice?.abilityScoreIncreases ?? {})[0] as Character['proficiencies']['savingThrows'][number] | undefined;
      return selectedAbility ? [selectedAbility] : [];
    });
    next = {
      ...next,
      proficiencies: {
        ...selection.proficiencies,
        skills: unique([...selection.proficiencies.skills, ...featSkills, ...skillUpgradeSkills]),
        tools: unique([...selection.proficiencies.tools, ...featTools, ...directFeatTools]),
        expertiseSkills: unique([...selection.proficiencies.expertiseSkills, ...featExpertise, ...skillUpgradeExpertise]),
        armor: unique([...selection.proficiencies.armor, ...featArmor]),
        weapons: unique([...selection.proficiencies.weapons, ...featWeapons]),
        languages: unique([...selection.proficiencies.languages, ...featLanguages]),
        savingThrows: unique([...selection.proficiencies.savingThrows, ...featSavingThrows])
      }
    };
  }

  if (next.buildChoices?.manualProficiencies) {
    const manual = next.buildChoices.manualProficiencies;
    next = {
      ...next,
      proficiencies: {
        skills: Array.from(new Set(manual.skills ?? [])),
        expertiseSkills: Array.from(new Set((manual.expertiseSkills ?? []).filter((skill) => (manual.skills ?? []).includes(skill)))),
        tools: Array.from(new Set(manual.tools ?? [])),
        weapons: Array.from(new Set(manual.weapons ?? [])),
        armor: Array.from(new Set(manual.armor ?? [])),
        languages: Array.from(new Set(manual.languages ?? [])),
        savingThrows: Array.from(new Set(manual.savingThrows ?? []))
      }
    };
  }

  next = applyCustomProficiencyModifiers(next);

  next = reconcileCharacterHitDice(next);
  next = reconcileCharacterHitPoints(next, items);
  next = reconcileCharacterSpellSlots(next, items);
  next = reconcileWarlockSpecializedInvocations(next, items);
  const pendingChoices = buildPendingCharacterChoices(next, items);
  next = { ...next, pendingChoices };
  return {
    character: next,
    removedFeatCount: invalidFeatEntityIds.size,
    removedSpellCount: automaticSpellRemovalCount + externalSpellGrantRemovalCount + wizardSpellbookRemovalCount + mysticArcanumRemovalCount + staleBonusSpellEntityIds.size + invalidSpellEntityIds.size + excessSpellEntityIds.size,
    pendingChoiceCount: pendingChoices.length,
    issues
  };
};

const pending = (
  kind: CharacterPendingChoice['kind'],
  title: string,
  description: string,
  values: Partial<CharacterPendingChoice> = {}
): CharacterPendingChoice => ({
  id: values.id ?? createId('pendingChoice'),
  kind,
  title,
  description,
  sourceItemId: values.sourceItemId,
  sourceEntityId: values.sourceEntityId,
  requiredCount: values.requiredCount,
  currentCount: values.currentCount,
  featCategory: values.featCategory,
  status: 'pending',
  createdAt: values.createdAt ?? now()
});

export const buildPendingCharacterChoices = (
  character: Character,
  items: StoredCompendiumItem[]
): CharacterPendingChoice[] => {
  const generatedKinds = new Set<CharacterPendingChoice['kind']>(['subclass', 'subclassOptions', 'feat', 'featOptions', 'metamagic', 'spellSelection', 'spellbookFeature', 'mysticArcanum', 'equipment', 'speciesOption', 'eldritchInvocation', 'eldritchInvocationOptions', 'pactWeapon']);
  const result: CharacterPendingChoice[] = (character.pendingChoices ?? []).filter(
    (entry) => entry.status === 'pending' && !generatedKinds.has(entry.kind)
  );
  const existing = new Map((character.pendingChoices ?? []).map((entry) => [`${entry.kind}:${entry.sourceEntityId ?? entry.sourceItemId ?? entry.title}`, entry]));
  const reuse = (choice: CharacterPendingChoice): CharacterPendingChoice => {
    const key = `${choice.kind}:${choice.sourceEntityId ?? choice.sourceItemId ?? choice.title}`;
    const previous = existing.get(key);
    return previous ? { ...choice, id: previous.id, createdAt: previous.createdAt } : choice;
  };

  for (const { item: classItem, level, entity } of classEntriesForCharacter(character, items)) {
    const requirements = getMysticArcanumRequirements({ classItem, classLevel: level, items });
    for (const requirement of requirements) {
      if (mysticArcanumChoiceForRequirement(character.buildChoices?.mysticArcanumChoices, requirement)) continue;
      result.push(reuse(pending(
        'mysticArcanum',
        `${requirement.featureName} · ${requirement.spellLevel}º círculo`,
        `Escolha uma magia de ${requirement.spellLevel}º círculo para o Mystic Arcanum de ${classItem.name}.`,
        { sourceItemId: requirement.featureItemId, sourceEntityId: entity.id, requiredCount: 1, currentCount: 0 }
      )));
    }
  }

  const speciesLink = (character.compendiumLinks ?? []).find(
    (entry) => entry.appliedAs === 'species' && entry.status === 'active'
  );
  const speciesItem = speciesLink
    ? findCompendiumItemForCharacterLink(items, speciesLink)
    : undefined;
  const speciesRequirements = getSpeciesChoiceRequirements(speciesItem, items, character.level);
  for (const requirement of speciesRequirements) {
    const requirementIssues = validateSpeciesChoices([requirement], character.buildChoices?.speciesChoices ?? []);
    if (!requirementIssues.length) continue;
    result.push(reuse(pending(
      'speciesOption',
      `Configurar ${requirement.featureName}`,
      requirementIssues.map((entry) => entry.message).join(' '),
      { sourceItemId: requirement.featureItemId }
    )));
  }

  for (const link of (character.compendiumLinks ?? []).filter((entry) => entry.appliedAs === 'feat' && entry.status === 'active')) {
    const featItem = findCompendiumItemForCharacterLink(items, link);
    if (!featItem || !getFeatChoiceSchema(featItem).kinds.length) continue;
    const choice = (character.featChoices ?? []).find((entry) => entry.featEntityId === link.appliedEntityId);
    const abilitiesBeforeChoice = recalculateCharacterAbilities({
      ...character,
      featChoices: (character.featChoices ?? []).filter((entry) => entry.featEntityId !== link.appliedEntityId)
    }).abilities;
    const siblingChoices = (character.featChoices ?? []).filter(
      (entry) => entry.featItemId === featItem.id && entry.featEntityId !== link.appliedEntityId
    );
    const choiceIssues = [
      ...validateFeatChoice(featItem, choice, abilitiesBeforeChoice, items, character),
      ...validateFeatChoiceUniqueness(featItem, choice, siblingChoices)
    ];
    if (choiceIssues.length) {
      result.push(reuse(pending('featOptions', `Configurar ${featItem.name}`, choiceIssues.map((entry) => entry.message).join(' '), {
        sourceItemId: featItem.id,
        sourceEntityId: link.appliedEntityId
      })));
    }
  }

  for (const source of getCharacterMetamagicSources(character, items).filter((entry) => entry.kind === 'sorcerer')) {
    if (metamagicSourceIsComplete(source)) continue;
    result.push(reuse(pending(
      'metamagic',
      `Configurar ${source.label}`,
      `${source.description} Selecione ${source.optionLimit} opção(ões); ${source.selectedOptionIds.length} selecionada(s).`,
      { sourceItemId: source.featureItemId, sourceEntityId: source.featureEntityId, requiredCount: source.optionLimit, currentCount: source.selectedOptionIds.length }
    )));
  }

  const classEntries = classEntriesForCharacter(character, items);

  for (const { item: classItem, level, entity } of classEntries) {
    const hasSubclass = character.subclasses.some((subclass) => subclass.classId === entity.id);
    if (hasSubclass) continue;
    const eligibleSubclasses = items.filter((candidate) => {
      if (candidate.type !== 'subclass' || candidate.status === 'disabled') return false;
      if (level < getSubclassUnlockLevel(candidate)) return false;
      const classReference = getCompendiumClassReference(candidate);
      if (!classReference) return false;
      const ownerClass = findCompendiumItemByReference(items, classReference);
      return ownerClass?.id === classItem.id;
    });
    if (!eligibleSubclasses.length) continue;
    result.push(reuse(pending(
      'subclass',
      `Escolher subclasse de ${classItem.name}`,
      `${classItem.name} nível ${level} já atingiu o nível de subclasse, mas a ficha não possui uma subclasse vinculada.`,
      { sourceItemId: classItem.id, sourceEntityId: entity.id, requiredCount: 1, currentCount: 0 }
    )));
  }

  // Feat-option pending choices only validate subselections for feats that are
  // already present. Also verify that class progression actually granted the
  // required number of feat slots (ASI/general, Fighting Style and Epic Boon).
  // This catches characters created by older flows where a selected feat was
  // dropped during application while the level progression itself remained.
  const classFeatureChoiceRequirements = getSpellAffectingClassFeatureChoiceRequirements(
    classEntries.map(({ item, level }) => ({ item, level })),
    items
  );
  const requiredFeatCounts = applyClassFeatureChoiceAlternativesToFeatRequirements(
    getProgressionFeatChoiceRequirements(classEntries.map(({ item, level }) => ({ item, level })), items),
    classFeatureChoiceRequirements,
    character.buildChoices?.classFeatureChoices ?? []
  );
  const speciesFeatItem = character.buildChoices?.speciesFeatItemId
    ? findCompendiumItemByReference(items, character.buildChoices.speciesFeatItemId)
    : undefined;
  const currentFeatCounts = { general: 0, fightingStyle: 0, epicBoon: 0 };
  for (const link of (character.compendiumLinks ?? []).filter((entry) => entry.appliedAs === 'feat' && entry.status === 'active')) {
    if (link.appliedEntityId === character.originFeatId || link.notes?.includes('feat-subchoice:')) continue;
    const featItem = findCompendiumItemForCharacterLink(items, link);
    if (!featItem || featItem.type !== 'feat') continue;
    if (speciesFeatItem && featItem.id === speciesFeatItem.id) continue;
    const category = getFeatCategory(featItem);
    if (category === 'general' || category === 'fightingStyle' || category === 'epicBoon') currentFeatCounts[category] += 1;
  }
  const featCategoryLabels = {
    general: 'feat geral / Ability Score Improvement',
    fightingStyle: 'Fighting Style',
    epicBoon: 'Epic Boon'
  } as const;
  for (const category of ['general', 'fightingStyle', 'epicBoon'] as const) {
    if (currentFeatCounts[category] >= requiredFeatCounts[category]) continue;
    const source = classEntries[0];
    result.push(reuse(pending(
      'feat',
      `Escolher ${featCategoryLabels[category]}`,
      `A progressão exige ${requiredFeatCounts[category]} escolha(s) de ${featCategoryLabels[category]}, mas a ficha possui ${currentFeatCounts[category]}.`,
      {
        sourceItemId: source?.item.id,
        sourceEntityId: source?.entity.id,
        requiredCount: requiredFeatCounts[category],
        currentCount: currentFeatCounts[category],
        featCategory: category
      }
    )));
  }

  for (const link of (character.compendiumLinks ?? []).filter((entry) => entry.appliedAs === 'subclass' && entry.status === 'active')) {
    const subclassItem = findCompendiumItemForCharacterLink(items, link);
    const subclassEntity = character.subclasses.find((entry) => entry.id === link.appliedEntityId);
    const classLevel = subclassEntity
      ? character.classes.find((entry) => entry.id === subclassEntity.classId)?.level ?? character.level
      : character.level;
    const requirements = getSubclassChoiceRequirements(subclassItem, items, classLevel);
    const choiceIssues = validateSubclassChoices(requirements, character.buildChoices?.subclassChoices);
    if (choiceIssues.length) {
      result.push(reuse(pending(
        'subclassOptions',
        `Configurar ${subclassItem?.name ?? link.appliedEntityName}`,
        choiceIssues.map((entry) => entry.message).join(' '),
        { sourceItemId: subclassItem?.id, sourceEntityId: link.appliedEntityId }
      )));
    }
  }

  const warlockLevel = getSelectedWarlockLevel(classEntries);
  if (warlockLevel > 0) {
    const invocationCounts = character.buildChoices?.eldritchInvocationCounts ?? {};
    const invocationLimit = getEldritchInvocationLimit(warlockLevel, classEntries, items);
    const enabledSourceIds = Array.from(new Set(items.filter((item) => item.status !== 'disabled').map((item) => item.sourceId)));
    const invocationIssues = validateEldritchInvocationSelection(
      classEntries,
      items,
      enabledSourceIds,
      invocationCounts
    );
    if (invocationIssues.length) {
      const currentCount = Object.values(invocationCounts).reduce((sum, count) => sum + Math.max(0, Math.floor(count)), 0);
      result.push(reuse(pending(
        'eldritchInvocation',
        'Revisar Eldritch Invocations',
        invocationIssues.map((entry) => entry.message).join(' '),
        { requiredCount: invocationLimit, currentCount }
      )));
    }
    const warlockClassEntityIds = new Set(
      character.classes.filter((entry) => entry.name.trim().toLowerCase() === 'warlock').map((entry) => entry.id)
    );
    const knownWarlockCantripItemIds = (character.compendiumLinks ?? [])
      .filter((link) => link.appliedAs === 'spell' && link.status === 'active')
      .filter((link) => {
        const spellEntity = character.spells.find((spell) => spell.id === link.appliedEntityId);
        const spellItem = findCompendiumItemForCharacterLink(items, link);
        return Boolean(spellEntity && spellItem && Number(spellItem.normalizedJson.level ?? 0) === 0 && spellEntity.spellcastingClassId && warlockClassEntityIds.has(spellEntity.spellcastingClassId));
      })
      .map((link) => findCompendiumItemForCharacterLink(items, link)?.id ?? link.itemId);
    const mainOriginFeatLink = (character.compendiumLinks ?? []).find(
      (link) => link.appliedAs === 'feat' && link.status === 'active' && link.appliedEntityId === character.originFeatId
    );
    const mainOriginFeatItemId = mainOriginFeatLink
      ? findCompendiumItemForCharacterLink(items, mainOriginFeatLink)?.id ?? mainOriginFeatLink.itemId
      : undefined;
    const invocationChoiceIssues = validateEldritchInvocationChoices(
      invocationCounts,
      character.buildChoices?.eldritchInvocationChoices ?? [],
      items,
      enabledSourceIds,
      {
        knownWarlockCantripItemIds,
        requireKnownWarlockCantrip: true,
        selectedOriginFeatItemIds: mainOriginFeatItemId ? [mainOriginFeatItemId] : []
      }
    );
    if (invocationChoiceIssues.length) {
      result.push(reuse(pending(
        'eldritchInvocationOptions',
        'Configurar escolhas das Eldritch Invocations',
        invocationChoiceIssues.map((entry) => entry.message).join(' ')
      )));
    }
    const pactWeaponIssues = validatePactWeaponChoice(character, items);
    if (pactWeaponIssues.length) {
      result.push(reuse(pending(
        'pactWeapon',
        'Invocar arma de pacto',
        pactWeaponIssues.map((entry) => entry.message).join(' ')
      )));
    }
  }

  for (const { item, entity } of classEntries) {
    const subclassItem = getActiveSubclassItemForClass(character, entity.id, items);
    const profile = getClassOrSubclassSpellcastingProfile(item, entity.level, subclassItem, items);
    if (!profile) continue;

    if (profile.preparationMode === 'spellbook') {
      const requirements = getWizardSpellbookFeatureRequirements({
        classItem: item,
        classLevel: entity.level,
        subclassItem,
        items
      });
      const automaticGrants = getAutomaticWizardSpellbookGrantReferences(item, entity.level, subclassItem, items);
      const specialIssues = validateWizardSpellbookFeatureChoices({
        requirements,
        choices: character.buildChoices?.spellbookFeatureChoices ?? [],
        profileByClassItemId: new Map([[item.id, profile]]),
        spellItems: items.filter((candidate) => candidate.type === 'spell' && candidate.status !== 'disabled'),
        normalSpellbookAssignments: character.buildChoices?.spellbookAssignments ?? {},
        automaticGrantSpellItemIdsByClassItemId: new Map([[item.id, new Set(automaticGrants.map((grant) => grant.spellItemId))]]),
        availableSpellbookItemIdsByClassItemId: new Map([[item.id, new Set(
          getSpellbookEntriesForClass(character, entity.id).map((entry) => entry.spellItemId)
        )]]),
        blockedSavantSpellItemIdsByClassItemId: new Map([[item.id, new Set(
          getSpellbookEntriesForClass(character, entity.id)
            .filter((entry) => entry.acquisition !== 'savant')
            .map((entry) => entry.spellItemId)
        )]]),
        requireExact: true
      });
      if (specialIssues.length) {
        result.push(reuse(pending(
          'spellbookFeature',
          `Configurar regras especiais do spellbook de ${entity.name}`,
          specialIssues.map((entry) => entry.message).join(' '),
          { sourceItemId: requirements[0]?.featureItemId ?? item.id, sourceEntityId: entity.id }
        )));
      }
    }

    const normalCounts = countCharacterSpellsForClass(character.spells, entity.id);
    const cantrips = normalCounts.cantrips;
    const leveled = normalCounts.prepared;
    const spellbookEntries = profile.preparationMode === 'spellbook'
      ? getSpellbookEntriesForClass(character, entity.id)
      : [];
    const missingCantrips = Math.max(0, profile.cantripLimit - cantrips);
    const missingPrepared = Math.max(0, profile.preparedSpellLimit - leveled);
    const normalSpellbookEntryCount = spellbookEntries.filter((entry) => entry.acquisition !== 'savant' && entry.acquisition !== 'feature').length;
    const missingSpellbook = profile.preparationMode === 'spellbook'
      ? Math.max(0, profile.spellbookMinimumSpellCount - normalSpellbookEntryCount)
      : 0;

    if (missingCantrips || missingPrepared || missingSpellbook) {
      const parts = [
        missingCantrips ? `${missingCantrips} cantrip(s)` : undefined,
        missingSpellbook ? `${missingSpellbook} magia(s) para o spellbook` : undefined,
        missingPrepared ? `${missingPrepared} magia(s) preparada(s)/conhecida(s)` : undefined
      ].filter(Boolean).join(', ');
      const requiredCount = profile.cantripLimit
        + profile.preparedSpellLimit
        + (profile.preparationMode === 'spellbook' ? profile.spellbookMinimumSpellCount : 0);
      const currentCount = cantrips + leveled + normalSpellbookEntryCount;
      result.push(reuse(pending('spellSelection', `Completar magias de ${entity.name}`, `Escolha ${parts}.`, {
        sourceItemId: item.id,
        sourceEntityId: entity.id,
        requiredCount,
        currentCount
      })));
    }
  }

  const startingClassItem = items.find((item) => item.id === character.buildChoices?.startingClassItemId);
  const classEquipmentOptions = getStartingEquipmentOptions(startingClassItem, 'class');
  if (classEquipmentOptions.length && !(character.buildChoices?.equipmentSelections ?? []).some((entry) => entry.sourceItemId === startingClassItem?.id)) {
    result.push(reuse(pending('equipment', `Escolher equipamento de ${startingClassItem?.name ?? 'classe inicial'}`, 'Escolha uma opção de equipamento inicial da classe ou ouro.', { sourceItemId: startingClassItem?.id })));
  }

  const customBackground = character.buildChoices?.customBackground;
  if (customBackground) {
    const hasCustomEquipment = (character.buildChoices?.equipmentSelections ?? []).some((entry) => entry.sourceItemId === CUSTOM_BACKGROUND_ITEM_ID);
    if (!hasCustomEquipment) {
      result.push(reuse(pending('equipment', `Escolher equipamento de ${customBackground.name || 'background personalizado'}`, 'Escolha equipamentos gerais até 50 GP ou mantenha os 50 GP.', { sourceItemId: CUSTOM_BACKGROUND_ITEM_ID })));
    }
  } else {
    const backgroundLink = (character.compendiumLinks ?? []).find((entry) => entry.appliedAs === 'background' && entry.status === 'active');
    const backgroundItem = backgroundLink
      ? findCompendiumItemForCharacterLink(items, backgroundLink)
      : undefined;
    const equipmentOptions = getStartingEquipmentOptions(backgroundItem, 'background');
    if (equipmentOptions.length && !(character.buildChoices?.equipmentSelections ?? []).some((entry) => entry.sourceItemId === backgroundItem?.id)) {
      result.push(reuse(pending('equipment', `Escolher equipamento de ${backgroundItem?.name ?? 'background'}`, 'Escolha uma opção de equipamento inicial ou ouro.', { sourceItemId: backgroundItem?.id })));
    }
  }

  return result;
};
