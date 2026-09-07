import fs from 'fs';
import path from 'path';
import type { StoredCompendiumItem } from '../compendium/types';
import { isPlayerCharacterClassItem, isSidekickClassItem } from '../characters/classSelectionRules';

const storedClass = (input: {
  id: string;
  name: string;
  sidekickClass?: boolean;
  tags?: string[];
  hitDie?: number;
}): StoredCompendiumItem => ({
  id: `test-pack:${input.id}`,
  importItemId: input.id,
  packId: 'test-pack',
  sourceId: 'test-source',
  type: 'class',
  name: input.name,
  rawJson: {
    id: input.id,
    kind: 'class',
    name: input.name,
    source: { id: 'test-source', status: 'active', confidence: 'exact' },
    payload: {}
  },
  normalizedJson: {
    id: input.id,
    name: input.name,
    type: 'class',
    hitDie: input.hitDie ?? (input.sidekickClass ? undefined : 10),
    mechanics: input.sidekickClass === undefined ? undefined : { sidekickClass: input.sidekickClass }
  },
  tags: input.tags ?? ['class'],
  status: 'validated',
  createdAt: '2026-08-12T00:00:00.000Z',
  updatedAt: '2026-08-12T00:00:00.000Z'
});

describe('player character class selection', () => {
  it('excludes structurally marked sidekick classes without relying on their names', () => {
    for (const name of ['Expert', 'Spellcaster', 'Warrior']) {
      const item = storedClass({ id: `tcoe-2020-class-sidekick-${name.toLowerCase()}`, name, sidekickClass: true });
      expect(isSidekickClassItem(item)).toBe(true);
      expect(isPlayerCharacterClassItem(item)).toBe(false);
    }
    expect(isPlayerCharacterClassItem(storedClass({ id: 'phb-2024-class-fighter', name: 'Fighter' }))).toBe(true);
  });

  it('rejects class-typed option records that do not carry a player-class chassis', () => {
    expect(isPlayerCharacterClassItem(storedClass({
      id: 'legacy-class-option',
      name: 'Legacy Class Option',
      hitDie: 0
    }))).toBe(false);
  });

  it('keeps compatibility with older snapshots that only retain the sidekick tag/id', () => {
    expect(isSidekickClassItem(storedClass({ id: 'legacy-expert', name: 'Expert', tags: ['class', 'sidekick'] }))).toBe(true);
    expect(isSidekickClassItem(storedClass({ id: 'tcoe-2020-class-sidekick-warrior', name: 'Warrior' }))).toBe(true);
  });

  it('keeps sidekick content in the Tasha bundle while the player-character UI filters it', () => {
    const tasha = JSON.parse(fs.readFileSync(
      path.join(process.cwd(), 'assets/compendium/tcoe-2020-2024-compatible-import-pack-v2-canonical.json'),
      'utf8'
    )) as { items: Array<{ id: string; kind: string; name: string; payload?: { mechanics?: { sidekickClass?: boolean } } }> };
    const sidekickClasses = tasha.items.filter((item) => item.kind === 'class' && item.payload?.mechanics?.sidekickClass === true);
    expect(sidekickClasses.map((item) => item.name).sort()).toEqual(['Expert', 'Spellcaster', 'Warrior']);

    const creationSource = fs.readFileSync(path.join(process.cwd(), 'app/characters/new.tsx'), 'utf8');
    const levelUpSource = fs.readFileSync(path.join(process.cwd(), 'app/characters/[id]/level-up.tsx'), 'utf8');
    expect(creationSource).toContain('.filter(isPlayerCharacterClassItem)');
    expect(levelUpSource).toContain('.filter(isPlayerCharacterClassItem)');
  });
});
