import type { CharacterProficiencies } from '../types';

export const SKILLS = [
  'Acrobatics',
  'Animal Handling',
  'Arcana',
  'Athletics',
  'Deception',
  'History',
  'Insight',
  'Intimidation',
  'Investigation',
  'Medicine',
  'Nature',
  'Perception',
  'Performance',
  'Persuasion',
  'Religion',
  'Sleight of Hand',
  'Stealth',
  'Survival'
] as const;

export const emptyCharacterProficiencies = (): CharacterProficiencies => ({
  skills: [],
  expertiseSkills: [],
  tools: [],
  weapons: [],
  armor: [],
  languages: [],
  savingThrows: []
});

const unique = <T>(values: T[]): T[] => Array.from(new Set(values));

export const mergeProficiencies = (
  left: CharacterProficiencies,
  right: CharacterProficiencies
): CharacterProficiencies => ({
  skills: unique([...left.skills, ...right.skills]),
  expertiseSkills: unique([
    ...(left.expertiseSkills ?? []),
    ...(right.expertiseSkills ?? [])
  ]).filter((skill) => unique([...left.skills, ...right.skills]).includes(skill)),
  tools: unique([...left.tools, ...right.tools]),
  weapons: unique([...left.weapons, ...right.weapons]),
  armor: unique([...left.armor, ...right.armor]),
  languages: unique([...left.languages, ...right.languages]),
  savingThrows: unique([...left.savingThrows, ...right.savingThrows])
});
