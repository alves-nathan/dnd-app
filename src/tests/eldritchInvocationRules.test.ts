import type { StoredCompendiumItem } from '../compendium/types';
import { buildPersistedCompendiumImport } from '../compendium/importer';
import { isProgressionOwnedFeatureItem } from '../compendium/classProgression';
import { withBuiltinEldritchInvocations } from '../characters/eldritchInvocationCatalog';
import { applyEldritchInvocationSelection } from '../characters/eldritchInvocationSelection';
import { applyCompendiumItemToCharacter } from '../compendium/mapper';
import { createEmptyCharacter } from '../data/mockData';
import {
  getEldritchInvocationLimit,
  getEldritchInvocationPrerequisiteIssues,
  getEligibleEldritchInvocations,
  getLevelAvailableEldritchInvocations,
  getSelectableEldritchInvocations,
  getSelectedWarlockLevel,
  validateEldritchInvocationSelection
} from '../characters/eldritchInvocationRules';

const source = {
  id: 'warlock-source',
  book: 'Warlock Test',
  version: '2024',
  status: 'active' as const,
  confidence: 'exact' as const
};

const imported = buildPersistedCompendiumImport({
  id: 'warlock-pack',
  source,
  items: [
    {
      id: 'warlock',
      kind: 'class',
      name: 'Warlock',
      source,
      payload: {
        level: 1,
        featureIds: ['eldritch-invocations'],
        progression: [{ level: 1, featureIds: ['eldritch-invocations'] }]
      }
    },
    {
      id: 'eldritch-invocations',
      kind: 'feature',
      name: 'Eldritch Invocations',
      source,
      payload: {
        sourceType: 'classFeature',
        classId: 'warlock',
        invocationsKnownByLevel: [1, 3, 3, 3, 5]
      }
    },
    {
      id: 'pact-blade',
      kind: 'feature',
      name: 'Pact of the Blade',
      summary: 'Creates or binds a pact weapon.',
      source,
      payload: {
        sourceType: 'eldritchInvocation',
        classId: 'warlock',
        levelGained: 1
      }
    },
    {
      id: 'agonizing-blast',
      kind: 'feature',
      name: 'Agonizing Blast',
      summary: 'Adds Charisma to a damaging cantrip.',
      source,
      payload: {
        sourceType: 'eldritchInvocation',
        classId: 'warlock',
        levelGained: 2,
        repeatable: true
      }
    },
    {
      id: 'thirsting-blade',
      kind: 'feature',
      name: 'Thirsting Blade',
      summary: 'Grants an extra pact weapon attack.',
      source,
      payload: {
        sourceType: 'eldritchInvocation',
        classId: 'warlock',
        levelGained: 5,
        prerequisite: 'level 5+, Pact of the Blade'
      }
    }
  ]
});

const item = (id: string) => imported.items.find((entry) => entry.importItemId === id)!;
const classEntries = (level: number) => [{ item: item('warlock'), level }];
const enabled = [source.id];

describe('eldritch invocation rules', () => {
  it('uses the Warlock class level and imported progression table', () => {
    expect(getSelectedWarlockLevel(classEntries(5))).toBe(5);
    expect(getEldritchInvocationLimit(1, classEntries(1), imported.items)).toBe(1);
    expect(getEldritchInvocationLimit(2, classEntries(2), imported.items)).toBe(3);
    expect(getEldritchInvocationLimit(5, classEntries(5), imported.items)).toBe(5);
  });

  it('lists invocation features independently from validation status', () => {
    expect(getSelectableEldritchInvocations(imported.items, enabled).map((entry) => entry.name)).toEqual([
      'Pact of the Blade',
      'Agonizing Blast',
      'Thirsting Blade'
    ]);
  });

  it('enforces level, dependency, repeatability, and exact count', () => {
    const thirsting = item('thirsting-blade');
    expect(getEldritchInvocationPrerequisiteIssues(thirsting, 4, {}, imported.items).map((entry) => entry.code)).toEqual(
      expect.arrayContaining([
        'ELDRITCH_INVOCATION_LEVEL_PREREQUISITE',
        'ELDRITCH_INVOCATION_DEPENDENCY_PREREQUISITE'
      ])
    );

    const valid = validateEldritchInvocationSelection(
      classEntries(2),
      imported.items,
      enabled,
      {
        [item('pact-blade').id]: 1,
        [item('agonizing-blast').id]: 2
      }
    );
    expect(valid).toEqual([]);
  });

  it('does not treat chosen invocations as automatic class progression features', () => {
    expect(isProgressionOwnedFeatureItem(item('pact-blade'), imported.items)).toBe(false);
  });
  it('completes the PHB 2024 catalog and hides invocations above the Warlock level', () => {
    const catalog = withBuiltinEldritchInvocations(imported.items)
      .filter((entry) => entry.normalizedJson.sourceType === 'eldritchInvocation');
    expect(catalog).toHaveLength(28);
    const levelOne = getLevelAvailableEldritchInvocations(imported.items, [...enabled, 'phb-2024'], 1);
    expect(levelOne.map((entry) => entry.name)).toEqual(expect.arrayContaining([
      'Armor of Shadows',
      'Eldritch Mind',
      'Pact of the Blade',
      'Pact of the Chain',
      'Pact of the Tome'
    ]));
    expect(levelOne.some((entry) => entry.name === 'Thirsting Blade')).toBe(false);
    expect(levelOne.some((entry) => entry.name === 'Witch Sight')).toBe(false);
  });


  it('retains legacy-only Tasha Warlock invocations on the 2024 chassis and keeps blocked options visible to the UI', () => {
    const tashaPack = require('../../assets/compendium/tcoe-2020-2024-compatible-import-pack-v2-canonical.json');
    const tashaItems: StoredCompendiumItem[] = tashaPack.items.map((entry: any) => ({
      id: entry.id,
      importItemId: entry.id,
      packId: tashaPack.id,
      sourceId: entry.source.id,
      type: entry.kind,
      name: entry.name,
      summary: entry.summary,
      rawJson: entry,
      normalizedJson: entry.payload,
      tags: entry.payload?.tags ?? [],
      status: 'validated',
      createdAt: '2026-08-12T00:00:00.000Z',
      updatedAt: '2026-08-12T00:00:00.000Z'
    }));
    const enabledSources = ['tcoe-2020', 'phb-2024'];
    const selectableNames = getSelectableEldritchInvocations(tashaItems, enabledSources).map((entry) => entry.name);
    expect(selectableNames).toEqual(expect.arrayContaining([
      'Pact of the Talisman',
      'Eldritch Invocation: Bond of the Talisman',
      'Eldritch Invocation: Far Scribe',
      'Eldritch Invocation: Protection of the Talisman',
      'Eldritch Invocation: Rebuke of the Talisman',
      'Eldritch Invocation: Undying Servitude'
    ]));
    expect(tashaItems.some((entry) => entry.name === 'Eldritch Invocation: Eldritch Mind')).toBe(false);
    expect(tashaItems.some((entry) => entry.name === 'Eldritch Invocation: Gift of the Protectors')).toBe(false);
    expect(tashaItems.some((entry) => entry.name === 'Eldritch Invocation: Investment of the Chain Master')).toBe(false);

    const pact = tashaItems.find((entry) => entry.name === 'Pact of the Talisman')!;
    const rebuke = tashaItems.find((entry) => entry.name === 'Eldritch Invocation: Rebuke of the Talisman')!;
    expect(getEligibleEldritchInvocations(tashaItems, enabledSources, 2, {})).not.toContainEqual(expect.objectContaining({ id: pact.id }));
    expect(getEldritchInvocationPrerequisiteIssues(rebuke, 3, {}, getSelectableEldritchInvocations(tashaItems, enabledSources))).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'ELDRITCH_INVOCATION_DEPENDENCY_PREREQUISITE' })
    ]));
    expect(getEldritchInvocationPrerequisiteIssues(rebuke, 3, { [pact.id]: 1 }, getSelectableEldritchInvocations(tashaItems, enabledSources))).toEqual([]);
  });


  it('hides invocations above the Warlock level but keeps same-level unmet prerequisites visible and disabled', () => {
    const levelTwo = getLevelAvailableEldritchInvocations(imported.items, [...enabled, 'phb-2024'], 2);
    expect(levelTwo.some((entry) => entry.name === 'Thirsting Blade')).toBe(false);
    expect(levelTwo.some((entry) => entry.name === 'Agonizing Blast')).toBe(true);

    const fs = require('fs');
    const path = require('path');
    const files = [
      'app/characters/new.tsx',
      'app/characters/[id]/level-up.tsx',
      'app/characters/[id]/invocations.tsx'
    ];
    for (const relative of files) {
      const sourceText = fs.readFileSync(path.join(process.cwd(), relative), 'utf8');
      expect(sourceText).toContain('getLevelAvailableEldritchInvocations');
      expect(sourceText).toContain('hasPrerequisiteIssues');
    }
  });

  it('recognizes an imported Xanathar legacy invocation once its source is enabled and its level is reached', () => {
    const grasp: StoredCompendiumItem = {
      ...item('agonizing-blast'),
      id: 'xgte:grasp-of-hadar',
      importItemId: 'xgte-2017-feature-warlock-eldritch-invocation-grasp-of-hadar',
      packId: 'xgte-test-pack',
      sourceId: 'xgte-2017',
      name: 'Grasp of Hadar',
      normalizedJson: {
        sourceType: 'eldritchInvocation',
        classId: 'phb-2014-class-warlock',
        levelGained: 2,
        prerequisite: 'eldritch blast cantrip',
        mechanics: {
          prerequisites: { class: 'Warlock', minimumWarlockLevel: 2, spell: 'phb-2014-spell-eldritch-blast' },
          moveTarget: { feet: 10, direction: 'straightLineCloserToYou' }
        }
      }
    };
    const allItems = [...imported.items, grasp];
    const enabledSources = [...enabled, 'phb-2024', 'xgte-2017'];
    expect(getLevelAvailableEldritchInvocations(allItems, enabledSources, 1).some((entry) => entry.name === 'Grasp of Hadar')).toBe(false);
    expect(getLevelAvailableEldritchInvocations(allItems, enabledSources, 2).some((entry) => entry.name === 'Grasp of Hadar')).toBe(true);
  });

  it('replaces the invocation feature entities while preserving the selected counts', () => {
    const classResult = applyCompendiumItemToCharacter(createEmptyCharacter('Warlock'), item('warlock'));
    expect(classResult.ok).toBe(true);
    const pactBlade = item('pact-blade');
    const first = applyEldritchInvocationSelection(
      classResult.character,
      { [pactBlade.id]: 1 },
      imported.items
    );
    expect(first.character.features.some((feature) => feature.name === 'Pact of the Blade')).toBe(true);
    const armorOfShadows = withBuiltinEldritchInvocations(imported.items).find((entry) => entry.name === 'Armor of Shadows')!;
    const second = applyEldritchInvocationSelection(
      first.character,
      { [armorOfShadows.id]: 1 },
      imported.items
    );
    expect(second.character.features.some((feature) => feature.name === 'Pact of the Blade')).toBe(false);
    expect(second.character.features.some((feature) => feature.name === 'Armor of Shadows')).toBe(true);
    expect(second.character.buildChoices?.eldritchInvocationCounts).toEqual({ [armorOfShadows.id]: 1 });
  });

});
