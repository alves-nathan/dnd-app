import { buildPersistedCompendiumImport } from '../compendium/importer';
import { getCompendiumChoiceDescription } from '../characters/creationData';
import { getSelectionShortDescription } from '../characters/selectionPreview';

const source = {
  id: 'xgte-2017',
  book: "Xanathar's Guide to Everything",
  version: '2017',
  status: 'active' as const,
  confidence: 'exact' as const
};

const persisted = buildPersistedCompendiumImport({
  id: 'description-quality',
  source,
  items: [
    {
      id: 'aspect',
      kind: 'feature',
      name: 'Aspect of the Moon',
      summary: "Legacy Eldritch Invocation from Xanathar's Guide to Everything.",
      source,
      payload: {
        sourceType: 'eldritchInvocation',
        prerequisite: 'Pact of the Tome feature',
        mechanics: {
          noLongerNeedsSleep: true,
          cannotBeForcedToSleep: true,
          longRest: { hours: 8, maySpendAllHoursInLightActivity: true }
        }
      }
    },
    {
      id: 'gift',
      kind: 'feature',
      name: 'Gift of the Ever-Living Ones',
      summary: "Legacy Eldritch Invocation from Xanathar's Guide to Everything.",
      source,
      payload: {
        sourceType: 'eldritchInvocation',
        prerequisite: 'Pact of the Chain feature',
        mechanics: { whenYouRegainHitPoints: { requiresFamiliarWithinFeet: 100, healingDiceForYou: 'treatEveryDieAsMaximumResult' } }
      }
    },
    {
      id: 'grasp',
      kind: 'feature',
      name: 'Grasp of Hadar',
      summary: "Legacy Eldritch Invocation from Xanathar's Guide to Everything.",
      source,
      payload: {
        sourceType: 'eldritchInvocation',
        prerequisite: 'eldritch blast cantrip',
        mechanics: {
          trigger: 'onceOnEachOfYourTurnsWhenHitCreatureWithEldritchBlast',
          moveTarget: { feet: 10, direction: 'straightLineCloserToYou' }
        }
      }
    },
    {
      id: 'water-genasi',
      kind: 'feature',
      name: 'Genasi Subrace: Water',
      summary: 'Legacy Wildemount 2020 feature: Genasi Subrace: Water.',
      source,
      payload: {
        sourceType: 'speciesFeature',
        mechanics: {
          optionType: 'genasiSubrace',
          name: 'Water',
          damageResistances: ['acid'],
          amphibious: true,
          swimSpeedFeet: 30,
          callToTheWave: {
            spellcastingAbility: 'CON',
            spells: [
              { spellId: 'xgte-2017-spell-shape-water', spellName: 'Shape Water', minimumCharacterLevel: 1, usage: 'atWillCantrip' },
              { spellId: 'phb-2024-spell-create-or-destroy-water', spellName: 'Create or Destroy Water', minimumCharacterLevel: 3, uses: 1, recharge: 'longRest' }
            ]
          }
        }
      }
    }
  ]
});

describe('character choice description quality', () => {
  it('renders the mechanics of imported invocations instead of a generic source label', () => {
    const aspect = persisted.items.find((item) => item.importItemId === 'aspect')!;
    const gift = persisted.items.find((item) => item.importItemId === 'gift')!;
    const grasp = persisted.items.find((item) => item.importItemId === 'grasp')!;
    expect(getCompendiumChoiceDescription(aspect)).toContain('não precisa dormir');
    expect(getCompendiumChoiceDescription(gift)).toContain('resultado máximo');
    expect(getCompendiumChoiceDescription(grasp)).toContain('10 ft');
  });

  it('describes a Genasi subrace with resistance, movement and granted spells', () => {
    const water = persisted.items.find((item) => item.importItemId === 'water-genasi')!;
    const description = getSelectionShortDescription(water, 500);
    expect(description).toContain('Resistência a acid');
    expect(description).toContain('Anfíbio');
    expect(description).toContain('Shape Water');
    expect(description).toContain('Create or Destroy Water');
  });
});
