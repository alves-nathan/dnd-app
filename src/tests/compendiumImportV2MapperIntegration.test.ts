import { applyCompendiumItemToCharacter } from '../compendium/mapper';
import type { CompendiumImportUpsertOperation } from '../compendium/importUpsertPlan';
import { createEmptyCharacter } from '../data/mockData';
import { buildStoredCompendiumV2Item } from '../storage/compendiumV2Persistence';

const source = {
  id: 'phb-2024',
  book: 'Player Handbook',
  version: '2024',
  status: 'active' as const,
  confidence: 'exact' as const,
  rulesEra: '2024' as const,
  contentType: 'official' as const
};

describe('Compendium Import V2 mapper integration', () => {
  it('maps a V2-persisted spell through the existing character mapper without an adapter fork', () => {
    const operation: CompendiumImportUpsertOperation = {
      kind: 'create',
      itemId: 'phb-2024-spell-fire-bolt',
      contentHash: 'cmpv2_mapper',
      item: {
        id: 'phb-2024-spell-fire-bolt',
        kind: 'spell',
        name: 'Fire Bolt',
        source,
        payload: {
          level: 0,
          school: 'Evocation',
          classes: ['Wizard'],
          castingTime: { kind: 'action', actionCost: 'action' },
          range: '120 feet',
          duration: 'Instantaneous',
          damageFormula: '1d10',
          damageType: 'fire'
        }
      },
      changedPaths: []
    };
    const stored = buildStoredCompendiumV2Item(operation, 'phb-2024-pack', '2026-08-10T23:00:00.000Z');
    const character = createEmptyCharacter('V2 mapper');
    const mapped = applyCompendiumItemToCharacter(character, stored);

    expect(mapped.ok).toBe(true);
    expect(mapped.character.spells.some((spell) => spell.name === 'Fire Bolt')).toBe(true);
    expect(mapped.link?.itemId).toBe(stored.id);
    expect(mapped.link?.importItemId).toBe('phb-2024-spell-fire-bolt');
  });


  it('materializes canonical proficiency-bonus and ability-modifier resource scaling on imported features', () => {
    const character = {
      ...createEmptyCharacter('Scaled resources'),
      level: 9,
      abilities: { STR: 10, DEX: 10, CON: 10, INT: 18, WIS: 10, CHA: 10 }
    };
    const operations: CompendiumImportUpsertOperation[] = [
      {
        kind: 'create',
        itemId: 'feature-pb-resource',
        contentHash: 'cmpv2_resource_pb',
        item: {
          id: 'feature-pb-resource',
          kind: 'feature',
          name: 'PB Resource',
          source,
          payload: {
            sourceType: 'classFeature',
            resource: { id: 'pb-resource', max: { kind: 'proficiencyBonus' }, recharge: 'longRest' }
          }
        },
        changedPaths: []
      },
      {
        kind: 'create',
        itemId: 'feature-int-resource',
        contentHash: 'cmpv2_resource_int',
        item: {
          id: 'feature-int-resource',
          kind: 'feature',
          name: 'INT Resource',
          source,
          payload: {
            sourceType: 'classFeature',
            resource: {
              id: 'int-resource',
              max: { kind: 'abilityModifier', ability: 'INT', formula: 'max(1, INT modifier)', minimum: 1 },
              recharge: 'longRest'
            }
          }
        },
        changedPaths: []
      }
    ];

    const pbStored = buildStoredCompendiumV2Item(operations[0], 'resource-pack', '2026-08-11T20:00:00.000Z');
    const intStored = buildStoredCompendiumV2Item(operations[1], 'resource-pack', '2026-08-11T20:00:00.000Z');
    const afterPb = applyCompendiumItemToCharacter(character, pbStored);
    const afterInt = applyCompendiumItemToCharacter(afterPb.character, intStored);

    expect(afterPb.character.resources.find((entry) => entry.id === 'pb-resource')?.max).toBe(4);
    expect(afterInt.character.resources.find((entry) => entry.id === 'int-resource')?.max).toBe(4);
  });

});
