import type {
  Armor,
  Background,
  Character,
  CharacterClass,
  CharacterCompendiumLink,
  Equipment,
  Feat,
  Feature,
  MagicItem,
  ResourcePool,
  SpellSlotPool,
  Species,
  Spell,
  Subclass,
  TurnRotation,
  Weapon
} from '../types';
import { createId } from '../utils/id';

export interface BuildPresetSnapshot {
  level: number;
  classes: CharacterClass[];
  subclasses: Subclass[];
  species?: Species;
  background?: Background;
  armor?: Armor;
  weapons: Weapon[];
  equipment: Equipment[];
  magicItems: MagicItem[];
  feats: Feat[];
  spells: Spell[];
  features: Feature[];
  resources: ResourcePool[];
  spellSlots?: SpellSlotPool[];
  rotations: TurnRotation[];
  compendiumLinks: CharacterCompendiumLink[];
}

export interface BuildPreset {
  id: string;
  name: string;
  description?: string;
  tags: string[];
  createdAt: string;
  updatedAt: string;
  sourceCharacterName?: string;
  snapshot: BuildPresetSnapshot;
}

export interface ApplyBuildPresetOptions {
  mode: 'replaceBuild' | 'merge';
  includeRotations?: boolean;
  includeEquipment?: boolean;
  includeResources?: boolean;
}

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

const cloneEntities = <T extends { id: string }>(items: T[]): T[] => items.map((item) => clone(item));

const rehydrateRotations = (rotations: TurnRotation[], characterId: string): TurnRotation[] =>
  rotations.map((rotation) => ({
    ...clone(rotation),
    id: createId('rot'),
    characterId,
    actions: rotation.actions.map((action) => ({ ...clone(action), id: createId('turnAction') }))
  }));

export const createBuildPresetFromCharacter = (character: Character, name?: string, description?: string, tags: string[] = []): BuildPreset => {
  const now = new Date().toISOString();
  return {
    id: createId('preset'),
    name: name?.trim() || `${character.name} build`,
    description: description?.trim() || undefined,
    tags,
    createdAt: now,
    updatedAt: now,
    sourceCharacterName: character.name,
    snapshot: {
      level: character.level,
      classes: clone(character.classes),
      subclasses: clone(character.subclasses),
      species: character.species ? clone(character.species) : undefined,
      background: character.background ? clone(character.background) : undefined,
      armor: character.armor ? clone(character.armor) : undefined,
      weapons: clone(character.weapons),
      equipment: clone(character.equipment),
      magicItems: clone(character.magicItems),
      feats: clone(character.feats),
      spells: clone(character.spells),
      features: clone(character.features),
      resources: clone(character.resources),
      spellSlots: clone(character.spellSlots ?? []),
      rotations: clone(character.rotations),
      compendiumLinks: clone(character.compendiumLinks ?? [])
    }
  };
};

const mergeUniqueByName = <T extends { id: string; name: string }>(current: T[], incoming: T[], _prefix: string): T[] => {
  const currentNames = new Set(current.map((item) => item.name.toLowerCase()));
  const freshIncoming = cloneEntities(incoming.filter((item) => !currentNames.has(item.name.toLowerCase())));
  return [...current, ...freshIncoming];
};

const mergeLinks = (current: CharacterCompendiumLink[] | undefined, incoming: CharacterCompendiumLink[] | undefined, characterId: string): CharacterCompendiumLink[] => {
  const existingItemIds = new Set((current ?? []).map((link) => link.itemId));
  const links = (incoming ?? [])
    .filter((link) => !existingItemIds.has(link.itemId))
    .map((link) => ({ ...clone(link), id: createId('cmpLink'), characterId, addedAt: new Date().toISOString() }));
  return [...(current ?? []), ...links];
};

export const applyBuildPresetToCharacter = (character: Character, preset: BuildPreset, options: ApplyBuildPresetOptions): Character => {
  const snapshot = preset.snapshot;

  if (options.mode === 'replaceBuild') {
    return {
      ...character,
      level: snapshot.level,
      classes: cloneEntities(snapshot.classes),
      subclasses: cloneEntities(snapshot.subclasses),
      species: snapshot.species ? clone(snapshot.species) : undefined,
      background: snapshot.background ? clone(snapshot.background) : undefined,
      armor: snapshot.armor ? clone(snapshot.armor) : undefined,
      weapons: options.includeEquipment === false ? character.weapons : cloneEntities(snapshot.weapons),
      equipment: options.includeEquipment === false ? character.equipment : cloneEntities(snapshot.equipment),
      magicItems: options.includeEquipment === false ? character.magicItems : cloneEntities(snapshot.magicItems),
      feats: cloneEntities(snapshot.feats),
      spells: cloneEntities(snapshot.spells),
      features: cloneEntities(snapshot.features),
      resources: options.includeResources === false ? character.resources : cloneEntities(snapshot.resources),
      spellSlots: options.includeResources === false ? character.spellSlots : clone(snapshot.spellSlots ?? []),
      rotations: options.includeRotations === false ? character.rotations : rehydrateRotations(snapshot.rotations, character.id),
      compendiumLinks: mergeLinks([], snapshot.compendiumLinks, character.id)
    };
  }

  return {
    ...character,
    classes: mergeUniqueByName(character.classes, snapshot.classes, 'class'),
    subclasses: mergeUniqueByName(character.subclasses, snapshot.subclasses, 'subclass'),
    species: character.species ?? (snapshot.species ? clone(snapshot.species) : undefined),
    background: character.background ?? (snapshot.background ? clone(snapshot.background) : undefined),
    armor: character.armor ?? (snapshot.armor ? clone(snapshot.armor) : undefined),
    weapons: options.includeEquipment === false ? character.weapons : mergeUniqueByName(character.weapons, snapshot.weapons, 'weapon'),
    equipment: options.includeEquipment === false ? character.equipment : mergeUniqueByName(character.equipment, snapshot.equipment, 'equipment'),
    magicItems: options.includeEquipment === false ? character.magicItems : mergeUniqueByName(character.magicItems, snapshot.magicItems, 'magicItem'),
    feats: mergeUniqueByName(character.feats, snapshot.feats, 'feat'),
    spells: mergeUniqueByName(character.spells, snapshot.spells, 'spell'),
    features: mergeUniqueByName(character.features, snapshot.features, 'feature'),
    resources: options.includeResources === false ? character.resources : mergeUniqueByName(character.resources, snapshot.resources, 'resource'),
    spellSlots: options.includeResources === false ? character.spellSlots : clone(snapshot.spellSlots ?? character.spellSlots ?? []),
    rotations: options.includeRotations === false ? character.rotations : [...character.rotations, ...rehydrateRotations(snapshot.rotations, character.id)],
    compendiumLinks: mergeLinks(character.compendiumLinks, snapshot.compendiumLinks, character.id)
  };
};

export const summarizeBuildPreset = (preset: BuildPreset): string => {
  const snapshot = preset.snapshot;
  const classText = snapshot.classes.map((entry) => `${entry.name} ${entry.level}`).join(' / ') || 'sem classe';
  return `${classText} · ${snapshot.weapons.length} arma(s) · ${snapshot.spells.length} magia(s) · ${snapshot.features.length} feature(s)`;
};
