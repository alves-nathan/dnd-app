import type {
  Character,
  CharacterSpellbookEntry,
  SpellChangeTransaction,
  SpellbookAcquisition
} from '../types';
import type { StoredCompendiumItem } from '../compendium/types';
import { applyCompendiumItemToCharacter } from '../compendium/mapper';
import {
  characterLinkMatchesReference,
  findCompendiumItemForCharacterLink
} from '../compendium/characterLinkIdentity';
import { createId } from '../utils/id';
import {
  annotateLatestSpellWithClass,
  getClassSpellcastingProfile,
  type ClassSpellcastingProfile,
  isSpellItemEligibleForProfile,
  spellItemLevel
} from './spellcastingRules';

export const WIZARD_STARTING_SPELLBOOK_SPELLS = 6;
export const WIZARD_SPELLBOOK_SPELLS_PER_LEVEL = 2;

export const isSpellbookProfile = (profile: ClassSpellcastingProfile | undefined): boolean =>
  profile?.preparationMode === 'spellbook';

export const getMinimumSpellbookSpellCount = (profile: ClassSpellcastingProfile): number =>
  isSpellbookProfile(profile)
    ? WIZARD_STARTING_SPELLBOOK_SPELLS + Math.max(0, profile.classLevel - 1) * WIZARD_SPELLBOOK_SPELLS_PER_LEVEL
    : 0;

export const getSpellbookSpellsGainedOnLevelUp = (
  before: ClassSpellcastingProfile | undefined,
  after: ClassSpellcastingProfile | undefined
): number => {
  if (!after || !isSpellbookProfile(after)) return 0;
  return Math.max(0, getMinimumSpellbookSpellCount(after) - (before ? getMinimumSpellbookSpellCount(before) : 0));
};

const now = (): string => new Date().toISOString();

const recordTransaction = (
  character: Character,
  input: Omit<SpellChangeTransaction, 'id' | 'characterId' | 'createdAt' | 'characterLevel'>
): Character => ({
  ...character,
  spellChangeTransactions: [
    ...(character.spellChangeTransactions ?? []),
    {
      id: createId('spellChange'),
      characterId: character.id,
      characterLevel: character.level,
      createdAt: now(),
      ...input
    }
  ]
});

const findActiveSpellEntity = (
  character: Character,
  spellItemId: string,
  classEntityId: string
) => {
  const link = (character.compendiumLinks ?? []).find((entry) => {
    if (entry.appliedAs !== 'spell' || entry.itemId !== spellItemId || entry.status === 'removed') return false;
    const spell = character.spells.find((candidate) => candidate.id === entry.appliedEntityId);
    return spell?.spellcastingClassId === classEntityId;
  });
  if (!link) return undefined;
  const spell = character.spells.find((candidate) => candidate.id === link.appliedEntityId);
  return spell ? { link, spell } : undefined;
};

export const getSpellbookEntriesForClass = (
  character: Character,
  classEntityId: string
): CharacterSpellbookEntry[] =>
  (character.spellbookEntries ?? [])
    .filter((entry) => entry.classEntityId === classEntityId)
    .sort((left, right) => left.spellLevel - right.spellLevel || left.spellName.localeCompare(right.spellName));

export interface LearnSpellbookSpellInput {
  character: Character;
  spellItem: StoredCompendiumItem;
  profile: ClassSpellcastingProfile;
  classEntityId: string;
  acquisition: SpellbookAcquisition;
  source: SpellChangeTransaction['source'];
  notes?: string;
  grantedByFeatureItemId?: string;
  spellbookFeatureChoiceId?: string;
}

export const learnSpellbookSpell = ({
  character,
  spellItem,
  profile,
  classEntityId,
  acquisition,
  source,
  notes,
  grantedByFeatureItemId,
  spellbookFeatureChoiceId
}: LearnSpellbookSpellInput): Character => {
  if (!isSpellbookProfile(profile) || spellItem.type !== 'spell' || spellItemLevel(spellItem) <= 0) return character;
  if (!isSpellItemEligibleForProfile(spellItem, profile)) return character;
  if ((character.spellbookEntries ?? []).some((entry) => entry.classEntityId === classEntityId && entry.spellItemId === spellItem.id)) return character;

  const entry: CharacterSpellbookEntry = {
    id: createId('spellbookEntry'),
    classEntityId,
    classItemId: profile.classItemId,
    spellItemId: spellItem.id,
    spellName: spellItem.name,
    spellLevel: spellItemLevel(spellItem),
    acquisition,
    learnedAtCharacterLevel: character.level,
    learnedAtClassLevel: profile.classLevel,
    prepared: false,
    createdAt: now(),
    notes,
    grantedByFeatureItemId,
    spellbookFeatureChoiceId
  };

  return recordTransaction(
    { ...character, spellbookEntries: [...(character.spellbookEntries ?? []), entry] },
    {
      classEntityId,
      className: profile.className,
      classLevel: profile.classLevel,
      kind: acquisition === 'copied' ? 'copied' : 'learned',
      spellItemId: spellItem.id,
      spellName: spellItem.name,
      source,
      notes
    }
  );
};

export interface PrepareSpellbookSpellInput {
  character: Character;
  spellItem: StoredCompendiumItem;
  profile: ClassSpellcastingProfile;
  classEntityId: string;
  source: SpellChangeTransaction['source'];
}

export const prepareSpellbookSpell = ({
  character,
  spellItem,
  profile,
  classEntityId,
  source
}: PrepareSpellbookSpellInput): Character => {
  if (!isSpellbookProfile(profile) || spellItem.type !== 'spell' || spellItemLevel(spellItem) <= 0) return character;
  const entry = (character.spellbookEntries ?? []).find((candidate) => candidate.classEntityId === classEntityId && candidate.spellItemId === spellItem.id);
  if (!entry || entry.prepared) return character;
  if (findActiveSpellEntity(character, spellItem.id, classEntityId)) {
    return {
      ...character,
      spellbookEntries: (character.spellbookEntries ?? []).map((candidate) => candidate.id === entry.id ? { ...candidate, prepared: true } : candidate)
    };
  }

  const result = applyCompendiumItemToCharacter(character, spellItem);
  if (!result.ok) return character;
  const annotated = annotateLatestSpellWithClass(character, result.character, classEntityId, profile.className, profile.ability);
  const next = {
    ...annotated,
    spellbookEntries: (annotated.spellbookEntries ?? []).map((candidate) => candidate.id === entry.id ? { ...candidate, prepared: true } : candidate)
  };
  return recordTransaction(next, {
    classEntityId,
    className: profile.className,
    classLevel: profile.classLevel,
    kind: 'prepared',
    spellItemId: spellItem.id,
    spellName: spellItem.name,
    source
  });
};

export interface UnprepareSpellbookSpellInput {
  character: Character;
  spellItemId: string;
  classEntityId: string;
  className: string;
  classLevel?: number;
  source: SpellChangeTransaction['source'];
}

export const unprepareSpellbookSpell = ({
  character,
  spellItemId,
  classEntityId,
  className,
  classLevel,
  source
}: UnprepareSpellbookSpellInput): Character => {
  const entry = (character.spellbookEntries ?? []).find((candidate) => candidate.classEntityId === classEntityId && candidate.spellItemId === spellItemId);
  if (!entry?.prepared) return character;
  const active = findActiveSpellEntity(character, spellItemId, classEntityId);
  const next: Character = {
    ...character,
    spells: active ? character.spells.filter((spell) => spell.id !== active.spell.id) : character.spells,
    compendiumLinks: active
      ? (character.compendiumLinks ?? []).map((link) => link.id === active.link.id ? { ...link, status: 'removed' as const } : link)
      : character.compendiumLinks,
    spellbookEntries: (character.spellbookEntries ?? []).map((candidate) => candidate.id === entry.id ? { ...candidate, prepared: false } : candidate)
  };
  return recordTransaction(next, {
    classEntityId,
    className,
    classLevel,
    kind: 'unprepared',
    spellItemId,
    spellName: entry.spellName,
    source
  });
};

export const removeSpellbookSpell = (
  character: Character,
  entryId: string,
  source: SpellChangeTransaction['source'] = 'manual'
): Character => {
  const entry = (character.spellbookEntries ?? []).find((candidate) => candidate.id === entryId);
  if (!entry) return character;
  let next = entry.prepared
    ? unprepareSpellbookSpell({
        character,
        spellItemId: entry.spellItemId,
        classEntityId: entry.classEntityId,
        className: character.classes.find((candidate) => candidate.id === entry.classEntityId)?.name ?? 'Wizard',
        classLevel: character.classes.find((candidate) => candidate.id === entry.classEntityId)?.level,
        source
      })
    : character;
  next = { ...next, spellbookEntries: (next.spellbookEntries ?? []).filter((candidate) => candidate.id !== entryId) };
  return recordTransaction(next, {
    classEntityId: entry.classEntityId,
    className: character.classes.find((candidate) => candidate.id === entry.classEntityId)?.name,
    classLevel: character.classes.find((candidate) => candidate.id === entry.classEntityId)?.level,
    kind: 'removed',
    spellItemId: entry.spellItemId,
    spellName: entry.spellName,
    source
  });
};

export const reconcileSpellbookEntries = (
  character: Character,
  validClassEntityIds: Set<string>,
  allItems: StoredCompendiumItem[]
): Character => {
  const validSpellItemIds = new Set(allItems.filter((item) => item.type === 'spell').map((item) => item.id));
  const spellbookClassIds = new Set(
    character.classes.flatMap((classEntity) => {
      if (!validClassEntityIds.has(classEntity.id)) return [];
      const link = (character.compendiumLinks ?? []).find(
        (entry) => entry.appliedAs === 'class' && entry.appliedEntityId === classEntity.id && entry.status === 'active'
      );
      const classItem = link ? findCompendiumItemForCharacterLink(allItems, link) : undefined;
      const profile = classItem ? getClassSpellcastingProfile(classItem, classEntity.level) : undefined;
      return profile?.preparationMode === 'spellbook' ? [classEntity.id] : [];
    })
  );
  const entries = (character.spellbookEntries ?? []).filter(
    (entry) => spellbookClassIds.has(entry.classEntityId) && validSpellItemIds.has(entry.spellItemId)
  );
  const entryKeys = new Set(entries.map((entry) => `${entry.classEntityId}:${entry.spellItemId}`));
  const spells = character.spells.filter((spell) => {
    if (!spell.spellcastingClassId || !validClassEntityIds.has(spell.spellcastingClassId)) return !spell.spellcastingClassId;
    if (!spellbookClassIds.has(spell.spellcastingClassId) || spell.level === 0) return true;
    const link = (character.compendiumLinks ?? []).find(
      (candidate) => candidate.appliedAs === 'spell' && candidate.appliedEntityId === spell.id && candidate.status !== 'removed'
    );
    const linkedItem = link ? findCompendiumItemForCharacterLink(allItems, link) : undefined;
    return Boolean(linkedItem && entryKeys.has(`${spell.spellcastingClassId}:${linkedItem.id}`));
  });
  const activeSpellIds = new Set(spells.map((spell) => spell.id));
  const compendiumLinks = (character.compendiumLinks ?? []).map((link) =>
    link.appliedAs === 'spell' && link.status !== 'removed' && !activeSpellIds.has(link.appliedEntityId)
      ? { ...link, status: 'removed' as const }
      : link
  );
  return {
    ...character,
    spellbookEntries: entries.map((entry) => ({
      ...entry,
      prepared: spells.some((spell) =>
        spell.spellcastingClassId === entry.classEntityId
        && compendiumLinks.some((link) =>
          link.appliedAs === 'spell' &&
          link.appliedEntityId === spell.id &&
          link.status !== 'removed' &&
          (
            findCompendiumItemForCharacterLink(allItems, link)?.id === entry.spellItemId ||
            characterLinkMatchesReference(allItems, link, entry.spellItemId)
          )
        )
      )
    })),
    spells,
    compendiumLinks
  };
};
