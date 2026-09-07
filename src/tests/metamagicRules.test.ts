import { BUNDLED_COMPENDIUM_PACKS } from '../compendium/bundledCompendium';
import { buildPersistedCompendiumImport } from '../compendium/importer';
import { createEmptyCharacter } from '../data/mockData';
import type { Character, SpellAction } from '../types';
import { parseDamageFormula } from '../rules-engine/dice/parser';
import {
  getCharacterMetamagicSources,
  setClassMetamagicOptions
} from '../characters/metamagicRules';
import { buildTurnFeatureActivationOptions } from '../characters/turnFeatureActivationRules';

const items = BUNDLED_COMPENDIUM_PACKS.flatMap((pack) =>
  buildPersistedCompendiumImport(pack.load() as Parameters<typeof buildPersistedCompendiumImport>[0], {
    importedAt: '2026-08-20T00:00:00.000Z'
  }).items
);

const sorcererClass = items.find((item) => item.type === 'class' && item.importItemId === 'phb-2024-class-sorcerer')!;
const metamagicFeature = items.find((item) => item.type === 'feature' && item.importItemId === 'phb-2024-feature-sorcerer-metamagic')!;

const sorcerer = (level: number): Character => {
  const base = createEmptyCharacter(`Sorcerer ${level}`);
  return {
    ...base,
    level,
    classes: [{ id: 'sorcerer-local', name: 'Sorcerer', level, hitDie: 6, source: { id: 'phb-2024', book: 'phb', version: '2024', status: 'active', confidence: 'exact' } }],
    features: [{ id: 'metamagic-local', name: 'Metamagic', sourceType: 'classFeature', source: { id: 'phb-2024', book: 'phb', version: '2024', status: 'active', confidence: 'exact' } }],
    resources: [{ id: 'sorcerer-sorcery-points', name: 'Sorcery Points', max: level, current: level, recharge: 'longRest' }],
    compendiumLinks: [
      {
        id: 'sorcerer-link', characterId: base.id, itemId: sorcererClass.id, importItemId: sorcererClass.importItemId,
        packId: sorcererClass.packId, sourceId: sorcererClass.sourceId, itemType: 'class', appliedAs: 'class',
        appliedEntityId: 'sorcerer-local', appliedEntityName: 'Sorcerer', status: 'active', addedAt: '2026-08-20T00:00:00.000Z'
      },
      {
        id: 'metamagic-link', characterId: base.id, itemId: metamagicFeature.id, importItemId: metamagicFeature.importItemId,
        packId: metamagicFeature.packId, sourceId: metamagicFeature.sourceId, itemType: 'feature', appliedAs: 'feature',
        appliedEntityId: 'metamagic-local', appliedEntityName: 'Metamagic', status: 'active', addedAt: '2026-08-20T00:00:00.000Z'
      }
    ]
  };
};

const testSpell: SpellAction = {
  id: 'test-spell',
  type: 'spell',
  name: 'Test Spell',
  sourceType: 'spell',
  actionCost: 'action',
  spellId: 'test-spell',
  spellLevel: 0,
  range: '60 ft',
  components: { verbal: true, somatic: true, material: false },
  damage: parseDamageFormula('1d8', { defaultSourceType: 'spell' })
};

describe('character Metamagic sources', () => {
  it('uses the Sorcerer progression table for known-option limits', () => {
    expect(getCharacterMetamagicSources(sorcerer(5), items).find((source) => source.kind === 'sorcerer')?.optionLimit).toBe(2);
    expect(getCharacterMetamagicSources(sorcerer(10), items).find((source) => source.kind === 'sorcerer')?.optionLimit).toBe(4);
    expect(getCharacterMetamagicSources(sorcerer(17), items).find((source) => source.kind === 'sorcerer')?.optionLimit).toBe(6);
  });

  it('persists Sorcerer selections separately and exposes only the selected deterministic options in combat', () => {
    const base = sorcerer(5);
    const source = getCharacterMetamagicSources(base, items).find((entry) => entry.kind === 'sorcerer')!;
    const choices = setClassMetamagicOptions([], source, [
      'feat-option-phb2024-metamagic-distant-spell',
      'feat-option-phb2024-metamagic-subtle-spell',
      'feat-option-phb2024-metamagic-quickened-spell'
    ]);
    const configured: Character = { ...base, buildChoices: { ...base.buildChoices!, classMetamagicChoices: choices } };
    const configuredSource = getCharacterMetamagicSources(configured, items).find((entry) => entry.kind === 'sorcerer')!;
    expect(configuredSource.selectedOptionIds).toHaveLength(2);
    expect(configuredSource.selectedOptionIds).toEqual([
      'feat-option-phb2024-metamagic-distant-spell',
      'feat-option-phb2024-metamagic-subtle-spell'
    ]);

    const options = buildTurnFeatureActivationOptions(configured, items, [testSpell]);
    expect(options.map((entry) => entry.name)).toEqual(expect.arrayContaining(['Distant Spell', 'Subtle Spell']));
    expect(options.some((entry) => entry.name.startsWith('Quickened Spell'))).toBe(false);
    expect(options.find((entry) => entry.name.startsWith('Distant Spell'))?.activation.consumes).toEqual([
      expect.objectContaining({ resourceId: 'sorcerer-sorcery-points', amount: 1 })
    ]);
  });

  it('keeps Metamagic Adept selections independent from Sorcerer selections', () => {
    const base = createEmptyCharacter('Feat Caster');
    const featCharacter: Character = {
      ...base,
      featChoices: [{
        id: 'feat-meta-choice', featEntityId: 'feat-meta', featItemId: 'tcoe-2020-feat-metamagic-adept', instanceIndex: 0,
        metamagicOptionIds: [
          'feat-option-phb2024-metamagic-quickened-spell',
          'feat-option-phb2024-metamagic-distant-spell'
        ]
      }],
      resources: [{ id: 'feat_metamagic_feat-meta', name: 'Metamagic Adept Sorcery Points', max: 2, current: 2, recharge: 'longRest' }]
    };
    const source = getCharacterMetamagicSources(featCharacter, items).find((entry) => entry.kind === 'feat')!;
    expect(source.optionLimit).toBe(2);
    expect(source.selectedOptionIds).toEqual([
      'feat-option-phb2024-metamagic-quickened-spell',
      'feat-option-phb2024-metamagic-distant-spell'
    ]);
    const options = buildTurnFeatureActivationOptions(featCharacter, items, [testSpell]);
    expect(options.map((entry) => entry.name)).toEqual(expect.arrayContaining(['Quickened Spell', 'Distant Spell']));
    expect(options.find((entry) => entry.name.startsWith('Quickened Spell'))?.activation.consumes).toEqual([
      expect.objectContaining({ resourceId: 'feat_metamagic_feat-meta', amount: 2 })
    ]);
  });
});
