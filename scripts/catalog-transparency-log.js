#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const args = process.argv.slice(2);
const command = args[0];
const value = (name) => { const index = args.indexOf(name); return index >= 0 ? args[index + 1] : undefined; };
const stable = (input) => Array.isArray(input) ? input.map(stable) : input && typeof input === 'object' ? Object.keys(input).sort().reduce((out, key) => { if (input[key] !== undefined) out[key] = stable(input[key]); return out; }, {}) : input;
const hash = (text) => crypto.createHash('sha256').update(text).digest('hex');
const leafHash = (payload) => hash(`catalog-transparency-leaf:${JSON.stringify(stable(payload))}`);
const nodeHash = (left, right) => hash(`catalog-transparency-node:${left}:${right}`);
const root = (leaves) => { if (!leaves.length) return hash('catalog-transparency-empty'); let level = [...leaves]; while (level.length > 1) { const next=[]; for(let i=0;i<level.length;i+=2) next.push(nodeHash(level[i], level[i+1] || level[i])); level=next; } return level[0]; };
if (command === 'verify') {
  const log = JSON.parse(fs.readFileSync(path.resolve(value('--log')), 'utf8'));
  const leaves = log.entries.map((entry, index) => { const { index: storedIndex, leafHash: storedHash, ...payload } = entry; if (storedIndex !== index || leafHash(payload) !== storedHash) throw new Error(`Entrada ${index} inválida.`); return storedHash; });
  if (root(leaves) !== log.treeRoot) throw new Error('Raiz Merkle inválida.');
  console.log(JSON.stringify({ status: 'PASS', logId: log.logId, entries: log.entries.length, treeRoot: log.treeRoot }, null, 2));
} else if (command === 'compare') {
  const local = JSON.parse(fs.readFileSync(path.resolve(value('--local')), 'utf8'));
  const remote = JSON.parse(fs.readFileSync(path.resolve(value('--remote')), 'utf8'));
  const shared = Math.min(local.entries.length, remote.entries.length);
  let relation = 'identical';
  for (let i=0;i<shared;i+=1) if (local.entries[i].leafHash !== remote.entries[i].leafHash) relation = 'forked';
  if (relation !== 'forked') relation = local.entries.length === remote.entries.length ? (local.treeRoot === remote.treeRoot ? 'identical' : 'forked') : local.entries.length < remote.entries.length ? 'remoteAhead' : 'localAhead';
  console.log(JSON.stringify({ status: ['forked','localAhead'].includes(relation) ? 'REJECTED' : 'PASS', relation }, null, 2));
  if (['forked','localAhead'].includes(relation)) process.exitCode = 2;
} else {
  console.error('Uso: catalog-transparency-log.js verify --log <arquivo> | compare --local <arquivo> --remote <arquivo>');
  process.exitCode = 1;
}
