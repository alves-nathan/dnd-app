import fs from 'node:fs';
import path from 'node:path';
import { applyCompendiumItemToCharacter } from '../compendium/mapper';
import type { CompendiumImportItem } from '../compendium/importDomain';
import type { StoredCompendiumItem } from '../compendium/types';
import { createEmptyCharacter, defaultCombatState } from '../data/mockData';
import { buildSpellAction } from '../rules-engine/actions/buildActions';
import { parseDamageFormula } from '../rules-engine/dice/parser';
import { createCombatScenario } from '../rules-engine/turns/compareRotations';
import { createTacticalTarget, resolveTacticalRotation } from '../rules-engine/turns/tacticalCombat';
import {
  describeTacticalAreaTemplate,
  normalizeTacticalAreaTemplate,
  tacticalActionTargetLimit,
  tacticalActionSupportsMultipleTargets,
  toggleTacticalTargetId
} from '../rules-engine/targeting/areaTemplates';
import type { AttackAction, SpellAction, TacticalActionResolution, TurnRotation } from '../types';

const fixture = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'assets/compendium/phb-2024-full-consolidated-import-pack-v2-canonical.json'), 'utf8')) as { items: CompendiumImportItem[] };

const storedSpell = (name: string): StoredCompendiumItem => {
  const item = fixture.items.find((entry) => entry.kind === 'spell' && entry.name === name);
  if (!item) throw new Error(`Missing spell fixture: ${name}`);
  return {
    id: `phb:${item.id}`,
    importItemId: item.id,
    packId: 'phb',
    sourceId: item.source.id,
    type: 'spell',
    name: item.name,
    summary: item.summary,
    version: item.source.version,
    rawJson: item,
    normalizedJson: item.payload as Record<string, unknown>,
    tags: [],
    status: 'validated',
    createdAt: '2026-08-11T00:00:00.000Z',
    updatedAt: '2026-08-11T00:00:00.000Z'
  };
};

const scenarioFor = (characterId: string) => ({
  ...createCombatScenario({ id: 'scenario', characterId, name: 'AoE', combatState: { ...defaultCombatState }, now: '2026-08-11T00:00:00.000Z' }),
  actorPositionFeet: 0,
  targets: [
    createTacticalTarget({ id: 'a', name: 'A', positionFeet: 10, hitPoints: { current: 20, max: 20, temporary: 0 } }),
    createTacticalTarget({ id: 'b', name: 'B', positionFeet: 15, hitPoints: { current: 20, max: 20, temporary: 0 } }),
    createTacticalTarget({ id: 'c', name: 'C', positionFeet: 30, hitPoints: { current: 20, max: 20, temporary: 0 } })
  ],
  tacticalLog: []
});

describe('tactical area templates and multiple targets', () => {
  it('maps a real PHB area spell into the runtime action without flattening the area', () => {
    const base = createEmptyCharacter('Caster');
    const applied = applyCompendiumItemToCharacter(base, storedSpell('Burning Hands'));
    expect(applied.ok).toBe(true);
    const spell = applied.character.spells.find((entry) => entry.name === 'Burning Hands')!;
    const action = buildSpellAction(applied.character, spell.id)!;

    expect(action.area).toMatchObject({ shape: 'cone', sizeFeet: 15 });
    expect(action.saveAbility).toBe('DEX');
    expect(action.saveSuccessDamage).toBe('half');
    expect(tacticalActionSupportsMultipleTargets(action)).toBe(true);
    expect(tacticalActionTargetLimit(action)).toBeUndefined();
    expect(describeTacticalAreaTemplate(action.area)).toContain('Cone');
  });

  it('normalizes line, cone, cube, sphere and cylinder dimensions', () => {
    expect(normalizeTacticalAreaTemplate({ shape: 'line', length: 100, width: 5, unit: 'ft' })).toMatchObject({ shape: 'line', lengthFeet: 100, widthFeet: 5 });
    expect(normalizeTacticalAreaTemplate({ shape: 'cone', size: 15, unit: 'ft' })).toMatchObject({ shape: 'cone', sizeFeet: 15 });
    expect(normalizeTacticalAreaTemplate({ shape: 'cube', size: 20, unit: 'ft' })).toMatchObject({ shape: 'cube', sizeFeet: 20 });
    expect(normalizeTacticalAreaTemplate({ shape: 'sphere', radius: 10, unit: 'ft' })).toMatchObject({ shape: 'sphere', radiusFeet: 10 });
    expect(normalizeTacticalAreaTemplate({ shape: 'cylinder', radius: 5, height: 40, unit: 'ft' })).toMatchObject({ shape: 'cylinder', radiusFeet: 5, heightFeet: 40 });
    expect(normalizeTacticalAreaTemplate({ shapeOptions: [{ shape: 'wall', length: 60, height: 20, unit: 'ft' }, { shape: 'ring', diameter: 20, unit: 'ft' }] })).toMatchObject({ shape: 'custom' });
  });

  it('resolves saves, damage and conditions independently for every selected area target', () => {
    const character = createEmptyCharacter('Caster');
    const action: SpellAction = {
      id: 'blast',
      type: 'spell',
      name: 'Area Blast',
      actionCost: 'action',
      sourceType: 'spell',
      spellLevel: 1,
      damage: parseDamageFormula('2d6'),
      targets: 1,
      area: { shape: 'sphere', radiusFeet: 10, origin: 'point' },
      saveAbility: 'DEX',
      saveSuccessDamage: 'half',
      conditionIds: ['prone']
    };
    const rotation: TurnRotation = {
      id: 'rotation', characterId: character.id, name: 'Blast',
      actions: [{ id: 'turn-blast', name: 'Area Blast', actionCost: 'action', action, targetId: 'a' }]
    };
    const resolutions: TacticalActionResolution[] = [{
      actionId: 'turn-blast', targetId: 'a', confirmedHits: 0,
      targetResults: [
        { targetId: 'a', saveResult: 'failure', damage: 10 },
        { targetId: 'b', saveResult: 'success', damage: 10 }
      ]
    }];

    const result = resolveTacticalRotation({ character, rotation, scenario: scenarioFor(character.id), resolutions });
    expect(result.issues.filter((entry) => entry.severity === 'error')).toHaveLength(0);
    expect(result.scenario.targets?.find((target) => target.id === 'a')?.hitPoints?.current).toBe(10);
    expect(result.scenario.targets?.find((target) => target.id === 'b')?.hitPoints?.current).toBe(15);
    expect(result.scenario.targets?.find((target) => target.id === 'c')?.hitPoints?.current).toBe(20);
    expect(result.scenario.targets?.find((target) => target.id === 'a')?.conditions).toContain('prone');
    expect(result.scenario.targets?.find((target) => target.id === 'b')?.conditions).not.toContain('prone');
    expect(result.scenario.tacticalLog?.filter((entry) => entry.kind === 'savingThrow')).toHaveLength(2);
  });

  it('blocks a save-based target resolution while an affected target is still pending', () => {
    const character = createEmptyCharacter('Caster');
    const action: SpellAction = {
      id: 'save-spell', type: 'spell', name: 'Save Spell', actionCost: 'action', sourceType: 'spell', spellLevel: 1,
      damage: parseDamageFormula('2d6'), area: { shape: 'cone', sizeFeet: 15 }, saveAbility: 'DEX', saveSuccessDamage: 'half'
    };
    const rotation: TurnRotation = { id: 'save-rotation', characterId: character.id, name: 'Save', actions: [{ id: 'save-action', name: 'Save Spell', actionCost: 'action', action, targetId: 'a' }] };
    const result = resolveTacticalRotation({ character, rotation, scenario: scenarioFor(character.id), resolutions: [{ actionId: 'save-action', targetId: 'a', confirmedHits: 0, targetResults: [{ targetId: 'a', saveResult: 'pending', damage: 10 }] }] });
    expect(result.issues.some((entry) => entry.code === 'TACTICAL_TARGET_SAVE_PENDING')).toBe(true);
    expect(result.scenario.targets?.find((target) => target.id === 'a')?.hitPoints?.current).toBe(20);
  });

  it('enforces target limits for multi-ray spells and supports deselection', () => {
    const action: SpellAction = {
      id: 'rays', type: 'spell', name: 'Rays', actionCost: 'action', sourceType: 'spell', spellLevel: 2,
      damage: parseDamageFormula('2d6'), targets: 1, attacksCount: 3
    };
    expect(tacticalActionSupportsMultipleTargets(action)).toBe(true);
    expect(tacticalActionTargetLimit(action)).toBe(3);
    expect(toggleTacticalTargetId(['a', 'b', 'c'], 'd', 3)).toEqual(['a', 'b', 'c']);
    expect(toggleTacticalTargetId(['a', 'b'], 'a', 3)).toEqual(['b']);
  });

  it('integrates Cleave with a secondary adjacent target and rejects a distant one', () => {
    const character = createEmptyCharacter('Cleave');
    const action: AttackAction = {
      id: 'cleave', type: 'attack', name: 'Greataxe', actionCost: 'action', sourceType: 'weapon',
      damage: parseDamageFormula('1d12 + STR'), attacksCount: 1,
      mastery: { property: 'cleave', label: 'Cleave', description: 'Secondary attack' }
    };
    const rotation: TurnRotation = { id: 'cleave-rotation', characterId: character.id, name: 'Cleave', actions: [{ id: 'cleave-action', name: 'Cleave', actionCost: 'action', action, targetId: 'a' }] };
    const adjacent = resolveTacticalRotation({
      character, rotation, scenario: scenarioFor(character.id), resolutions: [{
        actionId: 'cleave-action', targetId: 'a', confirmedHits: 1,
        targetResults: [{ targetId: 'a', confirmedHits: 1, damage: 8 }, { targetId: 'b', confirmedHits: 1, damage: 6 }]
      }]
    });
    expect(adjacent.issues.filter((entry) => entry.severity === 'error')).toHaveLength(0);
    expect(adjacent.scenario.targets?.find((target) => target.id === 'a')?.hitPoints?.current).toBe(12);
    expect(adjacent.scenario.targets?.find((target) => target.id === 'b')?.hitPoints?.current).toBe(14);
    expect(adjacent.effects.some((event) => event.kind === 'cleave' && event.targetId === 'b')).toBe(true);

    const distantScenario = { ...scenarioFor(character.id), targets: scenarioFor(character.id).targets.map((target) => target.id === 'b' ? { ...target, positionFeet: 25 } : target) };
    const distant = resolveTacticalRotation({
      character, rotation, scenario: distantScenario, resolutions: [{
        actionId: 'cleave-action', targetId: 'a', confirmedHits: 1,
        targetResults: [{ targetId: 'a', confirmedHits: 1 }, { targetId: 'b', confirmedHits: 1, damage: 6 }]
      }]
    });
    expect(distant.issues.some((entry) => entry.code === 'TACTICAL_CLEAVE_TARGET_NOT_ADJACENT')).toBe(true);
    expect(distant.scenario.targets?.find((target) => target.id === 'b')?.hitPoints?.current).toBe(20);
  });
});
