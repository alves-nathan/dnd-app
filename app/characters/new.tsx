import { router } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { Alert, StyleSheet, Text, View } from 'react-native';
import { Button } from '../../src/components/Button';
import { Card } from '../../src/components/Card';
import { ChoiceChipSelector } from '../../src/components/ChoiceChipSelector';
import { EldritchInvocationChoiceEditor } from '../../src/components/EldritchInvocationChoiceEditor';
import { Chip } from '../../src/components/Chip';
import { Field } from '../../src/components/Field';
import { IssueList } from '../../src/components/IssueList';
import { ProgressBar } from '../../src/components/ProgressBar';
import { PaginatedChipList } from '../../src/components/PaginatedChipList';
import { PaginatedOptionCardList } from '../../src/components/PaginatedOptionCardList';
import { Screen } from '../../src/components/Screen';
import { SubclassChoiceEditor } from '../../src/components/SubclassChoiceEditor';
import { getSpellChoiceInlineDescription, SpellChoiceDetails } from '../../src/components/SpellChoiceDetails';
import {
  ABILITY_ORDER,
  POINT_BUY_BUDGET,
  STANDARD_ARRAY,
  abilityScoresFromValues,
  areGeneratedAbilitiesFullyAssigned,
  emptyAbilityScores,
  isGeneratedValueAssignedElsewhere,
  isValidPointBuy,
  pointBuySpent,
  pointBuyState,
  rollAbilitySet,
  standardArrayState,
  toggleGeneratedAbilityAssignment,
  type GeneratedAbilityAssignments
} from '../../src/characters/abilityGeneration';
import {
  getFeatCategory,
  getFeatMinimumLevel,
  getProgressionFeatChoiceRequirements,
  isFeatRepeatable,
  validateBuildPrerequisites,
  validateFeatPrerequisites,
  validateMulticlassPrerequisites
} from '../../src/characters/characterBuildRules';
import {
  backgroundSuggestions,
  getBackgroundAbilityOptions,
  speciesHasIgnoredAbilityScoreIncrease,
  getCompendiumChoiceDescription,
  getSelectableFeatCandidates,
  getSelectableSpellCandidates,
  isOriginFeatItem,
  itemReferenceMatches
} from '../../src/characters/creationData';
import { buildProficiencySelection } from '../../src/characters/proficiencyRules';
import {
  backgroundChoiceForRequirement,
  getBackgroundChoiceRequirements,
  setBackgroundChoiceOption,
  validateBackgroundChoices
} from '../../src/characters/backgroundChoiceRules';
import { isPlayerCharacterClassItem, isSidekickClassItem } from '../../src/characters/classSelectionRules';
import {
  CUSTOM_BACKGROUND_ABILITY_COUNT,
  CUSTOM_BACKGROUND_EQUIPMENT_BUDGET_COPPER,
  CUSTOM_BACKGROUND_ITEM_ID,
  CUSTOM_BACKGROUND_SKILL_COUNT,
  CUSTOM_BACKGROUND_TOOL_COUNT,
  createCustomBackgroundCompendiumItem,
  createDefaultCustomBackgroundChoice,
  ensureCustomBackgroundCashEquipmentSelection,
  formatCopperCost,
  getCustomBackgroundEquipmentCandidates,
  getCustomBackgroundEquipmentPurchaseCount,
  getCustomBackgroundEquipmentSpentCopper,
  setCustomBackgroundEquipmentPurchaseCount,
  validateCustomBackgroundEquipmentSelection,
  validateCustomBackgroundOrigin,
  validateCustomBackgroundProficiencies,
  type CustomBackgroundEquipmentCandidate
} from '../../src/characters/customBackgroundRules';
import {
  getEldritchInvocationLimit,
  getEldritchInvocationMinimumLevel,
  getEldritchInvocationPrerequisiteIssues,
  findEldritchInvocationById,
  getLevelAvailableEldritchInvocations,
  getSelectedWarlockLevel,
  isEldritchInvocationRepeatable,
  validateEldritchInvocationSelection
} from '../../src/characters/eldritchInvocationRules';
import { getEldritchInvocationCardAction, isEldritchInvocationCardDisabled } from '../../src/characters/eldritchInvocationInteraction';
import { applyEldritchInvocationSelection } from '../../src/characters/eldritchInvocationSelection';
import {
  applyEldritchInvocationChoices,
  validateEldritchInvocationChoices
} from '../../src/characters/eldritchInvocationChoiceRules';
import {
  applyFeatChoiceEffects,
  emptyFeatChoice,
  featChoiceKey,
  getFeatChoiceSchema,
  isSpellItemEligibleForGenericFeatChoice,
  isWeaponItemEligibleForMasteryWithProficiencies,
  validateFeatChoiceSequence
} from '../../src/characters/featChoiceRules';
import {
  applyStartingEquipmentSelections,
  createEquipmentSelection,
  getStartingEquipmentOptions,
  validateStartingEquipmentSelections
} from '../../src/characters/startingEquipmentRules';
import {
  describeMagicItemAllowance,
  generateHigherLevelStartingBenefits,
  getHigherLevelStartingGuidance
} from '../../src/characters/higherLevelStartingRules';
import { reconcileCharacterSpellSlots } from '../../src/characters/spellSlotProgression';
import { learnSpellbookSpell, prepareSpellbookSpell } from '../../src/characters/spellbookRules';
import { reconcileCharacterBuild } from '../../src/characters/buildReconciliation';
import {
  getClassFeaturePreview,
  getClassSelectionDescription,
  getSpeciesFeaturePreview,
  getSpeciesSelectionDescription
} from '../../src/characters/selectionPreview';
import {
  getSubclassChoiceRequirements,
  getSubclassSpellListReferences,
  pruneSubclassChoices,
  validateSubclassChoices
} from '../../src/characters/subclassChoiceRules';
import {
  applyAutomaticSpeciesProgression,
  applyDirectSpeciesChoiceEffects,
  getSpeciesChoiceProficiencyGrants,
  getSpeciesChoiceRequirements,
  getSpeciesFeatChoiceRequirement,
  getSpeciesFeatureItems,
  setSpeciesChoiceOption,
  setSpeciesChoiceSkill,
  setSpeciesChoiceSpellcastingAbility,
  speciesChoiceForRequirement,
  validateSpeciesChoices
} from '../../src/characters/speciesChoiceRules';
import { SKILLS } from '../../src/characters/proficiencies';
import {
  ALL_TOOL_OPTIONS,
  COMMON_LANGUAGE,
  STANDARD_LANGUAGE_OPTIONS
} from '../../src/characters/choiceOptions';
import {
  annotateLatestSpellWithClass,
  getSpellcastingProfiles,
  isSpellItemEligibleForProfile,
  spellItemClasses,
  spellItemLevel,
  validateSpellAssignments
} from '../../src/characters/spellcastingRules';
import {
  reconcileSpellAssignmentReferences
} from '../../src/characters/spellAssignmentReferences';
import {
  applyAutomaticClassProgression,
  getCompendiumClassReference,
  getSubclassUnlockLevel
} from '../../src/compendium/classProgression';
import { applyCompendiumItemToCharacter } from '../../src/compendium/mapper';
import type { StoredCompendiumItem } from '../../src/compendium/types';
import { createEmptyCharacter, manualSource } from '../../src/data/mockData';
import { CHARACTER_CREATION_DRAFT_VERSION, type CharacterCreationDraft } from '../../src/characters/creationDraft';
import { characterCreationDraftRepository } from '../../src/characters/creationDraftRepository';
import { useCharacterStore } from '../../src/store/characterStore';
import { useCompendiumStore } from '../../src/store/compendiumStore';
import { useCharacterChoiceBridge } from '../../src/catalog/useCharacterChoiceBridge';
import { getCompendiumReviewTargetId } from '../../src/catalog/compendiumReviewTarget';
import { useAppTheme } from '../../src/theme';
import { createId } from '../../src/utils/id';
import type {
  AbilityGenerationMethod,
  AbilityGenerationState,
  AbilityScore,
  AbilityScores,
  Character,
  CharacterBackgroundChoice,
  CharacterEldritchInvocationChoice,
  CharacterEquipmentSelection,
  CharacterFeatChoice,
  CharacterHigherLevelStartingBenefits,
  CharacterSpeciesChoice,
  CharacterSubclassChoice
} from '../../src/types';

const steps = [
  'Níveis e classes',
  'Origem',
  'Subclasses, feats e invocations',
  'Atributos',
  'Proficiências',
  'Equipamento',
  'Magias',
  'Nome e revisão'
];

const abilityLabels: Record<AbilityScore, string> = {
  STR: 'Força',
  DEX: 'Destreza',
  CON: 'Constituição',
  INT: 'Inteligência',
  WIS: 'Sabedoria',
  CHA: 'Carisma'
};

const csv = (value: string): string[] =>
  value.split(',').map((entry) => entry.trim()).filter(Boolean);

const asRecord = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
const normalized = (value: string): string => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase();

const addBonuses = (
  base: AbilityScores,
  bonuses: Partial<Record<AbilityScore, number>>
): AbilityScores => ({
  STR: Math.min(20, base.STR + (bonuses.STR ?? 0)),
  DEX: Math.min(20, base.DEX + (bonuses.DEX ?? 0)),
  CON: Math.min(20, base.CON + (bonuses.CON ?? 0)),
  INT: Math.min(20, base.INT + (bonuses.INT ?? 0)),
  WIS: Math.min(20, base.WIS + (bonuses.WIS ?? 0)),
  CHA: Math.min(20, base.CHA + (bonuses.CHA ?? 0))
});

const countSelectedFeatsByCategory = (
  counts: Record<string, number>,
  allItems: StoredCompendiumItem[],
  category: 'general' | 'fightingStyle' | 'epicBoon'
): number =>
  Object.entries(counts).reduce((sum, [itemId, count]) => {
    const item = allItems.find((candidate) => candidate.id === itemId);
    return item && getFeatCategory(item) === category ? sum + count : sum;
  }, 0);

export default function NewCharacterScreen() {
  const { colors } = useAppTheme();
  const [step, setStep] = useState(0);
  const [name, setName] = useState('');
  const [targetLevel, setTargetLevel] = useState('1');
  const [classSearch, setClassSearch] = useState('');
  const [selectedClassLevels, setSelectedClassLevels] = useState<Record<string, number>>({});
  const [startingClassItemId, setStartingClassItemId] = useState<string>();
  const [selectedSpeciesId, setSelectedSpeciesId] = useState<string>();
  const [speciesChoices, setSpeciesChoices] = useState<CharacterSpeciesChoice[]>([]);
  const [selectedSpeciesFeatId, setSelectedSpeciesFeatId] = useState<string>();
  const [selectedBackgroundId, setSelectedBackgroundId] = useState<string>();
  const [backgroundChoices, setBackgroundChoices] = useState<CharacterBackgroundChoice[]>([]);
  const [customBackground, setCustomBackground] = useState(createDefaultCustomBackgroundChoice);
  const [customEquipmentSearch, setCustomEquipmentSearch] = useState('');
  const [selectedSubclassByClass, setSelectedSubclassByClass] = useState<Record<string, string>>({});
  const [subclassChoices, setSubclassChoices] = useState<CharacterSubclassChoice[]>([]);
  const [selectedOriginFeatId, setSelectedOriginFeatId] = useState<string>();
  const [selectedFeatCounts, setSelectedFeatCounts] = useState<Record<string, number>>({});
  const [selectedInvocationCounts, setSelectedInvocationCounts] = useState<Record<string, number>>({});
  const [eldritchInvocationChoices, setEldritchInvocationChoices] = useState<CharacterEldritchInvocationChoice[]>([]);
  const [featChoiceDrafts, setFeatChoiceDrafts] = useState<Record<string, CharacterFeatChoice>>({});
  const [equipmentSelections, setEquipmentSelections] = useState<CharacterEquipmentSelection[]>([]);
  const [higherLevelStartingBenefits, setHigherLevelStartingBenefits] = useState<CharacterHigherLevelStartingBenefits>();
  const [bonusMode, setBonusMode] = useState<'twoOne' | 'threeOnes'>('twoOne');
  const [bonusAbilities, setBonusAbilities] = useState<AbilityScore[]>(['STR', 'DEX']);
  const [abilityMethod, setAbilityMethod] = useState<AbilityGenerationMethod>('standardArray');
  const [abilityGeneration, setAbilityGeneration] = useState<AbilityGenerationState>(standardArrayState());
  const [abilityValueAssignments, setAbilityValueAssignments] = useState<GeneratedAbilityAssignments>({});
  const [baseAbilities, setBaseAbilities] = useState<AbilityScores>(() => emptyAbilityScores());
  const [classSkillChoices, setClassSkillChoices] = useState<string[]>([]);
  const [classToolChoicesText, setClassToolChoicesText] = useState('');
  const [backgroundToolChoicesText, setBackgroundToolChoicesText] = useState('');
  const [expertiseSkills, setExpertiseSkills] = useState<string[]>([]);
  const [languagesText, setLanguagesText] = useState('');
  const [classLanguagesText, setClassLanguagesText] = useState('');
  const [spellSearch, setSpellSearch] = useState('');
  const [activeSpellClassItemId, setActiveSpellClassItemId] = useState<string>();
  const [spellAssignments, setSpellAssignments] = useState<Record<string, string>>({});
  const [spellbookAssignments, setSpellbookAssignments] = useState<Record<string, string>>({});
  const [focusedSpellItemId, setFocusedSpellItemId] = useState<string>();
  const [draftHydrated, setDraftHydrated] = useState(false);
  const [draftUpdatedAt, setDraftUpdatedAt] = useState<string>();
  const [draftSaveError, setDraftSaveError] = useState<string>();

  const addCharacter = useCharacterStore((state) => state.addCharacter);
  const updateCharacter = useCharacterStore((state) => state.updateCharacter);
  const choiceBridge = useCharacterChoiceBridge();
  const { items, enabledSourceIds, searchItems, catalogSnapshotId, choiceForItemId } = choiceBridge;
  const updateItemsReview = useCompendiumStore((state) => state.updateItemsReview);
  const hydrate = useCompendiumStore((state) => state.hydrate);
  const isHydrated = useCompendiumStore((state) => state.isHydrated);
  const isHydrating = useCompendiumStore((state) => state.isHydrating);

  useEffect(() => {
    if (!isHydrated && !isHydrating) void hydrate();
  }, [hydrate, isHydrated, isHydrating]);

  useEffect(() => {
    let active = true;
    void characterCreationDraftRepository.load().then((draft) => {
      if (!active) return;
      if (draft) {
        setStep(draft.step);
        setName(draft.name);
        setTargetLevel(draft.targetLevel);
        setClassSearch(draft.classSearch);
        setSelectedClassLevels(draft.selectedClassLevels);
        setStartingClassItemId(draft.startingClassItemId);
        setSelectedSpeciesId(draft.selectedSpeciesId);
        setSpeciesChoices(draft.speciesChoices);
        setSelectedSpeciesFeatId(draft.selectedSpeciesFeatId);
        setSelectedBackgroundId(draft.selectedBackgroundId);
        setBackgroundChoices(draft.backgroundChoices ?? []);
        setCustomBackground(draft.customBackground ?? createDefaultCustomBackgroundChoice());
        setSelectedSubclassByClass(draft.selectedSubclassByClass);
        setSubclassChoices(draft.subclassChoices ?? []);
        setSelectedOriginFeatId(draft.selectedOriginFeatId);
        setSelectedFeatCounts(draft.selectedFeatCounts);
        setSelectedInvocationCounts(draft.selectedInvocationCounts);
        setEldritchInvocationChoices(draft.eldritchInvocationChoices);
        setFeatChoiceDrafts(draft.featChoiceDrafts);
        setEquipmentSelections(draft.equipmentSelections);
        setHigherLevelStartingBenefits(draft.higherLevelStartingBenefits);
        setBonusMode(draft.bonusMode);
        setBonusAbilities(draft.bonusAbilities.length ? draft.bonusAbilities : ['STR', 'DEX']);
        setAbilityMethod(draft.abilityMethod);
        setAbilityGeneration(draft.abilityGeneration);
        setAbilityValueAssignments(draft.abilityValueAssignments ?? {});
        setBaseAbilities(
          (draft.abilityMethod === 'standardArray' || draft.abilityMethod === 'diceRoll') && !Object.keys(draft.abilityValueAssignments ?? {}).length
            ? emptyAbilityScores()
            : draft.baseAbilities
        );
        setClassSkillChoices(draft.classSkillChoices);
        setClassToolChoicesText(draft.classToolChoicesText);
        setBackgroundToolChoicesText(draft.backgroundToolChoicesText ?? '');
        setExpertiseSkills(draft.expertiseSkills);
        setLanguagesText(draft.languagesText);
        setClassLanguagesText(draft.classLanguagesText ?? '');
        setSpellSearch(draft.spellSearch);
        setActiveSpellClassItemId(draft.activeSpellClassItemId);
        setSpellAssignments(draft.spellAssignments);
        setSpellbookAssignments(draft.spellbookAssignments);
        setDraftUpdatedAt(draft.updatedAt);
      }
      setDraftHydrated(true);
    }).catch(() => {
      if (!active) return;
      setDraftHydrated(true);
      setDraftSaveError('Não foi possível carregar o rascunho salvo.');
    });
    return () => { active = false; };
  }, []);

  const classes = useMemo(
    () => searchItems(classSearch, { types: ['class'], statuses: ['validated'], onlyEnabled: true })
      .filter(isPlayerCharacterClassItem)
      .slice(0, 30),
    [classSearch, enabledSourceIds, items, searchItems]
  );
  const classChoices = useMemo(
    () => choiceBridge.choices.filter((choice) => choice.kind === 'class'),
    [choiceBridge.choices]
  );
  const classesBlockedByCatalogFilters = useMemo(
    () => classChoices.some((choice) => choice.blockedReasons.some((reason) =>
      reason.code === 'sourceBookDisabled' || reason.code === 'categoryDisabled' || reason.code === 'entityDisabled'
    )),
    [classChoices]
  );
  const classesMissingMechanicalPayload = useMemo(
    () => classChoices.some((choice) => choice.blockedReasons.some((reason) => reason.code === 'catalogPayloadUnavailable')),
    [classChoices]
  );
  const classSearchHasNoMatches = Boolean(classSearch.trim()) &&
    classChoices.some((choice) => choice.available) &&
    classes.length === 0;
  const species = useMemo(
    () => searchItems('', { types: ['species'], statuses: ['validated'], onlyEnabled: true }).slice(0, 30),
    [enabledSourceIds, items, searchItems]
  );
  const backgrounds = useMemo(
    () => searchItems('', { types: ['background'], statuses: ['validated'], onlyEnabled: true }).slice(0, 30),
    [enabledSourceIds, items, searchItems]
  );
  const selectableFeatCandidates = useMemo(
    () => getSelectableFeatCandidates(items, enabledSourceIds),
    [enabledSourceIds, items]
  );
  const allSpells = useMemo(
    () => getSelectableSpellCandidates(items, enabledSourceIds),
    [enabledSourceIds, items]
  );
  const spellReferenceItems = useMemo(
    () => items.filter((item) => item.type === 'spell'),
    [items]
  );
  const originFeatCandidates = useMemo(
    () => selectableFeatCandidates.filter(isOriginFeatItem),
    [selectableFeatCandidates]
  );


  const currentDraft = useMemo<CharacterCreationDraft>(() => ({
    version: CHARACTER_CREATION_DRAFT_VERSION,
    updatedAt: new Date(0).toISOString(),
    step,
    name,
    targetLevel,
    classSearch,
    selectedClassLevels,
    startingClassItemId,
    selectedSpeciesId,
    speciesChoices,
    selectedSpeciesFeatId,
    selectedBackgroundId,
    backgroundChoices,
    customBackground,
    selectedSubclassByClass,
    subclassChoices,
    selectedOriginFeatId,
    selectedFeatCounts,
    selectedInvocationCounts,
    eldritchInvocationChoices,
    featChoiceDrafts,
    equipmentSelections,
    higherLevelStartingBenefits,
    bonusMode,
    bonusAbilities,
    abilityMethod,
    abilityGeneration,
    abilityValueAssignments,
    baseAbilities,
    classSkillChoices,
    classToolChoicesText,
    backgroundToolChoicesText,
    expertiseSkills,
    languagesText,
    classLanguagesText,
    spellSearch,
    activeSpellClassItemId,
    spellAssignments,
    spellbookAssignments
  }), [
    activeSpellClassItemId,
    abilityGeneration,
    abilityMethod,
    abilityValueAssignments,
    baseAbilities,
    bonusAbilities,
    bonusMode,
    classSearch,
    classSkillChoices,
    classToolChoicesText,
    backgroundToolChoicesText,
    customBackground,
    equipmentSelections,
    higherLevelStartingBenefits,
    expertiseSkills,
    featChoiceDrafts,
    languagesText,
    classLanguagesText,
    name,
    selectedBackgroundId,
    backgroundChoices,
    selectedClassLevels,
    selectedFeatCounts,
    selectedInvocationCounts,
    eldritchInvocationChoices,
    selectedOriginFeatId,
    selectedSpeciesId,
    speciesChoices,
    selectedSpeciesFeatId,
    selectedSubclassByClass,
    subclassChoices,
    spellAssignments,
    spellSearch,
    spellbookAssignments,
    startingClassItemId,
    step,
    targetLevel
  ]);

  useEffect(() => {
    if (!draftHydrated) return;
    const timer = setTimeout(() => {
      const updatedAt = new Date().toISOString();
      void characterCreationDraftRepository
        .save({ ...currentDraft, updatedAt })
        .then(() => {
          setDraftUpdatedAt(updatedAt);
          setDraftSaveError(undefined);
        })
        .catch(() => setDraftSaveError('Não foi possível salvar o rascunho automaticamente.'));
    }, 450);
    return () => clearTimeout(timer);
  }, [currentDraft, draftHydrated]);

  const selectedClassItems = Object.entries(selectedClassLevels)
    .map(([itemId, level]) => ({ item: items.find((entry) => entry.id === itemId), level }))
    .filter((entry): entry is { item: StoredCompendiumItem; level: number } => Boolean(entry.item));

  useEffect(() => {
    const blockedIds = new Set(
      Object.keys(selectedClassLevels).filter((itemId) => {
        const item = items.find((entry) => entry.id === itemId);
        return item ? isSidekickClassItem(item) : false;
      })
    );
    if (!blockedIds.size) return;
    setSelectedClassLevels((current) => Object.fromEntries(
      Object.entries(current).filter(([itemId]) => !blockedIds.has(itemId))
    ));
  }, [items, selectedClassLevels]);
  const allocatedLevel = selectedClassItems.reduce((sum, entry) => sum + entry.level, 0);
  const desiredLevel = Math.max(1, Math.min(20, Number(targetLevel) || 1));
  const classAllocationValid =
    selectedClassItems.length > 0 &&
    allocatedLevel === desiredLevel &&
    selectedClassItems.every(({ item }) => item.status === 'validated' && isPlayerCharacterClassItem(item));

  const higherLevelStartingGuidance = getHigherLevelStartingGuidance(desiredLevel);

  useEffect(() => {
    if (higherLevelStartingBenefits && higherLevelStartingBenefits.startingLevel !== desiredLevel) {
      setHigherLevelStartingBenefits(undefined);
    }
  }, [desiredLevel, higherLevelStartingBenefits]);

  useEffect(() => {
    if (!selectedClassItems.length) {
      setStartingClassItemId(undefined);
      return;
    }
    if (!startingClassItemId || !selectedClassItems.some(({ item }) => item.id === startingClassItemId)) {
      setStartingClassItemId(selectedClassItems[0]?.item.id);
    }
  }, [selectedClassLevels, startingClassItemId]);

  const isCustomBackground = selectedBackgroundId === CUSTOM_BACKGROUND_ITEM_ID;
  const selectedBackground = isCustomBackground
    ? createCustomBackgroundCompendiumItem(customBackground)
    : items.find((item) => item.id === selectedBackgroundId);
  const selectedSpecies = items.find((item) => item.id === selectedSpeciesId);
  const backgroundChoiceRequirements = useMemo(() => getBackgroundChoiceRequirements(selectedBackground), [selectedBackgroundId, selectedBackground?.id]);
  const backgroundChoiceIssues = useMemo(() => validateBackgroundChoices(backgroundChoiceRequirements, backgroundChoices), [backgroundChoiceRequirements, backgroundChoices]);
  const backgroundDefaults = backgroundSuggestions(selectedBackground);
  const backgroundAbilityOptions = getBackgroundAbilityOptions(selectedBackground);
  const backgroundUsesFreeAbilitySelection = Boolean(selectedBackground && backgroundDefaults.abilityOptions.length === 0);
  const speciesAbilityScoreIncreaseIgnored = speciesHasIgnoredAbilityScoreIncrease(selectedSpecies);
  const backgroundSkillKey = backgroundDefaults.proficiencies.skills.join('|');
  useEffect(() => {
    if (!backgroundDefaults.proficiencies.skills.length) return;
    setClassSkillChoices((current) => {
      const next = current.filter((skill) => !backgroundDefaults.proficiencies.skills.includes(skill));
      return next.length === current.length ? current : next;
    });
  }, [selectedBackgroundId, backgroundSkillKey]);
  const suggestedOriginFeat = backgroundDefaults.featIds
    .map((reference) => originFeatCandidates.find((feat) => itemReferenceMatches(feat, reference)))
    .find(Boolean);
  const selectedOriginFeat = items.find((item) => item.id === selectedOriginFeatId);
  const speciesFeatRequirement = getSpeciesFeatChoiceRequirement(selectedSpecies);
  const speciesFeatCandidates = useMemo(
    () => speciesFeatRequirement
      ? selectableFeatCandidates.filter((item) =>
          getFeatCategory(item) !== 'epicBoon' &&
          getFeatMinimumLevel(item) <= speciesFeatRequirement.acquisitionLevel
        )
      : [],
    [selectableFeatCandidates, speciesFeatRequirement?.speciesItemId, speciesFeatRequirement?.acquisitionLevel]
  );
  const selectedSpeciesFeat = items.find((item) => item.id === selectedSpeciesFeatId && item.type === 'feat');
  const speciesChoiceRequirements = useMemo(
    () => getSpeciesChoiceRequirements(selectedSpecies, items, desiredLevel),
    [selectedSpeciesId, items, desiredLevel]
  );
  const speciesChoiceIssues = useMemo(
    () => validateSpeciesChoices(speciesChoiceRequirements, speciesChoices),
    [speciesChoiceRequirements, speciesChoices]
  );
  const speciesChoiceProficiencyGrants = useMemo(
    () => getSpeciesChoiceProficiencyGrants(speciesChoiceRequirements, speciesChoices),
    [speciesChoiceRequirements, speciesChoices]
  );
  useEffect(() => {
    if (!speciesFeatRequirement && selectedSpeciesFeatId) {
      setSelectedSpeciesFeatId(undefined);
      return;
    }
    if (selectedSpeciesFeatId && !speciesFeatCandidates.some((item) => item.id === selectedSpeciesFeatId)) {
      setSelectedSpeciesFeatId(undefined);
    }
  }, [speciesFeatRequirement?.speciesItemId, speciesFeatCandidates, selectedSpeciesFeatId]);
  const selectedSpeciesFeatureItems = useMemo(
    () => getSpeciesFeatureItems(selectedSpecies, items),
    [selectedSpeciesId, items]
  );
  const selectedSpeciesFeaturePreview = useMemo(
    () => getSpeciesFeaturePreview(selectedSpecies, items, desiredLevel),
    [selectedSpeciesId, items, desiredLevel]
  );
  const customBackgroundOriginIssues = isCustomBackground ? validateCustomBackgroundOrigin(customBackground) : [];
  const originStepIssues = useMemo(() => {
    const issues = [...speciesChoiceIssues, ...backgroundChoiceIssues, ...customBackgroundOriginIssues];
    if (!selectedSpecies) issues.push({ severity: 'error' as const, code: 'SPECIES_REQUIRED', message: 'Escolha uma espécie.' });
    if (selectedSpecies && selectedSpecies.status !== 'validated') issues.push({ severity: 'error' as const, code: 'SPECIES_NOT_VALIDATED', message: 'Confirme novamente a espécie para validar seus dados.' });
    if (selectedSpeciesFeatureItems.some((item) => item.status !== 'validated')) issues.push({ severity: 'error' as const, code: 'SPECIES_FEATURES_NOT_VALIDATED', message: 'Confirme novamente a espécie para validar as traits vinculadas.' });
    if (!selectedBackground) issues.push({ severity: 'error' as const, code: 'BACKGROUND_REQUIRED', message: 'Escolha um background.' });
    if (selectedBackground && selectedBackground.status !== 'validated') issues.push({ severity: 'error' as const, code: 'BACKGROUND_NOT_VALIDATED', message: 'O background selecionado ficou indisponível. Escolha outro ou reative sua fonte.' });
    if (speciesFeatRequirement && !selectedSpeciesFeat) issues.push({ severity: 'error' as const, code: 'SPECIES_FEAT_REQUIRED', message: `${selectedSpecies?.name ?? 'A espécie'} exige a escolha de um feat adicional.` });
    if (selectedSpeciesFeat && selectedSpeciesFeat.status !== 'validated') issues.push({ severity: 'error' as const, code: 'SPECIES_FEAT_NOT_VALIDATED', message: 'Confirme novamente o feat concedido pela espécie para validá-lo.' });
    if (!selectedOriginFeat) issues.push({ severity: 'error' as const, code: 'ORIGIN_FEAT_REQUIRED', message: 'Escolha um Origin Feat.' });
    if (selectedOriginFeat && selectedOriginFeat.status !== 'validated') issues.push({ severity: 'error' as const, code: 'ORIGIN_FEAT_NOT_VALIDATED', message: 'Confirme novamente o Origin Feat para validá-lo.' });
    return issues;
  }, [selectedSpecies, selectedSpeciesFeatureItems, selectedSpeciesFeat, speciesFeatRequirement, selectedBackground, selectedOriginFeat, speciesChoiceIssues, backgroundChoiceIssues, customBackgroundOriginIssues]);
  const startingClassEntry = selectedClassItems.find(({ item }) => item.id === startingClassItemId);

  const eligibleSubclasses = useMemo(
    () => selectedClassItems.map(({ item: classItem, level }) => ({
      classItem,
      level,
      subclasses: searchItems('', { types: ['subclass'], statuses: ['validated'], onlyEnabled: true })
        .filter((subclass) =>
          getCompendiumClassReference(subclass) === classItem.importItemId &&
          getSubclassUnlockLevel(subclass) <= level
        )
        .slice(0, 20)
    })),
    [enabledSourceIds, items, searchItems, selectedClassLevels]
  );

  const selectedSubclassEntries = useMemo(() => eligibleSubclasses.flatMap(({ classItem, level, subclasses }) => {
    const selectedId = selectedSubclassByClass[classItem.id];
    const subclassItem = subclasses.find((candidate) => candidate.id === selectedId);
    return subclassItem ? [{ classItem, classLevel: level, subclassItem }] : [];
  }), [eligibleSubclasses, selectedSubclassByClass]);

  const subclassChoiceRequirements = useMemo(
    () => selectedSubclassEntries.flatMap(({ subclassItem, classLevel }) =>
      getSubclassChoiceRequirements(subclassItem, items, classLevel)
    ),
    [items, selectedSubclassEntries]
  );
  const subclassChoiceIssues = useMemo(
    () => validateSubclassChoices(subclassChoiceRequirements, subclassChoices),
    [subclassChoiceRequirements, subclassChoices]
  );
  const subclassSpellReferencesByClassItemId = useMemo(() => Object.fromEntries(
    selectedSubclassEntries.map(({ classItem, subclassItem, classLevel }) => [
      classItem.id,
      getSubclassSpellListReferences(subclassItem, subclassChoices, items, classLevel)
    ])
  ), [items, selectedSubclassEntries, subclassChoices]);

  useEffect(() => {
    if (choiceBridge.status !== 'ready') return;
    setSubclassChoices((current) => {
      const pruned = pruneSubclassChoices(current, subclassChoiceRequirements);
      const unchanged = pruned.length === current.length && pruned.every((choice, index) =>
        choice.subclassItemId === current[index]?.subclassItemId &&
        choice.choiceId === current[index]?.choiceId &&
        choice.optionId === current[index]?.optionId
      );
      return unchanged ? current : pruned;
    });
  }, [choiceBridge.status, subclassChoiceRequirements]);

  const featRequirements = useMemo(
    () => getProgressionFeatChoiceRequirements(selectedClassItems, items),
    [items, selectedClassLevels]
  );
  const selectedGeneralCount = countSelectedFeatsByCategory(selectedFeatCounts, items, 'general');
  const selectedFightingStyleCount = countSelectedFeatsByCategory(selectedFeatCounts, items, 'fightingStyle');
  const selectedEpicBoonCount = countSelectedFeatsByCategory(selectedFeatCounts, items, 'epicBoon');

  const warlockLevel = getSelectedWarlockLevel(selectedClassItems);
  const invocationLimit = getEldritchInvocationLimit(warlockLevel, selectedClassItems, items);
  const invocationCandidates = useMemo(
    () => getLevelAvailableEldritchInvocations(items, enabledSourceIds, warlockLevel),
    [enabledSourceIds, items, warlockLevel]
  );
  const selectedInvocationCount = Object.values(selectedInvocationCounts).reduce(
    (sum, count) => sum + Math.max(0, Math.floor(count)),
    0
  );
  const invocationIssues = useMemo(
    () => validateEldritchInvocationSelection(
      selectedClassItems,
      items,
      enabledSourceIds,
      selectedInvocationCounts
    ),
    [enabledSourceIds, items, selectedClassLevels, selectedInvocationCounts]
  );
  const invocationChoiceIssues = useMemo(
    () => validateEldritchInvocationChoices(
      selectedInvocationCounts,
      eldritchInvocationChoices,
      items,
      enabledSourceIds,
      {
        selectedOriginFeatItemIds: [selectedOriginFeatId, selectedSpeciesFeatId].filter((value): value is string => Boolean(value))
      }
    ),
    [eldritchInvocationChoices, enabledSourceIds, items, selectedInvocationCounts, selectedOriginFeatId, selectedSpeciesFeatId]
  );
  const allInvocationIssues = [...invocationIssues, ...invocationChoiceIssues];

  const bonuses = useMemo<Partial<Record<AbilityScore, number>>>(() => {
    const result: Partial<Record<AbilityScore, number>> = {};
    if (bonusMode === 'twoOne') {
      if (bonusAbilities[0]) result[bonusAbilities[0]] = 2;
      if (bonusAbilities[1] && bonusAbilities[1] !== bonusAbilities[0]) result[bonusAbilities[1]] = 1;
    } else {
      for (const ability of bonusAbilities.slice(0, 3)) result[ability] = 1;
    }
    return result;
  }, [bonusAbilities, bonusMode]);
  const finalAbilities = useMemo(() => addBonuses(baseAbilities, bonuses), [baseAbilities, bonuses]);
  const pointBuyValid = abilityMethod !== 'pointBuy' || isValidPointBuy(baseAbilities);
  const generatedAbilityAssignmentsComplete = (abilityMethod !== 'standardArray' && abilityMethod !== 'diceRoll')
    || areGeneratedAbilitiesFullyAssigned(abilityValueAssignments, abilityGeneration.generatedValues);

  const proficiencySelection = useMemo(
    () => buildProficiencySelection({
      startingClassItem: startingClassEntry?.item,
      startingClassLevel: startingClassEntry?.level,
      backgroundItem: selectedBackground,
      allItems: items,
      classSkillChoices,
      classToolChoices: csv(classToolChoicesText),
      backgroundToolChoices: csv(backgroundToolChoicesText),
      expertiseSkills,
      languages: csv(languagesText),
      classLanguageChoices: csv(classLanguagesText),
      fixedLanguages: [COMMON_LANGUAGE],
      speciesSkillGrants: speciesChoiceProficiencyGrants.skills,
      speciesLanguageGrants: speciesChoiceProficiencyGrants.languages,
      requiredLanguageChoiceCount: 2,
      allowedLanguageOptions: STANDARD_LANGUAGE_OPTIONS
    }),
    [
      startingClassEntry?.item.id,
      startingClassEntry?.level,
      selectedBackgroundId,
      customBackground,
      items,
      classSkillChoices,
      classToolChoicesText,
      backgroundToolChoicesText,
      expertiseSkills,
      languagesText,
      classLanguagesText,
      speciesChoiceProficiencyGrants.skills.join('|'),
      speciesChoiceProficiencyGrants.languages.join('|')
    ]
  );

  const inheritedBackgroundTools = Array.from(new Set([
    ...(proficiencySelection.backgroundRequirement?.fixedTools ?? []),
    ...csv(backgroundToolChoicesText),
    ...(isCustomBackground && customBackground.toolProficiency ? [customBackground.toolProficiency] : [])
  ]));
  const inheritedBackgroundToolKey = inheritedBackgroundTools.join('|');
  useEffect(() => {
    const inherited = new Set(inheritedBackgroundToolKey.split('|').filter(Boolean));
    if (!inherited.size) return;
    setClassToolChoicesText((current) => {
      const next = csv(current).filter((tool) => !inherited.has(tool)).join(', ');
      return next === current ? current : next;
    });
  }, [inheritedBackgroundToolKey]);

  const speciesFeatPrerequisiteIssues = useMemo(
    () => selectedSpeciesFeat ? validateFeatPrerequisites({
      featItem: selectedSpeciesFeat,
      totalLevel: speciesFeatRequirement?.acquisitionLevel ?? 1,
      abilities: finalAbilities,
      proficiencies: proficiencySelection.proficiencies,
      classEntries: selectedClassItems,
      allItems: items,
      currentCopies: selectedOriginFeat?.id === selectedSpeciesFeat.id ? 1 : 0
    }) : [],
    [selectedSpeciesFeatId, speciesFeatRequirement?.acquisitionLevel, finalAbilities, proficiencySelection.proficiencies, selectedClassLevels, items, selectedOriginFeatId]
  );

  const customBackgroundProficiencyIssues = isCustomBackground
    ? validateCustomBackgroundProficiencies(customBackground)
    : [];
  const proficiencyIssues = [...proficiencySelection.issues, ...customBackgroundProficiencyIssues];
  const proficienciesValid = proficiencyIssues.every((issue) => issue.severity !== 'error');

  const spellProfiles = useMemo(
    () => getSpellcastingProfiles(selectedClassItems),
    [selectedClassLevels, items]
  );
  useEffect(() => {
    if (!spellProfiles.length) {
      setActiveSpellClassItemId(undefined);
      setSpellAssignments({});
      setSpellbookAssignments({});
      return;
    }
    if (!activeSpellClassItemId || !spellProfiles.some((profile) => profile.classItemId === activeSpellClassItemId)) {
      setActiveSpellClassItemId(spellProfiles[0]?.classItemId);
    }
  }, [spellProfiles, activeSpellClassItemId]);

  const activeSpellProfile = spellProfiles.find((profile) => profile.classItemId === activeSpellClassItemId);
  const focusedSpellItem = focusedSpellItemId
    ? allSpells.find((spell) => spell.id === focusedSpellItemId)
    : undefined;
  const visibleSpells = useMemo(() => {
    if (!activeSpellProfile) return [];
    const query = spellSearch.trim().toLowerCase();
    const additionalSpellReferences = subclassSpellReferencesByClassItemId[activeSpellProfile.classItemId] ?? [];
    return allSpells
      .filter((spell) => isSpellItemEligibleForProfile(spell, activeSpellProfile, additionalSpellReferences))
      .filter((spell) => !query || spell.name.toLowerCase().includes(query));
  }, [activeSpellProfile, allSpells, spellSearch, subclassSpellReferencesByClassItemId]);
  const spellReferenceReconciliation = useMemo(
    () => reconcileSpellAssignmentReferences({
      assignments: spellAssignments,
      spellbookAssignments,
      spellItems: spellReferenceItems,
      classItems: selectedClassItems.map(({ item }) => item),
      validClassItemIds: spellProfiles.map((profile) => profile.classItemId),
      validSpellbookClassItemIds: spellProfiles
        .filter((profile) => profile.preparationMode === 'spellbook')
        .map((profile) => profile.classItemId),
      choiceForItemId
    }),
    [spellAssignments, spellbookAssignments, spellReferenceItems, selectedClassItems, spellProfiles, choiceForItemId]
  );
  const effectiveSpellAssignments = spellReferenceReconciliation.assignments;
  const effectiveSpellbookAssignments = spellReferenceReconciliation.spellbookAssignments;

  useEffect(() => {
    if (!draftHydrated || choiceBridge.status !== 'ready' || !spellReferenceReconciliation.changed) return;
    setSpellAssignments(effectiveSpellAssignments);
    setSpellbookAssignments(effectiveSpellbookAssignments);
  }, [
    choiceBridge.status,
    draftHydrated,
    effectiveSpellAssignments,
    effectiveSpellbookAssignments,
    spellReferenceReconciliation.changed
  ]);

  const spellValidation = useMemo(
    () => validateSpellAssignments({
      assignments: effectiveSpellAssignments,
      spellbookAssignments: effectiveSpellbookAssignments,
      spellItems: allSpells,
      profiles: spellProfiles,
      additionalSpellReferencesByClassItemId: subclassSpellReferencesByClassItemId,
      requireExact: false
    }),
    [effectiveSpellAssignments, effectiveSpellbookAssignments, allSpells, spellProfiles, subclassSpellReferencesByClassItemId]
  );
  const spellCompletionValidation = useMemo(
    () => validateSpellAssignments({
      assignments: effectiveSpellAssignments,
      spellbookAssignments: effectiveSpellbookAssignments,
      spellItems: allSpells,
      profiles: spellProfiles,
      additionalSpellReferencesByClassItemId: subclassSpellReferencesByClassItemId,
      requireExact: true
    }),
    [effectiveSpellAssignments, effectiveSpellbookAssignments, allSpells, spellProfiles, subclassSpellReferencesByClassItemId]
  );
  const spellCompletionIssues = spellCompletionValidation.issues.filter((issue) =>
    ['CANTRIP_SELECTION_COUNT', 'PREPARED_SPELL_SELECTION_COUNT', 'SPELLBOOK_SELECTION_COUNT'].includes(issue.code)
  );

  const selectedFeatItems = Object.entries(selectedFeatCounts).flatMap(([itemId, count]) => {
    const item = items.find((candidate) => candidate.id === itemId);
    return item ? Array.from({ length: count }, () => item) : [];
  });
  const allSelectedFeatItems = [selectedOriginFeat, selectedSpeciesFeat, ...selectedFeatItems].filter(
    (item): item is StoredCompendiumItem => Boolean(item)
  );
  const selectedFeatInstances = [
    ...(selectedOriginFeat ? [{ item: selectedOriginFeat, instanceIndex: 0, key: `origin::${selectedOriginFeat.id}::0`, origin: true, species: false }] : []),
    ...(selectedSpeciesFeat ? [{ item: selectedSpeciesFeat, instanceIndex: 0, key: `species::${selectedSpeciesFeat.id}::0`, origin: false, species: true }] : []),
    ...Object.entries(selectedFeatCounts).flatMap(([itemId, count]) => {
      const item = items.find((candidate) => candidate.id === itemId);
      return item ? Array.from({ length: count }, (_, instanceIndex) => ({ item, instanceIndex, key: featChoiceKey(item.id, instanceIndex), origin: false, species: false })) : [];
    })
  ];
  const featChoiceValidationCharacter: Character = {
    ...createEmptyCharacter('Validação da criação'),
    level: desiredLevel,
    abilities: finalAbilities,
    proficiencies: proficiencySelection.proficiencies
  };
  const featChoiceIssues = validateFeatChoiceSequence(
    selectedFeatInstances.map((instance) => ({ item: instance.item, choice: featChoiceDrafts[instance.key] })),
    finalAbilities,
    items,
    featChoiceValidationCharacter
  );

  const startingClassEquipmentOptions = getStartingEquipmentOptions(startingClassEntry?.item, 'class');
  const backgroundEquipmentOptions = isCustomBackground ? [] : getStartingEquipmentOptions(selectedBackground, 'background');
  const equipmentOptionGroups = [startingClassEquipmentOptions, backgroundEquipmentOptions].filter((group) => group.length);
  const customBackgroundEquipmentCandidates = useMemo(
    () => getCustomBackgroundEquipmentCandidates(items, enabledSourceIds),
    [items, enabledSourceIds]
  );
  const customBackgroundEquipmentSpentCopper = isCustomBackground
    ? getCustomBackgroundEquipmentSpentCopper(equipmentSelections, customBackgroundEquipmentCandidates)
    : 0;
  const visibleCustomBackgroundEquipmentCandidates = useMemo(() => {
    const query = customEquipmentSearch.trim().toLowerCase();
    return customBackgroundEquipmentCandidates.filter((candidate) =>
      !query || candidate.item.name.toLowerCase().includes(query)
    );
  }, [customBackgroundEquipmentCandidates, customEquipmentSearch]);
  const customBackgroundEquipmentIssues = isCustomBackground
    ? validateCustomBackgroundEquipmentSelection(equipmentSelections, customBackgroundEquipmentCandidates)
    : [];
  const equipmentIssues = [
    ...validateStartingEquipmentSelections(equipmentOptionGroups, equipmentSelections),
    ...customBackgroundEquipmentIssues
  ];
  const buildIssues = useMemo(
    () => validateBuildPrerequisites({
      classEntries: selectedClassItems,
      abilities: finalAbilities,
      proficiencies: proficiencySelection.proficiencies,
      featItems: allSelectedFeatItems,
      allItems: items
    }),
    [selectedClassLevels, finalAbilities, proficiencySelection.proficiencies, selectedOriginFeatId, selectedSpeciesFeatId, selectedFeatCounts, items]
  );
  const multiclassIssues = generatedAbilityAssignmentsComplete
    ? validateMulticlassPrerequisites(selectedClassItems.map(({ item }) => item), finalAbilities)
    : [];

  const missingSubclass = eligibleSubclasses.some(
    ({ classItem, subclasses }) => subclasses.length > 0 && !selectedSubclassByClass[classItem.id]
  );
  const featCountsValid =
    selectedGeneralCount === featRequirements.general &&
    selectedFightingStyleCount === featRequirements.fightingStyle &&
    selectedEpicBoonCount === featRequirements.epicBoon;
  const bonusAbilitiesAllowed = bonusAbilities.every((ability) => backgroundAbilityOptions.includes(ability));
  const bonusCountValid = bonusAbilitiesAllowed && (bonusMode === 'twoOne'
    ? bonusAbilities.length === 2 && new Set(bonusAbilities).size === 2
    : bonusAbilities.length === 3 && new Set(bonusAbilities).size === 3);

  const unavailableReferences = (references: Array<string | undefined>): string[] =>
    Array.from(new Set(references.filter((reference): reference is string => Boolean(reference))))
      .filter((reference) => reference !== CUSTOM_BACKGROUND_ITEM_ID)
      .filter((reference) => {
        const item = items.find((candidate) => candidate.id === reference);
        return !item || item.status !== 'validated';
      });

  const classUnavailableReferences = unavailableReferences(Object.keys(selectedClassLevels));
  const originUnavailableReferences = unavailableReferences([
    selectedSpeciesId,
    selectedBackgroundId,
    selectedOriginFeatId,
    selectedSpeciesFeatId,
    ...selectedSpeciesFeatureItems.map((item) => item.id)
  ]);
  const progressionUnavailableReferences = unavailableReferences([
    ...Object.values(selectedSubclassByClass),
    ...Object.keys(selectedFeatCounts),
    ...Object.keys(selectedInvocationCounts),
    ...Object.values(featChoiceDrafts).flatMap((choice) => [
      choice.featItemId,
      choice.fightingStyleItemId,
      ...(choice.spellItemIds ?? []),
      ...(choice.weaponItemIds ?? []),
      ...(choice.weaponMasterySelections ?? []).flatMap((selection) => [selection.sourceItemId, selection.weaponItemId])
    ]),
    ...eldritchInvocationChoices.flatMap((choice) => [
      choice.invocationItemId,
      choice.targetCantripItemId,
      choice.originFeatItemId,
      choice.familiarCreatureItemId,
      ...(choice.cantripItemIds ?? []),
      ...(choice.ritualSpellItemIds ?? [])
    ])
  ]);
  const equipmentUnavailableReferences = unavailableReferences(
    equipmentSelections.flatMap((selection) => [
      selection.sourceItemId,
      ...(selection.items ?? []).map((item) => item.compendiumItemId)
    ])
  );
  const spellUnavailableReferences = unavailableReferences([
    ...Object.keys(effectiveSpellAssignments),
    ...Object.values(effectiveSpellAssignments),
    ...Object.keys(effectiveSpellbookAssignments),
    ...Object.values(effectiveSpellbookAssignments)
  ]);
  const allUnavailableReferences = Array.from(new Set([
    ...classUnavailableReferences,
    ...originUnavailableReferences,
    ...progressionUnavailableReferences,
    ...equipmentUnavailableReferences,
    ...spellUnavailableReferences
  ]));

  const validateSelectedCompendiumItems = async (
    selectedItems: StoredCompendiumItem[]
  ): Promise<boolean> => {
    const entries = selectedItems
      .filter((item) => item.status !== 'validated' && item.status !== 'disabled')
      .flatMap((item) => {
        const itemId = getCompendiumReviewTargetId(item, choiceForItemId);
        return itemId ? [{
          itemId,
          update: {
            status: 'validated' as const,
            reviewDecision: 'approved' as const,
            reviewedBy: 'Escolha explícita durante a criação do personagem',
            reviewNotes: 'Aprovado ao ser escolhido explicitamente no fluxo de criação.'
          }
        }] : [];
      });
    if (!entries.length) return true;
    const result = await updateItemsReview(entries);
    if (!result.ok) {
      Alert.alert('Não foi possível validar a escolha', result.issues.map((issue) => issue.message).join('\n'));
    }
    return result.ok;
  };

  const addCustomBackgroundEquipment = async (candidate: CustomBackgroundEquipmentCandidate) => {
    const ok = await validateSelectedCompendiumItems([candidate.item]);
    if (!ok) return;
    setEquipmentSelections((current) => {
      const count = getCustomBackgroundEquipmentPurchaseCount(current, candidate);
      return setCustomBackgroundEquipmentPurchaseCount(current, candidate, count + 1, customBackgroundEquipmentCandidates);
    });
  };

  const selectSpecies = async (item: StoredCompendiumItem) => {
    const linkedFeatures = getSpeciesFeatureItems(item, items);
    const requiresValidation = [item, ...linkedFeatures].some((entry) => entry.status !== 'validated');
    if (selectedSpeciesId === item.id && !requiresValidation) {
      setSelectedSpeciesId(undefined);
      setSpeciesChoices([]);
      setSelectedSpeciesFeatId(undefined);
      return;
    }
    const ok = await validateSelectedCompendiumItems([item, ...linkedFeatures]);
    if (!ok) return;
    setSelectedSpeciesId(item.id);
    if (selectedSpeciesId !== item.id) setSelectedSpeciesFeatId(undefined);
    setSpeciesChoices((current) => current.filter((choice) => choice.speciesItemId === item.id));
  };

  const selectSpeciesFeat = async (item: StoredCompendiumItem) => {
    if (!speciesFeatCandidates.some((candidate) => candidate.id === item.id)) return;
    if (selectedSpeciesFeatId === item.id && item.status === 'validated') {
      setSelectedSpeciesFeatId(undefined);
      return;
    }
    const ok = await validateSelectedCompendiumItems([item]);
    if (ok) setSelectedSpeciesFeatId(item.id);
  };

  const selectOriginFeat = async (item: StoredCompendiumItem) => {
    if (selectedOriginFeatId === item.id && item.status === 'validated') {
      setSelectedOriginFeatId(undefined);
      return;
    }
    const ok = await validateSelectedCompendiumItems([item]);
    if (ok) setSelectedOriginFeatId(item.id);
  };

  const selectBackground = async (item: StoredCompendiumItem) => {
    if (selectedBackgroundId === item.id && item.status === 'validated') {
      setSelectedBackgroundId(undefined);
      setBackgroundChoices([]);
      setBackgroundToolChoicesText('');
      setSelectedOriginFeatId(undefined);
      setEquipmentSelections((current) => current.filter((selection) => selection.sourceKind !== 'background'));
      return;
    }
    const ok = await validateSelectedCompendiumItems([item]);
    if (!ok) return;
    setSelectedBackgroundId(item.id);
    setBackgroundChoices((current) => current.filter((choice) => choice.backgroundItemId === item.id));
    setBackgroundToolChoicesText('');
    setEquipmentSelections((current) => current.filter((selection) => selection.sourceKind !== 'background'));
    const suggestions = backgroundSuggestions(item);
    setClassSkillChoices((current) => current.filter((skill) => !suggestions.proficiencies.skills.includes(skill)));
    const suggestedFeat = suggestions.featIds
      .map((reference) => originFeatCandidates.find((feat) => itemReferenceMatches(feat, reference)))
      .find(Boolean);
    if (suggestedFeat && await validateSelectedCompendiumItems([suggestedFeat])) {
      setSelectedOriginFeatId(suggestedFeat.id);
    } else {
      setSelectedOriginFeatId(undefined);
    }
    setBonusMode('twoOne');
    setBonusAbilities(suggestions.abilityOptions.length >= 2 ? suggestions.abilityOptions.slice(0, 2) : []);
  };

  const selectCustomBackground = () => {
    if (isCustomBackground) {
      setSelectedBackgroundId(undefined);
      setSelectedOriginFeatId(undefined);
      setEquipmentSelections((current) => current.filter((selection) => selection.sourceKind !== 'background'));
      return;
    }
    setSelectedBackgroundId(CUSTOM_BACKGROUND_ITEM_ID);
    setBackgroundChoices([]);
    setSelectedOriginFeatId(undefined);
    setBackgroundToolChoicesText('');
    setClassSkillChoices((current) => current.filter((skill) => !customBackground.skillProficiencies.includes(skill)));
    setEquipmentSelections((current) => current.filter((selection) => selection.sourceKind !== 'background'));
    setBonusMode('twoOne');
    setBonusAbilities(customBackground.abilityScoreOptions.slice(0, 2));
  };


  const changeAbilityMethod = (method: AbilityGenerationMethod) => {
    setAbilityMethod(method);
    const state = method === 'standardArray'
      ? standardArrayState()
      : method === 'pointBuy'
        ? pointBuyState()
        : method === 'diceRoll'
          ? rollAbilitySet()
          : { method: 'manual' as const, generatedValues: ABILITY_ORDER.map((ability) => baseAbilities[ability]) };
    setAbilityGeneration(state);
    setAbilityValueAssignments({});
    setBaseAbilities(
      method === 'standardArray' || method === 'diceRoll'
        ? emptyAbilityScores()
        : abilityScoresFromValues(state.generatedValues)
    );
  };

  const assignGeneratedValue = (ability: AbilityScore, valueIndex: number) => {
    if (isGeneratedValueAssignedElsewhere(abilityValueAssignments, ability, valueIndex)) return;
    const wasSelected = abilityValueAssignments[ability] === valueIndex;
    const nextAssignments = toggleGeneratedAbilityAssignment(abilityValueAssignments, ability, valueIndex);
    setAbilityValueAssignments(nextAssignments);
    setBaseAbilities((current) => ({
      ...current,
      [ability]: wasSelected ? 10 : (abilityGeneration.generatedValues[valueIndex] ?? 10)
    }));
  };

  const addFeatChoice = (item: StoredCompendiumItem) => {
    const category = getFeatCategory(item);
    if (!['general', 'fightingStyle', 'epicBoon'].includes(category)) return;
    const limits = featRequirements;
    const currentCategoryCount = category === 'general'
      ? selectedGeneralCount
      : category === 'fightingStyle'
        ? selectedFightingStyleCount
        : selectedEpicBoonCount;
    const limit = limits[category as 'general' | 'fightingStyle' | 'epicBoon'];
    if (currentCategoryCount >= limit) return;
    const current = selectedFeatCounts[item.id] ?? 0;
    if (current > 0 && !isFeatRepeatable(item)) return;
    setSelectedFeatCounts((counts) => ({ ...counts, [item.id]: current + 1 }));
  };

  const selectProgressionFeat = async (item: StoredCompendiumItem) => {
    const ok = await validateSelectedCompendiumItems([item]);
    if (ok) addFeatChoice(item);
  };

  const addEldritchInvocation = async (item: StoredCompendiumItem) => {
    const current = selectedInvocationCounts[item.id] ?? 0;
    if (selectedInvocationCount >= invocationLimit) return;
    if (current > 0 && !isEldritchInvocationRepeatable(item)) return;
    const prerequisiteIssues = getEldritchInvocationPrerequisiteIssues(
      item,
      warlockLevel,
      selectedInvocationCounts,
      invocationCandidates
    );
    if (prerequisiteIssues.length) {
      Alert.alert(
        'Invocation indisponível',
        prerequisiteIssues.map((entry) => entry.message).join('\n')
      );
      return;
    }
    const ok = await validateSelectedCompendiumItems([item]);
    if (!ok) return;
    setSelectedInvocationCounts((counts) => ({
      ...counts,
      [item.id]: (counts[item.id] ?? 0) + 1
    }));
  };

  const toggleEldritchInvocation = async (item: StoredCompendiumItem) => {
    if (getEldritchInvocationCardAction(selectedInvocationCounts[item.id] ?? 0) === 'remove') {
      removeEldritchInvocation(item.id);
      return;
    }
    await addEldritchInvocation(item);
  };

  const removeEldritchInvocation = (itemId: string) => {
    const currentCount = selectedInvocationCounts[itemId] ?? 0;
    setSelectedInvocationCounts((counts) => {
      const current = counts[itemId] ?? 0;
      if (current <= 1) return Object.fromEntries(Object.entries(counts).filter(([id]) => id !== itemId));
      return { ...counts, [itemId]: current - 1 };
    });
    setEldritchInvocationChoices((choices) => choices.filter(
      (choice) => choice.invocationItemId !== itemId || choice.instanceIndex < Math.max(0, currentCount - 1)
    ));
  };

  const removeFeatChoice = (itemId: string) => {
    setSelectedFeatCounts((counts) => {
      const current = counts[itemId] ?? 0;
      if (current <= 1) return Object.fromEntries(Object.entries(counts).filter(([id]) => id !== itemId));
      return { ...counts, [itemId]: current - 1 };
    });
  };

  const toggleSpellbook = (spellItem: StoredCompendiumItem) => {
    if (!activeSpellProfile || activeSpellProfile.preparationMode !== 'spellbook' || spellItemLevel(spellItem) === 0) return;
    if (effectiveSpellbookAssignments[spellItem.id] === activeSpellProfile.classItemId) {
      setSpellAssignments(Object.fromEntries(
        Object.entries(effectiveSpellAssignments).filter(([id]) => id !== spellItem.id)
      ));
      setSpellbookAssignments(Object.fromEntries(
        Object.entries(effectiveSpellbookAssignments).filter(([id]) => id !== spellItem.id)
      ));
      return;
    }
    const count = Object.entries(effectiveSpellbookAssignments)
      .filter(([, classItemId]) => classItemId === activeSpellProfile.classItemId)
      .length;
    if (count >= activeSpellProfile.spellbookMinimumSpellCount) return;
    setSpellbookAssignments({
      ...effectiveSpellbookAssignments,
      [spellItem.id]: activeSpellProfile.classItemId
    });
  };

  const toggleSpell = (spellItem: StoredCompendiumItem) => {
    if (!activeSpellProfile) return;
    if (activeSpellProfile.preparationMode === 'spellbook' && spellItemLevel(spellItem) > 0 && effectiveSpellbookAssignments[spellItem.id] !== activeSpellProfile.classItemId) return;
    if (effectiveSpellAssignments[spellItem.id] === activeSpellProfile.classItemId) {
      setSpellAssignments(Object.fromEntries(
        Object.entries(effectiveSpellAssignments).filter(([id]) => id !== spellItem.id)
      ));
      return;
    }
    const counts = spellValidation.countsByClassItemId[activeSpellProfile.classItemId] ?? { cantrips: 0, prepared: 0, spellbook: 0 };
    const isCantrip = spellItemLevel(spellItem) === 0;
    const limit = isCantrip ? activeSpellProfile.cantripLimit : activeSpellProfile.preparedSpellLimit;
    const currentCount = isCantrip ? counts.cantrips : counts.prepared;
    if (currentCount >= limit) return;
    setSpellAssignments({
      ...effectiveSpellAssignments,
      [spellItem.id]: activeSpellProfile.classItemId
    });
  };

  const selectSpellbookSpell = async (spellItem: StoredCompendiumItem) => {
    setFocusedSpellItemId(spellItem.id);
    const alreadySelected = activeSpellProfile && effectiveSpellbookAssignments[spellItem.id] === activeSpellProfile.classItemId;
    if (!alreadySelected) {
      const ok = await validateSelectedCompendiumItems([spellItem]);
      if (!ok) return;
    }
    toggleSpellbook(spellItem);
  };

  const selectClassSpell = async (spellItem: StoredCompendiumItem) => {
    setFocusedSpellItemId(spellItem.id);
    const alreadySelected = activeSpellProfile && effectiveSpellAssignments[spellItem.id] === activeSpellProfile.classItemId;
    if (!alreadySelected) {
      const ok = await validateSelectedCompendiumItems([spellItem]);
      if (!ok) return;
    }
    toggleSpell(spellItem);
  };

  const canContinue = (): boolean => {
    if (step === 0) return classAllocationValid;
    if (step === 1) return originStepIssues.length === 0;
    if (step === 2) return progressionUnavailableReferences.length === 0 && !missingSubclass && subclassChoiceIssues.length === 0 && featCountsValid && featChoiceIssues.length === 0 && allInvocationIssues.length === 0;
    if (step === 3) return pointBuyValid && generatedAbilityAssignmentsComplete && bonusCountValid && multiclassIssues.length === 0;
    if (step === 4) return proficienciesValid;
    if (step === 5) return equipmentUnavailableReferences.length === 0 && equipmentIssues.length === 0;
    if (step === 6) return spellUnavailableReferences.length === 0 && spellValidation.ok;
    return allUnavailableReferences.length === 0 && buildIssues.length === 0 && subclassChoiceIssues.length === 0 && featChoiceIssues.length === 0 && speciesChoiceIssues.length === 0 && pointBuyValid && generatedAbilityAssignmentsComplete && bonusCountValid && proficienciesValid && equipmentIssues.length === 0 && spellValidation.ok && !missingSubclass && featCountsValid && allInvocationIssues.length === 0;
  };

  const applyWithClassLevel = (
    character: Character,
    item: StoredCompendiumItem,
    level: number
  ): Character => {
    const result = applyCompendiumItemToCharacter(character, item);
    if (!result.ok || !result.link) return character;
    const classesWithLevel = result.character.classes.map((entry) =>
      entry.id === result.link?.appliedEntityId ? { ...entry, level } : entry
    );
    return {
      ...result.character,
      classes: classesWithLevel,
      level: classesWithLevel.reduce((sum, entry) => sum + entry.level, 0)
    };
  };

  const finish = () => {
    const initial = addCharacter(name.trim());
    let next: Character = initial;
    const localClassByCompendiumItemId = new Map<string, { id: string; name: string }>();

    for (const entry of selectedClassItems) {
      const beforeLinks = new Set((next.compendiumLinks ?? []).map((link) => link.id));
      next = applyWithClassLevel(next, entry.item, entry.level);
      const classLink = (next.compendiumLinks ?? []).find(
        (link) => !beforeLinks.has(link.id) && link.appliedAs === 'class'
      );
      if (classLink) localClassByCompendiumItemId.set(entry.item.id, { id: classLink.appliedEntityId, name: entry.item.name });
    }

    if (selectedSpecies) {
      const result = applyCompendiumItemToCharacter(next, selectedSpecies);
      if (result.ok) next = result.character;
    }
    if (isCustomBackground) {
      next = {
        ...next,
        background: {
          id: createId('background'),
          name: customBackground.name.trim() || 'Background personalizado',
          source: manualSource,
          features: []
        }
      };
    } else if (selectedBackground) {
      const result = applyCompendiumItemToCharacter(next, selectedBackground);
      if (result.ok) next = result.character;
    }

    next = {
      ...next,
      name: name.trim(),
      catalogSnapshotId,
      abilities: finalAbilities,
      abilityScoreBonuses: bonuses,
      abilityGeneration: {
        ...abilityGeneration,
        method: abilityMethod,
        generatedValues: abilityMethod === 'standardArray' || abilityMethod === 'diceRoll'
          ? [...abilityGeneration.generatedValues]
          : ABILITY_ORDER.map((ability) => baseAbilities[ability]),
        pointBuyBudget: abilityMethod === 'pointBuy' ? POINT_BUY_BUDGET : abilityGeneration.pointBuyBudget,
        pointBuySpent: abilityMethod === 'pointBuy' ? pointBuySpent(baseAbilities) : abilityGeneration.pointBuySpent
      },
      proficiencies: proficiencySelection.proficiencies,
      buildChoices: {
        startingClassItemId,
        speciesChoices,
        speciesFeatItemId: selectedSpeciesFeatId,
        backgroundChoices,
        subclassChoices,
        classSkillChoices,
        classToolChoices: csv(classToolChoicesText),
        backgroundToolChoices: isCustomBackground ? [] : csv(backgroundToolChoicesText),
        customBackground: isCustomBackground ? customBackground : undefined,
        expertiseSkills,
        languages: csv(languagesText),
        classLanguageChoices: csv(classLanguagesText),
        spellAssignments: effectiveSpellAssignments,
        spellbookAssignments: effectiveSpellbookAssignments,
        equipmentSelections,
        eldritchInvocationCounts: selectedInvocationCounts,
        eldritchInvocationChoices,
        higherLevelStartingBenefits
      }
    };

    if (selectedSpecies) {
      next = applyDirectSpeciesChoiceEffects(next, selectedSpecies, speciesChoiceRequirements, speciesChoices);
    }

    for (const itemId of Object.values(selectedSubclassByClass).filter(Boolean)) {
      const item = items.find((entry) => entry.id === itemId);
      if (!item) continue;
      const result = applyCompendiumItemToCharacter(next, item);
      if (result.ok) next = result.character;
    }

    for (const instance of selectedFeatInstances) {
      const result = applyCompendiumItemToCharacter(next, instance.item);
      if (!result.ok || !result.link) continue;
      next = result.character;
      if (instance.origin) next = { ...next, originFeatId: result.link.appliedEntityId };
      const draft = featChoiceDrafts[instance.key];
      if (getFeatChoiceSchema(instance.item).kinds.length && draft) {
        next = applyFeatChoiceEffects(
          next,
          instance.item,
          { ...draft, featEntityId: result.link.appliedEntityId, featItemId: instance.item.id, instanceIndex: instance.instanceIndex },
          items
        );
      }
    }

    next = applyEldritchInvocationSelection(
      next,
      selectedInvocationCounts,
      items
    ).character;
    next = applyEldritchInvocationChoices(
      next,
      eldritchInvocationChoices,
      items
    ).character;

    for (const [spellItemId, classItemId] of Object.entries(effectiveSpellbookAssignments)) {
      const spellItem = items.find((entry) => entry.id === spellItemId);
      const localClass = localClassByCompendiumItemId.get(classItemId);
      const profile = spellProfiles.find((entry) => entry.classItemId === classItemId);
      if (!spellItem || !localClass || !profile) continue;
      next = learnSpellbookSpell({
        character: next,
        spellItem,
        profile,
        classEntityId: localClass.id,
        acquisition: 'starting',
        source: 'creation'
      });
    }

    for (const [spellItemId, classItemId] of Object.entries(effectiveSpellAssignments)) {
      const spellItem = items.find((entry) => entry.id === spellItemId);
      const localClass = localClassByCompendiumItemId.get(classItemId);
      const profile = spellProfiles.find((entry) => entry.classItemId === classItemId);
      if (!spellItem || !localClass || !profile) continue;
      if (profile.preparationMode === 'spellbook' && spellItemLevel(spellItem) > 0) {
        next = prepareSpellbookSpell({ character: next, spellItem, profile, classEntityId: localClass.id, source: 'creation' });
        continue;
      }
      const before = next;
      const result = applyCompendiumItemToCharacter(next, spellItem);
      if (result.ok) next = annotateLatestSpellWithClass(before, result.character, localClass.id, localClass.name, profile.ability);
    }

    next = applyStartingEquipmentSelections(next, equipmentSelections, items);
    if (higherLevelStartingBenefits) {
      next = {
        ...next,
        currency: {
          ...(next.currency ?? { cp: 0, sp: 0, ep: 0, gp: 0, pp: 0 }),
          gp: (next.currency?.gp ?? 0) + higherLevelStartingBenefits.bonusGold
        }
      };
    }
    next = applyAutomaticSpeciesProgression(next, items).character;
    next = applyAutomaticClassProgression(next, items).character;
    next = reconcileCharacterSpellSlots(next, items, { refill: true });
    next = reconcileCharacterBuild(next, items).character;
    updateCharacter(initial.id, () => next);
    void characterCreationDraftRepository.clear();
    router.replace(`/characters/${initial.id}`);
  };

  const handleNext = () => {
    const currentUnavailable = step === 0
      ? classUnavailableReferences
      : step === 1
        ? originUnavailableReferences
        : step === 2
          ? progressionUnavailableReferences
          : step === 5
            ? equipmentUnavailableReferences
            : step === 6
              ? spellUnavailableReferences
              : step === steps.length - 1
                ? allUnavailableReferences
                : [];
    if (currentUnavailable.length) {
      Alert.alert(
        'Escolha indisponível',
        'Uma ou mais escolhas do rascunho foram desativadas pelo catálogo ou pela fonte local. Remova-as ou reative o conteúdo em Gerenciar conteúdo antes de continuar.'
      );
      return;
    }
    if (!canContinue()) {
      const stepIssues = step === 1
        ? originStepIssues
        : step === 2
          ? [...subclassChoiceIssues, ...featChoiceIssues, ...allInvocationIssues]
        : step === 3
          ? multiclassIssues
          : step === 4
            ? proficiencyIssues
            : step === 5
              ? equipmentIssues
              : step === 6
                ? spellValidation.issues
                : buildIssues;
      Alert.alert(
        'Etapa incompleta',
        step === 0
          ? `Distribua exatamente ${desiredLevel} nível(is) entre as classes.`
          : stepIssues.map((issue) => issue.message).join('\n') || 'Complete todas as escolhas obrigatórias desta etapa.'
      );
      return;
    }
    if (step === steps.length - 1) finish();
    else setStep((current) => current + 1);
  };


  const discardCreationDraft = async () => {
    await characterCreationDraftRepository.clear();
    setStep(0);
    setName('');
    setTargetLevel('1');
    setHigherLevelStartingBenefits(undefined);
    setClassSearch('');
    setSelectedClassLevels({});
    setStartingClassItemId(undefined);
    setSelectedSpeciesId(undefined);
    setSpeciesChoices([]);
    setSelectedBackgroundId(undefined);
    setCustomBackground(createDefaultCustomBackgroundChoice());
    setCustomEquipmentSearch('');
    setSelectedSubclassByClass({});
    setSubclassChoices([]);
    setSelectedOriginFeatId(undefined);
    setSelectedFeatCounts({});
    setSelectedInvocationCounts({});
    setEldritchInvocationChoices([]);
    setFeatChoiceDrafts({});
    setEquipmentSelections([]);
    setBonusMode('twoOne');
    setBonusAbilities(['STR', 'DEX']);
    setAbilityMethod('standardArray');
    setAbilityGeneration(standardArrayState());
    setBaseAbilities(abilityScoresFromValues([...STANDARD_ARRAY]));
    setClassSkillChoices([]);
    setClassToolChoicesText('');
    setBackgroundToolChoicesText('');
    setExpertiseSkills([]);
    setLanguagesText('');
    setClassLanguagesText('');
    setSpellSearch('');
    setActiveSpellClassItemId(undefined);
    setSpellAssignments({});
    setSpellbookAssignments({});
    setDraftUpdatedAt(undefined);
    setDraftSaveError(undefined);
  };

  const footer = (
    <View style={styles.footerRow}>
      <View style={styles.flex}>
        <Button
          label={step === 0 ? 'Cancelar' : 'Voltar'}
          variant="text"
          icon="arrow-back"
          onPress={() => (step === 0 ? router.back() : setStep((current) => current - 1))}
        />
      </View>
      <View style={styles.flex}>
        <Button
          label={step === steps.length - 1 ? 'Criar personagem' : 'Continuar'}
          icon={step === steps.length - 1 ? 'checkmark' : 'arrow-forward'}
          disabled={!canContinue()}
          onPress={handleNext}
        />
      </View>
    </View>
  );

  const renderFeatChoices = (
    title: string,
    category: 'general' | 'fightingStyle' | 'epicBoon',
    required: number,
    selectedCount: number
  ) => {
    if (required === 0) return null;
    const available = selectableFeatCandidates.filter((item) => getFeatCategory(item) === category);
    const selected = Object.entries(selectedFeatCounts)
      .map(([itemId, count]) => ({ item: items.find((candidate) => candidate.id === itemId), count }))
      .filter((entry): entry is { item: StoredCompendiumItem; count: number } =>
        Boolean(entry.item && getFeatCategory(entry.item) === category)
      );
    return (
      <Card
        variant="outlined"
        title={`${title} (${selectedCount}/${required})`}
        subtitle="Leia a descrição e escolha a opção que será aplicada à ficha."
      >
        <PaginatedOptionCardList
          items={available}
          keyExtractor={(item) => item.id}
          titleForItem={(item) => `${item.name}${(selectedFeatCounts[item.id] ?? 0) > 0 ? ` ×${selectedFeatCounts[item.id]}` : ''}`}
          descriptionForItem={getCompendiumChoiceDescription}
          metaForItem={(item) => {
            const count = selectedFeatCounts[item.id] ?? 0;
            if (count > 0) return `Selecionado${count > 1 ? ` ×${count}` : ''}`;
            if (item.status !== 'validated') return 'Toque para validar e selecionar';
            return selectedCount >= required ? 'Limite da categoria atingido' : 'Toque para selecionar';
          }}
          isSelected={(item) => (selectedFeatCounts[item.id] ?? 0) > 0}
          isDisabled={(item) => selectedCount >= required || ((selectedFeatCounts[item.id] ?? 0) > 0 && !isFeatRepeatable(item))}
          onPressItem={(item) => { void selectProgressionFeat(item); }}
          pageSize={8}
          resetKey={`${category}:${selectedCount}`}
        />
        {selected.map(({ item, count }) => (
          <View key={`selected-${item.id}`} style={styles.selectionRow}>
            <Text style={[styles.selectionText, { color: colors.onSurface }]}>{item.name} ×{count}</Text>
            <Button label="Remover uma" variant="text" onPress={() => removeFeatChoice(item.id)} />
          </View>
        ))}
      </Card>
    );
  };


  const renderEldritchInvocationChoices = () => {
    if (warlockLevel <= 0) return null;

    const selected = Object.entries(selectedInvocationCounts)
      .map(([itemId, count]) => ({ item: findEldritchInvocationById(items, itemId), count }))
      .filter((entry): entry is { item: StoredCompendiumItem; count: number } => Boolean(entry.item && entry.count > 0));
    const warlockEntry = selectedClassItems.find(({ item }) => normalized(item.name) === 'warlock');

    return (
      <Card
        variant="outlined"
        title={`Eldritch Invocations (${selectedInvocationCount}/${invocationLimit})`}
        subtitle={`Warlock nível ${warlockLevel}. Leia a descrição, escolha a quantidade liberada e configure as opções internas.`}
      >
        <PaginatedOptionCardList
          items={invocationCandidates}
          keyExtractor={(item) => item.id}
          titleForItem={(item) => `${item.name}${(selectedInvocationCounts[item.id] ?? 0) > 0 ? ` ×${selectedInvocationCounts[item.id]}` : ''}`}
          descriptionForItem={getCompendiumChoiceDescription}
          metaForItem={(item) => {
            const count = selectedInvocationCounts[item.id] ?? 0;
            const minimumLevel = getEldritchInvocationMinimumLevel(item);
            const prerequisiteIssues = getEldritchInvocationPrerequisiteIssues(item, warlockLevel, selectedInvocationCounts, invocationCandidates);
            if (count > 0) return `Selecionada${count > 1 ? ` ×${count}` : ''} · nível mínimo ${minimumLevel} · toque para remover uma`;
            if (prerequisiteIssues.length) return prerequisiteIssues.map((entry) => entry.message).join(' ');
            if (item.status !== 'validated') return `Nível mínimo ${minimumLevel} · toque para validar e selecionar`;
            return selectedInvocationCount >= invocationLimit ? `Nível mínimo ${minimumLevel} · limite atingido` : `Nível mínimo ${minimumLevel} · toque para selecionar`;
          }}
          isSelected={(item) => (selectedInvocationCounts[item.id] ?? 0) > 0}
          isDisabled={(item) => isEldritchInvocationCardDisabled({
            selectedCount: selectedInvocationCounts[item.id] ?? 0,
            selectedTotal: selectedInvocationCount,
            limit: invocationLimit,
            hasPrerequisiteIssues: getEldritchInvocationPrerequisiteIssues(
              item,
              warlockLevel,
              selectedInvocationCounts,
              invocationCandidates
            ).length > 0
          })}
          onPressItem={(item) => { void toggleEldritchInvocation(item); }}
          selectedAccessibilityHint="Toque para remover uma seleção."
          pageSize={8}
          resetKey={`invocations:${warlockLevel}:${selectedInvocationCount}`}
          emptyText="Nenhuma Eldritch Invocation foi encontrada nas fontes ativas."
        />
        {selected.map(({ item, count }) => (
          <View key={`selected-invocation-${item.id}`} style={styles.selectionRow}>
            <Text style={[styles.selectionText, { color: colors.onSurface }]}>{item.name} ×{count}</Text>
            {isEldritchInvocationRepeatable(item) && selectedInvocationCount < invocationLimit ? (
              <Button label="Adicionar outra" variant="text" compact onPress={() => { void addEldritchInvocation(item); }} />
            ) : null}
            <Button label="Remover uma" variant="text" compact onPress={() => removeEldritchInvocation(item.id)} />
          </View>
        ))}
        <EldritchInvocationChoiceEditor
          items={items}
          enabledSourceIds={enabledSourceIds}
          selectedCounts={selectedInvocationCounts}
          choices={eldritchInvocationChoices}
          onChange={setEldritchInvocationChoices}
          selectedOriginFeatItemIds={selectedOriginFeatId ? [selectedOriginFeatId] : []}
          onBeforeSelectItem={async (item) => validateSelectedCompendiumItems([item])}
          onTargetCantripSelected={(spell) => {
            if (!warlockEntry) return;
            setSpellAssignments((current) => ({ ...current, [spell.id]: warlockEntry.item.id }));
          }}
        />
        {allInvocationIssues.length ? <IssueList issues={allInvocationIssues} /> : null}
      </Card>
    );
  };


  const updateFeatChoiceDraft = (
    key: string,
    item: StoredCompendiumItem,
    instanceIndex: number,
    updater: (choice: CharacterFeatChoice) => CharacterFeatChoice
  ) => {
    setFeatChoiceDrafts((current) => {
      const base = current[key] ?? emptyFeatChoice(item.id, '', instanceIndex);
      return { ...current, [key]: updater(base) };
    });
  };

  const renderFeatInternalChoice = (instance: typeof selectedFeatInstances[number]) => {
    const schema = getFeatChoiceSchema(instance.item);
    if (!schema.kinds.length) return null;
    const choice = featChoiceDrafts[instance.key] ?? emptyFeatChoice(instance.item.id, '', instance.instanceIndex);
    const increases = choice.abilityScoreIncreases ?? {};
    const increaseEntries = Object.entries(increases).filter(([, value]) => (value ?? 0) > 0);
    const asiPlusTwo = increaseEntries.length === 1 && increaseEntries[0]?.[1] === 2;
    const selectedSpellIds = choice.spellItemIds ?? [];
    const selectedCantrips = selectedSpellIds.filter((id) => spellItemLevel(items.find((item) => item.id === id) ?? instance.item) === 0).length;
    const selectedLevelOne = selectedSpellIds.filter((id) => spellItemLevel(items.find((item) => item.id === id) ?? instance.item) === 1).length;
    const selectedSpellList = normalized(choice.spellList ?? 'all');
    const allowedSpellLists = schema.allowCombinedSpellLists && selectedSpellList === 'all'
      ? schema.spellListOptions.map(normalized)
      : selectedSpellList && selectedSpellList !== 'all'
        ? [selectedSpellList]
        : schema.spellListOptions.map(normalized);
    const spellChoices = allSpells.filter((spell) => {
      const level = spellItemLevel(spell);
      if (level !== 0 && level !== 1) return false;
      if (allowedSpellLists.length) {
        const classes = spellItemClasses(spell).map(normalized);
        if (!classes.some((className) => allowedSpellLists.includes(className))) return false;
      }
      if (schema.spellChoiceSchools.length && level === 1) {
        const school = String(asRecord(spell.normalizedJson).school ?? '');
        if (!schema.spellChoiceSchools.map(normalized).includes(normalized(school))) return false;
      }
      return true;
    });
    const featCantripChoices = spellChoices.filter((spell) => spellItemLevel(spell) === 0);
    const featLevelOneSpellChoices = spellChoices.filter((spell) => spellItemLevel(spell) === 1);

    const featGenericSpellChoices = schema.genericSpellChoiceCount > 0
      ? allSpells.filter((spell) => isSpellItemEligibleForGenericFeatChoice(spell, schema))
      : [];

    const masteryWeaponChoices = schema.weaponMasteryChoiceCount > 0
      ? items
          .filter((item) => item.type === 'weapon' && item.status === 'validated')
          .filter((item) => isWeaponItemEligibleForMasteryWithProficiencies(proficiencySelection.proficiencies.weapons, item))
          .filter((item) => Boolean(String(asRecord(item.normalizedJson).mastery ?? '').trim()))
          .slice(0, 80)
      : [];

    const toggleFeatSpell = async (spell: StoredCompendiumItem) => {
      const alreadySelected = selectedSpellIds.includes(spell.id);
      if (!alreadySelected) {
        const ok = await validateSelectedCompendiumItems([spell]);
        if (!ok) return;
      }
      updateFeatChoiceDraft(instance.key, instance.item, instance.instanceIndex, (current) => {
        const ids = current.spellItemIds ?? [];
        if (ids.includes(spell.id)) return { ...current, spellItemIds: ids.filter((id) => id !== spell.id) };
        if (schema.genericSpellChoiceCount > 0) {
          if (ids.length >= schema.genericSpellChoiceCount) return current;
          return { ...current, spellItemIds: [...ids, spell.id] };
        }
        const level = spellItemLevel(spell);
        if (level === 0 && selectedCantrips >= schema.cantripChoiceCount) return current;
        if (level === 1 && selectedLevelOne >= schema.level1SpellChoiceCount) return current;
        return { ...current, spellItemIds: [...ids, spell.id] };
      });
    };

    return (
      <Card key={`choice-${instance.key}`} variant="outlined" title={`Configurar ${instance.item.name}`} subtitle={`Instância ${instance.instanceIndex + 1}${instance.origin ? ' · Origin Feat' : ''}`}>
        {schema.asiMode ? (
          <>
            <View style={styles.chips}>
              <Chip label="+2 em uma" selected={asiPlusTwo} onPress={() => updateFeatChoiceDraft(instance.key, instance.item, instance.instanceIndex, (current) => ({ ...current, abilityScoreIncreases: { STR: 2 } }))} />
              <Chip label="+1 em duas" selected={!asiPlusTwo && increaseEntries.length === 2} onPress={() => updateFeatChoiceDraft(instance.key, instance.item, instance.instanceIndex, (current) => ({ ...current, abilityScoreIncreases: { STR: 1, DEX: 1 } }))} />
            </View>
            <View style={styles.chips}>{ABILITY_ORDER.map((ability) => (
              <Chip
                key={`${instance.key}-${ability}`}
                label={`${ability}${increases[ability] ? ` +${increases[ability]}` : ''}`}
                selected={Boolean(increases[ability])}
                onPress={() => updateFeatChoiceDraft(instance.key, instance.item, instance.instanceIndex, (current) => {
                  const currentIncreases = current.abilityScoreIncreases ?? {};
                  if (asiPlusTwo) return { ...current, abilityScoreIncreases: { [ability]: 2 } };
                  const selected = Object.keys(currentIncreases).filter((key) => (currentIncreases[key as AbilityScore] ?? 0) > 0) as AbilityScore[];
                  if (selected.includes(ability)) return { ...current, abilityScoreIncreases: Object.fromEntries(Object.entries(currentIncreases).filter(([key]) => key !== ability)) };
                  return { ...current, abilityScoreIncreases: Object.fromEntries([...selected.slice(-1), ability].map((key) => [key, 1])) };
                })}
              />
            ))}</View>
          </>
        ) : schema.abilityOptions.length && schema.abilityIncreaseAmount > 0 ? (
          <View style={styles.chips}>{schema.abilityOptions.map((ability) => <Chip key={`${instance.key}-${ability}`} label={`${ability} +${schema.abilityIncreaseAmount}`} selected={Boolean(increases[ability])} onPress={() => updateFeatChoiceDraft(instance.key, instance.item, instance.instanceIndex, (current) => ({ ...current, abilityScoreIncreases: { [ability]: schema.abilityIncreaseAmount } }))} />)}</View>
        ) : null}

        {schema.skillChoiceCount > 0 ? (
          <ChoiceChipSelector
            title="Perícias"
            options={SKILLS}
            selectedValues={choice.skills ?? []}
            maximumSelections={schema.skillChoiceCount}
            onChange={(skills) => updateFeatChoiceDraft(instance.key, instance.item, instance.instanceIndex, (current) => ({ ...current, skills }))}
            testIDPrefix={`feat-${instance.key}-skill`}
          />
        ) : null}
        {schema.mixedSkillToolChoiceCount > 0 ? <>
          <ChoiceChipSelector
            title="Perícias"
            options={SKILLS}
            selectedValues={choice.skills ?? []}
            maximumSelections={schema.mixedSkillToolChoiceCount}
            totalSelectionCount={(choice.skills?.length ?? 0) + (choice.tools?.length ?? 0)}
            onChange={(skills) => updateFeatChoiceDraft(instance.key, instance.item, instance.instanceIndex, (current) => ({ ...current, skills }))}
            supportingText="A soma entre perícias e ferramentas deve atingir o total indicado."
            testIDPrefix={`feat-${instance.key}-mixed-skill`}
          />
          <ChoiceChipSelector
            title="Ferramentas"
            options={schema.toolOptions.length ? schema.toolOptions : ALL_TOOL_OPTIONS}
            selectedValues={choice.tools ?? []}
            maximumSelections={schema.mixedSkillToolChoiceCount}
            totalSelectionCount={(choice.skills?.length ?? 0) + (choice.tools?.length ?? 0)}
            onChange={(tools) => updateFeatChoiceDraft(instance.key, instance.item, instance.instanceIndex, (current) => ({ ...current, tools }))}
            supportingText="Escolha qualquer combinação válida até completar o total."
            testIDPrefix={`feat-${instance.key}-mixed-tool`}
          />
        </> : null}
        {schema.expertiseChoiceCount > 0 ? (
          <ChoiceChipSelector
            title="Expertise"
            options={Array.from(new Set([...proficiencySelection.proficiencies.skills, ...(choice.skills ?? [])]))}
            selectedValues={choice.expertiseSkills ?? []}
            maximumSelections={schema.expertiseChoiceCount}
            onChange={(expertiseSkills) => updateFeatChoiceDraft(instance.key, instance.item, instance.instanceIndex, (current) => ({ ...current, expertiseSkills }))}
            emptyText="Escolha primeiro uma perícia em que o personagem seja proficiente."
            testIDPrefix={`feat-${instance.key}-expertise`}
          />
        ) : null}
        {schema.toolChoiceCount > 0 ? (
          <ChoiceChipSelector
            title="Ferramentas"
            options={schema.toolOptions}
            selectedValues={choice.tools ?? []}
            maximumSelections={schema.toolChoiceCount}
            onChange={(tools) => updateFeatChoiceDraft(instance.key, instance.item, instance.instanceIndex, (current) => ({ ...current, tools }))}
            testIDPrefix={`feat-${instance.key}-tool`}
          />
        ) : null}
        {schema.languageChoiceCount > 0 ? (
          <ChoiceChipSelector
            title="Idiomas"
            options={schema.languageOptions}
            selectedValues={choice.languages ?? []}
            maximumSelections={schema.languageChoiceCount}
            onChange={(languages) => updateFeatChoiceDraft(instance.key, instance.item, instance.instanceIndex, (current) => ({ ...current, languages }))}
            testIDPrefix={`feat-${instance.key}-language`}
          />
        ) : null}

        {schema.skillUpgradeOptions.length ? <><Text style={[styles.sectionTitle, { color: colors.onSurface }]}>Aprimorar perícia</Text><View style={styles.chips}>{schema.skillUpgradeOptions.map((skill) => <Chip key={`${instance.key}-upgrade-${skill}`} label={skill} selected={choice.skillUpgrade === skill} onPress={() => updateFeatChoiceDraft(instance.key, instance.item, instance.instanceIndex, (current) => ({ ...current, skillUpgrade: skill }))} />)}</View></> : null}
        {schema.weaponMasteryChoiceCount > 0 ? <>
          <Text style={[styles.sectionTitle, { color: colors.onSurface }]}>Maestria de arma ({choice.weaponMasterySelections?.length ?? 0}/{schema.weaponMasteryChoiceCount})</Text>
          <PaginatedChipList
            items={masteryWeaponChoices}
            keyExtractor={(weapon) => `${instance.key}-mastery-${weapon.id}`}
            labelForItem={(weapon) => `${weapon.name} · ${String(asRecord(weapon.normalizedJson).mastery ?? '')}`}
            isSelected={(weapon) => (choice.weaponMasterySelections ?? []).some((entry) => entry.weaponItemId === weapon.id)}
            onPressItem={(weapon) => updateFeatChoiceDraft(instance.key, instance.item, instance.instanceIndex, (current) => {
              const existing = current.weaponMasterySelections ?? [];
              const selected = existing.some((entry) => entry.weaponItemId === weapon.id);
              if (selected) return { ...current, weaponMasterySelections: existing.filter((entry) => entry.weaponItemId !== weapon.id) };
              const mastery = String(asRecord(weapon.normalizedJson).mastery ?? '');
              const nextSelection = { id: '', sourceKind: 'feat' as const, weaponItemId: weapon.id, weaponName: weapon.name, mastery };
              return { ...current, weaponMasterySelections: [...existing.slice(-(schema.weaponMasteryChoiceCount - 1)), nextSelection] };
            })}
            pageSize={16}
            resetKey={`${instance.key}:${choice.weaponMasterySelections?.length ?? 0}`}
          />
        </> : null}

        {schema.spellListOptions.length ? (
          <>
            <Text style={[styles.sectionTitle, { color: colors.onSurface }]}>Listas disponíveis</Text>
            <View style={styles.chips}>
              {schema.allowCombinedSpellLists ? (
                <Chip
                  label={`Todas (${schema.spellListOptions.join(' + ')})`}
                  selected={!choice.spellList || normalized(choice.spellList) === 'all'}
                  onPress={() => updateFeatChoiceDraft(instance.key, instance.item, instance.instanceIndex, (current) => ({
                    ...current,
                    spellList: 'all'
                  }))}
                />
              ) : null}
              {schema.spellListOptions.map((list) => (
                <Chip
                  key={`${instance.key}-${list}`}
                  label={list}
                  selected={normalized(choice.spellList ?? '') === normalized(list)}
                  onPress={() => updateFeatChoiceDraft(instance.key, instance.item, instance.instanceIndex, (current) => ({
                    ...current,
                    spellList: list,
                    spellItemIds: (current.spellItemIds ?? []).filter((spellId) => {
                      const spell = items.find((candidate) => candidate.id === spellId);
                      return spell ? spellItemClasses(spell).map(normalized).includes(normalized(list)) : false;
                    })
                  }))}
                />
              ))}
            </View>
            {schema.allowCombinedSpellLists ? (
              <Text style={[styles.muted, { color: colors.onSurfaceVariant }]}>
                “Todas” permite combinar cantrips e a magia de nível 1 entre Cleric, Druid e Wizard.
              </Text>
            ) : null}
          </>
        ) : null}
        {schema.spellcastingAbilityOptions.length ? <><Text style={[styles.sectionTitle, { color: colors.onSurface }]}>Habilidade de conjuração</Text><View style={styles.chips}>{schema.spellcastingAbilityOptions.map((ability) => <Chip key={`${instance.key}-spell-${ability}`} label={ability} selected={choice.spellcastingAbility === ability} onPress={() => updateFeatChoiceDraft(instance.key, instance.item, instance.instanceIndex, (current) => ({ ...current, spellcastingAbility: ability }))} />)}</View></> : null}
        {schema.cantripChoiceCount > 0 ? (
          <>
            <Text style={[styles.sectionTitle, { color: colors.onSurface }]}>Cantrips ({selectedCantrips}/{schema.cantripChoiceCount})</Text>
            <PaginatedChipList
              items={featCantripChoices}
              keyExtractor={(spell) => `${instance.key}-cantrip-${spell.id}`}
              labelForItem={(spell) => spell.name}
              isSelected={(spell) => selectedSpellIds.includes(spell.id)}
              descriptionForSelectedItem={getSpellChoiceInlineDescription}
              onPressItem={(spell) => { void toggleFeatSpell(spell); }}
              pageSize={20}
              resetKey={`${instance.key}:cantrips:${choice.spellList ?? 'all'}:${selectedSpellIds.length}`}
              emptyText="Nenhum cantrip encontrado nas listas selecionadas."
            />
          </>
        ) : null}
        {schema.level1SpellChoiceCount > 0 ? (
          <>
            <Text style={[styles.sectionTitle, { color: colors.onSurface }]}>Magias de nível 1 ({selectedLevelOne}/{schema.level1SpellChoiceCount})</Text>
            <PaginatedChipList
              items={featLevelOneSpellChoices}
              keyExtractor={(spell) => `${instance.key}-level1-${spell.id}`}
              labelForItem={(spell) => spell.name}
              isSelected={(spell) => selectedSpellIds.includes(spell.id)}
              descriptionForSelectedItem={getSpellChoiceInlineDescription}
              onPressItem={(spell) => { void toggleFeatSpell(spell); }}
              pageSize={20}
              resetKey={`${instance.key}:level1:${choice.spellList ?? 'all'}:${selectedSpellIds.length}`}
              emptyText="Nenhuma magia de nível 1 encontrada nas listas selecionadas."
            />
          </>
        ) : null}
        {schema.genericSpellChoiceCount > 0 ? (
          <>
            <Text style={[styles.sectionTitle, { color: colors.onSurface }]}>Magia ({selectedSpellIds.length}/{schema.genericSpellChoiceCount})</Text>
            <Text style={[styles.muted, { color: colors.onSurfaceVariant }]}>Escolha conforme os critérios do feat{schema.genericSpellMaximumLevel !== undefined ? ` · nível máximo ${schema.genericSpellMaximumLevel}` : ''}{schema.genericSpellSourceLists.length ? ` · lista ${schema.genericSpellSourceLists.join(' ou ')}` : ''}.</Text>
            <PaginatedChipList
              items={featGenericSpellChoices}
              keyExtractor={(spell) => `${instance.key}-generic-spell-${spell.id}`}
              labelForItem={(spell) => `${spell.name} · nv ${spellItemLevel(spell)}`}
              isSelected={(spell) => selectedSpellIds.includes(spell.id)}
              descriptionForSelectedItem={getSpellChoiceInlineDescription}
              onPressItem={(spell) => { void toggleFeatSpell(spell); }}
              pageSize={20}
              resetKey={`${instance.key}:generic-spell:${selectedSpellIds.join('|')}`}
              emptyText="Nenhuma magia elegível encontrada."
            />
          </>
        ) : null}
        {schema.alwaysPreparedSpellReferences.length ? <Text style={[styles.muted, { color: colors.onSurfaceVariant }]}>Sempre preparadas: {schema.alwaysPreparedSpellReferences.join(', ')}</Text> : null}
        {schema.damageTypeOptions.length ? <View style={styles.chips}>{schema.damageTypeOptions.map((damageType) => <Chip key={`${instance.key}-${damageType}`} label={damageType} selected={choice.damageType === damageType} onPress={() => updateFeatChoiceDraft(instance.key, instance.item, instance.instanceIndex, (current) => ({ ...current, damageType }))} />)}</View> : null}
      </Card>
    );
  };

  if (choiceBridge.status !== 'ready') {
    return (
      <Screen
        title={choiceBridge.status === 'failed' ? 'Catálogo indisponível' : 'Preparando criação'}
        subtitle={choiceBridge.status === 'failed'
          ? 'A criação foi bloqueada para evitar escolhas sem validação do catálogo.'
          : 'Carregando catálogo e compêndio local...'}
        onBack={() => router.back()}
      >
        <Card
          variant="outlined"
          title={choiceBridge.status === 'failed' ? 'Não foi possível carregar as regras' : 'Sincronizando escolhas'}
          subtitle={choiceBridge.status === 'failed'
            ? 'Verifique o catálogo em Ajustes > Gerenciar conteúdo e tente novamente.'
            : 'Classes, espécies, backgrounds, feats, equipamentos e magias serão liberados quando as duas fontes estiverem prontas.'}
        />
      </Screen>
    );
  }

  return (
    <Screen
      eyebrow={`Etapa ${step + 1} de ${steps.length}`}
      title={steps[step]}
      subtitle="As regras do PHB são validadas e todos os dados podem ser ajustados depois."
      onBack={() => (step === 0 ? router.back() : setStep((current) => current - 1))}
      footer={footer}
    >
      <ProgressBar value={(step + 1) / steps.length} label={steps.join(' · ')} />

      {allUnavailableReferences.length ? (
        <Card
          variant="outlined"
          title="Rascunho contém conteúdo indisponível"
          subtitle="Alguma escolha foi desativada no catálogo ou no compêndio local. O personagem não será salvo até a seleção ser corrigida ou reativada."
        />
      ) : null}

      <Card
        variant="outlined"
        title={draftUpdatedAt ? 'Rascunho retomado e salvo automaticamente' : 'Rascunho automático'}
        subtitle={draftUpdatedAt ? `Última gravação: ${new Date(draftUpdatedAt).toLocaleString('pt-BR')}` : 'O progresso desta criação será preservado neste dispositivo.'}
      >
        {draftSaveError ? <Text style={{ color: colors.error }}>{draftSaveError}</Text> : null}
        <Button
          label="Descartar rascunho e recomeçar"
          variant="text"
          onPress={() => Alert.alert(
            'Descartar rascunho?',
            'Todas as escolhas desta criação serão removidas.',
            [
              { text: 'Cancelar', style: 'cancel' },
              { text: 'Descartar', style: 'destructive', onPress: () => { void discardCreationDraft(); } }
            ]
          )}
        />
      </Card>

      {step === 0 ? (
        <>
          <Card variant="hero" title="Defina o nível inicial" subtitle="Distribua o nível total entre uma ou mais classes. Os pré-requisitos de multiclasse serão validados após os atributos.">
            <Field
              label="Nível total"
              value={targetLevel}
              onChangeText={(value) => setTargetLevel(String(Math.max(1, Math.min(20, Number(value) || 1))))}
              keyboardType="number-pad"
              supportingText={`Distribuído: ${allocatedLevel}/${desiredLevel}`}
              errorText={allocatedLevel !== desiredLevel ? 'A soma dos níveis precisa coincidir com o total.' : undefined}
            />
          </Card>
          <Field label="Buscar classe" value={classSearch} onChangeText={setClassSearch} />
          <View style={styles.chips}>
            {classes.map((item) => (
              <Chip
                key={item.id}
                label={item.name}
                selected={item.id in selectedClassLevels}
                onPress={() => setSelectedClassLevels((current) => {
                  if (item.id in current) return Object.fromEntries(Object.entries(current).filter(([id]) => id !== item.id));
                  return { ...current, [item.id]: Object.keys(current).length ? 1 : desiredLevel };
                })}
              />
            ))}
          </View>
          {classes.length === 0 ? (
            <Card
              variant="outlined"
              title={classSearchHasNoMatches
                ? 'Nenhuma classe encontrada'
                : classesBlockedByCatalogFilters
                  ? 'Classes ocultas pelos filtros de conteúdo'
                  : 'Conteúdo de classes indisponível'}
              subtitle={classSearchHasNoMatches
                ? `Nenhuma classe disponível corresponde a “${classSearch.trim()}”.`
                : classesBlockedByCatalogFilters
                  ? 'As classes existem no catálogo, mas o Player’s Handbook 2024 ou a categoria de classes está desativada.'
                  : classesMissingMechanicalPayload
                    ? 'O catálogo encontrou as classes, mas o payload mecânico do PHB 2024 não está disponível no compêndio local.'
                    : 'Nenhuma classe validada está disponível. O app pode recarregar o conteúdo básico incluído sem apagar seus dados.'}
            >
              {classSearchHasNoMatches ? (
                <Button
                  label="Limpar busca"
                  variant="text"
                  onPress={() => setClassSearch('')}
                />
              ) : classesBlockedByCatalogFilters ? (
                <Button
                  label="Abrir filtros de conteúdo"
                  variant="text"
                  onPress={() => router.push('/content-management')}
                />
              ) : (
                <Button
                  label={isHydrating ? 'Recarregando conteúdo...' : 'Recarregar conteúdo básico'}
                  variant="text"
                  disabled={isHydrating}
                  onPress={() => { void hydrate(); }}
                />
              )}
              {!classSearchHasNoMatches ? (
                <Button
                  label="Abrir gerenciador do compêndio"
                  variant="text"
                  onPress={() => router.push('/compendium')}
                />
              ) : null}
            </Card>
          ) : null}
          {selectedClassItems.length > 1 ? (
            <Card variant="outlined" title="Classe inicial" subtitle="Define as proficiências iniciais da ficha.">
              <View style={styles.chips}>
                {selectedClassItems.map(({ item }) => (
                  <Chip key={item.id} label={item.name} selected={startingClassItemId === item.id} onPress={() => { setStartingClassItemId(item.id); setClassSkillChoices([]); setClassToolChoicesText(''); setExpertiseSkills([]); setClassLanguagesText(''); }} />
                ))}
              </View>
            </Card>
          ) : null}
          {selectedClassItems.map(({ item, level }) => {
            const previewLevel = selectedClassLevels[item.id] ?? desiredLevel;
            const featurePreview = getClassFeaturePreview(item, items, selectedClassLevels[item.id], desiredLevel);
            return (
              <Card
                key={item.id}
                variant="filled"
                title={item.name}
                subtitle={getClassSelectionDescription(item)}
              >
                <Field
                  label="Nível nesta classe"
                  value={String(level)}
                  onChangeText={(value) => setSelectedClassLevels((current) => ({ ...current, [item.id]: Math.max(1, Math.min(20, Number(value) || 1)) }))}
                  keyboardType="number-pad"
                />
                <Text style={[styles.previewHeading, { color: colors.onSurface }]}>Features até o nível {previewLevel}</Text>
                {featurePreview.length ? featurePreview.map((feature) => (
                  <View key={feature.key} style={styles.previewFeature}>
                    <Text style={[styles.previewFeatureTitle, { color: colors.onSurface }]}>Nível {feature.levelGained} · {feature.name}</Text>
                    <Text style={[styles.previewFeatureSummary, { color: colors.onSurfaceVariant }]}>{feature.summary}</Text>
                  </View>
                )) : (
                  <Text style={[styles.muted, { color: colors.onSurfaceVariant }]}>Nenhuma feature vinculada foi encontrada até este nível.</Text>
                )}
              </Card>
            );
          })}
        </>
      ) : null}

      {step === 1 ? (
        <>
          <Card
            variant="hero"
            title="Espécie, variante e background"
            subtitle="Escolha a origem e o Origin Feat. Os bônus de atributo serão definidos na etapa Atributos."
          />

          <Text style={[styles.sectionTitle, { color: colors.onSurface }]}>Espécie</Text>
          <View style={styles.chips}>
            {species.map((item) => (
              <Chip
                key={item.id}
                label={item.name}
                selected={selectedSpeciesId === item.id}
                onPress={() => { void selectSpecies(item); }}
              />
            ))}
          </View>

          {selectedSpecies ? (
            <Card
              variant="filled"
              title={selectedSpecies.name}
              subtitle={getSpeciesSelectionDescription(selectedSpecies)}
            >
              {speciesAbilityScoreIncreaseIgnored ? (
                <Text style={[styles.muted, { color: colors.onSurfaceVariant }]}>
                  Ability Score Increase da espécie ignorado pelas regras 2024; os bônus de atributo vêm do background.
                </Text>
              ) : null}
              <Text style={[styles.previewHeading, { color: colors.onSurface }]}>Traits e features até o nível {desiredLevel}</Text>
              {selectedSpeciesFeaturePreview.length ? selectedSpeciesFeaturePreview.map((feature) => (
                <View key={feature.key} style={styles.previewFeature}>
                  <Text style={[styles.previewFeatureTitle, { color: colors.onSurface }]}>Nível {feature.levelGained} · {feature.name}</Text>
                  <Text style={[styles.previewFeatureSummary, { color: colors.onSurfaceVariant }]}>{feature.summary}</Text>
                </View>
              )) : (
                <Text style={[styles.muted, { color: colors.onSurfaceVariant }]}>Nenhuma trait ou feature vinculada foi encontrada até este nível.</Text>
              )}
            </Card>
          ) : null}

          {speciesChoiceRequirements.map((requirement) => {
            const selectedChoice = speciesChoiceForRequirement(speciesChoices, requirement);
            const selectedOption = requirement.options.find((option) => option.id === selectedChoice?.optionId);
            return (
              <Card
                key={requirement.featureItemId}
                variant="outlined"
                title={requirement.featureName}
                subtitle={`Escolha obrigatória da espécie${requirement.levelGained > 1 ? ` · liberada no nível ${requirement.levelGained}` : ''}.`}
              >
                <View style={styles.chips}>
                  {requirement.options.map((option) => (
                    <Chip
                      key={`${requirement.featureItemId}-${option.id}`}
                      label={option.label}
                      selected={selectedChoice?.optionId === option.id}
                      onPress={() => setSpeciesChoices((current) => setSpeciesChoiceOption(current, requirement, option.id))}
                    />
                  ))}
                </View>
                {selectedOption?.skillChoiceCount ? (
                  <ChoiceChipSelector
                    title={`Perícia (${selectedChoice?.skill ? 1 : 0}/${selectedOption.skillChoiceCount})`}
                    options={selectedOption.skillOptions ?? SKILLS}
                    selectedValues={selectedChoice?.skill ? [selectedChoice.skill] : []}
                    maximumSelections={selectedOption.skillChoiceCount}
                    onChange={(values) => {
                      const skill = values[values.length - 1];
                      if (skill) setSpeciesChoices((current) => setSpeciesChoiceSkill(current, requirement, skill));
                    }}
                    supportingText="Esta proficiência é concedida pela espécie e é considerada ao validar as escolhas da classe."
                    testIDPrefix={`species-skill-${requirement.featureItemId}`}
                  />
                ) : null}
                {requirement.spellcastingAbilityOptions.length ? (
                  <>
                    <Text style={[styles.sectionTitle, { color: colors.onSurface }]}>Atributo de conjuração</Text>
                    <View style={styles.chips}>
                      {requirement.spellcastingAbilityOptions.map((ability) => (
                        <Chip
                          key={`${requirement.featureItemId}-${ability}`}
                          label={ability}
                          selected={selectedChoice?.spellcastingAbility === ability}
                          onPress={() => setSpeciesChoices((current) => setSpeciesChoiceSpellcastingAbility(current, requirement, ability))}
                        />
                      ))}
                    </View>
                  </>
                ) : null}
              </Card>
            );
          })}

          {speciesFeatRequirement ? (
            <Card
              variant="outlined"
              title={`Feat concedido por ${selectedSpecies?.name ?? 'espécie'}`}
              subtitle={`${speciesFeatRequirement.count} escolha obrigatória adquirida no nível ${speciesFeatRequirement.acquisitionLevel}. ${speciesFeatRequirement.restriction ?? 'Escolha um feat para o qual o personagem cumpra os pré-requisitos.'}`}
            >
              <Text style={[styles.muted, { color: colors.onSurfaceVariant }]}>Este feat é adicional ao Origin Feat do background. Os pré-requisitos são validados com o build completo.</Text>
              <PaginatedOptionCardList
                items={speciesFeatCandidates}
                keyExtractor={(item) => item.id}
                titleForItem={(item) => item.name}
                descriptionForItem={getCompendiumChoiceDescription}
                metaForItem={(item) => selectedSpeciesFeatId === item.id ? 'Selecionado como feat da espécie' : 'Toque para selecionar'}
                isSelected={(item) => selectedSpeciesFeatId === item.id}
                onPressItem={(item) => { void selectSpeciesFeat(item); }}
                pageSize={10}
                resetKey={`species-feat:${selectedSpeciesId ?? 'none'}`}
              />
              {speciesFeatPrerequisiteIssues.length ? <IssueList issues={speciesFeatPrerequisiteIssues} /> : null}
            </Card>
          ) : null}

          <Text style={[styles.sectionTitle, { color: colors.onSurface }]}>Background</Text>
          <View style={styles.chips}>
            <Chip
              testID="background-custom"
              label="Personalizado"
              selected={isCustomBackground}
              onPress={selectCustomBackground}
            />
            {backgrounds.map((item) => (
              <Chip
                key={item.id}
                label={item.name}
                selected={selectedBackgroundId === item.id}
                onPress={() => { void selectBackground(item); }}
              />
            ))}
          </View>

          {isCustomBackground ? (
            <Card
              variant="filled"
              title="Configurar background personalizado"
              subtitle="Escolha livremente os componentes mecânicos do background. Perícias, ferramenta e equipamento serão configurados nas etapas próprias."
            >
              <Field
                label="Nome do background"
                value={customBackground.name}
                onChangeText={(value) => setCustomBackground((current) => ({ ...current, name: value }))}
                placeholder="Ex.: Marinheiro das Ilhas"
              />
              <ChoiceChipSelector
                title={`Atributos disponíveis (${customBackground.abilityScoreOptions.length}/${CUSTOM_BACKGROUND_ABILITY_COUNT})`}
                options={ABILITY_ORDER}
                selectedValues={customBackground.abilityScoreOptions}
                maximumSelections={CUSTOM_BACKGROUND_ABILITY_COUNT}
                onChange={(abilityScoreOptions) => {
                  const abilities = abilityScoreOptions as AbilityScore[];
                  setCustomBackground((current) => ({ ...current, abilityScoreOptions: abilities }));
                  setBonusAbilities((current) => current.filter((ability) => abilities.includes(ability)));
                }}
                supportingText="Escolha exatamente três. Na etapa Atributos, distribua +2/+1 entre dois deles ou +1 nos três."
                testIDPrefix="custom-background-ability"
              />
            </Card>
          ) : selectedBackground ? (
            <Card
              variant="filled"
              title={`Regras de ${selectedBackground.name}`}
              subtitle={`Atributos: ${backgroundUsesFreeAbilitySelection ? 'escolha livre entre os 6' : backgroundAbilityOptions.join(', ')} · Origin Feat: ${suggestedOriginFeat?.name ?? 'escolha livre'}`}
            >
              <Text style={[styles.muted, { color: colors.onSurfaceVariant }]}>
                Perícias concedidas: {backgroundDefaults.proficiencies.skills.join(', ') || '—'} · Ferramentas: {backgroundDefaults.proficiencies.tools.join(', ') || (proficiencySelection.backgroundRequirement?.toolChoiceCount ? 'escolha livre' : '—')}
              </Text>
              {backgroundUsesFreeAbilitySelection ? (
                <Text style={[styles.muted, { color: colors.onSurfaceVariant }]}>Este background não define atributos; escolha livremente os bônus na etapa Atributos.</Text>
              ) : null}
            </Card>
          ) : null}

          {backgroundChoiceRequirements.map((requirement) => {
            const choice = backgroundChoiceForRequirement(backgroundChoices, requirement);
            return (
              <Card key={`${requirement.backgroundItemId}-${requirement.choiceType}`} variant="outlined" title={requirement.label} subtitle="Escolha obrigatória definida pelo background.">
                <View style={styles.chips}>
                  {requirement.options.map((option) => (
                    <Chip
                      key={`${requirement.choiceType}-${option}`}
                      label={option}
                      selected={choice?.optionId === option}
                      onPress={() => setBackgroundChoices((current) => setBackgroundChoiceOption(current, requirement, option))}
                    />
                  ))}
                </View>
              </Card>
            );
          })}

          <Text style={[styles.sectionTitle, { color: colors.onSurface }]}>Origin Feat</Text>
          {originFeatCandidates.length ? (
            <PaginatedOptionCardList
              items={originFeatCandidates}
              keyExtractor={(item) => item.id}
              titleForItem={(item) => item.name}
              descriptionForItem={getCompendiumChoiceDescription}
              metaForItem={(item) => selectedOriginFeatId === item.id
                ? 'Selecionado'
                : item.status === 'validated'
                  ? 'Toque para selecionar'
                  : 'Toque para validar e selecionar'}
              isSelected={(item) => selectedOriginFeatId === item.id}
              onPressItem={(item) => { void selectOriginFeat(item); }}
              pageSize={10}
              resetKey={`origin-feats:${selectedBackgroundId ?? 'none'}`}
            />
          ) : (
            <Card
              variant="outlined"
              title="Nenhum Origin Feat disponível"
              subtitle="Ative a fonte do PHB ou importe novamente o pacote de feats."
            />
          )}

          {originStepIssues.length ? <IssueList issues={originStepIssues} /> : null}
        </>
      ) : null}

      {step === 2 ? (
        <>
          <Card variant="hero" title="Escolhas liberadas pelo nível" subtitle="Features fixas são aplicadas automaticamente; subclasses, feats e Eldritch Invocations obrigatórias precisam ser preenchidos." />
          {eligibleSubclasses.map(({ classItem, level, subclasses }) => subclasses.length ? (
            <Card key={classItem.id} variant="filled" title={`Subclasse de ${classItem.name}`} subtitle={`Classe no nível ${level}`}>
              <View style={styles.chips}>{subclasses.map((item) => <Chip key={item.id} label={item.name} selected={selectedSubclassByClass[classItem.id] === item.id} onPress={() => setSelectedSubclassByClass((current) => ({ ...current, [classItem.id]: current[classItem.id] === item.id ? '' : item.id }))} />)}</View>
            </Card>
          ) : null)}
          <SubclassChoiceEditor
            requirements={subclassChoiceRequirements}
            choices={subclassChoices}
            onChange={setSubclassChoices}
            allowResolvedOverride
          />
          {subclassChoiceIssues.length ? <IssueList issues={subclassChoiceIssues} /> : null}
          {renderFeatChoices('Fighting Styles', 'fightingStyle', featRequirements.fightingStyle, selectedFightingStyleCount)}
          {renderFeatChoices('Feats gerais / ASI', 'general', featRequirements.general, selectedGeneralCount)}
          {renderFeatChoices('Epic Boons', 'epicBoon', featRequirements.epicBoon, selectedEpicBoonCount)}
          {renderEldritchInvocationChoices()}
          {selectedFeatInstances.map(renderFeatInternalChoice)}
          {featChoiceIssues.length ? <IssueList issues={featChoiceIssues} /> : null}
          {missingSubclass || subclassChoiceIssues.length > 0 || !featCountsValid || allInvocationIssues.length > 0 ? <Text style={{ color: colors.error }}>Complete as subclasses, suas configurações internas, feats e Eldritch Invocations exigidos pela progressão.</Text> : null}
        </>
      ) : null}

      {step === 3 ? (
        <>
          <Card variant="hero" title="Geração dos atributos" subtitle="Escolha o método e atribua os valores às habilidades." />
          <View style={styles.chips}>
            <Chip label="Standard Array" selected={abilityMethod === 'standardArray'} onPress={() => changeAbilityMethod('standardArray')} />
            <Chip label="Point Buy" selected={abilityMethod === 'pointBuy'} onPress={() => changeAbilityMethod('pointBuy')} />
            <Chip label="4d6" selected={abilityMethod === 'diceRoll'} onPress={() => changeAbilityMethod('diceRoll')} />
            <Chip label="Manual" selected={abilityMethod === 'manual'} onPress={() => changeAbilityMethod('manual')} />
          </View>
          <Card
            variant="hero"
            title="Aumento de atributo da origem"
            subtitle={backgroundUsesFreeAbilitySelection
              ? 'Este background não define aumentos de atributo. Escolha quaisquer atributos: +2/+1 em dois diferentes ou +1/+1/+1 em três diferentes.'
              : `Use apenas os três atributos definidos pelo background: ${backgroundAbilityOptions.join(', ')}.`}
          >
            <View style={styles.chips}>
              <Chip label="+2/+1" selected={bonusMode === 'twoOne'} onPress={() => { setBonusMode('twoOne'); setBonusAbilities((current) => current.filter((ability) => backgroundAbilityOptions.includes(ability)).length >= 2 ? current.filter((ability) => backgroundAbilityOptions.includes(ability)).slice(0, 2) : backgroundAbilityOptions.slice(0, 2)); }} />
              <Chip label="+1/+1/+1" selected={bonusMode === 'threeOnes'} onPress={() => { setBonusMode('threeOnes'); setBonusAbilities(backgroundAbilityOptions.slice(0, 3)); }} />
            </View>
            <View style={styles.chips}>
              {ABILITY_ORDER.map((ability) => (
                <Chip
                  key={`origin-bonus-${ability}`}
                  label={`${ability}${bonusAbilities.includes(ability) ? ` +${bonuses[ability] ?? 0}` : ''}`}
                  selected={bonusAbilities.includes(ability)}
                  disabled={!backgroundAbilityOptions.includes(ability)}
                  accessibilityHint={!backgroundAbilityOptions.includes(ability) ? 'Este atributo não está entre as opções definidas pelo background.' : undefined}
                  onPress={() => setBonusAbilities((current) => {
                    if (current.includes(ability)) return current.filter((entry) => entry !== ability);
                    const max = bonusMode === 'twoOne' ? 2 : 3;
                    return [...current, ability].slice(-max);
                  })}
                />
              ))}
            </View>
            {!bonusCountValid ? <Text style={{ color: colors.error }}>Escolha atributos diferentes para todos os bônus.</Text> : null}
          </Card>
          {abilityMethod === 'diceRoll' ? <Button label="Rolar novamente" icon="dice-outline" secondary onPress={() => changeAbilityMethod('diceRoll')} /> : null}
          {abilityMethod === 'pointBuy' ? <Text style={{ color: pointBuyValid ? colors.onSurfaceVariant : colors.error }}>Pontos usados: {pointBuySpent(baseAbilities)}/{POINT_BUY_BUDGET}</Text> : null}
          {abilityMethod === 'standardArray' ? (
            <Card variant="outlined" title="Valores disponíveis" subtitle="Atribua cada valor uma única vez. Todos os atributos começam sem valor selecionado.">
              <Text style={[styles.muted, { color: colors.onSurfaceVariant }]}>{abilityGeneration.generatedValues.join(' · ')}</Text>
            </Card>
          ) : null}
          {abilityMethod === 'diceRoll' ? (
            <Card variant="outlined" title="Resultados da rolagem" subtitle="Os seis resultados ficam registrados antes da atribuição. Cada rolagem pode ser usada em apenas um atributo.">
              {(abilityGeneration.diceRolls ?? []).map((roll, index) => (
                <Text key={`ability-roll-${index}`} style={[styles.muted, { color: colors.onSurfaceVariant }]}>
                  Rolagem {index + 1}: {roll.rolls.join(', ')} · descarta {roll.discarded} · total {roll.total}
                </Text>
              ))}
              {!abilityGeneration.diceRolls?.length ? (
                <Text style={[styles.muted, { color: colors.onSurfaceVariant }]}>Totais: {abilityGeneration.generatedValues.join(' · ')}</Text>
              ) : null}
            </Card>
          ) : null}
          {ABILITY_ORDER.map((ability) => {
            const generatedMode = abilityMethod === 'standardArray' || abilityMethod === 'diceRoll';
            const selectedValueIndex = abilityValueAssignments[ability];
            const hasGeneratedValue = generatedMode && typeof selectedValueIndex === 'number';
            const baseLabel = generatedMode && !hasGeneratedValue ? '—' : String(baseAbilities[ability]);
            const finalLabel = generatedMode && !hasGeneratedValue ? '—' : String(finalAbilities[ability]);
            return (
              <Card key={ability} variant="filled" title={`${ability} · ${abilityLabels[ability]}`} subtitle={`Base ${baseLabel} + bônus ${bonuses[ability] ?? 0} = ${finalLabel}`}>
                {generatedMode ? (
                  <View style={styles.chips}>{abilityGeneration.generatedValues.map((value, index) => {
                    const selected = selectedValueIndex === index;
                    const unavailable = isGeneratedValueAssignedElsewhere(abilityValueAssignments, ability, index);
                    return (
                      <Chip
                        key={`${value}-${index}`}
                        testID={`ability-${ability}-value-${index}`}
                        label={abilityMethod === 'diceRoll' ? `#${index + 1} · ${value}` : String(value)}
                        selected={selected}
                        disabled={unavailable}
                        accessibilityHint={selected ? 'Toque novamente para remover este valor.' : unavailable ? 'Este valor já foi atribuído a outro atributo.' : `Atribuir ${value} a ${abilityLabels[ability]}.`}
                        onPress={() => assignGeneratedValue(ability, index)}
                      />
                    );
                  })}</View>
                ) : (
                  <Field label="Valor base" value={String(baseAbilities[ability])} onChangeText={(value) => setBaseAbilities((current) => ({ ...current, [ability]: Math.max(1, Math.min(20, Number(value) || 0)) }))} keyboardType="number-pad" />
                )}
              </Card>
            );
          })}
          {(abilityMethod === 'standardArray' || abilityMethod === 'diceRoll') && !generatedAbilityAssignmentsComplete ? (
            <Text style={{ color: colors.error }}>Atribua um dos seis valores a cada atributo antes de continuar. Tocar novamente no valor selecionado desfaz a atribuição.</Text>
          ) : null}
          {multiclassIssues.length ? <Card variant="outlined" title="Pré-requisitos de multiclasse"><IssueList issues={multiclassIssues} /></Card> : null}
        </>
      ) : null}

      {step === 4 ? (
        <>
          <Card variant="hero" title="Proficiências" subtitle="A classe inicial define as escolhas; o background adiciona as perícias e ferramentas fixas." />
          {!isCustomBackground && selectedBackground && (backgroundDefaults.proficiencies.skills.length || (proficiencySelection.backgroundRequirement?.fixedTools.length ?? 0) > 0) ? (
            <Card variant="filled" title={`Perícias de ${selectedBackground.name}`} subtitle="Concedidas automaticamente pelo background e já consideradas na ficha.">
              <View style={styles.chips}>
                {backgroundDefaults.proficiencies.skills.map((skill) => (
                  <Chip
                    key={`background-skill-${skill}`}
                    testID={`background-skill-${normalized(skill)}`}
                    label={`Perícia · ${skill}`}
                    selected
                    disabled
                    accessibilityHint="Proficiência concedida automaticamente pelo background."
                    onPress={() => undefined}
                  />
                ))}
                {(proficiencySelection.backgroundRequirement?.fixedTools ?? []).map((tool) => (
                  <Chip
                    key={`background-tool-fixed-${tool}`}
                    label={`Ferramenta · ${tool}`}
                    selected
                    disabled
                    accessibilityHint="Proficiência em ferramenta concedida automaticamente pelo background."
                    onPress={() => undefined}
                  />
                ))}
              </View>
            </Card>
          ) : null}
          {isCustomBackground ? (
            <Card variant="filled" title={`Proficiências de ${customBackground.name || 'background personalizado'}`} subtitle="Escolha livremente duas perícias e uma ferramenta entre todas as opções disponíveis.">
              <ChoiceChipSelector
                title={`Perícias (${customBackground.skillProficiencies.length}/${CUSTOM_BACKGROUND_SKILL_COUNT})`}
                options={SKILLS}
                selectedValues={customBackground.skillProficiencies}
                maximumSelections={CUSTOM_BACKGROUND_SKILL_COUNT}
                onChange={(skillProficiencies) => {
                  setCustomBackground((current) => ({ ...current, skillProficiencies }));
                  setClassSkillChoices((current) => current.filter((skill) => !skillProficiencies.includes(skill)));
                }}
                testIDPrefix="custom-background-skill"
              />
              <ChoiceChipSelector
                title="Ferramenta (1/1)"
                options={ALL_TOOL_OPTIONS}
                selectedValues={customBackground.toolProficiency ? [customBackground.toolProficiency] : []}
                maximumSelections={CUSTOM_BACKGROUND_TOOL_COUNT}
                onChange={(tools) => setCustomBackground((current) => ({ ...current, toolProficiency: tools[0] }))}
                testIDPrefix="custom-background-tool"
              />
            </Card>
          ) : null}
          {proficiencySelection.requirement ? (
            <>
              <Card variant="filled" title={`Perícias de ${proficiencySelection.requirement.className}`} subtitle={`Escolha exatamente ${proficiencySelection.requirement.skillChoiceCount}.`}>
                <View style={styles.chips}>
                  {proficiencySelection.requirement.skillOptions.map((skill) => {
                    const grantedByBackground = backgroundDefaults.proficiencies.skills.includes(skill);
                    const grantedBySpecies = speciesChoiceProficiencyGrants.skills.includes(skill);
                    const grantedByOrigin = grantedByBackground || grantedBySpecies;
                    const selectedByClass = classSkillChoices.includes(skill);
                    return (
                      <Chip
                        key={skill}
                        label={skill}
                        selected={grantedByOrigin || selectedByClass}
                        disabled={grantedByOrigin || (!selectedByClass && classSkillChoices.length >= proficiencySelection.requirement!.skillChoiceCount)}
                        accessibilityHint={grantedByBackground
                          ? 'Esta perícia já é concedida pelo background; escolha outra perícia da classe.'
                          : grantedBySpecies
                            ? 'Esta perícia já é concedida pela espécie; escolha outra perícia da classe.'
                            : undefined}
                        onPress={() => setClassSkillChoices((current) => current.includes(skill) ? current.filter((entry) => entry !== skill) : [...current, skill])}
                      />
                    );
                  })}
                </View>
              </Card>
              {proficiencySelection.requirement.toolChoiceCount > 0 ? (
                <ChoiceChipSelector
                  title={`Escolhas de ${proficiencySelection.requirement.toolChoiceLabel ?? 'ferramenta'}`}
                  options={proficiencySelection.requirement.toolOptions}
                  selectedValues={csv(classToolChoicesText)}
                  lockedSelectedValues={inheritedBackgroundTools.filter((tool) => proficiencySelection.requirement?.toolOptions.includes(tool))}
                  maximumSelections={proficiencySelection.requirement.toolChoiceCount}
                  onChange={(values) => setClassToolChoicesText(values.join(', '))}
                  supportingText={inheritedBackgroundTools.some((tool) => proficiencySelection.requirement?.toolOptions.includes(tool)) ? 'As opções já concedidas pelo background aparecem selecionadas e bloqueadas; elas não consomem as escolhas adicionais da classe.' : undefined}
                  testIDPrefix="class-tool"
                />
              ) : null}
              {proficiencySelection.requirement.expertiseChoiceCount > 0 ? (
                <Card variant="outlined" title={`Expertise (${expertiseSkills.length}/${proficiencySelection.requirement.expertiseChoiceCount})`} subtitle="Escolha apenas entre perícias proficientes.">
                  <View style={styles.chips}>{proficiencySelection.proficiencies.skills.map((skill) => <Chip key={skill} label={skill} selected={expertiseSkills.includes(skill)} disabled={!expertiseSkills.includes(skill) && expertiseSkills.length >= proficiencySelection.requirement!.expertiseChoiceCount} onPress={() => setExpertiseSkills((current) => current.includes(skill) ? current.filter((entry) => entry !== skill) : [...current, skill])} />)}</View>
                </Card>
              ) : null}
            </>
          ) : null}
          <Card variant="filled" title="Concedidas automaticamente" subtitle={`Perícias do background: ${backgroundDefaults.proficiencies.skills.join(', ') || '—'} · Perícias da espécie: ${speciesChoiceProficiencyGrants.skills.join(', ') || '—'} · Idiomas da espécie: ${speciesChoiceProficiencyGrants.languages.join(', ') || '—'} · Salvamentos: ${proficiencySelection.proficiencies.savingThrows.join(', ') || '—'} · Armas: ${proficiencySelection.proficiencies.weapons.join(', ') || '—'} · Armaduras: ${proficiencySelection.proficiencies.armor.join(', ') || '—'}`} />
          {!isCustomBackground && proficiencySelection.backgroundRequirement?.toolChoiceCount ? (
            <ChoiceChipSelector
              title={`Ferramenta do antecedente: ${proficiencySelection.backgroundRequirement.toolChoiceLabel ?? 'escolha'}`}
              options={proficiencySelection.backgroundRequirement.toolOptions}
              selectedValues={csv(backgroundToolChoicesText)}
              maximumSelections={proficiencySelection.backgroundRequirement.toolChoiceCount}
              onChange={(values) => setBackgroundToolChoicesText(values.join(', '))}
              testIDPrefix="background-tool"
            />
          ) : null}
          <Text style={{ color: colors.onSurfaceVariant }}>
            Idioma fixo: {COMMON_LANGUAGE}. Escolha mais dois idiomas padrão.
          </Text>
          <ChoiceChipSelector
            title="Idiomas padrão"
            options={STANDARD_LANGUAGE_OPTIONS}
            selectedValues={csv(languagesText)}
            maximumSelections={2}
            onChange={(values) => setLanguagesText(values.join(', '))}
            testIDPrefix="origin-language"
          />
          {proficiencySelection.requirement?.fixedLanguages.length ? (
            <Text style={{ color: colors.onSurfaceVariant }}>
              Idiomas concedidos pela classe: {proficiencySelection.requirement.fixedLanguages.join(', ')}.
            </Text>
          ) : null}
          {proficiencySelection.requirement?.languageChoiceCount ? (
            <ChoiceChipSelector
              title="Idiomas adicionais da classe"
              options={proficiencySelection.requirement.languageOptions}
              selectedValues={csv(classLanguagesText)}
              maximumSelections={proficiencySelection.requirement.languageChoiceCount}
              onChange={(values) => setClassLanguagesText(values.join(', '))}
              testIDPrefix="class-language"
            />
          ) : null}
          {proficiencyIssues.length ? <IssueList issues={proficiencyIssues} /> : null}
        </>
      ) : null}

      {step === 5 ? (
        <>
          <Card variant="hero" title="Equipamento inicial" subtitle="Escolha a opção da classe e do background. Quando a fonte oferece ouro, ele é registrado na ficha." />
          {desiredLevel >= 2 ? (
            <Card
              variant="outlined"
              title={`Recursos para início no nível ${desiredLevel}`}
              subtitle="A tabela de níveis elevados é uma orientação do Mestre e sempre mantém o equipamento inicial normal."
            >
              {higherLevelStartingGuidance.eligibleForExtraBenefits ? (
                <>
                  <Text style={[styles.muted, { color: colors.onSurfaceVariant }]}>
                    Ouro adicional: {higherLevelStartingGuidance.baseGold} GP + 1d10 × {higherLevelStartingGuidance.goldMultiplier} GP. Itens mágicos sugeridos: {describeMagicItemAllowance(higherLevelStartingGuidance.magicItemAllowance)}.
                  </Text>
                  {higherLevelStartingBenefits ? (
                    <Card
                      variant="filled"
                      title={`${higherLevelStartingBenefits.bonusGold} GP adicionais`}
                      subtitle={`Rolagem: ${higherLevelStartingBenefits.rolledD10} no d10 · itens: ${describeMagicItemAllowance(higherLevelStartingBenefits.magicItemAllowance)}`}
                    />
                  ) : null}
                  <Button
                    label={higherLevelStartingBenefits ? 'Rolar novamente recursos extras' : 'Gerar recursos extras (1d10)'}
                    variant="outlined"
                    onPress={() => setHigherLevelStartingBenefits(generateHigherLevelStartingBenefits(desiredLevel))}
                  />
                  {higherLevelStartingBenefits ? (
                    <Button label="Não usar recursos extras" variant="text" onPress={() => setHigherLevelStartingBenefits(undefined)} />
                  ) : null}
                </>
              ) : (
                <Text style={[styles.muted, { color: colors.onSurfaceVariant }]}>Níveis 2–4 usam apenas o equipamento inicial normal.</Text>
              )}
            </Card>
          ) : null}
          {!isCustomBackground && equipmentOptionGroups.length === 0 ? <Card variant="filled" title="Sem opções estruturadas" subtitle="As fontes escolhidas não possuem equipamento inicial estruturado neste pacote. Você poderá adicionar itens depois." /> : null}
          {isCustomBackground ? (
            <Card
              variant="filled"
              title={`Equipamento de ${customBackground.name || 'background personalizado'}`}
              subtitle={`Monte um pacote de até 50 GP usando equipamentos gerais e armas simples das fontes ativas. Armas marciais e armaduras ficam fora do background. Saldo restante: ${formatCopperCost(CUSTOM_BACKGROUND_EQUIPMENT_BUDGET_COPPER - customBackgroundEquipmentSpentCopper)}.`}
            >
              <Button
                label="Usar somente 50 GP"
                variant="outlined"
                onPress={() => setEquipmentSelections((current) => ensureCustomBackgroundCashEquipmentSelection(current))}
              />
              <Field
                label="Buscar equipamento"
                value={customEquipmentSearch}
                onChangeText={setCustomEquipmentSearch}
                placeholder="Ex.: rope, clothes, kit..."
              />
              <PaginatedOptionCardList
                items={visibleCustomBackgroundEquipmentCandidates}
                keyExtractor={(candidate) => `custom-equipment-${candidate.item.id}`}
                titleForItem={(candidate) => `${candidate.item.name} · ${formatCopperCost(candidate.costCopper)}`}
                descriptionForItem={(candidate) => getCompendiumChoiceDescription(candidate.item)}
                metaForItem={(candidate) => {
                  const count = getCustomBackgroundEquipmentPurchaseCount(equipmentSelections, candidate);
                  if (count > 0) return `Selecionado ×${count} · toque para remover uma compra`;
                  const remaining = CUSTOM_BACKGROUND_EQUIPMENT_BUDGET_COPPER - customBackgroundEquipmentSpentCopper;
                  return candidate.costCopper <= remaining ? 'Toque para adicionar' : 'Orçamento insuficiente';
                }}
                isSelected={(candidate) => getCustomBackgroundEquipmentPurchaseCount(equipmentSelections, candidate) > 0}
                isDisabled={(candidate) => {
                  const count = getCustomBackgroundEquipmentPurchaseCount(equipmentSelections, candidate);
                  return count === 0 && candidate.costCopper > (CUSTOM_BACKGROUND_EQUIPMENT_BUDGET_COPPER - customBackgroundEquipmentSpentCopper);
                }}
                onPressItem={(candidate) => {
                  const count = getCustomBackgroundEquipmentPurchaseCount(equipmentSelections, candidate);
                  if (count > 0) {
                    setEquipmentSelections((current) => setCustomBackgroundEquipmentPurchaseCount(current, candidate, count - 1, customBackgroundEquipmentCandidates));
                    return;
                  }
                  void addCustomBackgroundEquipment(candidate);
                }}
                selectedAccessibilityHint="Toque para remover uma unidade de compra deste equipamento."
                pageSize={12}
                resetKey={`custom-background-equipment:${customEquipmentSearch}:${customBackgroundEquipmentSpentCopper}`}
                emptyText="Nenhum equipamento geral com custo válido foi encontrado nas fontes ativas."
              />
              {customBackgroundEquipmentCandidates.filter((candidate) => getCustomBackgroundEquipmentPurchaseCount(equipmentSelections, candidate) > 0).map((candidate) => {
                const count = getCustomBackgroundEquipmentPurchaseCount(equipmentSelections, candidate);
                const canAdd = customBackgroundEquipmentSpentCopper + candidate.costCopper <= CUSTOM_BACKGROUND_EQUIPMENT_BUDGET_COPPER;
                return (
                  <View key={`custom-equipment-selected-${candidate.item.id}`} style={styles.selectionRow}>
                    <Text style={[styles.selectionText, { color: colors.onSurface }]}>{candidate.item.name} ×{count} · {formatCopperCost(candidate.costCopper * count)}</Text>
                    <Button
                      label="Adicionar outro"
                      variant="text"
                      compact
                      disabled={!canAdd}
                      onPress={() => { void addCustomBackgroundEquipment(candidate); }}
                    />
                    <Button
                      label="Remover um"
                      variant="text"
                      compact
                      onPress={() => setEquipmentSelections((current) => setCustomBackgroundEquipmentPurchaseCount(current, candidate, Math.max(0, count - 1), customBackgroundEquipmentCandidates))}
                    />
                  </View>
                );
              })}
            </Card>
          ) : null}
          {equipmentOptionGroups.map((group) => {
            const source = group[0];
            const selected = equipmentSelections.find((entry) => entry.sourceItemId === source?.sourceItemId);
            return (
              <Card key={`${source?.sourceKind}-${source?.sourceItemId}`} variant="filled" title={source?.sourceName ?? 'Equipamento'} subtitle={source?.sourceKind === 'class' ? 'Classe inicial' : 'Background'}>
                <View style={styles.chips}>{group.map((option) => (
                  <Chip
                    key={`${option.sourceItemId}-${option.optionId}`}
                    label={`${option.optionId}: ${option.labels.join(', ')}`}
                    selected={selected?.optionId === option.optionId}
                    onPress={() => setEquipmentSelections((current) => [
                      ...current.filter((entry) => entry.sourceItemId !== option.sourceItemId),
                      createEquipmentSelection(option, items)
                    ])}
                  />
                ))}</View>
              </Card>
            );
          })}
          {equipmentIssues.length ? <IssueList issues={equipmentIssues} /> : null}
        </>
      ) : null}

      {step === 6 ? (
        <>
          <Card variant="hero" title="Magias" subtitle="Selecione agora as magias desejadas ou deixe escolhas pendentes para completar depois na ficha do personagem." />
          {spellProfiles.length === 0 ? <Card variant="filled" title="Sem conjuração" subtitle="As classes escolhidas não possuem Spellcasting ou Pact Magic nesta progressão." /> : null}
          <View style={styles.chips}>{spellProfiles.map((profile) => <Chip key={profile.classItemId} label={profile.className} selected={activeSpellClassItemId === profile.classItemId} onPress={() => setActiveSpellClassItemId(profile.classItemId)} />)}</View>
          {activeSpellProfile ? (
            <>
              <Card variant="filled" title={`${activeSpellProfile.className} ${activeSpellProfile.classLevel}`} subtitle={`Cantrips: ${spellValidation.countsByClassItemId[activeSpellProfile.classItemId]?.cantrips ?? 0}/${activeSpellProfile.cantripLimit} · Preparadas/conhecidas: ${spellValidation.countsByClassItemId[activeSpellProfile.classItemId]?.prepared ?? 0}/${activeSpellProfile.preparedSpellLimit}${activeSpellProfile.preparationMode === 'spellbook' ? ` · Spellbook: ${spellValidation.countsByClassItemId[activeSpellProfile.classItemId]?.spellbook ?? 0}/${activeSpellProfile.spellbookMinimumSpellCount}` : ''} · nível máximo ${activeSpellProfile.maxSpellLevel} · ${activeSpellProfile.preparationMode}`} />
              <Card variant="outlined" title="Escolhas opcionais nesta etapa" subtitle="Quantidades ainda não preenchidas serão registradas como pendências. Depois de criar o personagem, abra Magias para concluir as escolhas restantes." />
              <Field label="Buscar magia" value={spellSearch} onChangeText={setSpellSearch} />
              {focusedSpellItem
                && isSpellItemEligibleForProfile(
                  focusedSpellItem,
                  activeSpellProfile,
                  subclassSpellReferencesByClassItemId[activeSpellProfile.classItemId] ?? []
                )
                && effectiveSpellAssignments[focusedSpellItem.id] !== activeSpellProfile.classItemId
                && effectiveSpellbookAssignments[focusedSpellItem.id] !== activeSpellProfile.classItemId ? (
                <SpellChoiceDetails
                  item={focusedSpellItem}
                  selectionLabel="Detalhes da magia em foco"
                />
              ) : null}
              <Text style={[styles.sectionTitle, { color: colors.onSurface }]}>Cantrips</Text>
              <PaginatedChipList
                items={visibleSpells.filter((item) => spellItemLevel(item) === 0)}
                keyExtractor={(item) => `cantrip-${item.id}`}
                labelForItem={(item) => item.name}
                isSelected={(item) => effectiveSpellAssignments[item.id] === activeSpellProfile.classItemId}
                descriptionForSelectedItem={getSpellChoiceInlineDescription}
                onPressItem={(item) => { void selectClassSpell(item); }}
                pageSize={24}
                resetKey={`${activeSpellProfile.classItemId}:cantrip:${spellSearch}`}
                emptyText={`Nenhum cantrip de ${activeSpellProfile.className} encontrado.`}
              />

              {activeSpellProfile.preparationMode === 'spellbook' ? (
                <>
                  <Text style={[styles.sectionTitle, { color: colors.onSurface }]}>Magias com slot no spellbook</Text>
                  <PaginatedChipList
                    items={visibleSpells.filter((item) => spellItemLevel(item) > 0)}
                    keyExtractor={(item) => `book-${item.id}`}
                    labelForItem={(item) => `${item.name} · nv ${spellItemLevel(item)}`}
                    isSelected={(item) => effectiveSpellbookAssignments[item.id] === activeSpellProfile.classItemId}
                    descriptionForSelectedItem={getSpellChoiceInlineDescription}
                    onPressItem={(item) => { void selectSpellbookSpell(item); }}
                    pageSize={24}
                    resetKey={`${activeSpellProfile.classItemId}:spellbook:${spellSearch}`}
                    emptyText={`Nenhuma magia com slot de ${activeSpellProfile.className} encontrada.`}
                  />
                  <Text style={[styles.sectionTitle, { color: colors.onSurface }]}>Magias preparadas do spellbook</Text>
                  <PaginatedChipList
                    items={allSpells
                      .filter((item) => spellItemLevel(item) > 0)
                      .filter((item) => effectiveSpellbookAssignments[item.id] === activeSpellProfile.classItemId)
                      .filter((item) => !spellSearch.trim() || item.name.toLowerCase().includes(spellSearch.trim().toLowerCase()))}
                    keyExtractor={(item) => `prepared-${item.id}`}
                    labelForItem={(item) => `${item.name} · nv ${spellItemLevel(item)}`}
                    isSelected={(item) => effectiveSpellAssignments[item.id] === activeSpellProfile.classItemId}
                    descriptionForSelectedItem={getSpellChoiceInlineDescription}
                    onPressItem={(item) => { void selectClassSpell(item); }}
                    pageSize={24}
                    resetKey={`${activeSpellProfile.classItemId}:prepared:${Object.keys(effectiveSpellbookAssignments).length}:${spellSearch}`}
                    emptyText="Adicione magias ao spellbook para prepará-las."
                  />
                </>
              ) : (
                <>
                  <Text style={[styles.sectionTitle, { color: colors.onSurface }]}>Magias com slot</Text>
                  <PaginatedChipList
                    items={visibleSpells.filter((item) => spellItemLevel(item) > 0)}
                    keyExtractor={(item) => `slotted-${item.id}`}
                    labelForItem={(item) => `${item.name} · nv ${spellItemLevel(item)}`}
                    isSelected={(item) => effectiveSpellAssignments[item.id] === activeSpellProfile.classItemId}
                    descriptionForSelectedItem={getSpellChoiceInlineDescription}
                    onPressItem={(item) => { void selectClassSpell(item); }}
                    pageSize={24}
                    resetKey={`${activeSpellProfile.classItemId}:slotted:${spellSearch}`}
                    emptyText={`Nenhuma magia com slot de ${activeSpellProfile.className} encontrada.`}
                  />
                </>
              )}
            </>
          ) : null}
          {spellCompletionIssues.length ? (
            <Card variant="filled" title="Magias para escolher depois" subtitle={`${spellCompletionIssues.length} requisito(s) de quantidade permanecem pendentes.`}>
              {spellCompletionIssues.map((issue) => (
                <Text key={`${issue.code}:${issue.message}`} style={[styles.muted, { color: colors.onSurfaceVariant }]}>• {issue.message}</Text>
              ))}
            </Card>
          ) : null}
          {spellValidation.issues.length ? <IssueList issues={spellValidation.issues} /> : null}
        </>
      ) : null}

      {step === 7 ? (
        <>
          <Card variant="hero" title="Nome opcional" subtitle="Deixe vazio para usar um identificador derivado da classe." />
          <Field label="Nome do personagem" value={name} onChangeText={setName} placeholder="Opcional" />
          <Card variant="filled" title={name.trim() || `${selectedClassItems[0]?.item.name ?? 'Personagem'} sem nome`} subtitle={`Nível ${desiredLevel} · ${selectedClassItems.map(({ item, level }) => `${item.name} ${level}`).join(' / ')}`}>
            <Text style={[styles.muted, { color: colors.onSurfaceVariant }]}>Espécie: {selectedSpecies?.name ?? 'pendente'} · Background: {selectedBackground?.name ?? 'pendente'} · Feats: {selectedFeatInstances.length} · Magias ativas: {Object.keys(effectiveSpellAssignments).length} · Spellbook: {Object.keys(effectiveSpellbookAssignments).length} · Equipamento: {equipmentSelections.length} escolha(s){higherLevelStartingBenefits ? ` · Ouro extra: ${higherLevelStartingBenefits.bonusGold} GP` : ''}</Text>
          </Card>
          {(abilityMethod === 'standardArray' || abilityMethod === 'diceRoll') && !generatedAbilityAssignmentsComplete ? (
            <Card variant="outlined" title="Atributos pendentes" subtitle="Volte à etapa Atributos e atribua cada valor gerado exatamente uma vez antes de concluir." />
          ) : null}
          {buildIssues.length ? <Card variant="outlined" title="Pré-requisitos pendentes"><IssueList issues={buildIssues} /></Card> : null}
          {featChoiceIssues.length ? <IssueList issues={featChoiceIssues} /> : null}
          {proficiencyIssues.length ? <IssueList issues={proficiencyIssues} /> : null}
          {equipmentIssues.length ? <IssueList issues={equipmentIssues} /> : null}
          {spellCompletionIssues.length ? (
            <Card variant="filled" title="Escolhas de magia pendentes" subtitle="O personagem poderá ser concluído agora. As escolhas restantes aparecerão na ficha.">
              {spellCompletionIssues.map((issue) => (
                <Text key={`summary:${issue.code}:${issue.message}`} style={[styles.muted, { color: colors.onSurfaceVariant }]}>• {issue.message}</Text>
              ))}
            </Card>
          ) : null}
          {spellValidation.issues.length ? <IssueList issues={spellValidation.issues} /> : null}
        </>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  footerRow: {
    width: '100%',
    maxWidth: 760,
    alignSelf: 'center',
    flexDirection: 'row',
    gap: 10
  },
  flex: { flex: 1, minWidth: 130 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  sectionTitle: { fontSize: 15, lineHeight: 21, fontWeight: '900' },
  muted: { fontSize: 13, lineHeight: 19 },
  previewHeading: { fontSize: 14, lineHeight: 20, fontWeight: '900', marginTop: 2 },
  previewFeature: { gap: 2, paddingTop: 2 },
  previewFeatureTitle: { fontSize: 13, lineHeight: 18, fontWeight: '800' },
  previewFeatureSummary: { fontSize: 12, lineHeight: 17 },
  selectionRow: { flexDirection: 'row', alignItems: 'center', gap: 8, justifyContent: 'space-between' },
  selectionText: { flex: 1, fontWeight: '800' }
});
