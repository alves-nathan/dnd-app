import type { RuleSource } from '../types';
import {
  buildImportedCompendiumSourceRows,
  formatImportedCompendiumSourceLabel,
  type CompendiumContentBundledDefinitionLike,
  type CompendiumContentItemLike,
  type CompendiumContentPackLike
} from '../compendium/contentManagementSources';

const source = (id: string, book = id, version?: string): RuleSource => ({
  id,
  book,
  version,
  status: 'active',
  confidence: 'exact'
});

const pack = (id: string, sourceId: string): CompendiumContentPackLike => ({ id, sourceId });
const item = (sourceId: string): CompendiumContentItemLike => ({ sourceId });

const bundled: readonly CompendiumContentBundledDefinitionLike[] = [
  { id: 'spelljammer-base', sourceId: 'spelljammer-2022' },
  { id: 'phb-2014-base', sourceId: 'phb-2014' }
];

describe('content management imported source federation', () => {
  it('shows non-bundled imported books and keeps their enabled state', () => {
    const rows = buildImportedCompendiumSourceRows({
      sources: [
        source('spelljammer-2022'),
        source('xgte-2017', 'xgte'),
        source('bomt-2023', 'the-book-of-many-things')
      ],
      packs: [
        pack('spelljammer-base', 'spelljammer-2022'),
        pack('xgte-pack', 'xgte-2017'),
        pack('bomt-pack', 'bomt-2023')
      ],
      items: [
        item('spelljammer-2022'),
        item('xgte-2017'),
        item('xgte-2017'),
        item('bomt-2023')
      ],
      enabledSourceIds: ['xgte-2017'],
      bundledDefinitions: bundled
    });

    expect(rows.map((row) => row.sourceId)).toEqual(['bomt-2023', 'xgte-2017']);
    expect(rows.find((row) => row.sourceId === 'xgte-2017')).toMatchObject({
      label: "Xanathar's Guide to Everything (2017)",
      itemCount: 2,
      packCount: 1,
      enabled: true
    });
    expect(rows.find((row) => row.sourceId === 'bomt-2023')).toMatchObject({
      label: 'The Book of Many Things (2023)',
      itemCount: 1,
      enabled: false
    });
  });

  it('does not expose correction/delta packs as separate books when they share a bundled source', () => {
    const rows = buildImportedCompendiumSourceRows({
      sources: [source('spelljammer-2022'), source('phb-2014')],
      packs: [
        pack('spelljammer-base', 'spelljammer-2022'),
        pack('giff-correction', 'spelljammer-2022'),
        pack('phb-2014-base', 'phb-2014'),
        pack('phb-2014-runtime-delta', 'phb-2014')
      ],
      items: [item('spelljammer-2022'), item('phb-2014'), item('phb-2014')],
      enabledSourceIds: [],
      bundledDefinitions: bundled
    });

    expect(rows).toEqual([]);
  });

  it('groups multiple local packs by source instead of creating duplicate book rows', () => {
    const rows = buildImportedCompendiumSourceRows({
      sources: [source('custom-source', 'custom-source', '2026')],
      packs: [pack('custom-base', 'custom-source'), pack('custom-delta', 'custom-source')],
      items: [item('custom-source'), item('custom-source')],
      enabledSourceIds: ['custom-source'],
      bundledDefinitions: bundled
    });

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      sourceId: 'custom-source',
      label: 'Custom Source (2026)',
      itemCount: 2,
      packCount: 2,
      enabled: true
    });
  });

  it('humanizes unknown source labels while preserving explicit version metadata', () => {
    expect(formatImportedCompendiumSourceLabel(source('my-homebrew', 'my-homebrew', 'v3')))
      .toBe('My Homebrew (v3)');
  });
});
