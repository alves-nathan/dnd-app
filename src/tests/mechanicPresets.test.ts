import { createDefaultCharacter } from '../data/mockData';
import { analyzeActionDamage } from '../rules-engine/damage/calculateDamage';
import { addActiveEffectToCharacter } from '../rules-engine/effects/activeEffects';
import { createActiveEffectFromTemplate } from '../rules-engine/effects/derivedEffects';
import { applyMechanicPresetToCharacter, createMechanicPresetDraft } from '../presets/mechanicPresets';

const withValues = (blueprintId: string, values: Record<string, string>) => ({
  ...createMechanicPresetDraft(blueprintId),
  values: { ...createMechanicPresetDraft(blueprintId).values, ...values }
});

describe('mechanic presets', () => {
  it('creates a marked target feature with conditional damage and effect template', () => {
    const character = createDefaultCharacter('Preset Tester');
    const draft = withValues('marked-target-extra-damage', {
      featureName: 'Marked Damage',
      effectName: 'Marked Target',
      conditionId: 'marked-target',
      damageFormula: '1d6',
      actionName: 'Marked Extra Damage',
      oncePerTurnKey: 'marked-damage',
      concentration: 'sim'
    });

    const result = applyMechanicPresetToCharacter(character, draft);

    expect(result.feature).toBeDefined();
    expect(result.effectTemplate?.conditionIds).toEqual(['marked-target']);
    expect(result.effectTemplate?.concentration).toBe(true);
    expect(result.action?.damage.components[0]?.application).toBe('conditional');
    expect(result.character.features.some((feature) => feature.name === 'Marked Damage')).toBe(true);
  });

  it('does not count conditional damage until its effect is active', () => {
    const character = createDefaultCharacter('Preset Tester');
    const draft = withValues('marked-target-extra-damage', {
      featureName: 'Marked Damage',
      effectName: 'Marked Target',
      conditionId: 'marked-target',
      damageFormula: '1d6',
      actionName: 'Marked Extra Damage'
    });

    const result = applyMechanicPresetToCharacter(character, draft);
    const action = result.feature?.grantsActions?.[0];
    expect(action).toBeDefined();

    const inactive = analyzeActionDamage({
      action: action!,
      character: result.character,
      combatState: { rollMode: 'normal', targetCount: 1, resistanceMultiplier: 1 }
    });
    expect(inactive.total.average).toBe(0);

    const withEffect = addActiveEffectToCharacter(result.character, createActiveEffectFromTemplate(result.effectTemplate!));
    const active = analyzeActionDamage({
      action: action!,
      character: withEffect,
      combatState: { rollMode: 'normal', targetCount: 1, resistanceMultiplier: 1, activeConditionIds: ['marked-target'] }
    });
    expect(active.total.average).toBe(3.5);
  });

  it('creates a limited resource and consuming action for burst presets', () => {
    const character = createDefaultCharacter('Resource Tester');
    const draft = withValues('resource-burst-damage', {
      featureName: 'Manual Burst',
      resourceName: 'Burst Uses',
      resourceMax: '2',
      resourceCost: '1',
      damageFormula: '2d8',
      actionName: 'Burst Damage'
    });

    const result = applyMechanicPresetToCharacter(character, draft);

    expect(result.resource?.name).toBe('Burst Uses');
    expect(result.resource?.max).toBe(2);
    expect(result.action?.consumes?.[0]?.resourceId).toBe(result.resource?.id);
    expect(result.character.resources.some((resource) => resource.name === 'Burst Uses')).toBe(true);
  });
});
