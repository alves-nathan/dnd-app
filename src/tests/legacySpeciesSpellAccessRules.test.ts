import type { Character, CharacterCompendiumLink, CharacterSpeciesChoice } from '../types';
import type { StoredCompendiumItem } from '../compendium/types';
import { BUNDLED_COMPENDIUM_PACKS } from '../compendium/bundledCompendium';
import { buildPersistedCompendiumImport } from '../compendium/importer';
import { createEmptyCharacter } from '../data/mockData';
import {
  getSpeciesChoiceRequirements,
  getSpeciesGrantedSpellReferences,
  getSpeciesStructuredSpellGrants,
  setSpeciesChoiceOption
} from '../characters/speciesChoiceRules';
import { getSpeciesSpellListReferences } from '../characters/spellListRules';
import { reconcileExternalSpellGrants } from '../characters/externalSpellGrantRules';
import { buildAvailableActionsResult } from '../rules-engine/actions/buildActions';

const bundledItems = BUNDLED_COMPENDIUM_PACKS.flatMap((pack) =>
  buildPersistedCompendiumImport(pack.load() as Parameters<typeof buildPersistedCompendiumImport>[0], {
    importedAt: '2026-08-17T00:00:00.000Z'
  }).items
);

const byImportId = (id: string): StoredCompendiumItem => {
  const item = bundledItems.find((candidate) => candidate.importItemId === id);
  if (!item) throw new Error(`Fixture ausente: ${id}`);
  return item;
};

const fixtureFeature = (
  importItemId: string,
  mechanics: Record<string, unknown>,
  overrides: Record<string, unknown> = {}
): StoredCompendiumItem => {
  const base = bundledItems.find((item) => item.type === 'feature')!;
  return {
    ...base,
    id: `fixture-pack:${importItemId}`,
    importItemId,
    packId: 'fixture-pack',
    sourceId: 'fixture-source',
    type: 'feature',
    name: importItemId,
    status: 'validated',
    normalizedJson: {
      sourceType: 'speciesTrait',
      speciesId: 'fixture-species',
      levelGained: 1,
      mechanics,
      ...overrides
    }
  };
};

const fixtureSpecies = (
  featureIds: string[],
  importItemId = 'fixture-species'
): StoredCompendiumItem => {
  const base = byImportId('phb-2024-species-aasimar');
  return {
    ...base,
    id: `fixture-pack:${importItemId}`,
    importItemId,
    packId: 'fixture-pack',
    sourceId: 'fixture-source',
    name: importItemId,
    status: 'validated',
    normalizedJson: { featureIds }
  };
};

const activeSpeciesCharacter = (
  species: StoredCompendiumItem,
  level: number,
  speciesChoices: CharacterSpeciesChoice[] = [],
  abilities?: Partial<Character['abilities']>
): Character => {
  const base = createEmptyCharacter('Legacy species spells');
  const link: CharacterCompendiumLink = {
    id: 'fixture-species-link',
    characterId: base.id,
    itemId: species.id,
    importItemId: species.importItemId,
    packId: species.packId,
    sourceId: species.sourceId,
    itemType: 'species',
    appliedAs: 'species',
    appliedEntityId: 'fixture-species-entity',
    appliedEntityName: species.name,
    status: 'active',
    addedAt: '2026-08-17T00:00:00.000Z'
  };
  return {
    ...base,
    level,
    abilities: { ...base.abilities, ...abilities },
    species: { id: 'fixture-species-entity', name: species.name, features: [] },
    compendiumLinks: [link],
    buildChoices: { ...base.buildChoices!, speciesChoices }
  };
};

const canonicalRef = (id: string): string => byImportId(id).importItemId;

describe('comprehensive legacy species spell access', () => {
  it('normalizes Wildemount nested Genasi spellId/spells schemas with level gates and free uses', () => {
    const earth = fixtureFeature('fixture-earth-genasi', {
      passWithoutTrace: {
        spellId: canonicalRef('phb-2024-spell-pass-without-trace'),
        spellcastingAbility: 'CON',
        uses: 1,
        recharge: 'longRest',
        materialComponentsRequired: false
      }
    });
    expect(getSpeciesStructuredSpellGrants(earth, 3)).toEqual([
      expect.objectContaining({
        spellReference: canonicalRef('phb-2024-spell-pass-without-trace'),
        spellcastingAbility: 'CON',
        uses: 1,
        recharge: 'longRest',
        ignoreMaterialComponent: true
      })
    ]);

    const fire = fixtureFeature('fixture-fire-genasi', {
      reachToTheBlaze: {
        spellcastingAbility: 'CON',
        spells: [
          { spellId: canonicalRef('phb-2024-spell-produce-flame'), minimumCharacterLevel: 1, usage: 'atWillCantrip' },
          { spellId: canonicalRef('phb-2024-spell-burning-hands'), minimumCharacterLevel: 3, castAtLevel: 1, uses: 1, recharge: 'longRest' }
        ]
      }
    });
    expect(getSpeciesStructuredSpellGrants(fire, 1).map((grant) => grant.spellReference)).toEqual([
      canonicalRef('phb-2024-spell-produce-flame')
    ]);
    expect(getSpeciesStructuredSpellGrants(fire, 3)).toEqual(expect.arrayContaining([
      expect.objectContaining({ spellReference: canonicalRef('phb-2024-spell-produce-flame'), atWill: true }),
      expect.objectContaining({ spellReference: canonicalRef('phb-2024-spell-burning-hands'), uses: 1, castAtSpellLevel: 1 })
    ]));
  });

  it('reconciles a selected Wildemount-style Genasi option feature instead of only the subrace marker', () => {
    const earth = fixtureFeature('fixture-earth-option', {
      optionType: 'genasiSubrace',
      name: 'Earth',
      passWithoutTrace: {
        spellId: canonicalRef('phb-2024-spell-pass-without-trace'),
        spellcastingAbility: 'CON',
        uses: 1,
        recharge: 'longRest'
      }
    });
    const marker = fixtureFeature('fixture-genasi-choice', {
      chooseExactly: 1,
      choiceType: 'subrace',
      optionFeatureIds: [earth.importItemId]
    });
    const species = fixtureSpecies([marker.importItemId]);
    const items = [...bundledItems, marker, earth, species];
    const requirement = getSpeciesChoiceRequirements(species, items, 3).find((entry) => entry.kind === 'subrace')!;
    const choices = setSpeciesChoiceOption([], requirement, earth.importItemId);
    const result = reconcileExternalSpellGrants(activeSpeciesCharacter(species, 3, choices), items).character;
    const pass = result.spells.find((spell) => spell.name === 'Pass without Trace');
    expect(pass).toMatchObject({ spellcastingAbility: 'CON', externalSpellGrantOnly: true });
    expect(pass?.freeCastGrants).toHaveLength(1);
  });

  it('normalizes EEPC spellRefs with levelGranted and per-spell free casts', () => {
    const fire = fixtureFeature('fixture-eepc-fire', {
      spellRefs: [canonicalRef('phb-2024-spell-produce-flame'), canonicalRef('phb-2024-spell-burning-hands')],
      levelGranted: {
        [canonicalRef('phb-2024-spell-produce-flame')]: 1,
        [canonicalRef('phb-2024-spell-burning-hands')]: 3
      },
      freeCasts: { [canonicalRef('phb-2024-spell-burning-hands')]: 1 },
      recharge: 'longRest',
      spellcastingAbility: 'CON'
    });
    expect(getSpeciesStructuredSpellGrants(fire, 1)).toEqual([
      expect.objectContaining({ spellReference: canonicalRef('phb-2024-spell-produce-flame'), minimumCharacterLevel: 1 })
    ]);
    expect(getSpeciesStructuredSpellGrants(fire, 3)).toEqual(expect.arrayContaining([
      expect.objectContaining({ spellReference: canonicalRef('phb-2024-spell-burning-hands'), uses: 1, spellcastingAbility: 'CON' })
    ]));
  });

  it('supports Ebon-style shared free-cast pools and material-only component overrides', () => {
    const naturalDiviner = fixtureFeature('fixture-natural-diviner', {
      spellRefs: [
        canonicalRef('phb-2024-spell-guidance'),
        canonicalRef('phb-2024-spell-identify'),
        canonicalRef('phb-2024-spell-augury')
      ],
      levelGranted: {
        [canonicalRef('phb-2024-spell-guidance')]: 1,
        [canonicalRef('phb-2024-spell-identify')]: 3,
        [canonicalRef('phb-2024-spell-augury')]: 5
      },
      componentOverrides: {
        [canonicalRef('phb-2024-spell-identify')]: { materialRequired: false }
      },
      sharedNonCantripFreeCasts: 1,
      recharge: 'longRest',
      spellcastingAbility: 'WIS'
    });
    const species = fixtureSpecies([naturalDiviner.importItemId], 'fixture-wyrd-gnome');
    const items = [...bundledItems, naturalDiviner, species];
    const result = reconcileExternalSpellGrants(activeSpeciesCharacter(species, 5), items).character;
    const identify = result.spells.find((spell) => spell.name === 'Identify')!;
    const augury = result.spells.find((spell) => spell.name === 'Augury')!;
    expect(identify.freeCastGrants?.[0]?.resourceId).toBe(augury.freeCastGrants?.[0]?.resourceId);
    expect(identify.freeCastGrants?.[0]?.ignoreMaterialComponent).toBe(true);
    expect(result.resources.filter((resource) => resource.id.includes('shared-non-cantrip'))).toHaveLength(1);

    const identifyFree = buildAvailableActionsResult(result).actions.find((action) =>
      action.type === 'spell' && action.name.includes('Identify') && action.tags?.includes('free-cast')
    );
    expect(identifyFree && identifyFree.type === 'spell' ? identifyFree.components?.material : undefined).toBe(false);
  });

  it('applies feature-wide material-component overrides to grantedSpells, including at-will casting', () => {
    const blessing = fixtureFeature('fixture-pallid-blessing', {
      spellcastingAbility: 'WIS',
      materialComponentsRequired: false,
      grantedSpells: [
        {
          spellId: canonicalRef('phb-2024-spell-light'),
          minimumCharacterLevel: 1,
          usage: 'atWillCantrip'
        },
        {
          spellId: canonicalRef('phb-2024-spell-invisibility'),
          minimumCharacterLevel: 5,
          uses: 1,
          recharge: 'longRest',
          targetRestriction: 'selfOnly'
        }
      ]
    });
    const grants = getSpeciesStructuredSpellGrants(blessing, 5);
    expect(grants).toEqual(expect.arrayContaining([
      expect.objectContaining({
        spellReference: canonicalRef('phb-2024-spell-light'),
        atWill: true,
        ignoreMaterialComponent: true
      }),
      expect.objectContaining({
        spellReference: canonicalRef('phb-2024-spell-invisibility'),
        ignoreMaterialComponent: true,
        notes: expect.arrayContaining([expect.stringContaining('selfOnly')])
      })
    ]));

    const species = fixtureSpecies([blessing.importItemId], 'fixture-pallid-elf');
    const items = [...bundledItems, blessing, species];
    const result = reconcileExternalSpellGrants(activeSpeciesCharacter(species, 5), items).character;
    const light = result.spells.find((spell) => spell.name === 'Light')!;
    const invisibility = result.spells.find((spell) => spell.name === 'Invisibility')!;
    expect(light.externalSpellGrantSources?.[0]?.ignoreMaterialComponent).toBe(true);
    expect(invisibility.freeCastGrants?.[0]?.ignoreMaterialComponent).toBe(true);

    const actions = buildAvailableActionsResult(result).actions;
    const lightAtWill = actions.find((action) =>
      action.type === 'spell' && action.name.includes('Light') && action.tags?.includes('at-will')
    );
    const invisibilityFree = actions.find((action) =>
      action.type === 'spell' && action.name.includes('Invisibility') && action.tags?.includes('free-cast')
    );
    expect(lightAtWill && lightAtWill.type === 'spell' ? lightAtWill.components?.material : undefined).toBe(false);
    expect(invisibilityFree && invisibilityFree.type === 'spell' ? invisibilityFree.components?.material : undefined).toBe(false);
    expect(invisibilityFree?.ruleNotes?.join(' ')).toContain('selfOnly');
  });

  it('supports per-spell componentOverride and preserves Duergar-style casting restrictions', () => {
    const duergarMagic = fixtureFeature('fixture-duergar-magic', {
      spellcastingAbility: 'INT',
      grantedSpells: [
        {
          spellId: canonicalRef('phb-2024-spell-enlarge-reduce'),
          minimumCharacterLevel: 3,
          targetRestriction: 'self',
          optionRestriction: 'enlarge only',
          usage: 'once',
          uses: 1,
          recharge: 'longRest',
          componentOverride: { material: false }
        }
      ],
      castingRestriction: {
        cannotCastWhile: 'in direct sunlight',
        existingSpellUnaffectedAfterCast: true
      },
      note: 'The source waives material components only.'
    });
    const grant = getSpeciesStructuredSpellGrants(duergarMagic, 3)[0]!;
    expect(grant).toMatchObject({
      spellReference: canonicalRef('phb-2024-spell-enlarge-reduce'),
      spellcastingAbility: 'INT',
      uses: 1,
      ignoreMaterialComponent: true
    });
    expect(grant.notes?.join(' ')).toEqual(expect.stringContaining('direct sunlight'));
    expect(grant.notes?.join(' ')).toEqual(expect.stringContaining('enlarge only'));
    expect(grant.notes?.join(' ')).toEqual(expect.stringContaining('Restrição de alvo'));

    const species = fixtureSpecies([duergarMagic.importItemId], 'fixture-duergar');
    const items = [...bundledItems, duergarMagic, species];
    const result = reconcileExternalSpellGrants(activeSpeciesCharacter(species, 3), items).character;
    const freeCast = buildAvailableActionsResult(result).actions.find((action) =>
      action.type === 'spell' && action.name.includes('Enlarge/Reduce') && action.tags?.includes('free-cast')
    );
    expect(freeCast && freeCast.type === 'spell' ? freeCast.components?.material : undefined).toBe(false);
    expect(freeCast?.ruleNotes?.join(' ')).toEqual(expect.stringContaining('direct sunlight'));
    expect(freeCast?.ruleNotes?.join(' ')).toEqual(expect.stringContaining('enlarge only'));
  });

  it('supports ability-modifier use formulas and preserves source restrictions as rule notes', () => {
    const pathOfShadows = fixtureFeature('fixture-path-of-shadows', {
      spellRefs: [canonicalRef('phb-2024-spell-misty-step')],
      spellcastingAbility: 'CHA',
      usesFormula: 'max(1, CHA.modifier)',
      recharge: 'longRest',
      environment: ['darkness', 'dimLight']
    });
    const species = fixtureSpecies([pathOfShadows.importItemId], 'fixture-shadow-fey');
    const items = [...bundledItems, pathOfShadows, species];
    const result = reconcileExternalSpellGrants(activeSpeciesCharacter(species, 3, [], { CHA: 16 }), items).character;
    const misty = result.spells.find((spell) => spell.name === 'Misty Step')!;
    expect(result.resources.find((resource) => resource.id.includes('species_free_cast'))?.max).toBe(3);
    expect(misty.externalSpellGrantSources?.[0]?.ruleNotes?.join(' ')).toContain('darkness');
  });

  it('creates a no-slot at-will action for levelled species magic without inventing a resource', () => {
    const glamour = fixtureFeature('fixture-shadow-glamour', {
      spellRefs: [canonicalRef('phb-2024-spell-disguise-self')],
      atWill: true,
      spellcastingAbility: 'noneSpecified'
    });
    const species = fixtureSpecies([glamour.importItemId], 'fixture-changeling');
    const items = [...bundledItems, glamour, species];
    const result = reconcileExternalSpellGrants(activeSpeciesCharacter(species, 1), items).character;
    const disguise = result.spells.find((spell) => spell.name === 'Disguise Self')!;
    expect(disguise.freeCastGrants ?? []).toHaveLength(0);
    expect(result.resources.filter((resource) => resource.id.includes('species_free_cast'))).toHaveLength(0);
    const actions = buildAvailableActionsResult(result).actions.filter((action) => action.type === 'spell' && action.name.includes('Disguise Self'));
    expect(actions).toHaveLength(1);
    expect(actions[0]).toMatchObject({ type: 'spell', consumesSpellSlot: false });
    expect(actions[0]?.tags).toContain('at-will');
  });

  it('keeps Eberron-style Spells of the Mark as class-list expansion instead of automatic grants', () => {
    const mark = fixtureFeature('fixture-mark-magic', {
      grantedSpells: [
        { spellId: canonicalRef('phb-2024-spell-light'), minimumCharacterLevel: 1, atWill: true }
      ],
      spellListExpansionCondition: 'hasSpellcastingOrPactMagic',
      spellTable: {
        '1': [canonicalRef('phb-2024-spell-shield')],
        '2': [canonicalRef('phb-2024-spell-misty-step')]
      }
    });
    const species = fixtureSpecies([mark.importItemId], 'fixture-dragonmark');
    const items = [...bundledItems, mark, species];
    const granted = getSpeciesGrantedSpellReferences(species, items, 3, []);
    const expanded = getSpeciesSpellListReferences(species, [], items, 3, 'Wizard', true);
    const nonCasterExpanded = getSpeciesSpellListReferences(species, [], items, 3, 'Barbarian', false);
    expect(granted).toContain(canonicalRef('phb-2024-spell-light'));
    expect(granted).not.toContain(canonicalRef('phb-2024-spell-shield'));
    expect(expanded).toEqual(expect.arrayContaining([
      canonicalRef('phb-2024-spell-shield'),
      canonicalRef('phb-2024-spell-misty-step')
    ]));
    expect(nonCasterExpanded).not.toContain(canonicalRef('phb-2024-spell-shield'));
  });

  it('does not interpret affectedSpells or modifier references as species grants', () => {
    const modifier = fixtureFeature('fixture-modifier-only', {
      affectedSpells: [canonicalRef('phb-2024-spell-mending')],
      spellInteraction: { spellId: canonicalRef('phb-2024-spell-mage-hand') }
    });
    expect(getSpeciesStructuredSpellGrants(modifier, 20)).toHaveLength(0);
  });
});
