import type { StoredCompendiumItem } from '../compendium/types';
import { getClassProficiencyRequirement } from '../characters/proficiencyRules';
import { getCompendiumClassReference } from '../compendium/classProgression';
import { getFeatCategory, getFeatMinimumLevel } from '../characters/characterBuildRules';
import { backgroundSuggestions } from '../characters/creationData';
import { isPlayerCharacterClassItem } from '../characters/classSelectionRules';
import {
  getSpeciesChoiceRequirements,
  getSpeciesFeatChoiceRequirement,
  getSpeciesChoiceProficiencyGrants,
  setSpeciesChoiceOption,
  setSpeciesChoiceSkill,
  validateSpeciesChoices
} from '../characters/speciesChoiceRules';
import { getBackgroundChoiceRequirements } from '../characters/backgroundChoiceRules';
import { emptyFeatChoice, getFeatChoiceSchema, isSpellItemEligibleForGenericFeatChoice, validateFeatChoice } from '../characters/featChoiceRules';

const toStoredItems = (pack: any, packId: string): StoredCompendiumItem[] => pack.items.map((item: any) => ({
  id: item.id,
  importItemId: item.id,
  packId,
  sourceId: item.source?.id ?? 'unknown',
  type: item.kind,
  name: item.name,
  summary: item.summary,
  rawJson: item,
  normalizedJson: item.payload ?? {},
  tags: item.payload?.tags ?? item.tags ?? [],
  status: 'validated',
  createdAt: '2026-08-12T00:00:00.000Z',
  updatedAt: '2026-08-12T00:00:00.000Z'
}));

const forgePack = require('../../assets/compendium/forge-artificer-2025-full-consolidated-import-pack-v2-canonical.json');
const tashaPack = require('../../assets/compendium/tcoe-2020-2024-compatible-import-pack-v2-canonical.json');
const phbPack = require('../../assets/compendium/phb-2024-full-consolidated-import-pack-v2-canonical.json');
const spelljammerPack = require('../../assets/compendium/spelljammer-2022-2024-compatible-import-pack-v2-canonical.json');
const phb2014Pack = require('../../assets/compendium/phb-2014-2024-compatible-delta-v2-canonical.json');
const forgeItems = toStoredItems(forgePack, 'forge');
const tashaItems = toStoredItems(tashaPack, 'tasha');
const phbItems = toStoredItems(phbPack, 'phb');
const spelljammerItems = toStoredItems(spelljammerPack, 'spelljammer');
const phb2014Items = toStoredItems(phb2014Pack, 'phb2014');
const allItems = [...phbItems, ...forgeItems, ...tashaItems];
const proficiencyAuditItems = [...allItems, ...spelljammerItems, ...phb2014Items];

const item = (items: StoredCompendiumItem[], id: string): StoredCompendiumItem => {
  const found = items.find((entry) => entry.id === id);
  if (!found) throw new Error(`Missing ${id}`);
  return found;
};

describe('character creation direct-choice coverage', () => {
  it('uses imported Artificer skill and tool choices instead of PHB-only hardcoded counts', () => {
    const artificer = item(forgeItems, 'forge-artificer-2025-class-artificer');
    const requirement = getClassProficiencyRequirement(artificer, 1, allItems);

    expect(requirement.skillChoiceCount).toBe(2);
    expect(requirement.skillOptions).toEqual(expect.arrayContaining([
      'Arcana', 'History', 'Investigation', 'Medicine', 'Nature', 'Perception', 'Sleight of Hand'
    ]));
    expect(requirement.fixedTools).toEqual(expect.arrayContaining(["Thieves' Tools", "Tinker's Tools"]));
    expect(requirement.toolChoiceCount).toBe(1);
    expect(requirement.toolOptions.length).toBeGreaterThan(5);
    expect(requirement.toolOptions).toEqual(expect.arrayContaining(["Smith's Tools", "Carpenter's Tools"]));
  });

  it('keeps every selectable class/background combination able to satisfy class skill choices', () => {
    const selectableClasses = proficiencyAuditItems.filter(isPlayerCharacterClassItem);
    const availableBackgrounds = proficiencyAuditItems.filter((entry) => entry.type === 'background');

    expect(selectableClasses.length).toBeGreaterThan(10);
    expect(availableBackgrounds.length).toBeGreaterThan(10);

    for (const classItem of selectableClasses) {
      const requirement = getClassProficiencyRequirement(classItem, 1, proficiencyAuditItems);
      for (const background of availableBackgrounds) {
        const grantedSkills = new Set(backgroundSuggestions(background).proficiencies.skills);
        const remainingClassOptions = requirement.skillOptions.filter((skill) => !grantedSkills.has(skill));
        expect({
          className: classItem.name,
          backgroundName: background.name,
          remaining: remainingClassOptions.length,
          required: requirement.skillChoiceCount
        }).toEqual(expect.objectContaining({
          remaining: expect.any(Number),
          required: expect.any(Number)
        }));
        expect(remainingClassOptions.length).toBeGreaterThanOrEqual(requirement.skillChoiceCount);
      }
    }
  });

  it('keeps every bundled legacy subclass on a current base-class proficiency chassis', () => {
    const legacySubclasses = [...tashaItems, ...phb2014Items].filter((entry) => entry.type === 'subclass');
    expect(legacySubclasses.length).toBeGreaterThan(20);

    for (const subclass of legacySubclasses) {
      const classReference = getCompendiumClassReference(subclass);
      const baseClass = proficiencyAuditItems.find((entry) =>
        entry.type === 'class' && entry.importItemId === classReference
      );
      expect(classReference).toMatch(/^phb-2024-class-/);
      expect(baseClass).toBeTruthy();
      const requirement = getClassProficiencyRequirement(baseClass!, 3, proficiencyAuditItems);
      expect(requirement.skillOptions.length).toBeGreaterThanOrEqual(requirement.skillChoiceCount);
      expect(requirement.savingThrows.length).toBeGreaterThan(0);
    }

    const bladesinging = item(tashaItems, 'tcoe-2020-subclass-bladesinging');
    const wizard = phbItems.find((entry) => entry.importItemId === getCompendiumClassReference(bladesinging));
    const wizardRequirement = getClassProficiencyRequirement(wizard!, 3, proficiencyAuditItems);
    expect(wizardRequirement.className).toBe('Wizard');
    expect(wizardRequirement.skillChoiceCount).toBe(2);
    expect(wizardRequirement.skillOptions).toEqual(expect.arrayContaining(['Arcana', 'History', 'Investigation', 'Medicine']));
    expect(wizardRequirement.savingThrows).toEqual(['INT', 'WIS']);
  });

  it('exposes all direct Custom Lineage choices that affect character creation', () => {
    const lineage = item(tashaItems, 'tcoe-2020-species-custom-lineage');
    const requirements = getSpeciesChoiceRequirements(lineage, allItems, 1);
    const size = requirements.find((entry) => entry.kind === 'size');
    const variable = requirements.find((entry) => entry.kind === 'variableTrait');
    const language = requirements.find((entry) => entry.kind === 'language');

    expect(size?.options.map((entry) => entry.id)).toEqual(['Small', 'Medium']);
    expect(variable?.options.map((entry) => entry.id)).toEqual(['darkvision', 'skill-proficiency']);
    expect(language?.options.length).toBeGreaterThan(5);
    expect(getSpeciesFeatChoiceRequirement(lineage)).toEqual(expect.objectContaining({ count: 1, mustQualify: true, acquisitionLevel: 1 }));

    let choices = setSpeciesChoiceOption([], variable!, 'skill-proficiency');
    expect(validateSpeciesChoices(requirements.filter((entry) => entry.kind === 'variableTrait'), choices)).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'SPECIES_SKILL_REQUIRED' })
    ]));
    choices = setSpeciesChoiceSkill(choices, variable!, 'Arcana');
    choices = setSpeciesChoiceOption(choices, language!, 'Elvish');
    expect(validateSpeciesChoices(requirements.filter((entry) => entry.kind === 'variableTrait'), choices)).toEqual([]);
    expect(getSpeciesChoiceProficiencyGrants(requirements, choices)).toEqual(expect.objectContaining({
      skills: ['Arcana'],
      languages: ['Elvish']
    }));
  });


  it('keeps Custom Lineage level-1 feat choice from admitting Epic Boons or later-level feats', () => {
    const lineage = item(tashaItems, 'tcoe-2020-species-custom-lineage');
    const requirement = getSpeciesFeatChoiceRequirement(lineage)!;
    const epicBoons = phbItems.filter((entry) => entry.type === 'feat' && getFeatCategory(entry) === 'epicBoon');
    expect(requirement.acquisitionLevel).toBe(1);
    expect(epicBoons.length).toBeGreaterThan(0);
    expect(epicBoons.every((feat) => getFeatMinimumLevel(feat) > requirement.acquisitionLevel)).toBe(true);

    const creationSource = require('fs').readFileSync(require('path').join(process.cwd(), 'app/characters/new.tsx'), 'utf8');
    expect(creationSource).toContain("getFeatCategory(item) !== 'epicBoon'");
    expect(creationSource).toContain('getFeatMinimumLevel(item) <= speciesFeatRequirement.acquisitionLevel');
    expect(creationSource).toContain('items={speciesFeatCandidates}');
  });

  it('covers every imported species with more than one direct size option', () => {
    for (const species of allItems.filter((entry) => entry.type === 'species')) {
      const payload = species.normalizedJson as Record<string, unknown>;
      const sizes = Array.isArray(payload.sizeOptions) ? payload.sizeOptions.filter((entry): entry is string => typeof entry === 'string') : [];
      if (sizes.length <= 1) continue;
      const requirement = getSpeciesChoiceRequirements(species, allItems, 20).find((entry) => entry.kind === 'size');
      expect(requirement?.options.map((entry) => entry.id)).toEqual(sizes);
    }
  });

  it('exposes House Agent dragonmarked-house affiliation as a direct background choice', () => {
    const houseAgent = item(forgeItems, 'forge-artificer-2025-background-house-agent');
    const requirements = getBackgroundChoiceRequirements(houseAgent);
    expect(requirements).toEqual([
      expect.objectContaining({
        choiceType: 'dragonmarkedHouse',
        options: expect.arrayContaining(['House Cannith', 'House Deneith', 'House Lyrandar'])
      })
    ]);
  });


  it('treats a single imported spell list as fixed for Artificer Initiate and Aberrant Dragonmark', () => {
    const artificerInitiate = item(tashaItems, 'tcoe-2020-feat-artificer-initiate');
    const artificerSchema = getFeatChoiceSchema(artificerInitiate);
    expect(artificerSchema.spellListOptions).toEqual(['Artificer']);
    expect(artificerSchema.fixedSpellcastingAbility).toBe('INT');

    const artificerCantrip = allItems.find((entry) => entry.type === 'spell' && (entry.normalizedJson as any).level === 0 && Array.isArray((entry.normalizedJson as any).classes) && (entry.normalizedJson as any).classes.includes('Artificer'));
    const artificerLevelOne = allItems.find((entry) => entry.type === 'spell' && (entry.normalizedJson as any).level === 1 && Array.isArray((entry.normalizedJson as any).classes) && (entry.normalizedJson as any).classes.includes('Artificer'));
    expect(artificerCantrip).toBeTruthy();
    expect(artificerLevelOne).toBeTruthy();
    const artificerChoice = {
      ...emptyFeatChoice(artificerInitiate.id),
      tools: ["Smith's Tools"],
      spellItemIds: [artificerCantrip!.id, artificerLevelOne!.id]
    };
    expect(validateFeatChoice(artificerInitiate, artificerChoice, { STR: 10, DEX: 10, CON: 10, INT: 16, WIS: 10, CHA: 10 }, allItems)).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'FEAT_SPELL_LIST_REQUIRED' })
    ]));

    const aberrant = item(forgeItems, 'forge-artificer-2025-feat-aberrant-dragonmark');
    const aberrantSchema = getFeatChoiceSchema(aberrant);
    expect(aberrantSchema.spellListOptions).toEqual(['Sorcerer']);
    expect(aberrantSchema.fixedSpellcastingAbility).toBe('CON');
  });


  it('supports all four imported feat subchoice families with structured editors', () => {
    const phb2014Pack = require('../../assets/compendium/phb-2014-2024-compatible-delta-v2-canonical.json');
    const phb2014Items = toStoredItems(phb2014Pack, 'phb2014');
    const choicesItems = [...allItems, ...phb2014Items];
    const abilities = { STR: 10, DEX: 10, CON: 10, INT: 10, WIS: 10, CHA: 10 } as const;

    const eldritchAdept = item(choicesItems, 'tcoe-2020-feat-eldritch-adept');
    const eldritchSchema = getFeatChoiceSchema(eldritchAdept);
    expect(eldritchSchema.kinds).toContain('eldritchInvocation');
    expect(eldritchSchema.eldritchInvocationChoiceCount).toBe(1);
    expect(eldritchSchema.spellcastingAbilityOptions).toEqual(['INT', 'WIS', 'CHA']);
    expect(eldritchSchema.unsupportedChoiceTypes).toEqual([]);
    expect(validateFeatChoice(eldritchAdept, undefined, abilities, choicesItems)).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'FEAT_CHOICE_REQUIRED' })
    ]));

    const fightingInitiate = item(choicesItems, 'tcoe-2020-feat-fighting-initiate');
    const fightingSchema = getFeatChoiceSchema(fightingInitiate);
    expect(fightingSchema.kinds).toContain('fightingStyle');
    expect(fightingSchema.fightingStyleChoiceCount).toBe(1);
    expect(fightingSchema.unsupportedChoiceTypes).toEqual([]);
    expect(validateFeatChoice(fightingInitiate, undefined, abilities, choicesItems)).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'FEAT_CHOICE_REQUIRED' })
    ]));

    const metamagicAdept = item(choicesItems, 'tcoe-2020-feat-metamagic-adept');
    const metamagicSchema = getFeatChoiceSchema(metamagicAdept);
    expect(metamagicSchema.kinds).toContain('metamagic');
    expect(metamagicSchema.metamagicChoiceCount).toBe(2);
    expect(metamagicSchema.unsupportedChoiceTypes).toEqual([]);
    expect(validateFeatChoice(metamagicAdept, undefined, abilities, choicesItems)).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'FEAT_CHOICE_REQUIRED' })
    ]));

    const martialAdept = item(choicesItems, 'phb-2014-feat-martial-adept');
    const maneuverSchema = getFeatChoiceSchema(martialAdept);
    expect(maneuverSchema.kinds).toContain('maneuver');
    expect(maneuverSchema.maneuverChoiceCount).toBe(2);
    expect(maneuverSchema.unsupportedChoiceTypes).toEqual([]);
    expect(validateFeatChoice(martialAdept, undefined, abilities, choicesItems)).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'FEAT_CHOICE_REQUIRED' })
    ]));
  });

  it('recognizes the direct Boon of Siberys spell choice instead of dropping it', () => {
    const boon = item(forgeItems, 'forge-artificer-2025-feat-boon-of-siberys');
    const schema = getFeatChoiceSchema(boon);
    expect(schema.genericSpellChoiceCount).toBe(1);
    expect(schema.genericSpellMaximumLevel).toBe(8);
    expect(schema.genericSpellSourceLists).toContain('Sorcerer');
    expect(schema.spellcastingAbilityOptions).toEqual(['INT', 'WIS', 'CHA']);

    const teleport = item(phbItems, 'phb-2024-spell-teleport');
    expect(isSpellItemEligibleForGenericFeatChoice(teleport, schema)).toBe(true);
  });
});
