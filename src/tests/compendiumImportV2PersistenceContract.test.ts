import fs from 'node:fs';
import path from 'node:path';

describe('Compendium Import V2 persistence contracts', () => {
  it('keeps SQLite V2 execution inside a transaction and does not delete unrelated items', () => {
    const source = fs.readFileSync(path.resolve(__dirname, '../storage/sqliteCompendiumRepository.ts'), 'utf8');
    const start = source.indexOf('async saveImportV2Json');
    const end = source.indexOf('async removePack', start);
    const method = source.slice(start, end);

    expect(start).toBeGreaterThanOrEqual(0);
    expect(method).toContain('withTransactionAsync');
    expect(method).toContain('ON CONFLICT(id) DO UPDATE');
    expect(method).not.toContain('DELETE FROM compendium_items');
    expect(method).not.toContain('DELETE FROM compendium_packs');
  });

  it('keeps the legacy saveImportJson path available after the V2 cutover for backward compatibility', () => {
    const source = fs.readFileSync(path.resolve(__dirname, '../storage/compendiumRepository.ts'), 'utf8');
    expect(source).toContain('saveImportJson: (json: string)');
    expect(source).toContain('saveImportV2Json: (json: string)');
  });
});
