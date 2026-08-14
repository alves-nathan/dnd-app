import { buildPersistedCompendiumImport } from '../compendium/importer';
import { buildNormalizedJsonFromMappingDraft, createMappingDraftFromItem } from '../compendium/mappingEditor';
import type { CompendiumImportInput } from '../compendium/schemas';
import { KeyValueCompendiumRepository } from '../storage/compendiumRepository';
import { createMemoryKeyValueStorage } from '../storage/keyValueStorage';

const source = { id: 'mapping-source', book: 'Fonte autoral', page: '1', version: '2024', status: 'active' as const, confidence: 'manual' as const };

const input: CompendiumImportInput = {
  id: 'mapping-pack',
  source,
  items: [
    {
      id: 'mapping-weapon',
      kind: 'weapon',
      name: 'Arma mapeável',
      source,
      payload: { damageFormula: '1d6 + STR' }
    }
  ]
};

describe('visual compendium mapping editor', () => {
  it('creates a draft from the current normalized payload and rebuilds damage components', () => {
    const item = buildPersistedCompendiumImport(input).items[0]!;
    const draft = createMappingDraftFromItem(item);
    draft.values.damageFormula = '1d8 + STR';
    draft.values.weaponType = 'melee';
    draft.values.attackAbility = 'STR';

    const result = buildNormalizedJsonFromMappingDraft(item, draft);

    expect(result.issues.filter((issue) => issue.severity === 'error')).toHaveLength(0);
    expect(result.normalizedJson.damageFormula).toBe('1d8 + STR');
    expect(Array.isArray(result.normalizedJson.damageComponents)).toBe(true);
  });

  it('reports required-field errors before mapping can be validated', () => {
    const item = buildPersistedCompendiumImport(input).items[0]!;
    const draft = createMappingDraftFromItem(item);
    draft.values.weaponType = '';

    const result = buildNormalizedJsonFromMappingDraft(item, draft);

    expect(result.issues.some((issue) => issue.code === 'MAPPING_REQUIRED_WEAPONTYPE')).toBe(true);
  });

  it('persists normalized mapping through the repository abstraction', async () => {
    const repository = new KeyValueCompendiumRepository(createMemoryKeyValueStorage());
    const saved = await repository.saveImportJson(JSON.stringify(input));
    const item = saved.imported!.items[0]!;

    const snapshot = await repository.updateItemMapping(item.id, {
      normalizedJson: { ...item.normalizedJson, weaponType: 'melee', damageFormula: '1d10 + STR' },
      status: 'validated',
      reviewDecision: 'approved',
      reviewNotes: 'Mapeado visualmente.'
    });

    const mapped = snapshot.items.find((entry) => entry.id === item.id);
    expect(mapped?.status).toBe('validated');
    expect(mapped?.normalizedJson.weaponType).toBe('melee');
    expect(mapped?.reviewNotes).toContain('Mapeado');
  });
});
