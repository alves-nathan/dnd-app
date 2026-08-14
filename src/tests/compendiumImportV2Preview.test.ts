import fs from 'node:fs';
import path from 'node:path';
import { createImportContentHash } from '../compendium/importContentHash';
import type { CompendiumEntityKind, CompendiumImportSource } from '../compendium/importDomain';
import { buildCompendiumImportV2Preview } from '../compendium/importPreview';
import { parseAndPreviewImportPack } from '../compendium/parseImportPreview';
import { createCompendiumImportV2UpsertPlan } from '../compendium/importUpsertPlan';
import { migrateImportV1ToV2 } from '../compendium/importV1Migration';

const source = {
  id: 'phb-2024',
  book: 'Player Handbook',
  version: '2024',
  status: 'active' as const,
  confidence: 'exact' as const,
  rulesEra: '2024' as const,
  contentType: 'official' as const
};

const spell = (damageFormula = '1d10', sourceOverride: CompendiumImportSource = source) => ({
  id: 'phb-2024-spell-fire-bolt',
  kind: 'spell' as const,
  name: 'Fire Bolt',
  source: sourceOverride,
  payload: {
    level: 0,
    classes: ['Wizard'],
    castingTime: { kind: 'action' as const, actionCost: 'action' as const },
    damageFormula
  }
});

const pack = (items: ReturnType<typeof spell>[]) => ({
  templateVersion: 'dnd-combat-import.v2' as const,
  id: 'preview-pack',
  source,
  items
});

const existingSpell = () => ({
  id: 'stored-pack:phb-2024-spell-fire-bolt',
  importItemId: 'phb-2024-spell-fire-bolt',
  type: 'spell' as const,
  name: 'Fire Bolt',
  sourceId: source.id,
  rawJson: spell()
});

describe('dnd-combat-import.v2 preview/diff', () => {
  it('creates a stable content hash independent of key order and transient metadata', () => {
    expect(createImportContentHash({ a: 1, b: 2, importedAt: 'yesterday' }))
      .toBe(createImportContentHash({ b: 2, a: 1, importedAt: 'today' }));
    expect(createImportContentHash({ payload: { damage: '1d10' } }))
      .not.toBe(createImportContentHash({ payload: { damage: '2d10' } }));
  });

  it('classifies missing ids as creates', () => {
    const preview = buildCompendiumImportV2Preview(pack([spell()]));
    expect(preview.valid).toBe(true);
    expect(preview).toEqual(expect.objectContaining({ itemsFound: 1, creates: 1, updates: 0, unchanged: 0, conflicts: 0 }));
    expect(preview.byKind.spell).toBe(1);
  });

  it('classifies the same canonical content as unchanged even when existing data is V1-shaped', () => {
    const preview = buildCompendiumImportV2Preview(pack([spell()]), [existingSpell()]);
    expect(preview).toEqual(expect.objectContaining({ creates: 0, updates: 0, unchanged: 1, conflicts: 0 }));
    expect(preview.decisions[0].incomingHash).toBe(preview.decisions[0].existingHash);
  });

  it('classifies changed content from the same canonical source as update and reports paths', () => {
    const incoming = pack([spell('2d10')]);
    const preview = buildCompendiumImportV2Preview(incoming, [existingSpell()]);
    expect(preview.updates).toBe(1);
    expect(preview.decisions[0].changedPaths).toContain('payload.damageFormula');

    const plan = createCompendiumImportV2UpsertPlan(incoming, preview);
    expect(plan.executable).toBe(true);
    expect(plan.updates).toHaveLength(1);
    expect(plan.updates[0].existingStorageId).toBe('stored-pack:phb-2024-spell-fire-bolt');
  });

  it('treats source/rules-era identity collisions as conflicts instead of overwriting content', () => {
    const otherSource = { ...source, id: 'legacy-source', version: '2014', rulesEra: 'legacy' as const };
    const preview = buildCompendiumImportV2Preview(pack([spell('1d10', otherSource)]), [existingSpell()]);
    expect(preview.valid).toBe(false);
    expect(preview.conflicts).toBe(1);
    expect(preview.decisions[0].conflictReason).toBe('sourceMismatch');
    expect(preview.errors.some((entry) => entry.code === 'IMPORT_PREVIEW_SOURCE_CONFLICT')).toBe(true);
  });

  it('refuses ambiguous duplicate canonical ids already present in storage', () => {
    const first = existingSpell();
    const preview = buildCompendiumImportV2Preview(pack([spell()]), [first, { ...first, id: 'another-storage-row' }]);
    expect(preview.conflicts).toBe(1);
    expect(preview.decisions[0].conflictReason).toBe('duplicateExistingId');
    expect(createCompendiumImportV2UpsertPlan(pack([spell()]), preview).executable).toBe(false);
  });


  it('keeps an incremental spell pack idempotent when matching class names exist only in another installed pack', () => {
    const existingClass = {
      id: 'stored:class-wizard',
      importItemId: 'phb-2024-class-wizard',
      type: 'class' as const,
      name: 'Wizard',
      sourceId: source.id,
      rawJson: {
        id: 'phb-2024-class-wizard', kind: 'class' as const, name: 'Wizard', source, payload: { hitDie: 6 }
      }
    };
    const externalSource = { ...source, id: 'spelljammer-2022', version: '2022', rulesEra: 'legacy' as const };
    const incomingSpell = {
      id: 'spelljammer-2022-spell-air-bubble',
      kind: 'spell' as const,
      name: 'Air Bubble',
      source: externalSource,
      payload: {
        level: 2,
        classes: ['Artificer', 'Druid', 'Ranger', 'Sorcerer', 'Wizard'],
        castingTime: { kind: 'action' as const, actionCost: 'action' as const }
      }
    };
    const existingSpell = {
      id: 'stored:air-bubble',
      importItemId: incomingSpell.id,
      type: 'spell' as const,
      name: incomingSpell.name,
      sourceId: externalSource.id,
      rawJson: incomingSpell
    };
    const incremental = {
      templateVersion: 'dnd-combat-import.v2' as const,
      id: 'spelljammer-spells',
      source: externalSource,
      items: [incomingSpell]
    };

    const preview = buildCompendiumImportV2Preview(incremental, [existingClass, existingSpell]);
    expect(preview.valid).toBe(true);
    expect(preview).toEqual(expect.objectContaining({ creates: 0, updates: 0, unchanged: 1, conflicts: 0 }));
    expect(preview.decisions[0].changedPaths).toEqual([]);
  });

  it('resolves incremental-pack semantic references against the installed catalog during preview', () => {
    const existingClass = {
      id: 'stored:class-wizard',
      importItemId: 'phb-2024-class-wizard',
      type: 'class' as const,
      name: 'Wizard',
      sourceId: source.id,
      rawJson: {
        id: 'phb-2024-class-wizard', kind: 'class' as const, name: 'Wizard', source, payload: { hitDie: 6 }
      }
    };
    const incremental = {
      templateVersion: 'dnd-combat-import.v2',
      id: 'subclass-pack',
      source,
      items: [{
        id: 'phb-2024-subclass-evoker', kind: 'subclass', name: 'Evoker', source,
        payload: { classId: 'phb-2024-class-wizard' }
      }]
    };

    const result = parseAndPreviewImportPack(incremental, [existingClass]);
    expect(result.parse.ok).toBe(true);
    expect(result.preview?.valid).toBe(true);
    expect(result.preview?.creates).toBe(1);
    expect(result.preview?.semanticValidation.errors).toEqual([]);
  });

  it('runs V1 through parse + migration + preview without exposing the original version downstream', () => {
    const v1 = {
      templateVersion: 'dnd-combat-import.v1',
      id: 'legacy-preview',
      source,
      items: [{
        id: 'phb-2024-spell-fire-bolt', kind: 'spell', name: 'Fire Bolt', source,
        payload: { level: 0, classes: ['Wizard'], castingTime: 'action', damageFormula: '1d10' }
      }]
    };
    const result = parseAndPreviewImportPack(v1, []);
    expect(result.parse.ok).toBe(true);
    expect(result.parse.data?.templateVersion).toBe('dnd-combat-import.v2');
    expect(result.preview?.creates).toBe(1);
  });

  it('replays all 1,284 PHB V1 items against their canonical V2 representation as unchanged', () => {
    const fixturePath = path.resolve(process.cwd(), 'assets/compendium/phb-2024-full-consolidated-import-pack-v5-complete-invocations.json');
    const raw = JSON.parse(fs.readFileSync(fixturePath, 'utf8')) as {
      id: string;
      source: typeof source;
      items: Array<{ id: string; kind: CompendiumEntityKind; name: string; summary?: string; source: typeof source; payload: Record<string, unknown> }>;
    };
    const migrated = migrateImportV1ToV2(raw, { originalEnvelope: raw, detectedLegacyVersion: 'dnd-combat-import.v1' });
    expect(migrated.value).toBeDefined();
    if (!migrated.value) return;

    const existing = raw.items.map((item) => ({
      id: `${raw.id}:${item.id}`,
      importItemId: item.id,
      type: item.kind,
      name: item.name,
      summary: item.summary,
      sourceId: item.source.id,
      rawJson: item
    }));
    const preview = buildCompendiumImportV2Preview(migrated.value, existing);
    expect(preview.valid).toBe(true);
    expect(preview.itemsFound).toBe(1284);
    expect(preview).toEqual(expect.objectContaining({ creates: 0, updates: 0, unchanged: 1284, conflicts: 0 }));
  });
});
