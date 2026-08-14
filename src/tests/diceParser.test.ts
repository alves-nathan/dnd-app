import { parseDamageFormula } from '../rules-engine/dice/parser';

describe('parseDamageFormula', () => {
  it('parses dice plus ability', () => {
    const formula = parseDamageFormula('1d8 + STR');
    expect(formula.components).toHaveLength(2);
    expect(formula.components[0]?.kind).toBe('dice');
    expect(formula.components[1]?.kind).toBe('abilityModifier');
  });

  it('parses multiple dice, proficiency and flat numbers', () => {
    const formula = parseDamageFormula('2d6 + 1d8 + CHA + PB + 2');
    expect(formula.components.map((component) => component.kind)).toEqual(['dice', 'dice', 'abilityModifier', 'proficiencyBonus', 'flat']);
  });

  it('keeps unknown symbols as variables instead of inventing rules', () => {
    const formula = parseDamageFormula('1d12 + modificador_magico');
    expect(formula.components.some((component) => component.kind === 'customVariable')).toBe(true);
  });
});
