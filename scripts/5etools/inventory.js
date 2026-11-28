#!/usr/bin/env node
'use strict';

// Offline inventory: reads immutable Git objects, never the working tree.
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const SCHEMA = 'dnd-upstream-inventory.v1';
const cmp = (a, b) => a < b ? -1 : a > b ? 1 : 0;
const sorted = values => [...values].sort(cmp);
const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const assertDate = value => {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) ||
      Number.isNaN(Date.parse(value)) || new Date(value).toISOString().slice(0, 10) !== value) {
    throw new Error('Expected YYYY-MM-DD: ' + value);
  }
  return value;
};
const git = (root, args) => execFileSync('git', ['-C', root, ...args], {
  encoding: 'utf8', maxBuffer: 128 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe']
});
function openSnapshot(root, ref = 'HEAD') {
  if (typeof ref !== 'string' || ref.startsWith('-')) throw new Error('Invalid Git ref');
  const commit = git(root, ['rev-parse', '--verify', ref + '^{commit}']).trim();
  const files = new Map();
  for (const entry of git(root, ['ls-tree', '-r', '-z', commit]).split('\0').filter(Boolean)) {
    const tab = entry.indexOf('\t');
    const [mode, type, hash] = entry.slice(0, tab).split(' ');
    const name = entry.slice(tab + 1);
    if (type === 'blob' && mode !== '120000' && name.endsWith('.json')) files.set(name, hash);
  }
  return {
    commit, files,
    readJson(name) {
      if (!files.has(name)) throw new Error('Missing tracked JSON: ' + name);
      return JSON.parse(git(root, ['show', commit + ':' + name]));
    }
  };
}
function buildInventory(main, homebrew, asOf) {
  assertDate(asOf);
  const sources = new Map();
  const diagnostics = [];
  const get = (origin, code) => {
    if (typeof code !== 'string' || !code.trim()) throw new Error('Invalid source code');
    const id = origin + ':' + code;
    if (!sources.has(id)) sources.set(id, { id, origin, code, publications: [], paths: new Set() });
    return sources.get(id);
  };
  for (const [name, key] of [['books', 'book'], ['adventures', 'adventure']]) {
    const file = 'data/' + name + '.json';
    const list = main.readJson(file)[key];
    if (!Array.isArray(list)) throw new Error('Invalid catalog: ' + file);
    for (const row of list) {
      if (!record(row) || typeof row.name !== 'string') throw new Error('Invalid publication: ' + file);
      const source = get('main', row.source ?? row.id);
      let published = null;
      if (row.published != null) {
        try { published = assertDate(row.published); }
        catch { diagnostics.push({ code: 'invalidPublicationDate', sourceId: source.id, path: file }); }
      }
      source.publications.push({ id: row.id ?? source.code, kind: key, title: row.name, published });
    }
  }
  function registerPath(source, snapshot, name) {
    if (typeof name !== 'string' || !snapshot.files.has(name)) {
      diagnostics.push({ code: 'unresolvedIndexedPath', sourceId: source.id, path: String(name) });
      return;
    }
    source.paths.add(name);
  }
  for (const category of ['spells', 'bestiary']) {
    const dir = 'data/' + category + '/';
    const index = main.readJson(dir + 'index.json');
    if (!record(index)) throw new Error('Invalid index: ' + dir);
    for (const [code, file] of Object.entries(index)) {
      if (typeof file !== 'string') throw new Error('Invalid indexed filename: ' + code);
      registerPath(get('main', code), main, dir + file);
    }
  }
  const brewIndex = homebrew.readJson('_generated/index-sources.json');
  if (!record(brewIndex)) throw new Error('Invalid homebrew source index');
  for (const [code, file] of Object.entries(brewIndex)) {
    registerPath(get('homebrew', code), homebrew, file);
  }
  const snapshots = { main, homebrew };
  const outputSources = [...sources.values()].sort((a, b) => cmp(a.id, b.id)).map(source => {
    const publications = source.publications.sort((a,b) => cmp(JSON.stringify(a), JSON.stringify(b)));
    const dates = publications.map(p => p.published);
    const known = dates.length > 0 && dates.every(Boolean);
    const releaseStatus = !known ? 'unknown' : dates.every(d => d > asOf) ? 'upcoming' :
      dates.every(d => d <= asOf) ? 'catalog-date-reached' : 'mixed';
    return { ...source, publications, releaseStatus, activation: 'review-required',
      paths: sorted(source.paths).map(p => ({ path: p, blob: snapshots[source.origin].files.get(p) })) };
  });
  const files = [];
  for (const origin of ['main', 'homebrew']) {
    for (const p of sorted(snapshots[origin].files.keys())) {
      if (origin === 'main' && !p.startsWith('data/')) continue;
      if (origin === 'homebrew' && p.startsWith('_') && !p.startsWith('_generated/')) continue;
      files.push({ origin, path: p, blob: snapshots[origin].files.get(p) });
    }
  }
  return { schemaVersion: SCHEMA, asOf, commits: { main: main.commit, homebrew: homebrew.commit },
    sources: outputSources, files, diagnostics };
}
function diffInventories(previous, current) {
  if (previous?.schemaVersion !== SCHEMA || current?.schemaVersion !== SCHEMA) {
    throw new Error('Incompatible inventory schema');
  }
  const diff = (before, after, key, compare) => {
    const a = new Map(before.map(x => [key(x), x]));
    const b = new Map(after.map(x => [key(x), x]));
    return {
      added: sorted([...b.keys()].filter(k => !a.has(k))),
      removed: sorted([...a.keys()].filter(k => !b.has(k))),
      changed: sorted([...b.keys()].filter(k => a.has(k) && compare(a.get(k), b.get(k))))
    };
  };
  return {
    sources: diff(previous.sources, current.sources, x => x.id, (a,b) => JSON.stringify(a) !== JSON.stringify(b)),
    files: diff(previous.files, current.files, x => x.origin + ':' + x.path, (a,b) => a.blob !== b.blob),
    releaseStatusChanged: current.sources.filter(s => {
      const prior = previous.sources.find(p => p.id === s.id);
      return prior && prior.releaseStatus !== s.releaseStatus;
    }).map(s => s.id),
    activation: 'review-required'
  };
}
function run(args) {
  const options = {};
  const allowed = new Set(['--main', '--homebrew', '--main-ref', '--homebrew-ref', '--out', '--previous', '--as-of']);
  for (let i = 0; i < args.length; i += 2) {
    const key = args[i], value = args[i+1];
    if (!allowed.has(key) || !value || value.startsWith('--') || options[key]) throw new Error('Invalid option: ' + key);
    options[key] = value;
  }
  for (const key of ['--main', '--homebrew', '--out']) if (!options[key]) throw new Error('Required: ' + key);
  const asOf = options['--as-of'] ?? new Date().toISOString().slice(0,10);
  const result = buildInventory(openSnapshot(options['--main'], options['--main-ref']),
    openSnapshot(options['--homebrew'], options['--homebrew-ref']), asOf);
  const changes = options['--previous'] ? diffInventories(JSON.parse(fs.readFileSync(options['--previous'], 'utf8')), result) : null;
  const out = path.resolve(options['--out']);
  if (fs.existsSync(out)) throw new Error('Output already exists; use a new snapshot path: ' + out);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, JSON.stringify({ ...result, changes }, null, 2) + '\n', { flag: 'wx' });
  console.log(JSON.stringify({ out, commits: result.commits, sources: result.sources.length, diagnostics: result.diagnostics.length, changes }));
  if (result.diagnostics.length) process.exitCode = 2;
}
module.exports = { openSnapshot, buildInventory, diffInventories, assertDate };
if (require.main === module) {
  try { run(process.argv.slice(2)); } catch (error) { console.error(error.message); process.exitCode = 1; }
}
