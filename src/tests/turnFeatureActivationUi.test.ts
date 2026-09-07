import fs from 'node:fs';
import path from 'node:path';

const read = (relativePath: string): string =>
  fs.readFileSync(path.resolve(process.cwd(), relativePath), 'utf8');

describe('turn feature activation UI integration', () => {
  it('exposes transient turn and action activations directly in tactical combat', () => {
    const tactical = read('app/characters/[id]/tactical.tsx');

    expect(tactical).toContain('Ativações desta resolução');
    expect(tactical).toContain('Ativações desta ação');
    expect(tactical).toContain('useCharacterChoiceBridge');
    expect(tactical).toContain('buildTurnFeatureActivationOptions(character, characterRuleItems');
    expect(tactical).toContain('spendRotationResources(character.id, rotation.id, rotation)');
    expect(tactical).toContain("activation.modifier === 'giantAncestryFiresBurn'");
    expect(tactical).toContain('pelo menos um acerto confirmado que cause dano');
  });

  it('offers a source-aware Metamagic configuration route for Sorcerer and Metamagic Adept', () => {
    const sheet = read('app/characters/[id]/index.tsx');
    const resources = read('app/characters/[id]/resources.tsx');
    const tactical = read('app/characters/[id]/tactical.tsx');
    const rotationBuilder = read('app/characters/[id]/rotations/new.tsx');
    const features = read('app/characters/[id]/features.tsx');
    const metamagic = read('app/characters/[id]/metamagic.tsx');
    const metamagicRules = read('src/characters/metamagicRules.ts');

    for (const source of [sheet, resources, tactical, rotationBuilder]) {
      expect(source).toContain('Configurar Metamagic');
      expect(source).toContain('router.push(`/characters/${character.id}/metamagic`)');
    }
    expect(features).toContain('Configurar Metamagic do Sorcerer');
    expect(metamagic).toContain('title={source.label}');
    expect(metamagicRules).toContain("label: 'Sorcerer Metamagic'");
    expect(metamagic).toContain('Alterar escolhas do feat');
    expect(metamagic).toContain('classMetamagicChoices');
  });

  it('shows the concrete persisted species option instead of only the generic Giant Ancestry pool', () => {
    const sheet = read('app/characters/[id]/index.tsx');
    const resources = read('app/characters/[id]/resources.tsx');
    const features = read('app/characters/[id]/features.tsx');

    for (const source of [sheet, resources, features]) {
      expect(source).toContain('getSelectedSpeciesFeatureChoice');
      expect(source).toContain('Escolha ativa:');
    }
    expect(sheet).toContain('getSelectedSpeciesFeatureChoice(character, characterRuleItems');
    expect(resources).toContain('getSelectedSpeciesFeatureChoice(character, characterRuleItems');
    expect(features).toContain('useCharacterChoiceBridge');
  });

  it('keeps the rotation builder able to combine a species hit rider with a Metamagic modifier', () => {
    const builder = read('app/characters/[id]/rotations/new.tsx');

    expect(builder).toContain('activationExclusiveGroup');
    expect(builder).toContain('Ativações e modificadores desta ação');
    expect(builder).toContain('Giant Ancestry');
    expect(builder).toContain('Metamagic');
    expect(builder).toContain('useCharacterChoiceBridge');
    expect(builder).toContain('buildTurnFeatureActivationOptions(character, characterRuleItems');
  });
});
