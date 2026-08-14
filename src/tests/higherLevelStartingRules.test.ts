import {
  describeMagicItemAllowance,
  generateHigherLevelStartingBenefits,
  getHigherLevelStartingGuidance
} from '../characters/higherLevelStartingRules';

describe('higher-level starting equipment guidance', () => {
  it('keeps levels 1-4 on normal starting equipment only', () => {
    expect(getHigherLevelStartingGuidance(4)).toMatchObject({ eligibleForExtraBenefits: false, baseGold: 0 });
    expect(generateHigherLevelStartingBenefits(4, () => 0)).toBeUndefined();
  });

  it('generates the level 5-10 gold formula deterministically', () => {
    const result = generateHigherLevelStartingBenefits(10, () => 0.49, '2026-07-14T00:00:00.000Z');
    expect(result).toMatchObject({ rolledD10: 5, baseGold: 500, goldMultiplier: 25, bonusGold: 625 });
    expect(result?.magicItemAllowance).toEqual({ common: 1 });
  });

  it('returns the higher-tier magic item allowance', () => {
    const guidance = getHigherLevelStartingGuidance(17);
    expect(guidance.magicItemAllowance).toEqual({ common: 2, uncommon: 4, rare: 3, veryRare: 1 });
    expect(describeMagicItemAllowance(guidance.magicItemAllowance)).toContain('1 muito raro');
  });
});
