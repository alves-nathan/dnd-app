import fs from 'node:fs';
import path from 'node:path';
import { BUNDLED_COMPENDIUM_PACKS, serializeBundledCompendiumPack } from '../compendium/bundledCompendium';
import { parseImportPack } from '../compendium/parseImportPack';
import { IMPORT_TEMPLATE_VERSION_V2 } from '../compendium/importVersions';

const root = process.cwd();
const legacyAsset = 'phb-2024-full-consolidated-import-pack-v5-complete-invocations.json';
const canonicalAsset = 'phb-2024-full-consolidated-import-pack-v2-canonical.json';

describe('Import V2 post-cutover stabilization', () => {
  it('uses only the canonical V2 PHB in runtime-facing bundled consumers', () => {
    const consumers = [
      'src/compendium/bundledCompendium.ts',
      'scripts/check-character-choice-bridge.js',
      'scripts/run-app04-runtime-harness.js',
      'src/tests/catalogCharacterChoiceRealData.test.ts'
    ];
    for (const relative of consumers) {
      const source = fs.readFileSync(path.resolve(root, relative), 'utf8');
      expect(source).toContain(canonicalAsset);
      expect(source).not.toContain(legacyAsset);
    }
  });

  it('keeps the legacy PHB only as a compatibility/migration artifact', () => {
    expect(fs.existsSync(path.resolve(root, 'assets/compendium', legacyAsset))).toBe(true);
    expect(fs.existsSync(path.resolve(root, 'assets/compendium', canonicalAsset))).toBe(true);
  });

  it('parses the bundled production PHB as canonical V2 with all 1,284 items', () => {
    const phb = BUNDLED_COMPENDIUM_PACKS.find((pack) => pack.fileName === canonicalAsset);
    expect(phb).toBeDefined();
    expect(phb?.importFormat).toBe('v2');
    const parsed = parseImportPack(serializeBundledCompendiumPack(phb!));
    expect(parsed.ok).toBe(true);
    expect(parsed.data?.templateVersion).toBe(IMPORT_TEMPLATE_VERSION_V2);
    expect(parsed.data?.items).toHaveLength(1284);
    expect(new Set(parsed.data?.items.map((item) => item.id)).size).toBe(1284);
  });

  it('keeps the post-cutover check inside the permanent V2 release gate', () => {
    const packageJson = JSON.parse(fs.readFileSync(path.resolve(root, 'package.json'), 'utf8')) as { scripts: Record<string, string> };
    expect(packageJson.scripts['compendium:import-v2:release-gate']).toContain('compendium:import-v2:post-cutover:check');
  });
});
