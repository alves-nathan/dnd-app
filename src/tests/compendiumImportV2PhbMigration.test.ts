import fs from 'node:fs';
import path from 'node:path';
import { createCompendiumImportItemContentHash } from '../compendium/importContentHash';
import { parseImportPack } from '../compendium/parseImportPack';

const root = process.cwd();
const legacyPath = path.resolve(root, 'assets/compendium/phb-2024-full-consolidated-import-pack-v5-complete-invocations.json');
const canonicalPath = path.resolve(root, 'assets/compendium/phb-2024-full-consolidated-import-pack-v2-canonical.json');
const reportPath = path.resolve(root, 'artifacts/compendium-import-v2-phase08-phb-migration-report.json');

const readJson = (filePath: string): Record<string, any> => JSON.parse(fs.readFileSync(filePath, 'utf8')) as Record<string, any>;

describe('PHB 2024 canonical V2 migration artifact', () => {
  it('ships the 1,284 PHB entities as dnd-combat-import.v2 with the same IDs and kinds', () => {
    const legacy = readJson(legacyPath);
    const canonical = readJson(canonicalPath);
    expect(canonical.templateVersion).toBe('dnd-combat-import.v2');
    expect(canonical.id).toBe(legacy.id);
    expect(canonical.items).toHaveLength(1284);
    expect(new Set(canonical.items.map((item: any) => item.id)).size).toBe(1284);

    const legacyKinds = new Map(legacy.items.map((item: any) => [item.id, item.kind]));
    expect(canonical.items.every((item: any) => legacyKinds.get(item.id) === item.kind)).toBe(true);
  });

  it('parses the V1 source and the V2 artifact to semantically equivalent items', () => {
    const legacyParsed = parseImportPack(fs.readFileSync(legacyPath, 'utf8'));
    const canonicalParsed = parseImportPack(fs.readFileSync(canonicalPath, 'utf8'));
    expect(legacyParsed.ok).toBe(true);
    expect(canonicalParsed.ok).toBe(true);
    expect(canonicalParsed.detectedVersion).toBe('dnd-combat-import.v2');
    expect(canonicalParsed.semanticValidation?.errors).toEqual([]);
    expect(canonicalParsed.semanticValidation?.warnings).toEqual([]);

    const legacyHashes = new Map(legacyParsed.data?.items.map((item) => [item.id, createCompendiumImportItemContentHash(item)]));
    const canonicalHashes = new Map(canonicalParsed.data?.items.map((item) => [item.id, createCompendiumImportItemContentHash(item)]));
    expect(canonicalHashes.size).toBe(1284);
    for (const [id, hash] of legacyHashes) expect(canonicalHashes.get(id)).toBe(hash);
  });

  it('preserves all per-item V1 provenance outside gameplay payloads', () => {
    const legacy = readJson(legacyPath);
    const canonical = readJson(canonicalPath);
    const canonicalById = new Map(canonical.items.map((item: any) => [item.id, item]));
    const withLegacyMetadata = legacy.items.filter((item: any) => item._importMeta !== undefined);
    expect(withLegacyMetadata).toHaveLength(1284);
    for (const item of withLegacyMetadata) {
      const migrated = canonicalById.get(item.id) as any;
      expect(migrated.metadata?.legacyImport).toEqual(item._importMeta);
      expect(migrated.payload?._importMeta).toBeUndefined();
    }
  });

  it('moves legacy envelope extensions into metadata and records a deterministic migration manifest', () => {
    const canonical = readJson(canonicalPath);
    expect(canonical.extractionInstructions).toBeUndefined();
    expect(canonical.consolidationMeta).toBeUndefined();
    expect(canonical.metadata.legacyExtensions.extractionInstructions).toBeDefined();
    expect(canonical.metadata.legacyExtensions.consolidationMeta).toBeDefined();
    expect(canonical.metadata.canonicalMigration).toEqual(expect.objectContaining({
      schemaVersion: 'phb-2024-import-v2-migration.v1',
      sourceTemplateVersion: 'dnd-combat-import.v1',
      itemCount: 1284,
      deterministic: true
    }));
  });

  it('publishes a passing migration report with the canonical distribution', () => {
    const report = readJson(reportPath);
    expect(report.target.templateVersion).toBe('dnd-combat-import.v2');
    expect(report.target.itemCount).toBe(1284);
    expect(Object.keys(report.target.byKind)).toHaveLength(13);
    expect(report.preservation.ids.preserved).toBe(1284);
    expect(report.preservation.semanticItemHashes.preserved).toBe(1284);
    expect(report.preservation.legacyItemProvenance.preservedEntries).toBe(1284);
    expect(report.validation.semanticIssues.errors).toBe(0);
    expect(report.validation.semanticIssues.warnings).toBe(0);
    expect(report.invariant.runtimeBootstrapSwitched).toBe(false);
  });
});
