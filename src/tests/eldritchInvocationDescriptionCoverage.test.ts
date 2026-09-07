import { buildPersistedCompendiumImport } from '../compendium/importer';
import { getCompendiumChoiceDescription } from '../characters/creationData';

const source = {
  id: 'description-test',
  book: 'description-test',
  version: '2026',
  status: 'active' as const,
  confidence: 'exact' as const
};

const stored = (items: any[]) => buildPersistedCompendiumImport({
  id: 'invocation-description-coverage',
  source,
  items
}).items;

describe('eldritch invocation description coverage', () => {
  it.each([
    ['Fiendish Vigor', 'Conjura False Life em si mesmo sem espaço e recebe o valor máximo de pontos temporários.'],
    ['Lessons of the First Ones', 'Concede um Origin Feat elegível; repetível com feats diferentes.'],
    ['Mask of Many Faces', 'Conjura Disguise Self sem gastar espaço de magia.'],
    ['Misty Visions', 'Conjura Silent Image sem gastar espaço de magia.'],
    ['Otherworldly Leap', 'Conjura Jump em si mesmo sem gastar espaço de magia.']
  ])('keeps the concise PHB summary for %s when no mechanics object is present', (name, summary) => {
    const [item] = stored([{
      id: `test-${name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
      kind: 'feature',
      name,
      summary,
      source,
      payload: {
        sourceType: 'eldritchInvocation',
        classId: 'phb-2024-class-warlock',
        levelGained: 2,
        prerequisite: 'Level 2+ Warlock'
      }
    }]);
    const description = getCompendiumChoiceDescription(item!);
    expect(description).toContain('Pré-requisito: Level 2+ Warlock.');
    expect(description).toContain(summary);
  });

  it('describes Improved Pact Weapon from structured mechanics instead of a generic legacy label', () => {
    const [item] = stored([{
      id: 'improved-pact-weapon',
      kind: 'feature',
      name: 'Improved Pact Weapon',
      summary: "Legacy Eldritch Invocation from Xanathar's Guide to Everything.",
      source,
      payload: {
        sourceType: 'eldritchInvocation',
        prerequisite: 'Pact of the Blade feature',
        mechanics: {
          pactWeapon: {
            canBeSpellcastingFocusForWarlockSpells: true,
            attackAndDamageBonus: 1,
            bonusDoesNotApplyIfMagicWeaponAlreadyHasBonusToThoseRolls: true,
            additionalConjurableWeaponTypes: ['shortbow', 'longbow', 'light crossbow', 'heavy crossbow']
          }
        }
      }
    }]);
    const description = getCompendiumChoiceDescription(item!);
    expect(description).toContain('foco de conjuração');
    expect(description).toContain('+1');
    expect(description).toContain('shortbow');
    expect(description).not.toContain('Legacy Eldritch Invocation');
  });

  it('keeps the Pact of the Talisman source summary and exposes its structured usage', () => {
    const [item] = stored([{
      id: 'pact-of-the-talisman',
      kind: 'feature',
      name: 'Pact of the Talisman',
      summary: 'O talismã permite ao portador adicionar 1d4 após falhar um teste de habilidade, PB vezes por Long Rest.',
      source,
      payload: {
        sourceType: 'eldritchInvocation',
        prerequisite: 'Level 3+ Warlock',
        mechanics: {
          optionalClassFeature: true,
          item: 'talisman amulet',
          trigger: 'wearer fails an ability check',
          bonusDie: '1d4',
          uses: 'PB',
          recharge: 'longRest',
          replacementCeremony: { duration: '1 hour' }
        }
      }
    }]);
    const description = getCompendiumChoiceDescription(item!);
    expect(description).toContain('1d4');
    expect(description).toContain('PB');
    expect(description).toContain('1 hour');
  });
});
