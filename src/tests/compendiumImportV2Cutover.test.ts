import fs from 'node:fs';
import path from 'node:path';
import { BUNDLED_COMPENDIUM_PACKS, serializeBundledCompendiumPack } from '../compendium/bundledCompendium';
import { IMPORT_TEMPLATE_VERSION_V2 } from '../compendium/importVersions';
import { KeyValueCompendiumRepository } from '../storage/compendiumRepository';
import { initializeBundledCompendium, reconcileBundledCompendium } from '../storage/bundledCompendiumBootstrap';
import { createMemoryKeyValueStorage } from '../storage/keyValueStorage';

const root = process.cwd();
const legacyPhb = fs.readFileSync(
  path.resolve(root, 'assets/compendium/phb-2024-full-consolidated-import-pack-v5-complete-invocations.json'),
  'utf8'
);

describe('Compendium Import V2 controlled cutover', () => {
  it('uses the canonical V2 PHB as the production bundled asset', () => {
    const phb = BUNDLED_COMPENDIUM_PACKS[0];
    expect(phb?.importFormat).toBe('v2');
    expect(phb?.fileName).toBe('phb-2024-full-consolidated-import-pack-v2-canonical.json');
    const parsed = JSON.parse(serializeBundledCompendiumPack(phb!)) as { templateVersion?: string; id?: string; items?: unknown[] };
    expect(parsed.templateVersion).toBe(IMPORT_TEMPLATE_VERSION_V2);
    expect(parsed.id).toBe('phb-2024-full-consolidated-import-pack-v5-complete-invocations');
    expect(parsed.items).toHaveLength(1284);
  });

  it('installs a fresh 2024-first catalog through V2 persistence, together with MM 2024 dependency closure + Forge + Spelljammer + compatible Tasha + PHB 2014 legacy delta', async () => {
    const repository = new KeyValueCompendiumRepository(createMemoryKeyValueStorage());
    const result = await initializeBundledCompendium(repository, { prepareCoreCharacterContent: false, now: '2026-08-11T12:00:00.000Z' });
    expect(result.ok).toBe(true);
    expect(result.seeded).toBe(true);
    expect(result.snapshot.items).toHaveLength(1997);
    expect(result.importedPackIds).toEqual([
      'phb-2024-full-consolidated-import-pack-v5-complete-invocations',
      'mm-2024-runtime-dependency-delta-v1',
      'forge-artificer-2025-full-consolidated-import-pack-v1',
      'spelljammer-2022-full-consolidated-import-pack-v1',
      'tcoe-2020-2024-compatible-import-pack-v2',
      'phb-2014-2024-compatible-delta-v1'
    ]);
    expect(result.snapshot.items.every((item) => item.contentHash?.startsWith('cmpv2_'))).toBe(true);
    expect(result.snapshot.packs[0]?.schemaVersion).toBe(IMPORT_TEMPLATE_VERSION_V2);
  });

  it('bundles only 2024-first compatible extracted-book profiles', () => {
    expect(BUNDLED_COMPENDIUM_PACKS.map((pack) => pack.fileName)).toEqual([
      'phb-2024-full-consolidated-import-pack-v2-canonical.json',
      'mm-2024-runtime-dependency-delta-v2-canonical.json',
      'forge-artificer-2025-full-consolidated-import-pack-v2-canonical.json',
      'spelljammer-2022-2024-compatible-import-pack-v2-canonical.json',
      'tcoe-2020-2024-compatible-import-pack-v2-canonical.json',
      'phb-2014-2024-compatible-delta-v2-canonical.json'
    ]);
    const tasha = BUNDLED_COMPENDIUM_PACKS.find((pack) => pack.id === 'tcoe-2020-2024-compatible-import-pack-v2');
    const phb2014Delta = BUNDLED_COMPENDIUM_PACKS.find((pack) => pack.id === 'phb-2014-2024-compatible-delta-v1');
    expect(tasha?.importFormat).toBe('v2');
    expect(tasha?.predecessorPackIds).toEqual(expect.arrayContaining([
      'tcoe-2020-2024-compatible-import-pack-v1',
      'tcoe-2020-full-consolidated-import-pack-v1'
    ]));
    expect(phb2014Delta?.importFormat).toBe('v2');
  });

  it('promotes the existing bundled V1 PHB without changing any storage id', async () => {
    const repository = new KeyValueCompendiumRepository(createMemoryKeyValueStorage());
    const legacy = await repository.saveImportJson(legacyPhb);
    expect(legacy.ok).toBe(true);
    expect(legacy.snapshot.items).toHaveLength(1284);
    const before = new Map(legacy.snapshot.items.map((item) => [item.importItemId, item.id]));

    const result = await reconcileBundledCompendium(repository);
    expect(result.ok).toBe(true);
    expect(result.reconciled).toBe(true);
    expect(result.deferredPackIds).toEqual([]);
    expect(result.contentHashesBackfilled).toBe(1284);
    expect(result.snapshot.packs.find((pack) => pack.id === 'phb-2024-full-consolidated-import-pack-v5-complete-invocations')?.schemaVersion).toBe(IMPORT_TEMPLATE_VERSION_V2);

    for (const item of result.snapshot.items) {
      expect(item.id).toBe(before.get(item.importItemId));
      expect(item.contentHash).toMatch(/^cmpv2_/);
    }
  });

  it('keeps the V1 asset and legacy repository path for backward-compatible imports', () => {
    expect(fs.existsSync(path.resolve(root, 'assets/compendium/phb-2024-full-consolidated-import-pack-v5-complete-invocations.json'))).toBe(true);
    const repositorySource = fs.readFileSync(path.resolve(root, 'src/storage/compendiumRepository.ts'), 'utf8');
    expect(repositorySource).toContain('saveImportJson: (json: string)');
    expect(repositorySource).toContain('saveImportV2Json: (json: string)');
  });

  it('routes user-facing V2 JSON through the V2 repository path', () => {
    const storeSource = fs.readFileSync(path.resolve(root, 'src/store/compendiumStore.ts'), 'utf8');
    expect(storeSource).toContain('detectCompendiumImportVersion');
    expect(storeSource).toContain('detected === IMPORT_TEMPLATE_VERSION_V2 || detected === LEGACY_IMPORT_TEMPLATE_VERSION_V1');
    expect(storeSource).toContain('repository.saveImportV2Json(json)');
    expect(storeSource).toContain("importFormat: 'v2'");
    expect(storeSource).toContain('Truly unversioned legacy payloads keep the old path below');
  });
});
