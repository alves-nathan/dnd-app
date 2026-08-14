import type { Character } from '../types';
type CharacterIdentityInput = Pick<Character, 'name' | 'classes'> & Partial<Pick<Character, 'id'>>;
export const getCharacterDisplayName = (character: CharacterIdentityInput): string => {
  const explicitName = character.name.trim();
  if (explicitName) return explicitName;
  const primaryClass = character.classes[0]?.name?.trim();
  if (primaryClass) return `${primaryClass} sem nome`;
  const suffix = (character.id ?? '').replace(/[^a-z0-9]/gi, '').slice(-4).toUpperCase() || 'X';
  return `Personagem ${suffix}`;
};
