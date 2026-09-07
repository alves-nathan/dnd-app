import type {
  Character,
  CharacterSpellbookFeatureChoice,
  RuleValidationIssue,
  Spell
} from '../types';
import type { StoredCompendiumItem } from '../compendium/types';
import { findCompendiumItemByReference, getProgressionFeatureReferences } from '../compendium/classProgression';
import {
  characterLinkMatchesReference,
  findCompendiumItemForCharacterLink
} from '../compendium/characterLinkIdentity';
import {
  getActiveSubclassItemForClass,
  getClassSpellcastingProfile,
  isSpellItemEligibleForProfile,
  spellItemLevel,
  type ClassSpellcastingProfile
} from './spellcastingRules';
import {
  getSpellbookEntriesForClass,
  learnSpellbookSpell,
  prepareSpellbookSpell
} from './spellbookRules';

const asRecord = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
const asString = (value: unknown): string | undefined =>
  typeof value === 'string' && value.trim() ? value.trim() : undefined;
const asNumber = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isFinite(value) ? value : undefined;
const asBoolean = (value: unknown): boolean | undefined =>
  typeof value === 'boolean' ? value : undefined;
const asArray = (value: unknown): unknown[] => Array.isArray(value) ? value : [];
const normalize = (value: string): string => value.trim().toLowerCase();
const unique = <T,>(values: readonly T[]): T[] => Array.from(new Set(values));

const payloadFor = (item: StoredCompendiumItem | undefined): Record<string, unknown> =>
  asRecord(asRecord(item?.rawJson).payload);

const approvedItem = (item: StoredCompendiumItem): StoredCompendiumItem =>
  item.status === 'validated'
    ? item
    : { ...item, status: 'validated', reviewDecision: 'approved' };

const activeFeatureItems = (
  owner: StoredCompendiumItem | undefined,
  items: StoredCompendiumItem[],
  attainedLevel: number
): StoredCompendiumItem[] => {
  if (!owner || (owner.type !== 'class' && owner.type !== 'subclass')) return [];
  return getProgressionFeatureReferences(owner, attainedLevel)
    .map((reference) => findCompendiumItemByReference(items, reference))
    .filter((item): item is StoredCompendiumItem => Boolean(item && item.type === 'feature' && item.status !== 'disabled'));
};

const spellSchool = (item: StoredCompendiumItem): string | undefined =>
  asString(asRecord(item.normalizedJson).school) ?? asString(payloadFor(item).school);

const spellCastingActionCost = (item: StoredCompendiumItem): string | undefined => {
  const payload = payloadFor(item);
  const castingTime = asRecord(payload.castingTime);
  return asString(castingTime.actionCost) ?? asString(payload.actionCost) ?? asString(asRecord(item.normalizedJson).actionCost);
};

export type WizardSpellbookFeatureRequirementKind =
  | 'savantInitial'
  | 'savantNewSlotLevel'
  | 'spellMastery'
  | 'signatureSpells';

export interface WizardSpellbookFeatureRequirement {
  id: string;
  kind: WizardSpellbookFeatureRequirementKind;
  classItemId: string;
  className: string;
  featureItemId: string;
  featureName: string;
  count: number;
  candidateScope: 'wizardList' | 'spellbook';
  school?: string;
  exactSpellLevel?: number;
  maximumSpellLevel?: number;
  castingTime?: 'action';
  alwaysPrepared?: boolean;
  castAtWillAtLowestLevel?: boolean;
  freeCastEach?: number;
  recharge?: 'shortRest' | 'longRest';
}

export interface WizardSpellbookFeatureRequirementInput {
  classItem: StoredCompendiumItem;
  classLevel: number;
  subclassItem?: StoredCompendiumItem;
  items: StoredCompendiumItem[];
}

const savantRequirements = ({
  classItem,
  classLevel,
  subclassItem,
  items
}: WizardSpellbookFeatureRequirementInput): WizardSpellbookFeatureRequirement[] => {
  if (!subclassItem) return [];
  const features = activeFeatureItems(subclassItem, items, classLevel);
  const result: WizardSpellbookFeatureRequirement[] = [];
  for (const feature of features) {
    const payload = payloadFor(feature);
    if (asBoolean(payload.freeSpells) !== true) continue;
    const school = asString(payload.school);
    const featureLevel = Math.max(1, Math.floor(asNumber(payload.levelGained) ?? 3));
    if (!school || classLevel < featureLevel) continue;
    result.push({
      id: `${feature.id}:initial`,
      kind: 'savantInitial',
      classItemId: classItem.id,
      className: classItem.name,
      featureItemId: feature.id,
      featureName: feature.name,
      count: 2,
      candidateScope: 'wizardList',
      school,
      maximumSpellLevel: 2
    });

    let previousMaxSpellLevel = getClassSpellcastingProfile(classItem, featureLevel)?.maxSpellLevel ?? 0;
    for (let level = featureLevel + 1; level <= classLevel; level += 1) {
      const maxSpellLevel = getClassSpellcastingProfile(classItem, level)?.maxSpellLevel ?? previousMaxSpellLevel;
      if (maxSpellLevel > previousMaxSpellLevel) {
        result.push({
          id: `${feature.id}:slot-level:${maxSpellLevel}`,
          kind: 'savantNewSlotLevel',
          classItemId: classItem.id,
          className: classItem.name,
          featureItemId: feature.id,
          featureName: feature.name,
          count: 1,
          candidateScope: 'wizardList',
          school,
          maximumSpellLevel: maxSpellLevel
        });
      }
      previousMaxSpellLevel = maxSpellLevel;
    }
  }
  return result;
};

const specialChoiceRequirements = ({
  classItem,
  classLevel,
  items
}: WizardSpellbookFeatureRequirementInput): WizardSpellbookFeatureRequirement[] => {
  const result: WizardSpellbookFeatureRequirement[] = [];
  for (const feature of activeFeatureItems(classItem, items, classLevel)) {
    const payload = payloadFor(feature);
    const choices = asArray(payload.chooseSpells).map(asRecord).filter((row) => Object.keys(row).length > 0);
    if (!choices.length) continue;
    const engineKey = asString(payload.engineKey) ?? '';
    if (engineKey === 'wizard.spell-mastery' || normalize(feature.name) === 'spell mastery') {
      choices.forEach((row, index) => {
        const spellLevel = asNumber(row.level);
        if (!spellLevel) return;
        result.push({
          id: `${feature.id}:choice:${index}:${spellLevel}`,
          kind: 'spellMastery',
          classItemId: classItem.id,
          className: classItem.name,
          featureItemId: feature.id,
          featureName: feature.name,
          count: Math.max(1, Math.floor(asNumber(row.count) ?? 1)),
          candidateScope: 'spellbook',
          exactSpellLevel: spellLevel,
          castingTime: asString(row.castingTime) === 'action' ? 'action' : undefined,
          alwaysPrepared: true,
          castAtWillAtLowestLevel: asBoolean(payload.castAtWillAtLowestLevel) === true
        });
      });
      continue;
    }
    if (engineKey === 'wizard.signature-spells' || normalize(feature.name) === 'signature spells') {
      choices.forEach((row, index) => {
        const spellLevel = asNumber(row.level);
        if (!spellLevel) return;
        result.push({
          id: `${feature.id}:choice:${index}:${spellLevel}`,
          kind: 'signatureSpells',
          classItemId: classItem.id,
          className: classItem.name,
          featureItemId: feature.id,
          featureName: feature.name,
          count: Math.max(1, Math.floor(asNumber(row.count) ?? 1)),
          candidateScope: 'spellbook',
          exactSpellLevel: spellLevel,
          alwaysPrepared: asBoolean(payload.alwaysPrepared) === true,
          freeCastEach: asNumber(payload.freeCastEach),
          // PHB 2024 Signature Spells recharge after a Short or Long Rest.
          // ResourcePool uses `shortRest` for resources restored by either rest type.
          recharge: 'shortRest'
        });
      });
    }
  }
  return result;
};

export const getWizardSpellbookFeatureRequirements = (
  input: WizardSpellbookFeatureRequirementInput
): WizardSpellbookFeatureRequirement[] => [
  ...savantRequirements(input),
  ...specialChoiceRequirements(input)
];

export const getAutomaticWizardSpellbookGrantReferences = (
  classItem: StoredCompendiumItem,
  classLevel: number,
  subclassItem: StoredCompendiumItem | undefined,
  items: StoredCompendiumItem[]
): Array<{ featureItemId: string; featureName: string; spellItemId: string }> => {
  const features = [
    ...activeFeatureItems(classItem, items, classLevel),
    ...activeFeatureItems(subclassItem, items, classLevel)
  ];
  return features.flatMap((feature) => {
    const mechanics = asRecord(payloadFor(feature).mechanics);
    const reference = asString(mechanics.addsSpellToSpellbook);
    if (!reference) return [];
    const spellItem = findCompendiumItemByReference(items, reference);
    return spellItem?.type === 'spell'
      ? [{ featureItemId: feature.id, featureName: feature.name, spellItemId: spellItem.id }]
      : [];
  });
};

export interface WizardSpellbookFeatureCandidateInput {
  requirement: WizardSpellbookFeatureRequirement;
  profile: ClassSpellcastingProfile;
  spellItems: StoredCompendiumItem[];
  availableSpellbookItemIds?: ReadonlySet<string>;
}

export const getWizardSpellbookFeatureCandidates = ({
  requirement,
  profile,
  spellItems,
  availableSpellbookItemIds
}: WizardSpellbookFeatureCandidateInput): StoredCompendiumItem[] =>
  spellItems
    .filter((item) => item.type === 'spell' && item.status !== 'disabled' && spellItemLevel(item) > 0)
    .filter((item) => isSpellItemEligibleForProfile(item, profile))
    .filter((item) => requirement.candidateScope !== 'spellbook' || availableSpellbookItemIds?.has(item.id))
    .filter((item) => requirement.school === undefined || normalize(spellSchool(item) ?? '') === normalize(requirement.school))
    .filter((item) => requirement.exactSpellLevel === undefined || spellItemLevel(item) === requirement.exactSpellLevel)
    .filter((item) => requirement.maximumSpellLevel === undefined || spellItemLevel(item) <= requirement.maximumSpellLevel)
    .filter((item) => requirement.castingTime !== 'action' || spellCastingActionCost(item) === 'action')
    .sort((left, right) => spellItemLevel(left) - spellItemLevel(right) || left.name.localeCompare(right.name));

export const spellbookFeatureChoiceForRequirement = (
  choices: readonly CharacterSpellbookFeatureChoice[],
  requirement: WizardSpellbookFeatureRequirement
): CharacterSpellbookFeatureChoice | undefined => choices.find((choice) => choice.requirementId === requirement.id);

export const toggleWizardSpellbookFeatureChoiceSpell = (
  choices: readonly CharacterSpellbookFeatureChoice[],
  requirement: WizardSpellbookFeatureRequirement,
  spellItemId: string
): CharacterSpellbookFeatureChoice[] => {
  const existing = spellbookFeatureChoiceForRequirement(choices, requirement);
  const selected = existing?.spellItemIds ?? [];
  const nextSpellIds = selected.includes(spellItemId)
    ? selected.filter((itemId) => itemId !== spellItemId)
    : selected.length < requirement.count
      ? [...selected, spellItemId]
      : selected;
  const others = choices.filter((choice) => choice.requirementId !== requirement.id);
  if (!nextSpellIds.length) return others;
  return [...others, {
    requirementId: requirement.id,
    classItemId: requirement.classItemId,
    featureItemId: requirement.featureItemId,
    spellItemIds: nextSpellIds
  }];
};

export interface ValidateWizardSpellbookFeatureChoicesInput {
  requirements: WizardSpellbookFeatureRequirement[];
  choices: CharacterSpellbookFeatureChoice[];
  profileByClassItemId: ReadonlyMap<string, ClassSpellcastingProfile>;
  spellItems: StoredCompendiumItem[];
  normalSpellbookAssignments: Record<string, string>;
  automaticGrantSpellItemIdsByClassItemId?: ReadonlyMap<string, ReadonlySet<string>>;
  /** When reconciling an existing character, use the actual spellbook instead of creation-only assignments. */
  availableSpellbookItemIdsByClassItemId?: ReadonlyMap<string, ReadonlySet<string>>;
  /** Existing non-Savant entries that cannot consume a free Savant addition. */
  blockedSavantSpellItemIdsByClassItemId?: ReadonlyMap<string, ReadonlySet<string>>;
  requireExact?: boolean;
}

const issue = (code: string, message: string): RuleValidationIssue => ({ severity: 'error', code, message });

export const validateWizardSpellbookFeatureChoices = ({
  requirements,
  choices,
  profileByClassItemId,
  spellItems,
  normalSpellbookAssignments,
  automaticGrantSpellItemIdsByClassItemId,
  availableSpellbookItemIdsByClassItemId,
  blockedSavantSpellItemIdsByClassItemId,
  requireExact = true
}: ValidateWizardSpellbookFeatureChoicesInput): RuleValidationIssue[] => {
  const issues: RuleValidationIssue[] = [];
  const requirementIds = new Set(requirements.map((requirement) => requirement.id));
  for (const choice of choices) {
    if (!requirementIds.has(choice.requirementId)) {
      issues.push(issue('SPELLBOOK_FEATURE_CHOICE_STALE', `Escolha especial de spellbook ${choice.requirementId} não está mais ativa.`));
    }
  }

  for (const requirement of requirements) {
    const choice = spellbookFeatureChoiceForRequirement(choices, requirement);
    const selected = unique(choice?.spellItemIds ?? []);
    if (requireExact ? selected.length !== requirement.count : selected.length > requirement.count) {
      issues.push(issue(
        'SPELLBOOK_FEATURE_CHOICE_COUNT',
        `${requirement.featureName} exige ${requirement.count} magia(s); selecionada(s): ${selected.length}.`
      ));
    }
    const profile = profileByClassItemId.get(requirement.classItemId);
    if (!profile) continue;
    const savantSelected = new Set(
      choices
        .filter((candidate) => candidate.classItemId === requirement.classItemId)
        .filter((candidate) => requirements.some((req) => req.id === candidate.requirementId && (req.kind === 'savantInitial' || req.kind === 'savantNewSlotLevel')))
        .flatMap((candidate) => candidate.spellItemIds)
    );
    const explicitAvailableSpellbook = availableSpellbookItemIdsByClassItemId?.get(requirement.classItemId);
    const availableSpellbook = explicitAvailableSpellbook
      ? new Set(explicitAvailableSpellbook)
      : new Set([
          ...Object.entries(normalSpellbookAssignments)
            .filter(([, classItemId]) => classItemId === requirement.classItemId)
            .map(([spellItemId]) => spellItemId),
          ...savantSelected,
          ...(automaticGrantSpellItemIdsByClassItemId?.get(requirement.classItemId) ?? [])
        ]);
    const candidates = new Set(getWizardSpellbookFeatureCandidates({
      requirement,
      profile,
      spellItems,
      availableSpellbookItemIds: availableSpellbook
    }).map((item) => item.id));
    for (const spellItemId of selected) {
      if (!candidates.has(spellItemId)) {
        issues.push(issue('SPELLBOOK_FEATURE_CHOICE_INVALID_SPELL', `${requirement.featureName} não permite a magia selecionada ${spellItemId}.`));
      }
      const savantBlocked = blockedSavantSpellItemIdsByClassItemId?.get(requirement.classItemId)
        ?? new Set([
          ...Object.entries(normalSpellbookAssignments)
            .filter(([, classItemId]) => classItemId === requirement.classItemId)
            .map(([itemId]) => itemId),
          ...(automaticGrantSpellItemIdsByClassItemId?.get(requirement.classItemId) ?? [])
        ]);
      if ((requirement.kind === 'savantInitial' || requirement.kind === 'savantNewSlotLevel') && savantBlocked.has(spellItemId)) {
        issues.push(issue('SAVANT_DUPLICATES_EXISTING_SPELLBOOK', `${requirement.featureName} deve adicionar uma magia nova ao spellbook; ${spellItemId} já está registrado por outra origem.`));
      }
    }
  }

  const savantSeen = new Set<string>();
  for (const requirement of requirements.filter((entry) => entry.kind === 'savantInitial' || entry.kind === 'savantNewSlotLevel')) {
    const selected = spellbookFeatureChoiceForRequirement(choices, requirement)?.spellItemIds ?? [];
    for (const spellItemId of selected) {
      const key = `${requirement.classItemId}:${spellItemId}`;
      if (savantSeen.has(key)) issues.push(issue('SAVANT_DUPLICATE_SPELL', `A mesma magia não pode preencher duas concessões de Savant: ${spellItemId}.`));
      savantSeen.add(key);
    }
  }
  return issues;
};

export const pruneWizardSpellbookFeatureChoices = ({
  requirements,
  choices,
  profileByClassItemId,
  spellItems,
  normalSpellbookAssignments,
  automaticGrantSpellItemIdsByClassItemId,
  availableSpellbookItemIdsByClassItemId,
  blockedSavantSpellItemIdsByClassItemId
}: Omit<ValidateWizardSpellbookFeatureChoicesInput, 'requireExact'>): CharacterSpellbookFeatureChoice[] => {
  const requirementsById = new Map(requirements.map((requirement) => [requirement.id, requirement]));
  const kept: CharacterSpellbookFeatureChoice[] = [];
  for (const choice of choices) {
    const requirement = requirementsById.get(choice.requirementId);
    if (!requirement || requirement.classItemId !== choice.classItemId || requirement.featureItemId !== choice.featureItemId) continue;
    const profile = profileByClassItemId.get(requirement.classItemId);
    if (!profile) continue;
    const savantSelected = new Set(
      choices
        .filter((candidate) => candidate.classItemId === requirement.classItemId && candidate.requirementId !== choice.requirementId)
        .filter((candidate) => {
          const other = requirementsById.get(candidate.requirementId);
          return other?.kind === 'savantInitial' || other?.kind === 'savantNewSlotLevel';
        })
        .flatMap((candidate) => candidate.spellItemIds)
    );
    const explicitAvailable = availableSpellbookItemIdsByClassItemId?.get(requirement.classItemId);
    const availableSpellbook = explicitAvailable
      ? new Set(explicitAvailable)
      : new Set([
          ...Object.entries(normalSpellbookAssignments)
            .filter(([, classItemId]) => classItemId === requirement.classItemId)
            .map(([spellItemId]) => spellItemId),
          ...savantSelected,
          ...(automaticGrantSpellItemIdsByClassItemId?.get(requirement.classItemId) ?? [])
        ]);
    const candidates = new Set(getWizardSpellbookFeatureCandidates({
      requirement, profile, spellItems, availableSpellbookItemIds: availableSpellbook
    }).map((item) => item.id));
    const savantBlocked = blockedSavantSpellItemIdsByClassItemId?.get(requirement.classItemId)
      ?? new Set([
        ...Object.entries(normalSpellbookAssignments)
          .filter(([, classItemId]) => classItemId === requirement.classItemId)
          .map(([spellItemId]) => spellItemId),
        ...(automaticGrantSpellItemIdsByClassItemId?.get(requirement.classItemId) ?? [])
      ]);
    const selected = unique(choice.spellItemIds)
      .filter((spellItemId) => candidates.has(spellItemId))
      .filter((spellItemId) => !((requirement.kind === 'savantInitial' || requirement.kind === 'savantNewSlotLevel')
        && savantBlocked.has(spellItemId)))
      .slice(0, requirement.count);
    if (selected.length) kept.push({ ...choice, spellItemIds: selected });
  }
  const savantSeen = new Set<string>();
  return kept.flatMap((choice) => {
    const requirement = requirementsById.get(choice.requirementId);
    if (requirement?.kind !== 'savantInitial' && requirement?.kind !== 'savantNewSlotLevel') return [choice];
    const spellItemIds = choice.spellItemIds.filter((spellItemId) => {
      const key = `${choice.classItemId}:${spellItemId}`;
      if (savantSeen.has(key)) return false;
      savantSeen.add(key);
      return true;
    });
    return spellItemIds.length ? [{ ...choice, spellItemIds }] : [];
  });
};

const signatureResourceId = (classEntityId: string, spellItemId: string): string =>
  `wizard-signature:${classEntityId}:${spellItemId}`;

export interface ReconcileWizardSpellbookFeatureResult {
  character: Character;
  issues: RuleValidationIssue[];
  addedSpellbookEntryCount: number;
  removedSpellbookEntryCount: number;
  removedSpellCount: number;
}

export const reconcileWizardSpellbookFeatures = (
  character: Character,
  items: StoredCompendiumItem[]
): ReconcileWizardSpellbookFeatureResult => {
  let next = character;
  const originalSpellIds = new Set(character.spells.map((spell) => spell.id));
  const issues: RuleValidationIssue[] = [];
  let addedSpellbookEntryCount = 0;
  let removedSpellbookEntryCount = 0;
  const activeRequirementIds = new Set<string>();
  const activeFeatureGrantKeys = new Set<string>();
  const validChoices: CharacterSpellbookFeatureChoice[] = [];
  const activeSpellbookClassEntityIds = new Set<string>();
  const specialBySpellKey = new Map<string, { requirement: WizardSpellbookFeatureRequirement; choiceId: string; wasPrepared: boolean }>();

  for (const classEntity of character.classes) {
    const classLink = (character.compendiumLinks ?? []).find((entry) =>
      entry.appliedAs === 'class' && entry.appliedEntityId === classEntity.id && entry.status === 'active'
    );
    const classItem = classLink ? findCompendiumItemForCharacterLink(items, classLink) : undefined;
    const profile = classItem ? getClassSpellcastingProfile(classItem, classEntity.level) : undefined;
    if (!classItem || profile?.preparationMode !== 'spellbook') continue;
    activeSpellbookClassEntityIds.add(classEntity.id);
    const subclassItem = getActiveSubclassItemForClass(character, classEntity.id, items);
    const requirements = getWizardSpellbookFeatureRequirements({ classItem, classLevel: classEntity.level, subclassItem, items });
    const requirementsById = new Map(requirements.map((requirement) => [requirement.id, requirement]));
    const rawChoices = (character.buildChoices?.spellbookFeatureChoices ?? [])
      .filter((choice) => choice.classItemId === classItem.id)
      .filter((choice) => requirementsById.has(choice.requirementId));
    const grants = getAutomaticWizardSpellbookGrantReferences(classItem, classEntity.level, subclassItem, items);
    const existingNonSavantSpellbookIds = new Set([
      ...getSpellbookEntriesForClass(next, classEntity.id)
        .filter((entry) => entry.acquisition !== 'savant')
        .map((entry) => entry.spellItemId),
      ...grants.map((grant) => grant.spellItemId)
    ]);
    const savantChoices = pruneWizardSpellbookFeatureChoices({
      requirements: requirements.filter((requirement) => requirement.kind === 'savantInitial' || requirement.kind === 'savantNewSlotLevel'),
      choices: rawChoices,
      profileByClassItemId: new Map([[classItem.id, profile]]),
      spellItems: items,
      normalSpellbookAssignments: next.buildChoices?.spellbookAssignments ?? {},
      automaticGrantSpellItemIdsByClassItemId: new Map([[classItem.id, new Set(grants.map((grant) => grant.spellItemId))]]),
      blockedSavantSpellItemIdsByClassItemId: new Map([[classItem.id, existingNonSavantSpellbookIds]])
    });
    const availableSpellbookIds = new Set([
      ...getSpellbookEntriesForClass(next, classEntity.id).map((entry) => entry.spellItemId),
      ...savantChoices.flatMap((choice) => choice.spellItemIds),
      ...grants.map((grant) => grant.spellItemId)
    ]);
    const choices = pruneWizardSpellbookFeatureChoices({
      requirements,
      choices: rawChoices,
      profileByClassItemId: new Map([[classItem.id, profile]]),
      spellItems: items,
      normalSpellbookAssignments: next.buildChoices?.spellbookAssignments ?? {},
      automaticGrantSpellItemIdsByClassItemId: new Map([[classItem.id, new Set(grants.map((grant) => grant.spellItemId))]]),
      availableSpellbookItemIdsByClassItemId: new Map([[classItem.id, availableSpellbookIds]]),
      blockedSavantSpellItemIdsByClassItemId: new Map([[classItem.id, existingNonSavantSpellbookIds]])
    });
    choices.forEach((choice) => validChoices.push(choice));
    requirements.forEach((requirement) => activeRequirementIds.add(requirement.id));

    for (const grant of grants) {
      const spellItem = items.find((item) => item.id === grant.spellItemId);
      if (!spellItem) continue;
      const key = `${classEntity.id}:${grant.featureItemId}:${spellItem.id}`;
      activeFeatureGrantKeys.add(key);
      const hadEntry = getSpellbookEntriesForClass(next, classEntity.id).some((entry) => entry.spellItemId === spellItem.id);
      next = learnSpellbookSpell({
        character: next,
        spellItem: approvedItem(spellItem),
        profile,
        classEntityId: classEntity.id,
        acquisition: 'feature',
        source: 'feature',
        notes: `${grant.featureName}: adicionada gratuitamente ao spellbook.`,
        grantedByFeatureItemId: grant.featureItemId
      });
      if (!hadEntry && getSpellbookEntriesForClass(next, classEntity.id).some((entry) => entry.spellItemId === spellItem.id)) addedSpellbookEntryCount += 1;
    }

    for (const requirement of requirements.filter((entry) => entry.kind === 'savantInitial' || entry.kind === 'savantNewSlotLevel')) {
      const choice = spellbookFeatureChoiceForRequirement(choices, requirement);
      for (const spellItemId of choice?.spellItemIds ?? []) {
        const spellItem = items.find((item) => item.id === spellItemId && item.type === 'spell');
        if (!spellItem) continue;
        const hadEntry = getSpellbookEntriesForClass(next, classEntity.id).some((entry) => entry.spellItemId === spellItem.id);
        next = learnSpellbookSpell({
          character: next,
          spellItem: approvedItem(spellItem),
          profile,
          classEntityId: classEntity.id,
          acquisition: 'savant',
          source: 'feature',
          notes: `${requirement.featureName}: adicionada gratuitamente ao spellbook.`,
          grantedByFeatureItemId: requirement.featureItemId,
          spellbookFeatureChoiceId: requirement.id
        });
        if (!hadEntry && getSpellbookEntriesForClass(next, classEntity.id).some((entry) => entry.spellItemId === spellItem.id)) addedSpellbookEntryCount += 1;
      }
    }

    for (const requirement of requirements.filter((entry) => entry.kind === 'spellMastery' || entry.kind === 'signatureSpells')) {
      const choice = spellbookFeatureChoiceForRequirement(choices, requirement);
      for (const spellItemId of choice?.spellItemIds ?? []) {
        const entry = getSpellbookEntriesForClass(next, classEntity.id).find((candidate) => candidate.spellItemId === spellItemId);
        const spellItem = items.find((item) => item.id === spellItemId && item.type === 'spell');
        if (!entry || !spellItem) continue;
        const wasPrepared = entry.prepared;
        if (!entry.prepared && requirement.alwaysPrepared) {
          next = prepareSpellbookSpell({
            character: next,
            spellItem: approvedItem(spellItem),
            profile,
            classEntityId: classEntity.id,
            source: 'feature'
          });
        }
        specialBySpellKey.set(`${classEntity.id}:${spellItemId}`, { requirement, choiceId: requirement.id, wasPrepared });
      }
    }
  }

  const keptEntries = (next.spellbookEntries ?? []).filter((entry) => {
    if (entry.acquisition === 'savant') {
      const keep = Boolean(entry.spellbookFeatureChoiceId && activeRequirementIds.has(entry.spellbookFeatureChoiceId)
        && validChoices.some((choice) => choice.requirementId === entry.spellbookFeatureChoiceId && choice.spellItemIds.includes(entry.spellItemId)));
      if (!keep) removedSpellbookEntryCount += 1;
      return keep;
    }
    if (entry.acquisition === 'feature' && entry.grantedByFeatureItemId) {
      const keep = activeFeatureGrantKeys.has(`${entry.classEntityId}:${entry.grantedByFeatureItemId}:${entry.spellItemId}`);
      if (!keep) removedSpellbookEntryCount += 1;
      return keep;
    }
    return true;
  });
  const keptEntryKeys = new Set(keptEntries.map((entry) => `${entry.classEntityId}:${entry.spellItemId}`));

  let spells = next.spells.flatMap((spell): Spell[] => {
    if (!spell.spellcastingClassId) return [spell];
    const link = (next.compendiumLinks ?? []).find((candidate) => candidate.appliedAs === 'spell' && candidate.appliedEntityId === spell.id && candidate.status !== 'removed');
    const linkedSpellItem = link
      ? findCompendiumItemForCharacterLink(items, link)
      : undefined;
    const spellItemId = linkedSpellItem?.id;
    if (
      spellItemId
      && activeSpellbookClassEntityIds.has(spell.spellcastingClassId)
      && !keptEntryKeys.has(`${spell.spellcastingClassId}:${spellItemId}`)
      && spell.level > 0
    ) return [];
    const special = spellItemId ? specialBySpellKey.get(`${spell.spellcastingClassId}:${spellItemId}`) : undefined;
    if (!special) {
      if (!spell.spellbookSpecialChoiceId && !spell.signatureSpellFreeCastResourceId) return [spell];
      if (spell.spellbookSpecialPreparedOnly) return [];
      const {
        spellbookSpecialChoiceId: _choice,
        spellbookSpecialKind: _kind,
        spellbookSpecialPreparedOnly: _preparedOnly,
        signatureSpellFreeCastResourceId: _resource,
        ...rest
      } = spell;
      return [rest];
    }
    const requirement = special.requirement;
    const resourceId = requirement.kind === 'signatureSpells' && requirement.freeCastEach
      ? signatureResourceId(spell.spellcastingClassId, spellItemId!)
      : undefined;
    const sameSpecialChoice = spell.spellbookSpecialChoiceId === special.choiceId;
    const preparedOnly = sameSpecialChoice
      ? spell.spellbookSpecialPreparedOnly
      : requirement.alwaysPrepared === true && !special.wasPrepared;
    return [{
      ...spell,
      prepared: requirement.alwaysPrepared ? true : spell.prepared,
      spellbookSpecialChoiceId: special.choiceId,
      spellbookSpecialKind: requirement.kind === 'signatureSpells' ? 'signatureSpells' : 'spellMastery',
      spellbookSpecialPreparedOnly: preparedOnly,
      signatureSpellFreeCastResourceId: resourceId
    }];
  });

  const activeSignatureResourceIds = new Set(spells.flatMap((spell) => spell.signatureSpellFreeCastResourceId ? [spell.signatureSpellFreeCastResourceId] : []));
  const existingResourceById = new Map(next.resources.map((resource) => [resource.id, resource]));
  const resources = [
    ...next.resources.filter((resource) => !resource.id.startsWith('wizard-signature:') || activeSignatureResourceIds.has(resource.id)),
    ...Array.from(activeSignatureResourceIds)
      .filter((resourceId) => !existingResourceById.has(resourceId))
      .map((resourceId) => {
        const spell = spells.find((candidate) => candidate.signatureSpellFreeCastResourceId === resourceId);
        return {
          id: resourceId,
          name: `${spell?.name ?? 'Signature Spell'} · uso gratuito`,
          max: 1,
          current: 1,
          recharge: 'shortRest' as const,
          notes: 'Signature Spells: uma conjuração sem spell slot por magia; recarrega em Descanso Curto ou Longo. Conjurações normais com slot continuam disponíveis.'
        };
      })
  ];

  const activeSpellIds = new Set(spells.map((spell) => spell.id));
  const compendiumLinks = (next.compendiumLinks ?? []).map((link) =>
    link.appliedAs === 'spell' && link.status !== 'removed' && !activeSpellIds.has(link.appliedEntityId)
      ? { ...link, status: 'removed' as const }
      : link
  );

  next = {
    ...next,
    spellbookEntries: keptEntries.map((entry) => ({
      ...entry,
      prepared: spells.some((spell) => {
        if (spell.spellcastingClassId !== entry.classEntityId) return false;
        return compendiumLinks.some((link) =>
          link.appliedAs === 'spell' &&
          link.appliedEntityId === spell.id &&
          link.status !== 'removed' &&
          (
            findCompendiumItemForCharacterLink(items, link)?.id === entry.spellItemId ||
            characterLinkMatchesReference(items, link, entry.spellItemId)
          )
        );
      })
    })),
    spells,
    resources,
    compendiumLinks,
    buildChoices: {
      ...(next.buildChoices ?? {
        speciesChoices: [], classSkillChoices: [], classToolChoices: [], expertiseSkills: [], languages: [], spellAssignments: {}, spellbookAssignments: {}, equipmentSelections: []
      }),
      spellbookFeatureChoices: validChoices.filter((choice) => activeRequirementIds.has(choice.requirementId))
    }
  };

  const remainingSpellIds = new Set(next.spells.map((spell) => spell.id));
  const removedSpellCount = Array.from(originalSpellIds).filter((spellId) => !remainingSpellIds.has(spellId)).length;
  return { character: next, issues, addedSpellbookEntryCount, removedSpellbookEntryCount, removedSpellCount };
};
