import type {
  Character,
  CharacterBuildChoices,
  CharacterProficiencies
} from '../types';
import { normalizeCharacterChoiceReference } from '../catalog/characterChoiceBridge';

export const CHARACTER_STORE_VERSION = 24;

export interface PersistedCharacterStoreState {
  characters?: Character[];
  progressionDrafts?: Record<string, unknown>;
  progressionRecovery?: unknown;
  compatibilityRemediationPlans?: Record<string, unknown>;
  compatibilityRemediationRecovery?: unknown;
  compatibilityRemediationQuarantine?: Record<string, unknown>;
  [key: string]: unknown;
}

const asCharacterArray = (value: unknown): Character[] =>
  Array.isArray(value) ? value as Character[] : [];

const emptyProficiencies = (): CharacterProficiencies => ({
  skills: [],
  expertiseSkills: [],
  tools: [],
  weapons: [],
  armor: [],
  languages: [],
  savingThrows: []
});

const normalizeProficiencies = (
  proficiencies?: Partial<CharacterProficiencies>
): CharacterProficiencies => ({
  skills: proficiencies?.skills ?? [],
  expertiseSkills: proficiencies?.expertiseSkills ?? [],
  tools: proficiencies?.tools ?? [],
  weapons: proficiencies?.weapons ?? [],
  armor: proficiencies?.armor ?? [],
  languages: proficiencies?.languages ?? [],
  savingThrows: proficiencies?.savingThrows ?? []
});


const normalizeChoiceCountRecord = (
  value: Record<string, number> | undefined
): Record<string, number> => Object.fromEntries(
  Object.entries(value ?? {}).map(([key, count]) => [normalizeCharacterChoiceReference(key), count])
);

const normalizeChoiceAssignmentRecord = (
  value: Record<string, string> | undefined
): Record<string, string> => Object.fromEntries(
  Object.entries(value ?? {}).map(([key, target]) => [
    normalizeCharacterChoiceReference(key),
    normalizeCharacterChoiceReference(target)
  ])
);

const normalizeOptionalChoiceReference = (value: string | undefined): string | undefined =>
  value ? normalizeCharacterChoiceReference(value) : undefined;

const emptyBuildChoices = (): CharacterBuildChoices => ({
  speciesChoices: [],
  subclassChoices: [],
  classSkillChoices: [],
  classToolChoices: [],
  expertiseSkills: [],
  languages: [],
  spellAssignments: {},
  spellbookAssignments: {},
  equipmentSelections: [],
  eldritchInvocationCounts: {},
  eldritchInvocationChoices: []
});

const normalizeBuildChoices = (
  buildChoices?: Partial<CharacterBuildChoices>
): CharacterBuildChoices => {
  const fallback = emptyBuildChoices();
  return {
    ...fallback,
    ...buildChoices,
    classSkillChoices: buildChoices?.classSkillChoices ?? [],
    classToolChoices: buildChoices?.classToolChoices ?? [],
    backgroundToolChoices: buildChoices?.backgroundToolChoices ?? [],
    expertiseSkills: buildChoices?.expertiseSkills ?? [],
    languages: buildChoices?.languages ?? [],
    classLanguageChoices: buildChoices?.classLanguageChoices ?? [],
    startingClassItemId: buildChoices?.startingClassItemId
      ? normalizeCharacterChoiceReference(buildChoices.startingClassItemId)
      : undefined,
    speciesChoices: (buildChoices?.speciesChoices ?? []).map((choice) => ({
      ...choice,
      speciesItemId: normalizeCharacterChoiceReference(choice.speciesItemId),
      featureItemId: normalizeCharacterChoiceReference(choice.featureItemId)
    })),
    subclassChoices: (buildChoices?.subclassChoices ?? []).map((choice) => ({
      ...choice,
      subclassItemId: normalizeCharacterChoiceReference(choice.subclassItemId)
    })),
    spellAssignments: normalizeChoiceAssignmentRecord(buildChoices?.spellAssignments),
    spellbookAssignments: normalizeChoiceAssignmentRecord(buildChoices?.spellbookAssignments),
    equipmentSelections: (buildChoices?.equipmentSelections ?? []).map((selection) => ({
      ...selection,
      sourceItemId: normalizeCharacterChoiceReference(selection.sourceItemId),
      items: selection.items?.map((item) => ({
        ...item,
        compendiumItemId: item.compendiumItemId
          ? normalizeCharacterChoiceReference(item.compendiumItemId)
          : undefined
      }))
    })),
    activeLoadout: buildChoices?.activeLoadout ? { ...buildChoices.activeLoadout, explicit: buildChoices.activeLoadout.explicit ?? true, heldFocusEquipmentId: buildChoices.activeLoadout.heldFocusEquipmentId, armorAccessoryIds: buildChoices.activeLoadout.armorAccessoryIds ?? [] } : undefined,
    eldritchInvocationCounts: normalizeChoiceCountRecord(buildChoices?.eldritchInvocationCounts),
    eldritchInvocationChoices: (buildChoices?.eldritchInvocationChoices ?? []).map((choice) => ({
      ...choice,
      invocationItemId: normalizeCharacterChoiceReference(choice.invocationItemId),
      cantripItemIds: (choice.cantripItemIds ?? []).map(normalizeCharacterChoiceReference),
      ritualSpellItemIds: (choice.ritualSpellItemIds ?? []).map(normalizeCharacterChoiceReference),
      targetCantripItemId: choice.targetCantripItemId ? normalizeCharacterChoiceReference(choice.targetCantripItemId) : undefined,
      originFeatItemId: choice.originFeatItemId ? normalizeCharacterChoiceReference(choice.originFeatItemId) : undefined,
      familiarCreatureItemId: choice.familiarCreatureItemId ? normalizeCharacterChoiceReference(choice.familiarCreatureItemId) : undefined
    })),
    pactWeapon: buildChoices?.pactWeapon ? {
      ...buildChoices.pactWeapon,
      sourceWeaponItemId: normalizeOptionalChoiceReference(buildChoices.pactWeapon.sourceWeaponItemId)
    } : undefined,
    gazeOfTwoMinds: buildChoices?.gazeOfTwoMinds ? {
      ...buildChoices.gazeOfTwoMinds,
      invocationItemId: normalizeCharacterChoiceReference(buildChoices.gazeOfTwoMinds.invocationItemId)
    } : undefined,
    giftOfProtectors: buildChoices?.giftOfProtectors ? {
      ...buildChoices.giftOfProtectors,
      invocationItemId: normalizeCharacterChoiceReference(buildChoices.giftOfProtectors.invocationItemId)
    } : undefined,
    oneWithShadows: buildChoices?.oneWithShadows ? {
      ...buildChoices.oneWithShadows,
      invocationItemId: normalizeCharacterChoiceReference(buildChoices.oneWithShadows.invocationItemId)
    } : undefined,
    manualProficiencies: buildChoices?.manualProficiencies
      ? normalizeProficiencies(buildChoices.manualProficiencies)
      : undefined
  };
};

export const ensureCharacterCollections = (character: Character): Character => ({
  ...character,
  name: character.name ?? '',
  abilityScoreBonuses: character.abilityScoreBonuses ?? {},
  classes: character.classes ?? [],
  subclasses: character.subclasses ?? [],
  feats: (character.feats ?? []).map((feat) => ({
    ...feat,
    grantedByInvocationItemId: normalizeOptionalChoiceReference(feat.grantedByInvocationItemId)
  })),
  featChoices: (character.featChoices ?? []).map((choice) => ({
    ...choice,
    featItemId: normalizeCharacterChoiceReference(choice.featItemId),
    spellItemIds: (choice.spellItemIds ?? []).map(normalizeCharacterChoiceReference),
    weaponItemIds: (choice.weaponItemIds ?? []).map(normalizeCharacterChoiceReference),
    fightingStyleItemId: normalizeOptionalChoiceReference(choice.fightingStyleItemId),
    weaponMasterySelections: (choice.weaponMasterySelections ?? []).map((selection) => ({
      ...selection,
      sourceItemId: normalizeOptionalChoiceReference(selection.sourceItemId),
      weaponItemId: normalizeOptionalChoiceReference(selection.weaponItemId)
    }))
  })),
  features: character.features ?? [],
  weapons: (character.weapons ?? []).map((weapon) => ({
    ...weapon,
    quantity: weapon.quantity ?? 1,
    pactWeaponSourceItemId: normalizeOptionalChoiceReference(weapon.pactWeaponSourceItemId)
  })),
  armors: character.armors ?? (character.armor ? [character.armor] : []),
  armorAccessories: character.armorAccessories ?? [],
  companions: (character.companions ?? []).map((companion) => ({
    ...companion,
    sourceCreatureItemId: normalizeCharacterChoiceReference(companion.sourceCreatureItemId),
    grantedByInvocationItemId: normalizeCharacterChoiceReference(companion.grantedByInvocationItemId),
    resources: companion.resources ?? [],
    activeEffects: companion.activeEffects ?? [],
    transactions: companion.transactions ?? []
  })),
  senses: (character.senses ?? []).map((sense) => ({
    ...sense,
    sourceInvocationItemId: normalizeOptionalChoiceReference(sense.sourceInvocationItemId)
  })),
  hitPoints: character.hitPoints ?? { current: 0, max: 0, temporary: 0 },
  hitDice: character.hitDice ?? [],
  equipment: character.equipment ?? [],
  magicItems: character.magicItems ?? [],
  spells: (character.spells ?? []).map((spell) => ({
    ...spell,
    grantedByInvocationItemId: normalizeOptionalChoiceReference(spell.grantedByInvocationItemId)
  })),
  compendiumLinks: (character.compendiumLinks ?? []).map((link) => {
    const itemId = normalizeCharacterChoiceReference(link.choiceId ?? link.itemId);
    const catalogEntityId = itemId.startsWith('catalog:') ? itemId.slice('catalog:'.length) : link.catalogEntityId;
    return {
      ...link,
      itemId,
      choiceId: itemId,
      origin: itemId.startsWith('catalog:') ? 'catalog' as const : (link.origin ?? 'compendium' as const),
      catalogEntityId
    };
  }),
  buildChoices: normalizeBuildChoices(character.buildChoices),
  pendingChoices: (character.pendingChoices ?? []).map((choice) => ({
    ...choice,
    sourceItemId: choice.sourceItemId ? normalizeCharacterChoiceReference(choice.sourceItemId) : undefined
  })),
  spellbookEntries: (character.spellbookEntries ?? []).map((entry) => ({
    ...entry,
    classItemId: normalizeOptionalChoiceReference(entry.classItemId),
    spellItemId: normalizeCharacterChoiceReference(entry.spellItemId)
  })),
  weaponMasteries: (character.weaponMasteries ?? []).map((mastery) => ({
    ...mastery,
    sourceItemId: normalizeOptionalChoiceReference(mastery.sourceItemId),
    weaponItemId: normalizeOptionalChoiceReference(mastery.weaponItemId)
  })),
  spellChangeTransactions: (character.spellChangeTransactions ?? []).map((transaction) => ({
    ...transaction,
    spellItemId: normalizeOptionalChoiceReference(transaction.spellItemId),
    replacedSpellItemId: normalizeOptionalChoiceReference(transaction.replacedSpellItemId)
  })),
  currency: character.currency ?? { cp: 0, sp: 0, ep: 0, gp: 0, pp: 0 },
  proficiencies: character.proficiencies
    ? normalizeProficiencies(character.proficiencies)
    : emptyProficiencies(),
  resources: (character.resources ?? []).map((resource) => ({
    ...resource,
    sourceInvocationItemId: normalizeOptionalChoiceReference(resource.sourceInvocationItemId)
  })),
  spellSlots: character.spellSlots ?? [],
  activeEffects: character.activeEffects ?? [],
  rotations: character.rotations ?? [],
  resourceTransactions: character.resourceTransactions ?? [],
  spellSlotTransactions: character.spellSlotTransactions ?? [],
  activeEffectTransactions: character.activeEffectTransactions ?? [],
  hitDieTransactions: character.hitDieTransactions ?? [],
  healingTransactions: (character.healingTransactions ?? []).map((transaction) => ({
    ...transaction,
    sourceItemId: normalizeOptionalChoiceReference(transaction.sourceItemId)
  })),
  protectionTransactions: character.protectionTransactions ?? [],
  progressionTransactions: character.progressionTransactions ?? []
});

const normalizeStateCharacters = (
  state: PersistedCharacterStoreState
): PersistedCharacterStoreState => ({
  ...state,
  characters: asCharacterArray(state.characters).map(ensureCharacterCollections),
  progressionDrafts: state.progressionDrafts ?? {},
  progressionRecovery: state.progressionRecovery ?? { hydrated: false, recoverableCharacterIds: [], conflictedCharacterIds: [], issues: [] },
  compatibilityRemediationPlans: state.compatibilityRemediationPlans ?? {},
  compatibilityRemediationRecovery: state.compatibilityRemediationRecovery ?? { hydrated: false, pendingAcknowledgementCharacterIds: [], conflictedCharacterIds: [], staleCatalogCharacterIds: [], quarantinedPlanIds: [], issues: [] },
  compatibilityRemediationQuarantine: state.compatibilityRemediationQuarantine ?? {}
});

/**
 * Each persisted version gets an explicit migration boundary. Migrations stay
 * idempotent because beta updates and manual restores can contain mixed shapes.
 */
const migrationSteps: Record<number, (state: PersistedCharacterStoreState) => PersistedCharacterStoreState> = {
  0: normalizeStateCharacters,
  1: normalizeStateCharacters,
  2: normalizeStateCharacters,
  3: normalizeStateCharacters,
  4: normalizeStateCharacters,
  5: normalizeStateCharacters,
  6: normalizeStateCharacters,
  7: normalizeStateCharacters,
  8: normalizeStateCharacters,
  9: normalizeStateCharacters,
  10: normalizeStateCharacters,
  11: normalizeStateCharacters,
  12: normalizeStateCharacters,
  13: normalizeStateCharacters,
  14: normalizeStateCharacters,
  15: normalizeStateCharacters,
  16: normalizeStateCharacters,
  17: normalizeStateCharacters,
  18: normalizeStateCharacters,
  19: normalizeStateCharacters,
  20: normalizeStateCharacters,
  21: normalizeStateCharacters,
  22: normalizeStateCharacters,
  23: normalizeStateCharacters
};

export const migrateCharacterStoreState = (
  persisted: unknown,
  fromVersion = 0
): PersistedCharacterStoreState => {
  let state: PersistedCharacterStoreState =
    persisted && typeof persisted === 'object'
      ? persisted as PersistedCharacterStoreState
      : { characters: [] };

  const normalizedVersion = Number.isFinite(fromVersion)
    ? Math.max(0, Math.floor(fromVersion))
    : 0;

  for (let version = normalizedVersion; version < CHARACTER_STORE_VERSION; version += 1) {
    state = (migrationSteps[version] ?? normalizeStateCharacters)(state);
  }

  return normalizeStateCharacters(state);
};
