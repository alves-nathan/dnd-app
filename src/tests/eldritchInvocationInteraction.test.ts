import fs from 'node:fs';
import path from 'node:path';
import type { StoredCompendiumItem } from '../compendium/types';
import { getCompendiumReviewTargetId } from '../catalog/compendiumReviewTarget';
import type { CharacterChoiceItem } from '../catalog/characterChoiceTypes';
import {
  getEldritchInvocationCardAction,
  isEldritchInvocationCardDisabled
} from '../characters/eldritchInvocationInteraction';

const projectRoot = path.resolve(__dirname, '../..');

const mappedItem = (overrides: Partial<StoredCompendiumItem> = {}): StoredCompendiumItem => ({
  id: 'compendium:stored-invocation-id',
  importItemId: 'phb-2024-feature-warlock-eldritch-mind',
  packId: 'phb-2024',
  sourceId: 'phb-2024',
  type: 'feature',
  name: 'Eldritch Mind',
  rawJson: {} as StoredCompendiumItem['rawJson'],
  normalizedJson: {
    sourceType: 'eldritchInvocation',
    originalCompendiumItemId: 'stored-invocation-id'
  },
  tags: ['eldritch invocation'],
  status: 'needsReview',
  reviewDecision: 'pending',
  createdAt: '2026-08-05T00:00:00.000Z',
  updatedAt: '2026-08-05T00:00:00.000Z',
  ...overrides
});

describe('Eldritch Invocation interaction state', () => {
  it('keeps a selected card enabled so it can be removed even at the limit', () => {
    expect(isEldritchInvocationCardDisabled({
      selectedCount: 1,
      selectedTotal: 3,
      limit: 3,
      hasPrerequisiteIssues: true
    })).toBe(false);
  });

  it('disables only an unselected card when the limit or prerequisites block adding it', () => {
    expect(isEldritchInvocationCardDisabled({ selectedCount: 0, selectedTotal: 3, limit: 3 })).toBe(true);
    expect(isEldritchInvocationCardDisabled({ selectedCount: 0, selectedTotal: 1, limit: 3, hasPrerequisiteIssues: true })).toBe(true);
    expect(isEldritchInvocationCardDisabled({ selectedCount: 0, selectedTotal: 1, limit: 3 })).toBe(false);
  });

  it('uses the card as add when empty and remove when already selected', () => {
    expect(getEldritchInvocationCardAction(0)).toBe('add');
    expect(getEldritchInvocationCardAction(1)).toBe('remove');
    expect(getEldritchInvocationCardAction(2)).toBe('remove');
  });
});

describe('compendium review target resolution', () => {
  it('uses the persistent compendium item ID from the character-choice bridge', () => {
    const choice = {
      choiceId: 'compendium:stored-invocation-id',
      origin: 'compendium',
      compendiumItemId: 'stored-invocation-id'
    } as CharacterChoiceItem;

    expect(getCompendiumReviewTargetId(mappedItem(), () => choice)).toBe('stored-invocation-id');
  });

  it('falls back to the originalCompendiumItemId metadata instead of persisting the UI ID', () => {
    expect(getCompendiumReviewTargetId(mappedItem())).toBe('stored-invocation-id');
  });
});

describe('invocation screens integration contract', () => {
  it('uses toggle interaction in creation, management and level-up flows', () => {
    const creation = fs.readFileSync(path.join(projectRoot, 'app/characters/new.tsx'), 'utf8');
    const management = fs.readFileSync(path.join(projectRoot, 'app/characters/[id]/invocations.tsx'), 'utf8');
    const levelUp = fs.readFileSync(path.join(projectRoot, 'app/characters/[id]/level-up.tsx'), 'utf8');

    expect(creation).toContain('getCompendiumReviewTargetId(item, choiceForItemId)');
    expect(creation).toContain('toggleEldritchInvocation(item)');
    expect(management).toContain('onPressItem={(item) => toggle(item.id)}');
    expect(levelUp).toContain('onPressItem={toggleInvocation}');
    expect([creation, management, levelUp].every((source) => source.includes('isEldritchInvocationCardDisabled'))).toBe(true);
  });
});
