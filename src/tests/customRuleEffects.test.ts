import { getSpellListAdditionRules, getSpellReplacementRules } from '../characters/customRuleEffects';
import { createEmptyCharacter, defaultCombatState } from '../data/mockData';
import { analyzeActionDamage } from '../rules-engine/damage/calculateDamage';
import { parseDamageFormula } from '../rules-engine/dice/parser';
import { applyRest, spendResources } from '../rules-engine/resources/resourceManager';
import type { Feat, Feature, SpellAction } from '../types';

const friendlyFireFeature = (): Feature => ({
  id: 'friendly-fire-feature',
  name: 'Friendly Fire',
  sourceType: 'feat',
  custom: true,
  customRules: {
    damageMultipliers: [{
      id: 'friendly-fire-double',
      damageType: 'fire',
      multiplier: 2,
      label: 'Friendly Fire'
    }],
    triggeredDamage: [{
      id: 'friendly-fire-trigger',
      triggerDamageType: 'fire',
      triggerRoll: { count: 1, sides: 8 },
      triggerValues: [1],
      radiusFeet: 30,
      saveAbility: 'DEX',
      saveSuccessDamage: 'half',
      damageMode: 'sameAsTriggeringDamage'
    }],
    grantedSpellItemIds: ['phb-2024-spell-fire-bolt']
  }
});

const fireBoltAction = (): SpellAction => ({
  id: 'fire-bolt-action',
  type: 'spell',
  name: 'Fire Bolt',
  actionCost: 'action',
  sourceType: 'spell',
  spellLevel: 0,
  damage: parseDamageFormula('1d10', { defaultSourceType: 'spell' }),
  damageTypes: ['fire'],
  targets: 1
});

describe('custom feat/feature structured rules', () => {
  it('applies a damage-type multiplier from a custom feat and surfaces its triggered damage rule', () => {
    const feat: Feat = {
      id: 'friendly-fire-feat',
      name: 'Friendly Fire',
      custom: true,
      features: [friendlyFireFeature()]
    };
    const character = { ...createEmptyCharacter('Homebrew'), feats: [feat] };

    const result = analyzeActionDamage({
      action: fireBoltAction(),
      character,
      combatState: defaultCombatState
    });

    expect(result.perHit).toMatchObject({ min: 2, max: 20, average: 11 });
    expect(result.total.average).toBe(11);
    expect(result.formula).toContain('× 2');
    expect(result.warnings).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'CUSTOM_DAMAGE_MULTIPLIER_APPLIED' }),
      expect.objectContaining({ code: 'CUSTOM_TRIGGERED_DAMAGE_RULE' })
    ]));
  });

  it('does not apply the fire multiplier to another damage type', () => {
    const character = { ...createEmptyCharacter('Homebrew'), features: [friendlyFireFeature()] };
    const coldAction: SpellAction = { ...fireBoltAction(), id: 'cold-bolt', name: 'Cold Bolt', damageTypes: ['cold'] };

    const result = analyzeActionDamage({ action: coldAction, character, combatState: defaultCombatState });

    expect(result.perHit.average).toBe(5.5);
    expect(result.warnings.some((issue) => issue.code === 'CUSTOM_DAMAGE_MULTIPLIER_APPLIED')).toBe(false);
    expect(result.warnings.some((issue) => issue.code === 'CUSTOM_TRIGGERED_DAMAGE_RULE')).toBe(false);
  });

  it('scopes a custom spell-list addition to the configured class', () => {
    const character = {
      ...createEmptyCharacter('Bard'),
      features: [{
        id: 'friendly-fire-list-feature',
        name: 'Friendly Fire',
        sourceType: 'manual' as const,
        custom: true,
        customRules: {
          spellListAdditions: [{
            id: 'friendly-fire-list',
            spellItemIds: ['phb-2024-spell-fire-bolt'],
            classNames: ['Bard']
          }]
        }
      }]
    };

    expect(getSpellListAdditionRules(character, 'Bard')[0]?.rule.spellItemIds).toContain('phb-2024-spell-fire-bolt');
    expect(getSpellListAdditionRules(character, 'Wizard')).toHaveLength(0);
  });

  it('spends and restores a custom spell-replacement allowance on a long rest', () => {
    const replacementFeature: Feature = {
      id: 'bard-flexibility',
      name: 'Flexible Repertoire',
      sourceType: 'manual',
      custom: true,
      customRules: {
        spellReplacement: [{
          id: 'bard-flexibility-rule',
          count: 1,
          recharge: 'longRest',
          resourceId: 'bard-flexibility-resource',
          classNames: ['Bard']
        }]
      }
    };
    const character = {
      ...createEmptyCharacter('Bard'),
      classes: [{ id: 'bard-class', name: 'Bard', level: 7 }],
      features: [replacementFeature],
      resources: [{
        id: 'bard-flexibility-resource',
        name: 'Flexible Repertoire · troca de magia',
        max: 1,
        current: 1,
        recharge: 'longRest' as const
      }]
    };

    expect(getSpellReplacementRules(character, 'Bard')[0]).toMatchObject({ available: true });
    expect(getSpellReplacementRules(character, 'Wizard')).toHaveLength(0);

    const spent = spendResources({
      character,
      costs: [{ resourceId: 'bard-flexibility-resource', amount: 1 }],
      reason: 'Troca de magia por feature personalizada'
    });
    expect(spent.issues.some((issue) => issue.severity === 'error')).toBe(false);
    expect(getSpellReplacementRules(spent.character, 'Bard')[0]).toMatchObject({ available: false });

    const rested = applyRest(spent.character, 'longRest');
    expect(getSpellReplacementRules(rested.character, 'Bard')[0]).toMatchObject({ available: true });
    expect(rested.character.resources.find((resource) => resource.id === 'bard-flexibility-resource')?.current).toBe(1);
  });
});
