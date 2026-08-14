import type { CharacterHigherLevelStartingBenefits } from '../types';

export type StartingMagicItemRarity = 'common' | 'uncommon' | 'rare' | 'veryRare';


export interface HigherLevelStartingGuidance {
  startingLevel: number;
  usesNormalStartingEquipment: true;
  eligibleForExtraBenefits: boolean;
  baseGold: number;
  goldMultiplier: number;
  magicItemAllowance: Partial<Record<StartingMagicItemRarity, number>>;
}

const clampLevel = (level: number): number => Math.max(1, Math.min(20, Math.floor(level || 1)));

export const getHigherLevelStartingGuidance = (level: number): HigherLevelStartingGuidance => {
  const startingLevel = clampLevel(level);
  if (startingLevel <= 4) {
    return {
      startingLevel,
      usesNormalStartingEquipment: true,
      eligibleForExtraBenefits: false,
      baseGold: 0,
      goldMultiplier: 0,
      magicItemAllowance: {}
    };
  }
  if (startingLevel <= 10) {
    return {
      startingLevel,
      usesNormalStartingEquipment: true,
      eligibleForExtraBenefits: true,
      baseGold: 500,
      goldMultiplier: 25,
      magicItemAllowance: { common: 1 }
    };
  }
  if (startingLevel <= 16) {
    return {
      startingLevel,
      usesNormalStartingEquipment: true,
      eligibleForExtraBenefits: true,
      baseGold: 5000,
      goldMultiplier: 250,
      magicItemAllowance: { common: 2, uncommon: 3, rare: 1 }
    };
  }
  return {
    startingLevel,
    usesNormalStartingEquipment: true,
    eligibleForExtraBenefits: true,
    baseGold: 20000,
    goldMultiplier: 250,
    magicItemAllowance: { common: 2, uncommon: 4, rare: 3, veryRare: 1 }
  };
};

export const generateHigherLevelStartingBenefits = (
  level: number,
  random: () => number = Math.random,
  now = new Date().toISOString()
): CharacterHigherLevelStartingBenefits | undefined => {
  const guidance = getHigherLevelStartingGuidance(level);
  if (!guidance.eligibleForExtraBenefits) return undefined;
  const rolledD10 = Math.max(1, Math.min(10, Math.floor(random() * 10) + 1));
  return {
    startingLevel: guidance.startingLevel,
    rolledD10,
    baseGold: guidance.baseGold,
    goldMultiplier: guidance.goldMultiplier,
    bonusGold: guidance.baseGold + rolledD10 * guidance.goldMultiplier,
    magicItemAllowance: { ...guidance.magicItemAllowance },
    generatedAt: now
  };
};

const rarityLabels: Record<StartingMagicItemRarity, string> = {
  common: 'comum',
  uncommon: 'incomum',
  rare: 'raro',
  veryRare: 'muito raro'
};

export const describeMagicItemAllowance = (
  allowance: Partial<Record<StartingMagicItemRarity, number>>
): string => {
  const entries = (Object.keys(rarityLabels) as StartingMagicItemRarity[])
    .map((rarity) => ({ rarity, count: allowance[rarity] ?? 0 }))
    .filter((entry) => entry.count > 0);
  return entries.length
    ? entries.map(({ rarity, count }) => `${count} ${rarityLabels[rarity]}${count > 1 ? 's' : ''}`).join(', ')
    : 'nenhum item mágico adicional';
};
