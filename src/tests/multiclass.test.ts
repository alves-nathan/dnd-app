import { createDefaultCharacter } from '../data/mockData';
import { getProficiencyBonus, getTotalLevel } from '../rules-engine/characters/derivedStats';
import { validateCharacterRules } from '../rules-engine/validators/ruleValidation';

describe('multiclass validation', () => {
  it('derives total level from class levels', () => {
    const character = createDefaultCharacter();
    const multiclass = {
      ...character,
      level: 5,
      classes: [
        { id: 'fighter-like', name: 'Martial manual', level: 3 },
        { id: 'caster-like', name: 'Caster manual', level: 2 }
      ]
    };
    expect(getTotalLevel(multiclass)).toBe(5);
    expect(getProficiencyBonus(multiclass)).toBe(3);
    expect(validateCharacterRules(multiclass).ok).toBe(true);
  });
});
