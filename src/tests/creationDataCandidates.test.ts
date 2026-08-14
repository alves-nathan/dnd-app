import { buildPersistedCompendiumImport } from '../compendium/importer';
import {
  getCompendiumChoiceDescription,
  getSelectableFeatCandidates,
  getSelectableSpellCandidates,
  isOriginFeatItem
} from '../characters/creationData';

const reviewSource = {
  id: 'phb-test',
  book: 'PHB Test',
  version: '2024',
  status: 'needsReview' as const,
  confidence: 'importedNeedsReview' as const
};

const persisted = buildPersistedCompendiumImport({
  id: 'creation-data-candidates',
  source: reviewSource,
  items: [
    {
      id: 'alert',
      kind: 'feat',
      name: 'Alert',
      summary: 'Adiciona a proficiência à iniciativa e permite trocar iniciativa.',
      source: reviewSource,
      payload: { category: 'origin' }
    },
    {
      id: 'archery',
      kind: 'feat',
      name: 'Archery',
      summary: 'Concede bônus em ataques com armas de distância.',
      source: reviewSource,
      payload: { category: 'fightingStyle', prerequisite: 'Fighting Style Feature' }
    },
    {
      id: 'eldritch-blast',
      kind: 'spell',
      name: 'Eldritch Blast',
      summary: 'Cantrip de Warlock.',
      source: reviewSource,
      payload: { level: 0, classes: ['Warlock'] }
    },
    {
      id: 'disabled-spell',
      kind: 'spell',
      name: 'Disabled Spell',
      source: { ...reviewSource, status: 'disabled' as const },
      payload: { level: 1, classes: ['Wizard'] }
    },
    {
      id: 'disabled-feat',
      kind: 'feat',
      name: 'Disabled Feat',
      source: { ...reviewSource, status: 'disabled' as const },
      payload: { category: 'general' }
    }
  ]
});

describe('creation feat candidates', () => {
  it('keeps enabled needsReview feats selectable for explicit approval', () => {
    const candidates = getSelectableFeatCandidates(persisted.items, ['phb-test']);
    expect(candidates.map((item) => item.importItemId)).toEqual(['alert', 'archery']);
    expect(candidates.every((item) => item.status === 'needsReview')).toBe(true);
  });

  it('keeps enabled needsReview spells visible, including Eldritch Blast', () => {
    const candidates = getSelectableSpellCandidates(persisted.items, ['phb-test']);
    expect(candidates.map((item) => item.importItemId)).toContain('eldritch-blast');
    expect(candidates.map((item) => item.importItemId)).not.toContain('disabled-spell');
  });

  it('exposes a short description for option cards', () => {
    const alert = persisted.items.find((item) => item.importItemId === 'alert')!;
    expect(isOriginFeatItem(alert)).toBe(true);
    expect(getCompendiumChoiceDescription(alert)).toContain('iniciativa');
  });
});
