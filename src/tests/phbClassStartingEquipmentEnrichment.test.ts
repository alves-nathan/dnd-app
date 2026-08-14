import { execFileSync } from 'child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join, resolve } from 'path';

const classIds = [
  'barbarian', 'bard', 'cleric', 'druid', 'fighter', 'monk',
  'paladin', 'ranger', 'rogue', 'sorcerer', 'warlock', 'wizard'
];

describe('PHB class starting equipment enrichment', () => {
  it('adds structured equipment to all twelve classes while preserving the pack id', () => {
    const directory = mkdtempSync(join(tmpdir(), 'dnd-phb-equipment-'));
    const input = join(directory, 'input.json');
    const output = join(directory, 'output.json');
    writeFileSync(input, JSON.stringify({
      id: 'replace-me-in-place',
      items: classIds.map((slug) => ({
        id: `phb-2024-class-${slug}`,
        kind: 'class',
        name: slug,
        payload: {}
      }))
    }));

    execFileSync(
      process.execPath,
      [resolve('scripts/enrich-phb-class-starting-equipment.js'), input, output],
      { cwd: process.cwd(), stdio: 'pipe' }
    );

    const enriched = JSON.parse(readFileSync(output, 'utf8')) as {
      id: string;
      metadata: { classStartingEquipment: { classCount: number; replacementSafe: boolean } };
      items: Array<{ payload: { equipmentOptions?: Record<string, string[]> } }>;
    };
    expect(enriched.id).toBe('replace-me-in-place');
    expect(enriched.metadata.classStartingEquipment).toMatchObject({ classCount: 12, replacementSafe: true });
    expect(enriched.items.every((item) => Object.keys(item.payload.equipmentOptions ?? {}).length >= 2)).toBe(true);
  });
});
