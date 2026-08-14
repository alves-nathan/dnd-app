import fs from 'node:fs';
import path from 'node:path';
import { buildCompendiumImportV2Preview } from '../compendium/importPreview';
import type { CanonicalImportPackForPreview } from '../compendium/importPreview';
import { createCompendiumImportV2UpsertPlan } from '../compendium/importUpsertPlan';
import {
  applyCompendiumImportV2PlanToSnapshot,
  existingPreviewItemsFromSnapshot
} from '../storage/compendiumV2Persistence';
import { emptyCompendiumPersistenceState, type CompendiumPersistenceState } from '../storage/compendiumSnapshot';
import { parseImportPack } from '../compendium/parseImportPack';
import type { ResourceDefinition } from '../compendium/importDomain';

const root = process.cwd();
const readPack = (relativePath: string): CanonicalImportPackForPreview => {
  const parsed = parseImportPack(fs.readFileSync(path.resolve(root, relativePath), 'utf8'), { validateSemantics: false });
  if (!parsed.ok || !parsed.data) {
    throw new Error(`Unable to canonicalize ${relativePath}: ${parsed.issues.map((entry) => `${entry.code}: ${entry.message}`).join(' | ')}`);
  }
  return parsed.data as CanonicalImportPackForPreview;
};

const phb = readPack('assets/compendium/phb-2024-full-consolidated-import-pack-v2-canonical.json');
const mm2024Delta = readPack('assets/compendium/mm-2024-runtime-dependency-delta-v2-canonical.json');
const forge = readPack('assets/compendium/forge-artificer-2025-full-consolidated-import-pack-v2-canonical.json');
const spelljammer = readPack('assets/compendium/spelljammer-2022-2024-compatible-import-pack-v2-canonical.json');
const tasha = readPack('assets/compendium/tcoe-2020-2024-compatible-import-pack-v2-canonical.json');
const phb2014Delta = readPack('assets/compendium/phb-2014-2024-compatible-delta-v2-canonical.json');

const apply = (snapshot: CompendiumPersistenceState, pack: CanonicalImportPackForPreview): CompendiumPersistenceState => {
  const preview = buildCompendiumImportV2Preview(pack, existingPreviewItemsFromSnapshot(snapshot));
  const plan = createCompendiumImportV2UpsertPlan(pack, preview);
  expect(preview.valid).toBe(true);
  expect(preview.errors).toEqual([]);
  expect(plan.executable).toBe(true);
  return applyCompendiumImportV2PlanToSnapshot(snapshot, pack, plan, { importedAt: '2026-08-11T21:55:00.000Z' }).snapshot;
};

describe('2024-first + legacy extracted book packs against the current app import runtime', () => {
  it('parses the staged raw sources and the derived Tasha compatibility pack through the V2 boundary', () => {
    for (const relativePath of [
      'assets/compendium/mm-2024-runtime-dependency-delta-v2-canonical.json',
      'artifacts/compendium/integration/v2/forge-artificer-2025-full-consolidated-import-pack-v2-canonical.json',
      'artifacts/compendium/integration/v2/spelljammer-2022-full-consolidated-import-pack-v2-canonical.json',
      'artifacts/compendium/integration/v2/tcoe-2020-full-consolidated-import-pack-v2-canonical.json',
      'assets/compendium/tcoe-2020-2024-compatible-import-pack-v2-canonical.json',
      'assets/compendium/phb-2014-2024-compatible-delta-v2-canonical.json'
    ]) {
      const parsed = parseImportPack(fs.readFileSync(path.resolve(root, relativePath), 'utf8'), { validateSemantics: false });
      if (!parsed.ok) {
        throw new Error(`Unable to parse ${relativePath}: ${parsed.issues.map((entry) => `${entry.code}: ${entry.message}`).join(' | ')}`);
      }
      expect(parsed.issues.filter((entry) => entry.code === 'IMPORT_V2_SCHEMA_ERROR')).toEqual([]);
    }
  });

  it('imports PHB 2024 + MM 2024 dependency delta + Forge + Spelljammer + Tasha compatibility + PHB 2014 delta atomically', () => {
    let snapshot = emptyCompendiumPersistenceState();
    snapshot = apply(snapshot, phb);
    snapshot = apply(snapshot, mm2024Delta);
    snapshot = apply(snapshot, forge);
    snapshot = apply(snapshot, spelljammer);
    snapshot = apply(snapshot, tasha);
    snapshot = apply(snapshot, phb2014Delta);

    expect(snapshot.items).toHaveLength(1997);
    expect(snapshot.packs).toHaveLength(6);
    expect(tasha.metadata?.externalDependencies?.phb2014 ?? []).toEqual([]);
  });

  it('replays the current-rules dependency delta and all extracted legacy book profiles idempotently', () => {
    let snapshot = emptyCompendiumPersistenceState();
    snapshot = apply(snapshot, phb);
    snapshot = apply(snapshot, mm2024Delta);
    snapshot = apply(snapshot, forge);
    snapshot = apply(snapshot, spelljammer);
    snapshot = apply(snapshot, tasha);
    snapshot = apply(snapshot, phb2014Delta);

    for (const [pack, expected] of [[mm2024Delta, 2], [forge, 200], [spelljammer, 182], [tasha, 273], [phb2014Delta, 56]] as const) {
      const replay = buildCompendiumImportV2Preview(pack, existingPreviewItemsFromSnapshot(snapshot));
      expect(replay).toEqual(expect.objectContaining({ valid: true, creates: 0, updates: 0, unchanged: expected, conflicts: 0 }));
    }
  });

  it('preserves every feature resource instead of dropping legacy resource objects without ids', () => {
    for (const pack of [mm2024Delta, forge, spelljammer, tasha, phb2014Delta]) {
      const resources = pack.items
        .filter((item) => item.kind === 'feature')
        .map((item) => item.payload.resource)
        .filter((entry): entry is ResourceDefinition => Boolean(entry && typeof entry === 'object' && !Array.isArray(entry)));
      expect(resources.every((entry) => typeof entry.id === 'string' && entry.id.length > 0)).toBe(true);
    }
  });
});
