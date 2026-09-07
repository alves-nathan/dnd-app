import { buildPersistedCompendiumImport } from '../compendium/importer';
import { applyCompendiumItemToCharacter } from '../compendium/mapper';
import { annotateLatestSpellWithClass, countCharacterSpellsForClass } from '../characters/spellcastingRules';
import { reconcileCharacterBuild } from '../characters/buildReconciliation';
import { createEmptyCharacter } from '../data/mockData';

const source = { id: 'reconcile-source', book: 'Reconcile Test', version: '2024', status: 'active' as const, confidence: 'exact' as const };
const pack = buildPersistedCompendiumImport({
  id: 'reconcile-pack', source, items: [
    { id: 'bard', kind: 'class', name: 'Bard', source, payload: { level: 1, progression: [{ level: 1, featureIds: ['bonus-cantrip-feature'] }], spellcasting: { progression: 'fullCaster', slotsByLevel: { '1': { '1': 2 } }, cantripsKnownByLevel: [1], preparedSpellsByLevel: [1] } } },
    { id: 'bonus-cantrip-feature', kind: 'feature', name: 'Bonus Cantrip Feature', source, payload: { levelGained: 1, mechanics: { cantripChoiceCount: 1, spellList: 'Bard' } } },
    { id: 'spell-a', kind: 'spell', name: 'Spell A', source, payload: { level: 1, classes: ['Bard'] } },
    { id: 'spell-b', kind: 'spell', name: 'Spell B', source, payload: { level: 1, classes: ['Bard'] } },
    { id: 'bonus-cantrip', kind: 'spell', name: 'Bonus Cantrip', source, payload: { level: 0, classes: ['Bard'] } },
    { id: 'glamour', kind: 'subclass', name: 'College of Glamour', source, payload: { classId: 'bard', progression: [{ level: 3, featureIds: ['glamour-beguiling'] }] } },
    { id: 'glamour-beguiling', kind: 'feature', name: 'Beguiling Magic', source, payload: { sourceType: 'subclassFeature', classId: 'bard', subclassId: 'glamour', resource: { id: 'glamour-beguiling-magic', recharge: 'longRest' } } },
    { id: 'wizard', kind: 'class', name: 'Wizard', source, payload: { level: 1, progression: [{ level: 4, featureIds: ['wizard-asi'] }], spellcasting: { progression: 'fullCaster', preparationSource: 'spellbook', slotsByLevel: { '1': { '1': 2 } }, cantripsKnownByLevel: [3], preparedSpellsByLevel: [4] } } },
    { id: 'wizard-asi', kind: 'feature', name: 'Ability Score Improvement', source, payload: { levelGained: 4 } },
    { id: 'general-feat', kind: 'feat', name: 'Test General Feat', source, payload: { category: 'general', prerequisite: 'Level 4+' } },
    { id: 'decoy-general-feat', kind: 'feat', name: 'Decoy General Feat', source, payload: { category: 'general', prerequisite: 'Level 20+' } },
    { id: 'wizard-spell', kind: 'spell', name: 'Wizard Spell', source, payload: { level: 1, classes: ['Wizard'] } },
    { id: 'fire-bolt-homebrew-access', kind: 'spell', name: 'Fire Bolt', source, payload: { level: 0, classes: ['Wizard'], damageFormula: '1d10', damageType: 'fire' } }
  ]
});
const item = (id: string) => pack.items.find((entry) => entry.importItemId === id)!;

describe('build reconciliation', () => {
  it('removes spells above the class limit and persists pending choices', () => {
    let character = applyCompendiumItemToCharacter(createEmptyCharacter('Bard'), item('bard')).character;
    const classId = character.classes[0]!.id;
    for (const spellId of ['spell-a', 'spell-b']) {
      const before = character;
      const applied = applyCompendiumItemToCharacter(character, item(spellId));
      character = annotateLatestSpellWithClass(before, applied.character, classId, 'Bard');
    }
    const result = reconcileCharacterBuild(character, pack.items);
    expect(result.character.spells).toHaveLength(1);
    expect(result.removedSpellCount).toBeGreaterThanOrEqual(1);
  });

  it('keeps a spell that a custom feature adds to the active class spell list', () => {
    let character = applyCompendiumItemToCharacter(createEmptyCharacter('Bard'), item('bard')).character;
    const classId = character.classes[0]!.id;
    character = {
      ...character,
      features: [{
        id: 'friendly-fire',
        name: 'Friendly Fire',
        sourceType: 'manual',
        custom: true,
        customRules: {
          spellListAdditions: [{
            id: 'friendly-fire-list',
            spellItemIds: [item('fire-bolt-homebrew-access').id],
            classNames: ['Bard']
          }]
        }
      }]
    };
    const before = character;
    const applied = applyCompendiumItemToCharacter(character, item('fire-bolt-homebrew-access'));
    character = annotateLatestSpellWithClass(before, applied.character, classId, 'Bard');

    const result = reconcileCharacterBuild(character, pack.items);

    expect(result.character.spells.map((spell) => spell.name)).toContain('Fire Bolt');
    expect(result.issues.some((issue) => issue.code === 'SPELLS_REMOVED_BY_CLASS_RECONCILIATION')).toBe(false);
  });

  it('creates a distinct pending spellbook requirement for Wizard', () => {
    const character = applyCompendiumItemToCharacter(createEmptyCharacter('Wizard'), item('wizard')).character;
    const result = reconcileCharacterBuild(character, pack.items);
    const pending = result.character.pendingChoices?.find((choice) => choice.kind === 'spellSelection');
    expect(pending?.description).toContain('6 magia(s) para o spellbook');
    expect(pending?.description).toContain('4 magia(s) preparada(s)');
  });


  it('creates a pending general feat when class progression granted a feat slot but the feat entity is missing', () => {
    let character = applyCompendiumItemToCharacter(createEmptyCharacter('Wizard 5 missing feat'), item('wizard')).character;
    character = {
      ...character,
      level: 5,
      classes: character.classes.map((entry) => ({ ...entry, level: 5 })),
      compendiumLinks: (character.compendiumLinks ?? []).map((link) =>
        link.appliedAs === 'class'
          ? { ...link, itemId: `catalog:${item('wizard').id}`, choiceId: `catalog:${item('wizard').id}`, origin: 'catalog' as const }
          : link
      )
    };

    const result = reconcileCharacterBuild(character, pack.items);
    const featPending = result.character.pendingChoices?.find((choice) => choice.kind === 'feat');

    expect(featPending).toEqual(expect.objectContaining({
      featCategory: 'general',
      requiredCount: 1,
      currentCount: 0
    }));
    expect(featPending?.title).toContain('feat geral');
  });

  it('clears the progression feat pending once a qualifying general feat is linked', () => {
    let character = applyCompendiumItemToCharacter(createEmptyCharacter('Wizard 5 with feat'), item('wizard')).character;
    character = {
      ...character,
      level: 5,
      classes: character.classes.map((entry) => ({ ...entry, level: 5 }))
    };
    character = applyCompendiumItemToCharacter(character, item('general-feat')).character;
    character = {
      ...character,
      compendiumLinks: (character.compendiumLinks ?? []).map((link) =>
        link.appliedAs === 'feat'
          ? { ...link, itemId: `catalog:${item('general-feat').id}`, choiceId: `catalog:${item('general-feat').id}`, origin: 'catalog' as const }
          : link
      )
    };

    const result = reconcileCharacterBuild(character, pack.items);

    expect(result.character.feats.map((feat) => feat.name)).toContain('Test General Feat');
    expect(result.character.pendingChoices?.some((choice) => choice.kind === 'feat')).toBe(false);
  });


  it('does not remove a feat when its stale carrier id was reused by another feat', () => {
    let character = applyCompendiumItemToCharacter(createEmptyCharacter('Stale feat carrier'), item('wizard')).character;
    character = {
      ...character,
      level: 5,
      classes: character.classes.map((entry) => ({ ...entry, level: 5 }))
    };
    character = applyCompendiumItemToCharacter(character, item('general-feat')).character;
    const featEntity = character.feats.find((feat) => feat.name === 'Test General Feat')!;
    character = {
      ...character,
      compendiumLinks: (character.compendiumLinks ?? []).map((link) =>
        link.appliedAs === 'feat' && link.appliedEntityId === featEntity.id
          ? {
              ...link,
              itemId: item('decoy-general-feat').id,
              importItemId: item('general-feat').importItemId
            }
          : link
      )
    };

    const result = reconcileCharacterBuild(character, pack.items);

    expect(result.removedFeatCount).toBe(0);
    expect(result.character.feats).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: featEntity.id, name: 'Test General Feat' })
    ]));
  });

  it('removes resources, masteries and spells orphaned by a removed feat', () => {
    const character = {
      ...createEmptyCharacter('Orphan cleanup'),
      resources: [{ id: 'feat_free_cast_missing-feat', name: 'Free cast', max: 1, current: 1, recharge: 'longRest' as const }],
      weaponMasteries: [{ id: 'wm-1', sourceKind: 'feat' as const, sourceEntityId: 'missing-feat', weaponName: 'Spear', mastery: 'sap' }],
      spells: [{
        id: 'feat-spell', name: 'Feat Spell', level: 1, castingTime: 'action' as const,
        targeting: { targets: 1 }, grantedByFeatEntityId: 'missing-feat'
      }]
    };
    const result = reconcileCharacterBuild(character, pack.items);
    expect(result.character.resources).toHaveLength(0);
    expect(result.character.weaponMasteries).toHaveLength(0);
    expect(result.character.spells).toHaveLength(0);
  });

  it('keeps feature and bonus spells outside the normal class spell limits', () => {
    let character = applyCompendiumItemToCharacter(createEmptyCharacter('Bard'), item('bard')).character;
    const classId = character.classes[0]!.id;
    const beforeNormal = character;
    character = annotateLatestSpellWithClass(
      beforeNormal,
      applyCompendiumItemToCharacter(character, item('spell-a')).character,
      classId,
      'Bard'
    );
    const beforeGranted = character;
    character = annotateLatestSpellWithClass(
      beforeGranted,
      applyCompendiumItemToCharacter(character, item('spell-b')).character,
      classId,
      'Bard'
    );
    character = {
      ...character,
      spells: character.spells.map((spell) => spell.name === 'Spell B'
        ? { ...spell, grantedByFeatureEntityId: 'feature-entity' }
        : spell)
    };

    const result = reconcileCharacterBuild(character, pack.items);
    expect(result.character.spells.map((spell) => spell.name)).toEqual(expect.arrayContaining(['Spell A', 'Spell B']));
    expect(countCharacterSpellsForClass(result.character.spells, classId).prepared).toBe(1);
    expect(result.issues.some((issue) => issue.code === 'EXCESS_SPELLS_REMOVED_BY_RECONCILIATION')).toBe(false);
  });

  it('keeps a selected bonus spell and removes it when its bonus choice becomes stale', () => {
    let character = applyCompendiumItemToCharacter(createEmptyCharacter('Bard'), item('bard')).character;
    const classId = character.classes[0]!.id;
    const before = character;
    const applied = applyCompendiumItemToCharacter(character, item('bonus-cantrip'));
    character = annotateLatestSpellWithClass(before, applied.character, classId, 'Bard');
    const added = character.spells.find((spell) => spell.name === 'Bonus Cantrip')!;
    const requirementId = `${item('bonus-cantrip-feature').id}:mechanics-cantrip-choice`;
    character = {
      ...character,
      spells: character.spells.map((spell) => spell.id === added.id ? { ...spell, bonusSpellChoiceId: requirementId } : spell),
      buildChoices: {
        speciesChoices: [],
        classSkillChoices: [],
        classToolChoices: [],
        expertiseSkills: [],
        languages: [],
        spellAssignments: {},
        equipmentSelections: [],
        bonusSpellChoices: [{
          requirementId,
          classItemId: item('bard').id,
          featureItemId: item('bonus-cantrip-feature').id,
          spellItemIds: [item('bonus-cantrip').id]
        }]
      }
    };

    const kept = reconcileCharacterBuild(character, pack.items);
    expect(kept.character.spells.some((spell) => spell.name === 'Bonus Cantrip')).toBe(true);
    expect(countCharacterSpellsForClass(kept.character.spells, classId).cantrips).toBe(0);

    const stale = reconcileCharacterBuild({
      ...kept.character,
      buildChoices: { ...kept.character.buildChoices!, bonusSpellChoices: [] }
    }, pack.items);
    expect(stale.character.spells.some((spell) => spell.name === 'Bonus Cantrip')).toBe(false);
    expect(stale.issues.some((issue) => issue.code === 'BONUS_SPELLS_REMOVED_BY_RECONCILIATION')).toBe(true);
  });

  it('surfaces a missing subclass once the class reaches its subclass level', () => {
    let character = applyCompendiumItemToCharacter(createEmptyCharacter('Bard 3'), item('bard')).character;
    const classEntityId = character.classes[0]!.id;
    character = {
      ...character,
      level: 3,
      classes: character.classes.map((entry) => entry.id === classEntityId ? { ...entry, level: 3 } : entry)
    };
    const result = reconcileCharacterBuild(character, pack.items);
    expect(result.character.pendingChoices).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'subclass', title: 'Escolher subclasse de Bard' })
    ]));
  });

});
