const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const read = (name) => fs.readFileSync(path.join(root, name), 'utf8');
const assert = (condition, message) => { if (!condition) throw new Error(message); };

const domain = read('src/compendium/importDomain.ts');
const schemas = read('src/compendium/importV2Schemas.ts');
const docsSource = read('src/compendium/importV2Documentation.ts');
const template = read('src/compendium/importTemplate.ts');
const docs = read('docs/compendium-import-v2.md');
const jsonSchema = JSON.parse(read('docs/dnd-combat-import-v2.schema.json'));

const kindsMatch = /COMPENDIUM_ENTITY_KINDS\s*=\s*\[([\s\S]*?)\]\s*as const/.exec(domain);
assert(kindsMatch, 'Could not read COMPENDIUM_ENTITY_KINDS.');
const kinds = Array.from(kindsMatch[1].matchAll(/'([^']+)'/g), (entry) => entry[1]);
assert(kinds.length === 13, `Expected 13 kinds, found ${kinds.length}.`);
assert(schemas.includes("z.discriminatedUnion('kind'"), 'V2 schema is not discriminated by kind.');
assert(docsSource.includes('z.toJSONSchema(compendiumImportV2Schema'), 'JSON Schema generator must derive from the Zod V2 schema.');
assert(template.includes('buildImportSchemaDocumentation'), 'Extractor/template must reuse canonical schema documentation.');
assert(template.includes('IMPORT_TEMPLATE_VERSION_V2'), 'Template must target V2.');
assert(!/templateVersion:\s*STANDARD_IMPORT_TEMPLATE_VERSION/.test(template), 'Template still appears to emit the legacy V1 version constant.');
assert(docs.includes('Compatibilidade V1'), 'Canonical docs must document V1 compatibility.');
assert(docs.includes('Custom background'), 'Canonical docs must document custom background requirements.');
assert(jsonSchema.properties?.templateVersion?.const === 'dnd-combat-import.v2', 'Checked-in JSON Schema must target V2.');
for (const kind of kinds) {
  assert(docs.includes(`## ${kind === 'class' ? '8. Class' : ''}`) || docs.includes(kind) || docs.includes(kind[0].toUpperCase() + kind.slice(1)), `Docs appear to omit ${kind}.`);
  assert(jsonSchema.$defs?.[`${kind}Item`], `JSON Schema missing ${kind}Item definition.`);
}
const minimalKindsMatch = /minimalBlueprintKinds:[^=]*=\s*\[([^\]]+)\]/.exec(template);
assert(minimalKindsMatch, 'Could not inspect minimal template kinds.');
for (const kind of ['class','feature','spell','background','feat','equipment']) {
  assert(minimalKindsMatch[1].includes(`'${kind}'`), `Minimal V2 template missing ${kind}.`);
}

console.log(`Phase 07 contract OK · ${kinds.length} kinds · V2 template/docs/schema aligned.`);
