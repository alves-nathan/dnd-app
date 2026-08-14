import { buildPersistedCompendiumImport } from '../compendium/importer';
import { applyCompendiumItemToCharacter } from '../compendium/mapper';
import { createEmptyCharacter } from '../data/mockData';
import { applyEldritchInvocationSelection } from '../characters/eldritchInvocationSelection';
import {
  applyEldritchInvocationChoices,
  emptyEldritchInvocationChoice,
  validateEldritchInvocationChoices
} from '../characters/eldritchInvocationChoiceRules';

const source = { id: 'advanced-invocation-source', book: 'Invocation Test', version: '2024', status: 'active' as const, confidence: 'exact' as const };
const imported = buildPersistedCompendiumImport({
  id: 'advanced-invocation-pack',
  source,
  items: [
    { id: 'warlock', kind: 'class', name: 'Warlock', source, payload: { level: 5 } },
    { id: 'agonizing', kind: 'feature', name: 'Agonizing Blast', source, payload: { sourceType: 'eldritchInvocation', engineKey: 'warlock.agonizing-blast', repeatable: true } },
    { id: 'repelling', kind: 'feature', name: 'Repelling Blast', source, payload: { sourceType: 'eldritchInvocation', engineKey: 'warlock.repelling-blast', repeatable: true } },
    { id: 'lessons', kind: 'feature', name: 'Lessons of the First Ones', source, payload: { sourceType: 'eldritchInvocation', engineKey: 'warlock.lessons-of-the-first-ones', repeatable: true } },
    { id: 'pact-chain', kind: 'feature', name: 'Pact of the Chain', source, payload: { sourceType: 'eldritchInvocation', engineKey: 'warlock.pact-of-the-chain' } },
    { id: 'lifedrinker', kind: 'feature', name: 'Lifedrinker', source, payload: { sourceType: 'eldritchInvocation', engineKey: 'warlock.lifedrinker' } },
    { id: 'eldritch-blast', kind: 'spell', name: 'Eldritch Blast', source, payload: { level: 0, classes: ['Warlock'], damageFormula: '1d10', range: '120 ft', requiresAttackRoll: true, castingTime: 'action' } },
    { id: 'poison-spray', kind: 'spell', name: 'Poison Spray', source, payload: { level: 0, classes: ['Warlock'], damageFormula: '1d12', range: '30 ft', requiresAttackRoll: false, castingTime: 'action' } },
    { id: 'find-familiar', kind: 'spell', name: 'Find Familiar', source, payload: { level: 1, classes: ['Wizard'], ritual: true, castingTime: '1 hour or ritual' } },
    { id: 'skilled', kind: 'feat', name: 'Skilled', source, payload: { category: 'origin' } },
    { id: 'lucky', kind: 'feat', name: 'Lucky', source, payload: { category: 'origin' } },
    { id: 'imp', kind: 'creatureStatBlock', name: 'Imp', source, payload: { armorClass: 13, hitPoints: 10 } }
  ]
});
const item = (id: string) => imported.items.find((entry) => entry.importItemId === id)!;

describe('advanced Eldritch Invocation choices', () => {
  it('requires eligible known cantrips and unique targets for repeated invocations', () => {
    const agonizing = item('agonizing');
    const blast = item('eldritch-blast');
    const counts = { [agonizing.id]: 2 };
    const choices = [0, 1].map((instanceIndex) => ({
      ...emptyEldritchInvocationChoice(agonizing.id, instanceIndex),
      targetCantripItemId: blast.id
    }));
    const issues = validateEldritchInvocationChoices(counts, choices, imported.items, [source.id], {
      knownWarlockCantripItemIds: [blast.id],
      requireKnownWarlockCantrip: true
    });
    expect(issues.map((entry) => entry.code)).toContain('ELDRITCH_INVOCATION_CANTRIP_DUPLICATE');

    const repelling = item('repelling');
    const poison = item('poison-spray');
    const repellingIssues = validateEldritchInvocationChoices(
      { [repelling.id]: 1 },
      [{ ...emptyEldritchInvocationChoice(repelling.id), targetCantripItemId: poison.id }],
      imported.items,
      [source.id],
      { knownWarlockCantripItemIds: [poison.id], requireKnownWarlockCantrip: true }
    );
    expect(repellingIssues.map((entry) => entry.code)).toContain('ELDRITCH_INVOCATION_CANTRIP_INVALID');
  });

  it('validates Lessons, Pact Chain and Lifedrinker internal choices', () => {
    const lessons = item('lessons');
    const chain = item('pact-chain');
    const lifedrinker = item('lifedrinker');
    const skilled = item('skilled');
    const imp = item('imp');
    const counts = { [lessons.id]: 1, [chain.id]: 1, [lifedrinker.id]: 1 };
    const validChoices = [
      { ...emptyEldritchInvocationChoice(lessons.id), originFeatItemId: skilled.id },
      { ...emptyEldritchInvocationChoice(chain.id), familiarCreatureItemId: imp.id, familiarVariant: 'special' as const },
      { ...emptyEldritchInvocationChoice(lifedrinker.id), lifedrinkerDamageType: 'radiant' as const }
    ];
    expect(validateEldritchInvocationChoices(counts, validChoices, imported.items, [source.id])).toEqual([]);
    expect(validateEldritchInvocationChoices(counts, validChoices, imported.items, [source.id], {
      selectedOriginFeatItemIds: [skilled.id]
    }).map((entry) => entry.code)).toContain('LESSONS_ORIGIN_FEAT_DUPLICATE');
  });

  it('applies Lessons feat and Pact Chain free Find Familiar', () => {
    const lessons = item('lessons');
    const chain = item('pact-chain');
    const skilled = item('skilled');
    const imp = item('imp');
    const counts = { [lessons.id]: 1, [chain.id]: 1 };
    const choices = [
      { ...emptyEldritchInvocationChoice(lessons.id), originFeatItemId: skilled.id },
      { ...emptyEldritchInvocationChoice(chain.id), familiarCreatureItemId: imp.id, familiarVariant: 'special' as const }
    ];
    let character = applyCompendiumItemToCharacter(createEmptyCharacter('Chain Warlock'), item('warlock')).character;
    character = applyEldritchInvocationSelection(character, counts, imported.items).character;
    const result = applyEldritchInvocationChoices(character, choices, imported.items);
    expect(result.appliedFeatCount).toBe(1);
    expect(result.character.feats.some((feat) => feat.name === 'Skilled' && feat.grantedByInvocationItemId === lessons.id)).toBe(true);
    expect(result.character.spells.some((spell) => spell.name === 'Find Familiar' && spell.freeCast && spell.grantedByInvocationItemId === chain.id)).toBe(true);
  });
});
