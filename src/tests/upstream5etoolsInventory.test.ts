const { buildInventory, diffInventories, assertDate, openSnapshot } = require('../../scripts/5etools/inventory');
const { mkdtempSync, writeFileSync, mkdirSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const { execFileSync } = require('node:child_process');

const snapshot = (commit: string, data: Record<string, unknown>, hashes: Record<string, string> = {}) => ({
  commit,
  files: new Map(Object.keys(data).map(p => [p, hashes[p] ?? 'blob-' + p])),
  readJson: (p: string) => {
    if (!(p in data)) throw new Error('Missing: ' + p);
    return data[p];
  }
});
const main = (extra: Record<string, unknown> = {}, hashes: Record<string, string> = {}) => snapshot('main-sha', {
  'data/books.json': { book: [{ id: 'AU', source: 'AU', name: 'Arcana Unleashed', published: '2026-09-15' },
    { id: 'WoW', source: 'WoW', name: 'World of Warcraft', published: '2026-11-17' }] },
  'data/adventures.json': { adventure: [{ id: 'AU-adventure', source: 'AU', name: 'Example', published: '2026-09-15' }] },
  'data/spells/index.json': { AU: 'spells-au.json', WoW: 'spells-wow.json', Unlisted: 'unlisted.json' },
  'data/spells/spells-au.json': {}, 'data/spells/spells-wow.json': {}, 'data/spells/unlisted.json': {},
  'data/bestiary/index.json': {}, 'data/feats.json': {}, ...extra
}, hashes);
const brew = (extra: Record<string, unknown> = {}) => snapshot('brew-sha', {
  '_generated/index-sources.json': { AU: 'collection/example.json' },
  'collection/example.json': {}, ...extra
});
describe('offline upstream inventory', () => {
  test('preserves source namespaces, multiple publications and unlisted indexed sources', () => {
    const result = buildInventory(main(), brew(), '2026-11-12');
    expect(result.sources.map((s: {id: string}) => s.id)).toEqual(['homebrew:AU', 'main:AU', 'main:Unlisted', 'main:WoW']);
    expect(result.sources.find((s: {id: string}) => s.id === 'main:AU').publications).toHaveLength(2);
    expect(result.sources.find((s: {id: string}) => s.id === 'main:Unlisted').releaseStatus).toBe('unknown');
    expect(result.sources.every((s: {activation: string}) => s.activation === 'review-required')).toBe(true);
  });
  test('detects release transition without a commit change', () => {
    const a = buildInventory(main(), brew(), '2026-11-12');
    const b = buildInventory(main(), brew(), '2026-11-17');
    expect(diffInventories(a,b).releaseStatusChanged).toEqual(['main:WoW']);
    expect(diffInventories(a,b).files.changed).toEqual([]);
  });
  test('detects indexed and shared file changes without attributing shared changes to one source', () => {
    const a = buildInventory(main(), brew(), '2026-11-12');
    const b = buildInventory(main({}, {'data/spells/spells-au.json': 'new', 'data/feats.json': 'new'}), brew(), '2026-11-12');
    const changes = diffInventories(a,b);
    expect(changes.sources.changed).toEqual(['main:AU']);
    expect(changes.files.changed).toEqual(['main:data/feats.json','main:data/spells/spells-au.json']);
  });
  test('detects additions and removals as review work, not runtime mutations', () => {
    const a = buildInventory(main(), brew(), '2026-11-12');
    const b = buildInventory(main({'data/spells/index.json': { AU: 'spells-au.json', New: 'new.json' }, 'data/spells/new.json': {}}), brew(), '2026-11-12');
    const changes = diffInventories(a,b);
    expect(changes.sources.added).toEqual(['main:New']);
    expect(changes.sources.removed).toEqual(['main:Unlisted']);
    expect(changes.activation).toBe('review-required');
  });
  test('reports missing indexed paths and rejects malformed dates and indexes', () => {
    expect(buildInventory(main({'data/spells/index.json': { AU: 'missing.json' }}), brew(), '2026-11-12').diagnostics).toEqual([
      {code: 'unresolvedIndexedPath', sourceId: 'main:AU', path: 'data/spells/missing.json'}
    ]);
    expect(() => assertDate('2026-02-30')).toThrow();
    expect(() => buildInventory(main({'data/spells/index.json': []}), brew(), '2026-11-12')).toThrow();
  });
  test('reads committed Git objects, not modified working-tree content', () => {
    const root = mkdtempSync(join(tmpdir(), 'dnd-upstream-test-'));
    try {
      const git = (...args: string[]) => execFileSync('git', ['-C', root, ...args], {encoding: 'utf8', stdio: ['ignore','pipe','pipe']});
      git('init'); git('config','user.email','fixture@example.invalid'); git('config','user.name','Fixture');
      mkdirSync(join(root,'data'));
      writeFileSync(join(root,'data','book.json'), '{"value":1}');
      git('add','.'); git('commit','-m','fixture');
      writeFileSync(join(root,'data','book.json'), '{"value":2}');
      const s = openSnapshot(root);
      expect(s.readJson('data/book.json')).toEqual({value:1});
      expect(s.commit).toMatch(/^[a-f0-9]{40,64}$/);
    } finally { rmSync(root,{recursive:true,force:true}); }
  });
});
export {};
