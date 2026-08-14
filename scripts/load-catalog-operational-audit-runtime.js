const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Module = require('node:module');

const loadTypeScript = () => {
  for (const candidate of ['typescript', '/opt/nvm/versions/node/v22.16.0/lib/node_modules/typescript/lib/typescript.js', '/usr/local/lib/node_modules/typescript/lib/typescript.js']) {
    try { return require(candidate); } catch {}
  }
  throw new Error('TypeScript não encontrado para carregar o verificador operacional.');
};

const sourceFiles = [
  'src/catalog/catalogBundleDigest.ts',
  'src/catalog/utils.ts',
  'src/catalog/catalogTrust.ts',
  'src/catalog/catalogTransparency.ts',
  'src/catalog/catalogDistribution.ts',
  'src/catalog/catalogPublication.ts',
  'src/catalog/catalogRolloutHealth.ts',
  'src/catalog/catalogRolloutAggregation.ts',
  'src/catalog/catalogOperationalAuthorization.ts',
  'src/catalog/catalogOperationalJournal.ts',
  'src/catalog/catalogOperationalAudit.ts',
  'src/catalog/catalogOperationalFederation.ts'
];

module.exports = function loadCatalogOperationalAuditRuntime(root) {
  const ts = loadTypeScript();
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'catalog-operational-audit-runtime-'));
  for (const relative of sourceFiles) {
    const input = path.join(root, relative);
    const output = path.join(tempRoot, relative.replace(/\.ts$/, '.js'));
    fs.mkdirSync(path.dirname(output), { recursive: true });
    fs.writeFileSync(output, ts.transpileModule(fs.readFileSync(input, 'utf8'), {
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
      fileName: input
    }).outputText);
  }
  const load = (relative) => {
    const runtimePath = path.join(tempRoot, relative.replace(/\.ts$/, '.js'));
    const runtimeModule = new Module(runtimePath, module);
    runtimeModule.filename = runtimePath;
    runtimeModule.paths = Module._nodeModulePaths(path.dirname(runtimePath));
    runtimeModule._compile(fs.readFileSync(runtimePath, 'utf8'), runtimePath);
    return runtimeModule.exports;
  };
  return {
    audit: load('src/catalog/catalogOperationalAudit.ts'),
    federation: load('src/catalog/catalogOperationalFederation.ts'),
    journal: load('src/catalog/catalogOperationalJournal.ts'),
    operation: load('src/catalog/catalogOperationalAuthorization.ts'),
    aggregation: load('src/catalog/catalogRolloutAggregation.ts'),
    publication: load('src/catalog/catalogPublication.ts'),
    trust: load('src/catalog/catalogTrust.ts'),
    utils: load('src/catalog/utils.ts')
  };
};
