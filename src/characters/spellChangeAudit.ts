import type { Character, SpellChangeTransaction } from '../types';
import { createId } from '../utils/id';

export type SpellChangeInput = Omit<SpellChangeTransaction, 'id' | 'characterId' | 'characterLevel' | 'createdAt'>;

export const appendSpellChangeTransaction = (
  character: Character,
  input: SpellChangeInput
): Character => ({
  ...character,
  spellChangeTransactions: [
    ...(character.spellChangeTransactions ?? []),
    {
      id: createId('spellChange'),
      characterId: character.id,
      characterLevel: character.level,
      createdAt: new Date().toISOString(),
      ...input
    }
  ]
});
