import type { Character, CharacterCompendiumLink, CharacterSpellbookFeatureChoice } from '../types';
import type { StoredCompendiumItem } from '../compendium/types';
import { BUNDLED_COMPENDIUM_PACKS } from '../compendium/bundledCompendium';
import { buildPersistedCompendiumImport } from '../compendium/importer';
import { createEmptyCharacter } from '../data/mockData';
import { buildAvailableActions } from '../rules-engine/actions/buildActions';
import { applyRest } from '../rules-engine/resources/resourceManager';
import {
  getClassSpellcastingProfile,
  spellCountsAgainstNormalClassLimit
} from '../characters/spellcastingRules';
import { getSpellbookEntriesForClass, learnSpellbookSpell } from '../characters/spellbookRules';
import {
  getAutomaticWizardSpellbookGrantReferences,
  getWizardSpellbookFeatureCandidates,
  getWizardSpellbookFeatureRequirements,
  reconcileWizardSpellbookFeatures,
  validateWizardSpellbookFeatureChoices
} from '../characters/wizardSpellbookRules';

const items = BUNDLED_COMPENDIUM_PACKS.flatMap((pack) =>
  buildPersistedCompendiumImport(pack.load() as Parameters<typeof buildPersistedCompendiumImport>[0], {
    importedAt: '2026-08-15T00:00:00.000Z'
  }).items
);

const byImportId = (id: string): StoredCompendiumItem => {
  const item = items.find((candidate) => candidate.importItemId === id);
  if (!item) throw new Error(`Fixture ausente: ${id}`);
  return item;
};

const wizardFixture = (
  level: number,
  subclassImportId?: string
): { character: Character; classEntityId: string; classItem: StoredCompendiumItem; subclassItem?: StoredCompendiumItem } => {
  const base = createEmptyCharacter('Wizard spellbook');
  const classItem = byImportId('phb-2024-class-wizard');
  const subclassItem = subclassImportId ? byImportId(subclassImportId) : undefined;
  const classEntityId = 'fixture-class:wizard';
  const subclassEntityId = subclassItem ? `fixture-subclass:${subclassItem.importItemId}` : undefined;
  const addedAt = '2026-08-15T00:00:00.000Z';
  const links: CharacterCompendiumLink[] = [{
    id: 'fixture-wizard-link', characterId: base.id, itemId: classItem.id, importItemId: classItem.importItemId,
    packId: classItem.packId, sourceId: classItem.sourceId, itemType: 'class', appliedAs: 'class',
    appliedEntityId: classEntityId, appliedEntityName: classItem.name, status: 'active', addedAt
  }];
  if (subclassItem && subclassEntityId) links.push({
    id: 'fixture-subclass-link', characterId: base.id, itemId: subclassItem.id, importItemId: subclassItem.importItemId,
    packId: subclassItem.packId, sourceId: subclassItem.sourceId, itemType: 'subclass', appliedAs: 'subclass',
    appliedEntityId: subclassEntityId, appliedEntityName: subclassItem.name, status: 'active', addedAt
  });
  return {
    classEntityId,
    classItem,
    subclassItem,
    character: {
      ...base,
      level,
      classes: [{ id: classEntityId, name: classItem.name, level }],
      subclasses: subclassItem && subclassEntityId ? [{ id: subclassEntityId, classId: classEntityId, name: subclassItem.name }] : [],
      compendiumLinks: links,
      buildChoices: {
        speciesChoices: [], classSkillChoices: [], classToolChoices: [], expertiseSkills: [], languages: [],
        spellAssignments: {}, spellbookAssignments: {}, equipmentSelections: [], spellbookFeatureChoices: []
      }
    }
  };
};

const withSpellbookSpells = (fixture: ReturnType<typeof wizardFixture>, spellImportIds: string[]): Character => {
  const profile = getClassSpellcastingProfile(fixture.classItem, fixture.character.classes[0]!.level)!;
  return spellImportIds.reduce((character, spellImportId) => learnSpellbookSpell({
    character,
    spellItem: byImportId(spellImportId),
    profile,
    classEntityId: fixture.classEntityId,
    acquisition: 'manual',
    source: 'manual'
  }), fixture.character);
};

const withChoices = (character: Character, choices: CharacterSpellbookFeatureChoice[]): Character => ({
  ...character,
  buildChoices: { ...character.buildChoices!, spellbookFeatureChoices: choices }
});

describe('Wizard spellbook special rules', () => {
  it('models all four 2024 Savant schools with two initial free spells and one per newly unlocked slot level', () => {
    const schools = [
      ['phb-2024-subclass-wizard-abjurer', 'abjuration'],
      ['phb-2024-subclass-wizard-diviner', 'divination'],
      ['phb-2024-subclass-wizard-evoker', 'evocation'],
      ['phb-2024-subclass-wizard-illusionist', 'illusion']
    ] as const;
    for (const [subclassId, school] of schools) {
      const fixture = wizardFixture(17, subclassId);
      const before = getWizardSpellbookFeatureRequirements({ ...fixture, classLevel: 2, items });
      expect(before).toHaveLength(0);
      const atThree = getWizardSpellbookFeatureRequirements({ ...fixture, classLevel: 3, items });
      expect(atThree).toEqual(expect.arrayContaining([
        expect.objectContaining({ kind: 'savantInitial', school, count: 2, maximumSpellLevel: 2 })
      ]));
      const atSeventeen = getWizardSpellbookFeatureRequirements({ ...fixture, classLevel: 17, items });
      const savant = atSeventeen.filter((entry) => entry.kind === 'savantInitial' || entry.kind === 'savantNewSlotLevel');
      expect(savant).toHaveLength(8);
      expect(savant.reduce((sum, entry) => sum + entry.count, 0)).toBe(9);
      expect(savant.filter((entry) => entry.kind === 'savantNewSlotLevel').map((entry) => entry.maximumSpellLevel)).toEqual([3, 4, 5, 6, 7, 8, 9]);
    }
  });

  it('filters Savant candidates by Wizard eligibility, school and spell level', () => {
    const fixture = wizardFixture(3, 'phb-2024-subclass-wizard-abjurer');
    const profile = getClassSpellcastingProfile(fixture.classItem, 3)!;
    const requirement = getWizardSpellbookFeatureRequirements({ ...fixture, classLevel: 3, items })
      .find((entry) => entry.kind === 'savantInitial')!;
    const ids = new Set(getWizardSpellbookFeatureCandidates({ requirement, profile, spellItems: items }).map((item) => item.importItemId));
    expect(ids.has('phb-2024-spell-mage-armor')).toBe(true);
    expect(ids.has('phb-2024-spell-shield')).toBe(true);
    expect(ids.has('phb-2024-spell-magic-missile')).toBe(false);
    expect(ids.has('phb-2024-spell-dispel-magic')).toBe(false);
  });

  it('allows a later Savant grant to choose any eligible school spell at or below the newly unlocked slot level', () => {
    const fixture = wizardFixture(5, 'phb-2024-subclass-wizard-abjurer');
    const profile = getClassSpellcastingProfile(fixture.classItem, 5)!;
    const requirement = getWizardSpellbookFeatureRequirements({ ...fixture, classLevel: 5, items })
      .find((entry) => entry.kind === 'savantNewSlotLevel' && entry.maximumSpellLevel === 3)!;
    const ids = new Set(getWizardSpellbookFeatureCandidates({ requirement, profile, spellItems: items }).map((item) => item.importItemId));
    expect(ids.has('phb-2024-spell-counterspell')).toBe(true);
    expect(ids.has('phb-2024-spell-shield')).toBe(true);
    expect(ids.has('phb-2024-spell-banishment')).toBe(false);
  });

  it('materializes Savant choices as free spellbook entries without treating them as normal progression spells', () => {
    const fixture = wizardFixture(3, 'phb-2024-subclass-wizard-abjurer');
    const requirement = getWizardSpellbookFeatureRequirements({ ...fixture, classLevel: 3, items })
      .find((entry) => entry.kind === 'savantInitial')!;
    const character = withChoices(fixture.character, [{
      requirementId: requirement.id, classItemId: fixture.classItem.id, featureItemId: requirement.featureItemId,
      spellItemIds: [byImportId('phb-2024-spell-mage-armor').id, byImportId('phb-2024-spell-shield').id]
    }]);
    const first = reconcileWizardSpellbookFeatures(character, items);
    const entries = getSpellbookEntriesForClass(first.character, fixture.classEntityId);
    expect(entries.filter((entry) => entry.acquisition === 'savant')).toHaveLength(2);
    expect(entries.filter((entry) => entry.acquisition === 'savant').every((entry) => entry.prepared === false)).toBe(true);
    const second = reconcileWizardSpellbookFeatures(first.character, items);
    expect(second.addedSpellbookEntryCount).toBe(0);
    expect(getSpellbookEntriesForClass(second.character, fixture.classEntityId).filter((entry) => entry.acquisition === 'savant')).toHaveLength(2);
  });

  it('restricts Spell Mastery to level-1/2 Action spells already in the Wizard spellbook', () => {
    const fixture = wizardFixture(18);
    const profile = getClassSpellcastingProfile(fixture.classItem, 18)!;
    const requirements = getWizardSpellbookFeatureRequirements({ ...fixture, classLevel: 18, items }).filter((entry) => entry.kind === 'spellMastery');
    expect(requirements).toHaveLength(2);
    const available = new Set([
      byImportId('phb-2024-spell-magic-missile').id,
      byImportId('phb-2024-spell-shield').id,
      byImportId('phb-2024-spell-scorching-ray').id,
      byImportId('phb-2024-spell-misty-step').id
    ]);
    const levelOne = requirements.find((entry) => entry.exactSpellLevel === 1)!;
    const levelTwo = requirements.find((entry) => entry.exactSpellLevel === 2)!;
    const oneIds = new Set(getWizardSpellbookFeatureCandidates({ requirement: levelOne, profile, spellItems: items, availableSpellbookItemIds: available }).map((item) => item.importItemId));
    const twoIds = new Set(getWizardSpellbookFeatureCandidates({ requirement: levelTwo, profile, spellItems: items, availableSpellbookItemIds: available }).map((item) => item.importItemId));
    expect(oneIds.has('phb-2024-spell-magic-missile')).toBe(true);
    expect(oneIds.has('phb-2024-spell-shield')).toBe(false);
    expect(twoIds.has('phb-2024-spell-scorching-ray')).toBe(true);
    expect(twoIds.has('phb-2024-spell-misty-step')).toBe(false);
  });

  it('makes Spell Mastery always prepared and at-will without charging the normal prepared limit, and reverts cleanly', () => {
    const fixture = wizardFixture(18);
    let character = withSpellbookSpells(fixture, ['phb-2024-spell-magic-missile', 'phb-2024-spell-scorching-ray']);
    const requirements = getWizardSpellbookFeatureRequirements({ ...fixture, classLevel: 18, items }).filter((entry) => entry.kind === 'spellMastery');
    character = withChoices(character, requirements.map((requirement) => ({
      requirementId: requirement.id,
      classItemId: fixture.classItem.id,
      featureItemId: requirement.featureItemId,
      spellItemIds: [byImportId(requirement.exactSpellLevel === 1 ? 'phb-2024-spell-magic-missile' : 'phb-2024-spell-scorching-ray').id]
    })));
    const applied = reconcileWizardSpellbookFeatures(character, items).character;
    const mastered = applied.spells.filter((spell) => spell.spellbookSpecialKind === 'spellMastery');
    expect(mastered).toHaveLength(2);
    expect(mastered.every((spell) => spell.prepared && !spellCountsAgainstNormalClassLimit(spell))).toBe(true);
    const actions = buildAvailableActions(applied).filter((action) => action.type === 'spell' && mastered.some((spell) => action.spellId === spell.id));
    expect(actions).toHaveLength(4);
    expect(actions.filter((action) => action.type === 'spell' && action.consumesSpellSlot)).toHaveLength(2);
    expect(actions.filter((action) => action.type === 'spell' && !action.consumesSpellSlot && action.tags?.includes('spell-mastery'))).toHaveLength(2);

    const cleared = reconcileWizardSpellbookFeatures(withChoices(applied, []), items).character;
    expect(cleared.spells.some((spell) => spell.spellbookSpecialKind === 'spellMastery')).toBe(false);
    expect(getSpellbookEntriesForClass(cleared, fixture.classEntityId).every((entry) => entry.prepared === false)).toBe(true);
  });

  it('models Signature Spells as two level-3 spellbook choices with separate Short-or-Long-Rest free-cast resources', () => {
    const fixture = wizardFixture(20);
    let character = withSpellbookSpells(fixture, ['phb-2024-spell-fireball', 'phb-2024-spell-counterspell']);
    const requirement = getWizardSpellbookFeatureRequirements({ ...fixture, classLevel: 20, items }).find((entry) => entry.kind === 'signatureSpells')!;
    expect(requirement).toMatchObject({ exactSpellLevel: 3, count: 2, alwaysPrepared: true, freeCastEach: 1, recharge: 'shortRest' });
    character = withChoices(character, [{
      requirementId: requirement.id, classItemId: fixture.classItem.id, featureItemId: requirement.featureItemId,
      spellItemIds: [byImportId('phb-2024-spell-fireball').id, byImportId('phb-2024-spell-counterspell').id]
    }]);
    const applied = reconcileWizardSpellbookFeatures(character, items).character;
    const signature = applied.spells.filter((spell) => spell.spellbookSpecialKind === 'signatureSpells');
    expect(signature).toHaveLength(2);
    expect(signature.every((spell) => spell.prepared && !spellCountsAgainstNormalClassLimit(spell))).toBe(true);
    const signatureResources = applied.resources.filter((resource) => resource.id.startsWith('wizard-signature:'));
    expect(signatureResources).toHaveLength(2);
    expect(signatureResources.every((resource) => resource.recharge === 'shortRest')).toBe(true);
    const spent = {
      ...applied,
      resources: applied.resources.map((resource) => resource.id === signatureResources[0]!.id ? { ...resource, current: 0 } : resource)
    };
    expect(applyRest(spent, 'shortRest').character.resources.find((resource) => resource.id === signatureResources[0]!.id)?.current).toBe(1);
    expect(applyRest(spent, 'longRest').character.resources.find((resource) => resource.id === signatureResources[0]!.id)?.current).toBe(1);
    const actions = buildAvailableActions(applied).filter((action) => action.type === 'spell' && signature.some((spell) => action.spellId === spell.id));
    expect(actions.filter((action) => action.type === 'spell' && action.consumesSpellSlot)).toHaveLength(2);
    expect(actions.filter((action) => action.type === 'spell' && !action.consumesSpellSlot && action.tags?.includes('signature-spell'))).toHaveLength(2);
  });

  it('adds legacy Necromancy and Transmutation spellbook grants only when their feature levels are active', () => {
    const necro5 = wizardFixture(5, 'phb-2014-subclass-wizard-school-of-necromancy');
    const necro6 = wizardFixture(6, 'phb-2014-subclass-wizard-school-of-necromancy');
    expect(getAutomaticWizardSpellbookGrantReferences(necro5.classItem, 5, necro5.subclassItem, items)).toHaveLength(0);
    expect(getAutomaticWizardSpellbookGrantReferences(necro6.classItem, 6, necro6.subclassItem, items).map((entry) => entry.spellItemId)).toContain(byImportId('phb-2024-spell-animate-dead').id);
    const necroApplied = reconcileWizardSpellbookFeatures(necro6.character, items).character;
    expect(getSpellbookEntriesForClass(necroApplied, necro6.classEntityId)).toEqual(expect.arrayContaining([
      expect.objectContaining({ spellItemId: byImportId('phb-2024-spell-animate-dead').id, acquisition: 'feature' })
    ]));

    const trans9 = wizardFixture(9, 'phb-2014-subclass-wizard-school-of-transmutation');
    const trans10 = wizardFixture(10, 'phb-2014-subclass-wizard-school-of-transmutation');
    expect(getAutomaticWizardSpellbookGrantReferences(trans9.classItem, 9, trans9.subclassItem, items)).toHaveLength(0);
    expect(getAutomaticWizardSpellbookGrantReferences(trans10.classItem, 10, trans10.subclassItem, items).map((entry) => entry.spellItemId)).toContain(byImportId('phb-2024-spell-polymorph').id);
  });

  it('validates Spell Mastery and Signature choices against the actual saved spellbook, not only creation assignments', () => {
    const fixture = wizardFixture(20);
    const character = withSpellbookSpells(fixture, ['phb-2024-spell-magic-missile', 'phb-2024-spell-scorching-ray', 'phb-2024-spell-fireball', 'phb-2024-spell-counterspell']);
    const requirements = getWizardSpellbookFeatureRequirements({ ...fixture, classLevel: 20, items }).filter((entry) => entry.kind === 'spellMastery' || entry.kind === 'signatureSpells');
    const choices: CharacterSpellbookFeatureChoice[] = requirements.map((requirement) => ({
      requirementId: requirement.id,
      classItemId: fixture.classItem.id,
      featureItemId: requirement.featureItemId,
      spellItemIds: requirement.kind === 'signatureSpells'
        ? [byImportId('phb-2024-spell-fireball').id, byImportId('phb-2024-spell-counterspell').id]
        : [byImportId(requirement.exactSpellLevel === 1 ? 'phb-2024-spell-magic-missile' : 'phb-2024-spell-scorching-ray').id]
    }));
    const profile = getClassSpellcastingProfile(fixture.classItem, 20)!;
    const issues = validateWizardSpellbookFeatureChoices({
      requirements,
      choices,
      profileByClassItemId: new Map([[fixture.classItem.id, profile]]),
      spellItems: items,
      normalSpellbookAssignments: {},
      availableSpellbookItemIdsByClassItemId: new Map([[fixture.classItem.id, new Set(getSpellbookEntriesForClass(character, fixture.classEntityId).map((entry) => entry.spellItemId))]]),
      requireExact: true
    });
    expect(issues).toEqual([]);
  });
});
