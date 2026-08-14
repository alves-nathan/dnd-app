import fs from 'node:fs';
import path from 'node:path';

const read = (relativePath: string): string =>
  fs.readFileSync(path.resolve(process.cwd(), relativePath), 'utf8');

describe('custom feat/feature UI contracts', () => {
  it('exposes custom creation from both feat and feature screens', () => {
    const feats = read('app/characters/[id]/feats.tsx');
    const features = read('app/characters/[id]/features.tsx');
    const customRule = read('app/characters/[id]/custom-rule.tsx');

    expect(feats).toContain('Criar feat personalizado');
    expect(features).toContain('Criar feature personalizada');
    expect(customRule).toContain('Preencher exemplo Friendly Fire');
    expect(customRule).toContain("setDamageType('fire')");
    expect(customRule).toContain("setTriggerDieSides('8')");
    expect(customRule).toContain("setTriggerRadiusFeet('30')");
    expect(customRule).toContain("setTriggerSaveAbility('DEX')");
    expect(customRule).toContain("item.name.trim().toLowerCase() === 'fire bolt'");
    expect(customRule).toContain('Adicionar à lista da classe');
    expect(customRule).toContain("setSpellAccessMode('list')");
    expect(customRule).toContain('spellListAdditions');
    expect(customRule).toContain('spellReplacementEnabled');
    expect(customRule).toContain("setSpellReplacementRecharge('longRest')");
    expect(customRule).toContain('Dimensão afetada');
    expect(customRule).toContain('Conceder');
    expect(customRule).toContain('Remover');
    expect(customRule).toContain('× bônus de proficiência (PB)');
    expect(customRule).toContain('× modificador de atributo');
    expect(customRule).toContain('Tipos de dano');
    expect(customRule).toContain('Escolas de magia');
    expect(customRule).toContain('Dano recebido');
    expect(customRule).toContain('Vantagem');
    expect(customRule).toContain('Desvantagem');
    expect(customRule).toContain('modifiers: customModifiers.length');
  });

  it('keeps tools inherited from a background visually selected without consuming class choices', () => {
    const creation = read('app/characters/new.tsx');
    const selector = read('src/components/ChoiceChipSelector.tsx');

    expect(creation).toContain('lockedSelectedValues={inheritedBackgroundTools');
    expect(creation).toContain('customBackground.toolProficiency');
    expect(creation).toContain('elas não consomem as escolhas adicionais da classe');
    expect(selector).toContain('lockedSelectedValues?: string[]');
    expect(selector).toContain('lockedSelectedValues.includes(option)');
  });

  it('records a damage type for manual spells so homebrew damage modifiers can recognize them', () => {
    const spells = read('app/characters/[id]/spells.tsx');
    expect(spells).toContain('testIDPrefix="manual-spell-damage-type"');
    expect(spells).toContain('damageType: damageType || undefined');
    expect(spells).toContain('getSpellReplacementRules');
    expect(spells).toContain("source: activeReplacementChoice || activeSelectionChoice ? 'levelUp' : activeCustomReplacementRule && replacement ? 'feature' : 'manual'");
  });
});
