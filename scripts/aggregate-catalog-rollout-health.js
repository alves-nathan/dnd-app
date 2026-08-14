#!/usr/bin/env node
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Module = require('node:module');
const crypto = require('node:crypto');
const args = process.argv.slice(2);
const value = (name) => { const index = args.indexOf(name); return index >= 0 ? args[index + 1] : undefined; };
const required = (name) => { const result = value(name); if (!result) throw new Error(`Argumento obrigatório ausente: ${name}`); return result; };
const root = path.resolve(__dirname, '..');
const loadTypeScript = () => { for (const candidate of ['typescript', '/opt/nvm/versions/node/v22.16.0/lib/node_modules/typescript/lib/typescript.js', '/usr/local/lib/node_modules/typescript/lib/typescript.js']) { try { return require(candidate); } catch {} } throw new Error('TypeScript não encontrado.'); };
const ts = loadTypeScript();
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'catalog-rollout-aggregate-'));
for (const relative of ['src/catalog/catalogBundleDigest.ts', 'src/catalog/utils.ts', 'src/catalog/catalogTrust.ts', 'src/catalog/catalogTransparency.ts', 'src/catalog/catalogDistribution.ts', 'src/catalog/catalogPublication.ts', 'src/catalog/catalogRolloutHealth.ts', 'src/catalog/catalogRolloutAggregation.ts']) {
  const file = path.join(root, relative); const output = path.join(tempRoot, relative.replace(/\.ts$/, '.js')); fs.mkdirSync(path.dirname(output), { recursive: true }); fs.writeFileSync(output, ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS }, fileName: file }).outputText);
}
const loadRuntime = (relative) => { const runtimePath = path.join(tempRoot, relative.replace(/\.ts$/, '.js')); const runtimeModule = new Module(runtimePath, module); runtimeModule.filename = runtimePath; runtimeModule.paths = Module._nodeModulePaths(path.dirname(runtimePath)); runtimeModule._compile(fs.readFileSync(runtimePath, 'utf8'), runtimePath); return runtimeModule.exports; };
const aggregation = loadRuntime('src/catalog/catalogRolloutAggregation.ts');
const submissionsDocument = JSON.parse(fs.readFileSync(path.resolve(required('--submissions')), 'utf8'));
const submissions = Array.isArray(submissionsDocument) ? submissionsDocument : submissionsDocument.submissions;
if (!Array.isArray(submissions)) throw new Error('O arquivo de submissões precisa conter um array.');
const policy = JSON.parse(fs.readFileSync(path.resolve(required('--policy')), 'utf8'));
const publication = JSON.parse(fs.readFileSync(path.resolve(required('--publication')), 'utf8'));
const privateDocument = JSON.parse(fs.readFileSync(path.resolve(required('--private-key')), 'utf8'));
const privateJwk = privateDocument.privateJwk || privateDocument;
const report = aggregation.buildCatalogRolloutAggregateReport({ submissions, policy, publication, reportPublisherId: value('--publisher-id') || policy.publisherId, reportKeyId: value('--key-id') || policy.keyId });
report.signature = crypto.sign('sha256', Buffer.from(aggregation.catalogRolloutAggregateReportPayload(report)), { key: crypto.createPrivateKey({ key: privateJwk, format: 'jwk' }), dsaEncoding: 'ieee-p1363' }).toString('base64url');
const outputPath = path.resolve(required('--output'));
fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify({ status: 'PASS', output: outputPath, reportId: report.reportId, contributors: report.uniqueContributors, duplicates: report.duplicateSubmissions, rejected: report.rejectedSubmissions, health: report.status, recommendation: report.recommendation }, null, 2));
