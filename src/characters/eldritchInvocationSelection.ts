import type { Character } from '../types';
import type { StoredCompendiumItem } from '../compendium/types';
import { applyCompendiumItemToCharacter } from '../compendium/mapper';
import { findEldritchInvocationById, isEldritchInvocationItem } from './eldritchInvocationRules';
import { reconcileWarlockSpecializedInvocations } from './warlockSpecializedInvocations';

const activeInvocationLinks = (
  character: Character,
  selectedIds: Set<string>
) => (character.compendiumLinks ?? []).filter(
  (link) => link.status === 'active' && link.appliedAs === 'feature' && selectedIds.has(link.itemId)
);

export interface ApplyEldritchInvocationSelectionResult {
  character: Character;
  appliedCount: number;
  removedCount: number;
  missingItemIds: string[];
}

export const applyEldritchInvocationSelection = (
  character: Character,
  selectedCounts: Record<string, number>,
  items: StoredCompendiumItem[]
): ApplyEldritchInvocationSelectionResult => {
  const previousCounts = character.buildChoices?.eldritchInvocationCounts ?? {};
  const normalizedCounts = Object.fromEntries(
    Object.entries(selectedCounts)
      .map(([itemId, count]) => [itemId, Math.max(0, Math.floor(count))])
      .filter(([, count]) => Number(count) > 0)
  ) as Record<string, number>;
  const selectedIds = new Set(Object.keys(normalizedCounts));
  const oldIds = new Set(Object.keys(previousCounts));
  const linksToRemove = activeInvocationLinks(character, oldIds);
  const removedEntityIds = new Set(linksToRemove.map((link) => link.appliedEntityId));
  const removedInvocationSpellIds = new Set(
    character.spells
      .filter((spell) => Boolean(spell.grantedByInvocationItemId && !selectedIds.has(spell.grantedByInvocationItemId)))
      .map((spell) => spell.id)
  );

  let next: Character = {
    ...character,
    features: character.features.filter((feature) => !removedEntityIds.has(feature.id)),
    spells: character.spells.filter((spell) => !removedInvocationSpellIds.has(spell.id)),
    compendiumLinks: (character.compendiumLinks ?? []).map((link) =>
      (removedEntityIds.has(link.appliedEntityId) || removedInvocationSpellIds.has(link.appliedEntityId)) && link.status === 'active'
        ? { ...link, status: 'removed' as const }
        : link
    ),
    buildChoices: {
      ...(character.buildChoices ?? {
        speciesChoices: [],
        classSkillChoices: [],
        classToolChoices: [],
        expertiseSkills: [],
        languages: [],
        spellAssignments: {},
        spellbookAssignments: {},
        equipmentSelections: [],
        eldritchInvocationChoices: []
      }),
      eldritchInvocationCounts: normalizedCounts,
      eldritchInvocationChoices: (character.buildChoices?.eldritchInvocationChoices ?? []).filter(
        (choice) => (normalizedCounts[choice.invocationItemId] ?? 0) > choice.instanceIndex
      )
    }
  };

  let appliedCount = 0;
  const missingItemIds: string[] = [];
  for (const [itemId, rawCount] of Object.entries(selectedCounts)) {
    const count = Math.max(0, Math.floor(rawCount));
    if (!count) continue;
    const item = findEldritchInvocationById(items, itemId);
    if (!item || !isEldritchInvocationItem(item)) {
      missingItemIds.push(itemId);
      continue;
    }
    const explicitlyApproved: StoredCompendiumItem = item.status === 'validated'
      ? item
      : {
          ...item,
          status: 'validated',
          reviewDecision: 'approved',
          reviewedBy: 'Escolha explícita de Eldritch Invocation',
          reviewedAt: new Date().toISOString()
        };
    for (let index = 0; index < count; index += 1) {
      const result = applyCompendiumItemToCharacter(next, explicitlyApproved);
      if (result.ok) {
        next = result.character;
        appliedCount += 1;
      }
    }
  }

  next = reconcileWarlockSpecializedInvocations(next, items);

  return {
    character: next,
    appliedCount,
    removedCount: removedEntityIds.size,
    missingItemIds
  };
};
