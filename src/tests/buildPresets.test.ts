import { createDefaultCharacter } from '../data/mockData';
import { applyBuildPresetToCharacter, createBuildPresetFromCharacter } from '../presets/buildPresets';

describe('build presets', () => {
  it('creates a reusable preset from a character snapshot', () => {
    const character = createDefaultCharacter('Preset Source');
    const preset = createBuildPresetFromCharacter(character, 'Blade preset', 'Reusable build', ['blade']);

    expect(preset.name).toBe('Blade preset');
    expect(preset.snapshot.weapons).toHaveLength(character.weapons.length);
    expect(preset.snapshot.rotations).toHaveLength(character.rotations.length);
    expect(preset.tags).toEqual(['blade']);
  });

  it('merges a preset into another character without duplicating names already present', () => {
    const source = createDefaultCharacter('Source');
    const target = createDefaultCharacter('Target');
    const preset = createBuildPresetFromCharacter(source, 'Manual preset');

    const merged = applyBuildPresetToCharacter(target, preset, { mode: 'merge', includeRotations: true, includeEquipment: true, includeResources: true });

    expect(merged.weapons.length).toBe(target.weapons.length);
    expect(merged.rotations.length).toBe(target.rotations.length + source.rotations.length);
  });

  it('replaces the build while preserving the character identity', () => {
    const source = createDefaultCharacter('Source');
    const target = createDefaultCharacter('Target');
    source.weapons[0] = { ...source.weapons[0]!, name: 'Preset Weapon' };
    const preset = createBuildPresetFromCharacter(source, 'Replace preset');

    const replaced = applyBuildPresetToCharacter(target, preset, { mode: 'replaceBuild', includeRotations: false, includeEquipment: true, includeResources: true });

    expect(replaced.id).toBe(target.id);
    expect(replaced.name).toBe(target.name);
    expect(replaced.weapons.some((weapon) => weapon.name === 'Preset Weapon')).toBe(true);
    expect(replaced.rotations).toEqual(target.rotations);
  });
});
