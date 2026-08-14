import { BUNDLED_COMPENDIUM_PACKS, serializeBundledCompendiumPack, type BundledCompendiumPackDefinition } from '../compendium/bundledCompendium';
import { parseImportPack } from '../compendium/parseImportPack';
import { IMPORT_TEMPLATE_VERSION_V2 } from '../compendium/importVersions';
import { KeyValueCompendiumRepository } from '../storage/compendiumRepository';
import { ensureRequiredCharacterCreationCompendium, initializeBundledCompendium, installBundledCompendiumPack, isCompendiumSnapshotEmpty, reconcileBundledCompendium } from '../storage/bundledCompendiumBootstrap';
import { createMemoryKeyValueStorage } from '../storage/keyValueStorage';

const source = { id: 'bundled-test-source', book: 'Bundled Test Book', version: '2024', status: 'needsReview' as const, confidence: 'importedNeedsReview' as const };

const v2Payload = (id: string) => ({
  templateVersion: IMPORT_TEMPLATE_VERSION_V2,
  id,
  source,
  items: [
    { id: 'bundled-test-class', kind: 'class', name: 'Bundled Test Class', source, payload: { progression: [{ level: 1, featureIds: ['bundled-test-feature'] }] } },
    { id: 'bundled-test-feature', kind: 'feature', name: 'Bundled Test Feature', source, payload: { sourceType: 'classFeature', classId: 'bundled-test-class', levelGained: 1 } }
  ]
});

const v1Payload = (id: string) => ({
  templateVersion: 'dnd-combat-import.v1',
  id,
  source,
  items: [
    { id: 'bundled-test-class', kind: 'class', name: 'Bundled Test Class', source, payload: { progression: [{ level: 1, featureIds: ['bundled-test-feature'] }] } },
    { id: 'bundled-test-feature', kind: 'feature', name: 'Bundled Test Feature', source, payload: { sourceType: 'classFeature', classId: 'bundled-test-class', levelGained: 1 } }
  ]
});

const createPack = (id: string = 'bundled-test-pack'): BundledCompendiumPackDefinition => ({
  id,
  fileName: `${id}.json`,
  label: 'Pacote V2 de teste',
  importFormat: 'v2',
  load: () => v2Payload(id)
});

describe('bundled compendium bootstrap', () => {
  it('installs bundled V2 packs into an empty repository and prepares core content', async () => {
    const repository = new KeyValueCompendiumRepository(createMemoryKeyValueStorage());
    const result = await initializeBundledCompendium(repository, { packs: [createPack()], now: '2026-07-15T12:00:00.000Z' });
    expect(result.ok).toBe(true);
    expect(result.seeded).toBe(true);
    expect(result.importedPackIds).toEqual(['bundled-test-pack']);
    expect(result.importedItemCount).toBe(2);
    expect(result.preparedCoreItemCount).toBe(2);
    expect(result.enabledSourceCount).toBe(1);
    expect(result.snapshot.enabledSourceIds).toContain(source.id);
    expect(result.snapshot.items.every((item) => item.status === 'validated')).toBe(true);
    expect(result.snapshot.items.every((item) => item.reviewDecision === 'approved')).toBe(true);
    expect(result.snapshot.items.every((item) => item.contentHash?.startsWith('cmpv2_'))).toBe(true);
    expect(result.snapshot.packs[0]?.schemaVersion).toBe(IMPORT_TEMPLATE_VERSION_V2);
  });

  it('is idempotent and never installs a new bundled pack into an unrelated non-empty repository', async () => {
    const repository = new KeyValueCompendiumRepository(createMemoryKeyValueStorage());
    const first = await repository.saveImportJson(JSON.stringify(v1Payload('existing-pack')));
    expect(first.ok).toBe(true);
    const result = await initializeBundledCompendium(repository, { packs: [createPack('must-not-be-imported')] });
    expect(result.ok).toBe(true);
    expect(result.seeded).toBe(false);
    expect(result.snapshot.packs.map((pack) => pack.id)).toEqual(['existing-pack']);
  });

  it('restores a missing required bundled pack in a non-empty repository without removing user content', async () => {
    const repository = new KeyValueCompendiumRepository(createMemoryKeyValueStorage());
    const existing = await repository.saveImportJson(JSON.stringify({
      templateVersion: 'dnd-combat-import.v1',
      id: 'user-pack',
      source: { ...source, id: 'user-source' },
      items: [
        {
          id: 'user-homebrew-class',
          kind: 'class',
          name: 'User Homebrew Class',
          source: { ...source, id: 'user-source' },
          payload: { progression: [] }
        }
      ]
    }));
    expect(existing.ok).toBe(true);

    const repaired = await ensureRequiredCharacterCreationCompendium(repository, {
      packs: [createPack('required-core-pack')]
    });

    expect(repaired.ok).toBe(true);
    expect(repaired.restoredPackIds).toEqual(['required-core-pack']);
    expect(repaired.snapshot.packs.map((pack) => pack.id).sort()).toEqual(['required-core-pack', 'user-pack']);
    expect(repaired.snapshot.items.some((item) => item.packId === 'user-pack')).toBe(true);
    expect(repaired.snapshot.items.some((item) => item.packId === 'required-core-pack')).toBe(true);
  });

  it('repairs missing required items even when stale pack metadata is still present', async () => {
    const repository = new KeyValueCompendiumRepository(createMemoryKeyValueStorage());
    const installed = await repository.saveImportV2Json(JSON.stringify(v2Payload('required-core-pack')));
    expect(installed.ok).toBe(true);
    const damaged = {
      ...installed.snapshot,
      items: installed.snapshot.items.filter((item) => item.importItemId !== 'bundled-test-class')
    };
    await repository.saveSnapshot(damaged);
    expect((await repository.loadSnapshot()).packs.some((pack) => pack.id === 'required-core-pack')).toBe(true);
    expect((await repository.loadSnapshot()).items.some((item) => item.importItemId === 'bundled-test-class')).toBe(false);

    const repaired = await ensureRequiredCharacterCreationCompendium(repository, {
      packs: [createPack('required-core-pack')]
    });

    expect(repaired.ok).toBe(true);
    expect(repaired.restoredPackIds).toEqual(['required-core-pack']);
    expect(repaired.snapshot.items.some((item) => item.importItemId === 'bundled-test-class')).toBe(true);
    expect(repaired.snapshot.items.find((item) => item.importItemId === 'bundled-test-class')?.status).toBe('validated');
  });

  it('defers required-pack repair when an existing local item would be overwritten', async () => {
    const repository = new KeyValueCompendiumRepository(createMemoryKeyValueStorage());
    const existing = await repository.saveImportJson(JSON.stringify({
      templateVersion: 'dnd-combat-import.v1',
      id: 'user-pack',
      source,
      items: [
        {
          id: 'bundled-test-class',
          kind: 'class',
          name: 'Locally Modified Class',
          source,
          payload: { progression: [{ level: 1, featureIds: [] }] }
        }
      ]
    }));
    expect(existing.ok).toBe(true);

    const repaired = await ensureRequiredCharacterCreationCompendium(repository, {
      packs: [createPack('required-core-pack')]
    });

    expect(repaired.ok).toBe(false);
    expect(repaired.restoredPackIds).toEqual([]);
    expect(repaired.issues.some((issue) => issue.code === 'REQUIRED_BUNDLED_COMPENDIUM_REPAIR_CONFLICT')).toBe(true);
    expect(repaired.snapshot.packs.map((pack) => pack.id)).toEqual(['user-pack']);
    expect(repaired.snapshot.items[0]?.name).toBe('Locally Modified Class');
  });


  it('upgrades a known bundled predecessor transactionally while preserving retained storage ids', async () => {
    const repository = new KeyValueCompendiumRepository(createMemoryKeyValueStorage());
    const predecessorId = 'managed-predecessor-pack';
    const currentId = 'managed-current-pack';
    const managedSource = { ...source, id: 'managed-source', status: 'active' as const, confidence: 'exact' as const };
    const predecessorPayload = {
      templateVersion: IMPORT_TEMPLATE_VERSION_V2,
      id: predecessorId,
      source: managedSource,
      items: [
        { id: 'managed-retained-feat', kind: 'feat', name: 'Managed Retained Feat', source: managedSource, summary: 'Legacy wording', payload: { category: 'general' } },
        { id: 'managed-suppressed-feat', kind: 'feat', name: 'Managed Suppressed Feat', source: managedSource, payload: { category: 'general' } }
      ]
    };
    const predecessor = await repository.saveImportV2Json(JSON.stringify(predecessorPayload));
    expect(predecessor.ok).toBe(true);
    const retainedStorageId = predecessor.snapshot.items.find((item) => item.importItemId === 'managed-retained-feat')?.id;

    const currentPack: BundledCompendiumPackDefinition = {
      id: currentId,
      fileName: `${currentId}.json`,
      label: 'Managed current pack',
      importFormat: 'v2',
      predecessorPackIds: [predecessorId],
      load: () => ({
        templateVersion: IMPORT_TEMPLATE_VERSION_V2,
        id: currentId,
        source: managedSource,
        items: [
          { id: 'managed-retained-feat', kind: 'feat', name: 'Managed Retained Feat', source: managedSource, summary: '2024-first wording', payload: { category: 'general' } }
        ]
      })
    };

    const installed = await installBundledCompendiumPack(repository, currentId, [currentPack]);
    expect(installed.ok).toBe(true);
    expect(installed.snapshot.packs.some((pack) => pack.id === predecessorId)).toBe(false);
    expect(installed.snapshot.packs.some((pack) => pack.id === currentId)).toBe(true);
    expect(installed.snapshot.items.some((item) => item.importItemId === 'managed-suppressed-feat')).toBe(false);
    const retained = installed.snapshot.items.find((item) => item.importItemId === 'managed-retained-feat');
    expect(retained?.id).toBe(retainedStorageId);
    expect(retained?.packId).toBe(currentId);
    expect((retained?.rawJson as { summary?: string }).summary).toBe('2024-first wording');
    expect(installed.issues.some((issue) => issue.code === 'BUNDLED_COMPENDIUM_MANAGED_PREDECESSOR_UPGRADED')).toBe(true);
  });

  it('rolls back a partial V2 installation when a later pack is invalid', async () => {
    const repository = new KeyValueCompendiumRepository(createMemoryKeyValueStorage());
    const invalidPack: BundledCompendiumPackDefinition = {
      id: 'invalid-pack',
      fileName: 'invalid-pack.json',
      label: 'Pacote inválido',
      importFormat: 'v2',
      load: () => ({ templateVersion: IMPORT_TEMPLATE_VERSION_V2, id: 'invalid-pack', source, items: [{ invalid: true }] })
    };
    const result = await initializeBundledCompendium(repository, { packs: [createPack('valid-first-pack'), invalidPack] });
    expect(result.ok).toBe(false);
    expect(result.seeded).toBe(false);
    expect(isCompendiumSnapshotEmpty(await repository.loadSnapshot())).toBe(true);
  });

  it('promotes an unchanged installed V1 bundled pack to V2 without changing storage ids', async () => {
    const repository = new KeyValueCompendiumRepository(createMemoryKeyValueStorage());
    const legacy = await repository.saveImportJson(JSON.stringify(v1Payload('bundled-test-pack')));
    expect(legacy.ok).toBe(true);
    const beforeIds = legacy.snapshot.items.map((item) => item.id);
    expect(legacy.snapshot.items.every((item) => item.contentHash === undefined)).toBe(true);

    const reconciled = await reconcileBundledCompendium(repository, { packs: [createPack('bundled-test-pack')] });
    expect(reconciled.ok).toBe(true);
    expect(reconciled.reconciled).toBe(true);
    expect(reconciled.deferredPackIds).toEqual([]);
    expect(reconciled.contentHashesBackfilled).toBe(2);
    expect(reconciled.snapshot.items.map((item) => item.id)).toEqual(beforeIds);
    expect(reconciled.snapshot.items.every((item) => item.contentHash?.startsWith('cmpv2_'))).toBe(true);
    expect(reconciled.snapshot.packs.find((pack) => pack.id === 'bundled-test-pack')?.schemaVersion).toBe(IMPORT_TEMPLATE_VERSION_V2);
  });

  it('preserves local normalized mappings while promoting unchanged raw V1 content', async () => {
    const repository = new KeyValueCompendiumRepository(createMemoryKeyValueStorage());
    const legacy = await repository.saveImportJson(JSON.stringify(v1Payload('bundled-test-pack')));
    expect(legacy.ok).toBe(true);
    const changed = {
      ...legacy.snapshot,
      items: legacy.snapshot.items.map((item, index) => index === 0
        ? { ...item, normalizedJson: { ...item.normalizedJson, localOnlyRule: true } }
        : item)
    };
    await repository.saveSnapshot(changed);

    const reconciled = await reconcileBundledCompendium(repository, { packs: [createPack('bundled-test-pack')] });
    expect(reconciled.reconciled).toBe(true);
    expect(reconciled.deferredPackIds).toEqual([]);
    expect(reconciled.snapshot.items[0]?.normalizedJson.localOnlyRule).toBe(true);
    expect(reconciled.snapshot.packs[0]?.schemaVersion).toBe(IMPORT_TEMPLATE_VERSION_V2);
  });

  it('defers V1 to V2 promotion when the installed raw bundled content truly diverges', async () => {
    const repository = new KeyValueCompendiumRepository(createMemoryKeyValueStorage());
    const legacy = await repository.saveImportJson(JSON.stringify(v1Payload('bundled-test-pack')));
    expect(legacy.ok).toBe(true);
    const changed = {
      ...legacy.snapshot,
      items: legacy.snapshot.items.map((item, index) => index === 0
        ? { ...item, rawJson: { ...item.rawJson, summary: 'Local raw override' } }
        : item)
    };
    await repository.saveSnapshot(changed);

    const reconciled = await reconcileBundledCompendium(repository, { packs: [createPack('bundled-test-pack')] });
    expect(reconciled.reconciled).toBe(false);
    expect(reconciled.deferredPackIds).toEqual(['bundled-test-pack']);
    expect((reconciled.snapshot.items[0]?.rawJson as { summary?: string }).summary).toBe('Local raw override');
    expect(reconciled.snapshot.packs[0]?.schemaVersion).not.toBe(IMPORT_TEMPLATE_VERSION_V2);
  });

  it('ships the canonical PHB V2 manifest with 1,284 records', () => {
    const phb = BUNDLED_COMPENDIUM_PACKS.find((pack) => pack.id === 'phb-2024-full-consolidated-import-pack-v5-complete-invocations');
    expect(phb).toBeDefined();
    expect(phb?.importFormat).toBe('v2');
    expect(phb?.fileName).toBe('phb-2024-full-consolidated-import-pack-v2-canonical.json');
    const preview = parseImportPack(serializeBundledCompendiumPack(phb as BundledCompendiumPackDefinition));
    expect(preview.ok).toBe(true);
    expect(preview.data?.templateVersion).toBe(IMPORT_TEMPLATE_VERSION_V2);
    expect(preview.data?.items).toHaveLength(1284);
    expect(new Set(preview.data?.items.map((item) => item.id)).size).toBe(1284);
  });
});
