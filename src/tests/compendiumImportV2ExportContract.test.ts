import fs from 'node:fs';
import path from 'node:path';

describe('Compendium Import V2 export contract', () => {
  const root = process.cwd();
  const packageExport = fs.readFileSync(path.join(root, 'src/compendium/packageExport.ts'), 'utf8');
  const v2Export = fs.readFileSync(path.join(root, 'src/compendium/importV2Export.ts'), 'utf8');
  const exportScreen = fs.readFileSync(path.join(root, 'app/compendium/export.tsx'), 'utf8');

  it('makes V2 the only newly generated user-facing package format', () => {
    expect(packageExport).toContain('IMPORT_TEMPLATE_VERSION_V2');
    expect(packageExport).not.toContain('STANDARD_IMPORT_TEMPLATE_VERSION');
    expect(exportScreen).toContain('dnd-combat-import.v2');
    expect(exportScreen).not.toContain('Gere um JSON dnd-combat-import.v1');
  });

  it('keeps storage/review metadata outside entity payloads', () => {
    expect(v2Export).toContain('metadata.storageOrigins');
    expect(v2Export).toContain('metadata.review');
    expect(v2Export).toContain('payloadFromRuntimeState');
    expect(v2Export).not.toContain('payload.exportMetadata');
  });

  it('verifies JSON round-trip through parseImportPack', () => {
    expect(v2Export).toContain('verifyCompendiumImportV2RoundTrip');
    expect(v2Export).toContain('parseImportPack(json, { validateSemantics: false })');
    expect(v2Export).toContain('createCompendiumImportItemContentHash');
  });
});
