import fs from 'node:fs';
import path from 'node:path';
import { parseImportPack } from '../compendium/parseImportPack';
import {
  IMPORT_TEMPLATE_VERSION_V2,
  LEGACY_IMPORT_TEMPLATE_VERSION_V1,
  STANDARD_IMPORT_TEMPLATE_VERSION
} from '../compendium/importVersions';

const root = process.cwd();

describe('Import V2 final baseline hardening', () => {
  it('uses explicit canonical and legacy version identifiers', () => {
    expect(IMPORT_TEMPLATE_VERSION_V2).toBe('dnd-combat-import.v2');
    expect(LEGACY_IMPORT_TEMPLATE_VERSION_V1).toBe('dnd-combat-import.v1');
    expect(STANDARD_IMPORT_TEMPLATE_VERSION).toBe(LEGACY_IMPORT_TEMPLATE_VERSION_V1);
  });

  it('ships a static V2 template that passes the canonical parser', () => {
    const json = fs.readFileSync(
      path.resolve(root, 'docs/import-templates/dnd-compendium-import.template.json'),
      'utf8'
    );
    const parsed = parseImportPack(json);
    expect(parsed.ok).toBe(true);
    expect(parsed.detectedVersion).toBe(IMPORT_TEMPLATE_VERSION_V2);
    expect(parsed.data?.items).toHaveLength(6);
    expect(new Set(parsed.data?.items.map((item) => item.id)).size).toBe(6);
    expect(new Set(parsed.data?.items.map((item) => item.kind))).toEqual(
      new Set(['class', 'feature', 'spell', 'background', 'feat', 'equipment'])
    );
  });

  it('does not expose V1 as the current user-facing format', () => {
    const compendiumHome = fs.readFileSync(path.resolve(root, 'app/compendium/index.tsx'), 'utf8');
    const exportScreen = fs.readFileSync(path.resolve(root, 'app/compendium/export.tsx'), 'utf8');
    expect(compendiumHome).toContain('dnd-combat-import.v2 canônico');
    expect(exportScreen).toContain('dnd-combat-import.v2 canônico');
    expect(compendiumHome).not.toContain('dnd-combat-import.v1');
    expect(exportScreen).not.toContain('dnd-combat-import.v1');
  });

  it('keeps the final baseline check in the permanent release gate', () => {
    const packageJson = JSON.parse(fs.readFileSync(path.resolve(root, 'package.json'), 'utf8')) as { scripts: Record<string, string> };
    expect(packageJson.scripts['compendium:import-v2:release-gate']).toContain('compendium:import-v2:final-baseline:check');
  });
});
