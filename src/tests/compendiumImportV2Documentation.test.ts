import fs from 'node:fs';
import path from 'node:path';
import { COMPENDIUM_ENTITY_KINDS } from '../compendium/importDomain';
import {
  buildImportSchemaDocumentation,
  buildImportV2JsonSchema,
  IMPORT_V2_ENTITY_DOCUMENTATION
} from '../compendium/importV2Documentation';
import { buildStandardImportJsonObject, validateStandardImportTemplateJson } from '../compendium/importTemplate';

const root = path.resolve(__dirname, '../..');

describe('Compendium Import V2 documentation artifacts', () => {
  it('documents every runtime entity kind from the shared domain constant', () => {
    expect(Object.keys(IMPORT_V2_ENTITY_DOCUMENTATION).sort()).toEqual([...COMPENDIUM_ENTITY_KINDS].sort());
    const markdown = buildImportSchemaDocumentation({ format: 'markdown' });
    for (const kind of COMPENDIUM_ENTITY_KINDS) expect(markdown).toContain(`### ${kind}`);
  });

  it('derives JSON Schema from the same Zod schema used by the importer', () => {
    const schema = buildImportV2JsonSchema();
    expect(schema.$id).toContain('dnd-combat-import-v2.schema.json');
    expect(JSON.stringify(schema)).toContain('dnd-combat-import.v2');
    expect(JSON.stringify(schema)).toContain('creatureStatBlock');
  });

  it('keeps the checked-in external schema on the same version/kind contract', () => {
    const staticSchema = JSON.parse(fs.readFileSync(path.join(root, 'docs/dnd-combat-import-v2.schema.json'), 'utf8')) as Record<string, unknown>;
    const text = JSON.stringify(staticSchema);
    expect(text).toContain('dnd-combat-import.v2');
    for (const kind of COMPENDIUM_ENTITY_KINDS) expect(text).toContain(`\"${kind}\"`);
  });

  it('validates template examples with the real parser/schema pipeline', () => {
    const minimal = buildStandardImportJsonObject({ includeAllTypes: false });
    const full = buildStandardImportJsonObject({ includeAllTypes: true });
    expect(validateStandardImportTemplateJson(JSON.stringify(minimal)).ok).toBe(true);
    expect(validateStandardImportTemplateJson(JSON.stringify(full)).ok).toBe(true);
  });

  it('ships the canonical markdown documentation', () => {
    const documentation = fs.readFileSync(path.join(root, 'docs/compendium-import-v2.md'), 'utf8');
    expect(documentation).toContain('dnd-combat-import.v2');
    expect(documentation).toContain('Compatibilidade V1');
    expect(documentation).toContain('Custom background');
    expect(documentation).toContain('Export e round-trip');
  });
});
