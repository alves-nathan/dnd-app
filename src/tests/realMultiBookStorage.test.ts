import fs from 'node:fs';
import path from 'node:path';
import { KeyValueCompendiumRepository } from '../storage/compendiumRepository';
import { createMemoryKeyValueStorage } from '../storage/keyValueStorage';

const realMultiBook = process.env.RUN_REAL_MULTI_BOOK === '1' ? it : it.skip;

describe('real multi-package storage validation', () => {
  realMultiBook('imports, replaces and removes supplied packages without broken sources', async () => {
    const configured = (process.env.COMPENDIUM_PACKAGE_PATHS ?? '')
      .split(path.delimiter)
      .map((entry: string) => entry.trim())
      .filter(Boolean);
    if (configured.length < 2) throw new Error('Set COMPENDIUM_PACKAGE_PATHS with at least two JSON package paths.');

    const repository = new KeyValueCompendiumRepository(createMemoryKeyValueStorage());
    const saved = [];
    for (const packagePath of configured) {
      const result = await repository.saveImportJson(fs.readFileSync(path.resolve(packagePath), 'utf8'));
      expect(result.ok).toBe(true);
      expect(result.imported).toBeTruthy();
      saved.push(result.imported!);
    }

    const snapshot = await repository.loadSnapshot();
    const sourceIds = new Set(snapshot.sources.map((source) => source.id));
    const packIds = new Set(snapshot.packs.map((pack) => pack.id));
    expect(snapshot.packs).toHaveLength(configured.length);
    expect(snapshot.items.length).toBeGreaterThan(1000);
    expect(snapshot.items.every((item) => sourceIds.has(item.sourceId) && packIds.has(item.packId))).toBe(true);

    const replacement = await repository.saveImportJson(fs.readFileSync(path.resolve(configured[0]!), 'utf8'));
    expect(replacement.ok).toBe(true);
    expect(replacement.snapshot.packs).toHaveLength(configured.length);

    const afterRemoval = await repository.removePack(saved[0]!.pack.id);
    const remainingSourceIds = new Set(afterRemoval.sources.map((source) => source.id));
    expect(afterRemoval.packs).toHaveLength(configured.length - 1);
    expect(afterRemoval.items.every((item) => remainingSourceIds.has(item.sourceId))).toBe(true);
  }, 120000);
});
