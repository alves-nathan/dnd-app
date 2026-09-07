import { buildPersistedCompendiumImport } from '../compendium/importer';
import { applyCompendiumItemToCharacter } from '../compendium/mapper';
import { buildSpellAction } from '../rules-engine/actions/buildActions';
import { createDefaultCharacter } from '../data/mockData';
import { CompendiumImportInput } from '../compendium/schemas';

const source = { id: 'test-source', book: 'Legal Test Source', page: '10', version: '2024', status: 'active' as const, confidence: 'exact' as const };

const buildItem = (kind: CompendiumImportInput['items'][number]['kind'], payload: Record<string, unknown>) => {
  const pack = buildPersistedCompendiumImport({
    id: `pack-${kind}`,
    source,
    items: [{ id: `${kind}-1`, kind, name: `Imported ${kind}`, summary: 'Mapped in tests.', source, payload }]
  });
  return pack.items[0]!;
};

describe('compendium mapper', () => {
  it('applies a validated imported weapon to a character and preserves the link', () => {
    const character = createDefaultCharacter('Mapper Test');
    const item = buildItem('weapon', { damageFormula: '1d8 + STR', attackAbility: 'STR', magicBonus: 1, weaponType: 'melee' });

    const result = applyCompendiumItemToCharacter(character, item);

    expect(result.ok).toBe(true);
    expect(result.character.weapons).toHaveLength(character.weapons.length + 1);
    const weapon = result.character.weapons[result.character.weapons.length - 1]!;
    expect(weapon.damage.raw).toBe('1d8 + STR');
    expect(weapon.magicBonus).toBe(1);
    expect(result.character.compendiumLinks).toHaveLength(1);
    expect(result.character.compendiumLinks?.[0].itemId).toBe(item.id);
  });

  it('applies a validated imported spell to a character', () => {
    const character = createDefaultCharacter('Mapper Test');
    const item = buildItem('spell', { damageFormula: '2d10', damageType: 'fire', level: 0, castingTime: 'action', requiresAttackRoll: true, targets: 1 });

    const result = applyCompendiumItemToCharacter(character, item);

    expect(result.ok).toBe(true);
    expect(result.character.spells).toHaveLength(character.spells.length + 1);
    const spell = result.character.spells[result.character.spells.length - 1]!;
    expect(spell.damage?.raw).toBe('2d10');
    expect(spell.damageType).toBe('fire');
    expect(buildSpellAction(result.character, spell.id)?.damageTypes).toEqual(['fire']);
    expect(result.character.compendiumLinks?.[0].appliedAs).toBe('spell');
  });


  it('maps imported speciesTrait features to the speciesFeature damage/source domain', () => {
    const character = createDefaultCharacter('Species Feature Mapper Test');
    const item = buildItem('feature', { sourceType: 'speciesTrait', speciesId: 'goliath-test' });

    const result = applyCompendiumItemToCharacter(character, item);

    expect(result.ok).toBe(true);
    expect(result.character.features.at(-1)?.sourceType).toBe('speciesFeature');
  });

  it('preserves explicit Attack action capacity from imported progression features', () => {
    const character = createDefaultCharacter('Mapper Test');
    const item = buildItem('feature', { sourceType: 'classFeature', attackActionAttackCount: 3 });

    const result = applyCompendiumItemToCharacter(character, item);

    expect(result.ok).toBe(true);
    expect(result.character.features.at(-1)?.attackActionAttackCount).toBe(3);
  });

  it('blocks an item that still needs review', () => {
    const character = createDefaultCharacter('Mapper Test');
    const pack = buildPersistedCompendiumImport({
      id: 'pack-review',
      source: { ...source, confidence: 'manual' },
      items: [{ id: 'review-weapon', kind: 'weapon', name: 'Review Weapon', source: { ...source, confidence: 'manual' }, payload: { damageFormula: '1d6 + DEX' } }]
    });

    const result = applyCompendiumItemToCharacter(character, pack.items[0]!);

    expect(result.ok).toBe(false);
    expect(result.issues[0]!.code).toBe('COMPENDIUM_ITEM_NOT_VALIDATED');
  });

  it('does not apply the same active compendium item twice', () => {
    const character = createDefaultCharacter('Mapper Test');
    const item = buildItem('weapon', { damageFormula: '1d8 + STR' });
    const first = applyCompendiumItemToCharacter(character, item);

    const second = applyCompendiumItemToCharacter(first.character, item);

    expect(first.ok).toBe(true);
    expect(second.ok).toBe(false);
    expect(second.issues[0]!.code).toBe('COMPENDIUM_ITEM_ALREADY_LINKED');
  });
});
