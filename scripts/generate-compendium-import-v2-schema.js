const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

// Small local TS require hook for build-time artifact generation. This avoids
// adding tsx/ts-node just to materialize the JSON Schema from the app's Zod schema.
require.extensions['.ts'] = (module, filename) => {
  const source = fs.readFileSync(filename, 'utf8');
  const output = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      esModuleInterop: true,
      moduleResolution: ts.ModuleResolutionKind.Node10
    },
    fileName: filename
  }).outputText;
  module._compile(output, filename);
};

const root = path.resolve(__dirname, '..');
const { buildImportV2JsonSchemaText } = require(path.join(root, 'src/compendium/importV2Documentation.ts'));
const outputPath = path.join(root, 'docs/dnd-combat-import-v2.schema.json');
fs.writeFileSync(outputPath, `${buildImportV2JsonSchemaText()}\n`);
console.log(`Generated ${path.relative(root, outputPath)} from compendiumImportV2Schema.`);
