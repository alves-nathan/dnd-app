import type { StoredCompendiumItem } from '../compendium/types';
import { BUNDLED_COMPENDIUM_PACKS } from '../compendium/bundledCompendium';
import { buildPersistedCompendiumImport } from '../compendium/importer';
import { classifySpellAccessFeature } from '../characters/spellAccessFeatureClassifier';

const allBundledItems = BUNDLED_COMPENDIUM_PACKS.flatMap((pack) =>
  buildPersistedCompendiumImport(pack.load() as Parameters<typeof buildPersistedCompendiumImport>[0], {
    importedAt: '2026-08-15T00:00:00.000Z'
  }).items
);

const findByImportId = (id: string): StoredCompendiumItem => {
  const item = allBundledItems.find((candidate) => candidate.importItemId === id);
  if (!item) throw new Error(`Fixture ausente: ${id}`);
  return item;
};

const signalKinds = (id: string): string[] =>
  classifySpellAccessFeature(findByImportId(id)).map((signal) => signal.kind);

describe('spell access feature classifier completeness', () => {
  it('recognizes explicit granted cantrips and ritual-only grants', () => {
    expect(signalKinds('forge-artificer-2025-feature-artificer-tinkers-magic')).toContain('granted');
    expect(signalKinds('phb-2024-feature-barbarian-path-of-the-wild-heart-animal-speaker')).toContain('ritualGrant');
    expect(signalKinds('phb-2024-feature-barbarian-path-of-the-wild-heart-nature-speaker')).toContain('ritualGrant');
  });

  it('recognizes subclass spellcasting profiles added to non-spellcaster classes', () => {
    expect(signalKinds('phb-2024-feature-fighter-eldritch-knight-spellcasting')).toContain('subclassSpellcasting');
    expect(signalKinds('phb-2024-feature-rogue-arcane-trickster-spellcasting')).toContain('subclassSpellcasting');
  });

  it('recognizes Mystic Arcanum separately from normal Pact Magic spell selection', () => {
    const signals = classifySpellAccessFeature(findByImportId('phb-2024-feature-warlock-mystic-arcanum'));
    expect(signals).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'mysticArcanumChoice',
        details: expect.objectContaining({ arcanumByLevel: { '11': 6, '13': 7, '15': 8, '17': 9 } })
      })
    ]));
  });

  it.each([
    ['phb-2024-feature-wizard-abjurer-abjuration-savant', 'abjuration'],
    ['phb-2024-feature-wizard-diviner-divination-savant', 'divination'],
    ['phb-2024-feature-wizard-evoker-evocation-savant', 'evocation'],
    ['phb-2024-feature-wizard-illusionist-illusion-savant', 'illusion']
  ] as const)('recognizes Wizard Savant spellbook bonus choices: %s', (id: string, school: string) => {
    expect(classifySpellAccessFeature(findByImportId(id))).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'spellbookBonusChoice', school })
    ]));
  });

  it('recognizes Wizard Spell Mastery and Signature Spells as spellbook-special choices', () => {
    expect(signalKinds('phb-2024-feature-wizard-spell-mastery')).toContain('spellbookSpecialChoice');
    expect(signalKinds('phb-2024-feature-wizard-signature-spells')).toContain('spellbookSpecialChoice');
  });

  it.each([
    ['phb-2014-feature-wizard-school-of-necromancy-undead-thralls', 'phb-2024-spell-animate-dead'],
    ['phb-2014-feature-wizard-school-of-transmutation-shapechanger', 'phb-2024-spell-polymorph']
  ] as const)('recognizes legacy spellbook grants: %s', (id: string, spellReference: string) => {
    expect(classifySpellAccessFeature(findByImportId(id))).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'spellbookGrant', spellReferences: [spellReference] })
    ]));
  });

  it('recognizes conditional spell lists and reconciles reviewed PHB 2024 carriers through the runtime bridge', () => {
    expect(signalKinds('phb-2024-feature-druid-circle-of-the-land-circle-of-the-land-spells')).toContain('conditionalList');
    const moonSignals = classifySpellAccessFeature(findByImportId('phb-2024-feature-druid-circle-of-the-moon-circle-of-the-moon-spells'));
    expect(moonSignals).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'alwaysPrepared',
        spellReferences: expect.arrayContaining(['phb-2024-spell-moonbeam', 'phb-2024-spell-mass-cure-wounds']),
        details: expect.objectContaining({ reconciledFrom: 'runtimeCatalogBridge' })
      })
    ]));
    expect(moonSignals.some((signal) => signal.kind === 'catalogReconciliationRequired')).toBe(false);
  });

  it('recognizes all four Genie patron variants in the structured expanded list carrier', () => {
    const signals = classifySpellAccessFeature(findByImportId('tcoe-2020-feature-the-genie-expanded-spell-list'));
    expect(signals).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'expandedList',
        details: expect.objectContaining({
          hasPatronVariantMap: true,
          genieKinds: ['dao', 'djinni', 'efreeti', 'marid']
        })
      })
    ]));
  });
});
