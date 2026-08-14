import { parseDamageFormula } from '../rules-engine/dice/parser';
import { buildDerivedEffectOptions, createActiveEffectFromTemplate, parseEffectTemplatesFromPayload } from '../rules-engine/effects/derivedEffects';
import { createDefaultCharacter } from '../data/mockData';
import { Spell } from '../types';

describe('derived effects', () => {
  it('builds an effect template from imported payload fields', () => {
    const templates = parseEffectTemplatesFromPayload(
      {
        effectName: 'Marked Target',
        effectKind: 'spell',
        effectConditionIds: ['marked-target'],
        effectConcentration: true,
        effectDurationUnit: 'minute',
        effectDurationRemaining: 10
      },
      { idPrefix: 'test', name: 'Mark', kind: 'spell', sourceType: 'spell' }
    );

    expect(templates).toHaveLength(1);
    expect(templates[0].conditionIds).toEqual(['marked-target']);
    expect(templates[0].concentration).toBe(true);
    expect(templates[0].duration.unit).toBe('minute');
  });

  it('creates active effects from derived templates', () => {
    const [template] = parseEffectTemplatesFromPayload(
      { conditionIds: ['hex'], concentration: true },
      { idPrefix: 'hex', name: 'Hex', kind: 'spell', sourceType: 'spell' }
    );

    const effect = createActiveEffectFromTemplate(template);
    expect(effect.status).toBe('active');
    expect(effect.templateId).toBe(template.id);
    expect(effect.conditionIds).toEqual(['hex']);
  });

  it('discovers spell effects from concentration or damage conditions', () => {
    const character = createDefaultCharacter('Tester');
    const spell: Spell = {
      id: 'spell-hunters-mark',
      name: 'Imported Mark',
      level: 1,
      castingTime: 'bonusAction',
      concentration: true,
      damage: parseDamageFormula('1d6', { defaultSourceType: 'spell' }),
      effectTemplates: [
        {
          id: 'mark-template',
          name: 'Imported Mark',
          kind: 'spell',
          sourceType: 'spell',
          concentration: true,
          conditionIds: ['imported-mark'],
          duration: { unit: 'minute', remaining: 60, expiresOn: 'turnStart' }
        }
      ]
    };

    const options = buildDerivedEffectOptions({ ...character, spells: [spell] });
    expect(options).toHaveLength(1);
    expect(options[0].template.conditionIds).toEqual(['imported-mark']);
    expect(options[0].alreadyActive).toBe(false);
  });
});
