#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');

const loadTypeScript = () => {
  for (const candidate of ['typescript', '/opt/nvm/versions/node/v22.16.0/lib/node_modules/typescript/lib/typescript.js', '/usr/local/lib/node_modules/typescript/lib/typescript.js']) {
    try { return require(candidate); } catch {}
  }
  throw new Error('TypeScript não encontrado.');
};
const ts = loadTypeScript();
const root = path.resolve(__dirname, '..');
const files = [];
const visit = (directory) => {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === '.git') continue;
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) visit(absolute);
    else if (!entry.name.endsWith('.d.ts') && /\.(ts|tsx)$/.test(entry.name)) files.push(absolute);
  }
};
visit(root);
const errors = [];
for (const file of files) {
  const source = fs.readFileSync(file, 'utf8');
  const sourceFile = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
  const result = ts.transpileModule(source, {
    fileName: file,
    reportDiagnostics: true,
    compilerOptions: {
      target: ts.ScriptTarget.ES2020,
      module: ts.ModuleKind.CommonJS,
      jsx: ts.JsxEmit.ReactJSX
    }
  });
  for (const diagnostic of result.diagnostics ?? []) {
    if (diagnostic.category !== ts.DiagnosticCategory.Error) continue;
    const location = diagnostic.start === undefined ? undefined : ts.getLineAndCharacterOfPosition(sourceFile, diagnostic.start);
    errors.push(`${path.relative(root, file)}${location ? `:${location.line + 1}:${location.character + 1}` : ''} ${ts.flattenDiagnosticMessageText(diagnostic.messageText, ' ')}`);
  }
}
if (errors.length) {
  console.error('[typescript:syntax:check] FAIL');
  errors.forEach((error) => console.error(`- ${error}`));
  process.exit(1);
}
console.log('[typescript:syntax:check] PASS');
console.log(`files=${files.length}`);
