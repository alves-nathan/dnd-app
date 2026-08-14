import fs from 'node:fs';
import path from 'node:path';
import {
  normalizeAbilityReference,
  normalizeActionCost,
  normalizeCastingTime,
  normalizeCurrencyValue,
  normalizeDamageTypeReference,
  normalizeCompendiumImportPack,
  normalizeResourceDefinition,
  normalizeSkillName
} from '../compendium/importNormalization';
import { migrateImportV1ToV2, type LegacyCompendiumImportInput } from '../compendium/importV1Migration';
import { parseImportPack } from '../compendium/parseImportPack';

const source = {
  id: 'test-source',
  book: 'Test Book',
  version: '2024',
  status: 'needsReview' as const,
  confidence: 'importedNeedsReview' as const
};

describe('compendium import V2 normalization', () => {
  it('normalizes action aliases without discarding their semantic subtype', () => {
    expect(normalizeActionCost('magicAction').value).toEqual({
      actionCost: 'action',
      detail: expect.objectContaining({ subtype: 'magicAction', original: 'magicAction' })
    });
    expect(normalizeActionCost('attackReplacement').value.actionCost).toBe('special');
    expect(normalizeActionCost('passive').value.actionCost).toBe('free');
  });

  it('promotes composite abilities, skill aliases and damage types', () => {
    expect(normalizeAbilityReference('STR_OR_DEX').value).toEqual(expect.objectContaining({ kind: 'choice', options: ['STR', 'DEX'] }));
    expect(normalizeSkillName('sleight-of-hand').value).toBe('Sleight of Hand');
    expect(normalizeDamageTypeReference('radiant or necrotic').value).toEqual(expect.objectContaining({ kind: 'choice', options: ['necrotic', 'radiant'] }));
    expect(normalizeDamageTypeReference('piercing+poison').value).toEqual(expect.objectContaining({ kind: 'multiple', types: ['piercing', 'poison'] }));
    expect(normalizeDamageTypeReference('sameAsWeapon').value).toEqual(expect.objectContaining({ kind: 'sameAs', source: 'weapon' }));
  });

  it('turns legacy prices into canonical currency', () => {
    expect(normalizeCurrencyValue('1,500 GP').value).toEqual({ amount: 1500, unit: 'GP' });
    expect(normalizeCurrencyValue({ amount: 5, unit: 'sp' }).value).toEqual({ amount: 5, unit: 'SP' });
  });

  it('structures duration/triggered casting times', () => {
    expect(normalizeCastingTime('10 minutes or ritual').value).toEqual(expect.objectContaining({ kind: 'duration', amount: 10, unit: 'minute', ritualAlternative: true }));
    expect(normalizeCastingTime('reactionOnTakingDamage').value).toEqual(expect.objectContaining({ kind: 'action', actionCost: 'reaction' }));
  });

  it('normalizes 21-entry resource arrays as level-0 sentinel plus levels 1-20', () => {
    const normalized = normalizeResourceDefinition({
      id: 'sorcery-points',
      maxByLevel: [0, 0, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20],
      recharge: 'longRest'
    }).value;
    const max = normalized?.max;
    expect(typeof max === 'object' && max !== null ? max.steps?.[0] : undefined).toEqual({ level: 1, value: 0 });
    expect(typeof max === 'object' && max !== null ? max.steps?.at(-1) : undefined).toEqual({ level: 20, value: 20 });
    expect(typeof max === 'object' && max !== null ? max.steps : undefined).toHaveLength(20);
  });

  it('promotes legacy resource level arrays and partial recovery rules', () => {
    const normalized = normalizeResourceDefinition({
      id: 'rage',
      maxByLevel: [2, 2, 3],
      recharge: 'longRestAndOneOnShortRest'
    }).value;
    expect(normalized?.max).toEqual({
      kind: 'classLevel',
      steps: [{ level: 1, value: 2 }, { level: 2, value: 2 }, { level: 3, value: 3 }]
    });
    expect(normalized?.recharge).toBe('manual');
    expect(normalized?.recoveryRules).toEqual([
      { trigger: 'shortRest', amount: 1 },
      { trigger: 'longRest', amount: 'all' }
    ]);
  });



  it('preserves legacy feature resources by generating deterministic ids and promoting common use formulas', () => {
    const pack = normalizeCompendiumImportPack({
      templateVersion: 'dnd-combat-import.v1',
      id: 'legacy-resource-pack',
      source,
      items: [
        {
          id: 'feature-pb-resource',
          kind: 'feature',
          name: 'PB Resource',
          source,
          payload: { sourceType: 'classFeature', resource: { uses: 'PB', recharge: 'longRest' } }
        },
        {
          id: 'feature-ability-resource',
          kind: 'feature',
          name: 'Ability Resource',
          source,
          payload: { sourceType: 'classFeature', resource: { usesFormula: 'max(1, INT modifier)', recharge: 'longRest' } }
        }
      ]
    });

    const pb = pack.value?.items.find((item) => item.id === 'feature-pb-resource');
    const ability = pack.value?.items.find((item) => item.id === 'feature-ability-resource');
    expect(pb?.kind === 'feature' ? pb.payload.resource : undefined).toEqual(expect.objectContaining({
      id: 'feature-pb-resource-resource',
      max: { kind: 'proficiencyBonus' },
      recharge: 'longRest'
    }));
    expect(ability?.kind === 'feature' ? ability.payload.resource : undefined).toEqual(expect.objectContaining({
      id: 'feature-ability-resource-resource',
      max: expect.objectContaining({ kind: 'abilityModifier', ability: 'INT', minimum: 1 }),
      recharge: 'longRest'
    }));
    expect(pack.issues.filter((entry) => entry.code === 'IMPORT_INVALID_RESOURCE')).toEqual([]);
    expect(pack.issues.filter((entry) => entry.code === 'IMPORT_GENERATED_RESOURCE_ID')).toHaveLength(2);
  });

  it('remediates schema-incompatible legacy Tasha shapes without inventing mechanics', () => {
    const pack = normalizeCompendiumImportPack({
      templateVersion: 'dnd-combat-import.v1',
      id: 'legacy-tasha-shapes',
      source,
      items: [
        {
          id: 'legacy-class',
          kind: 'class',
          name: 'Legacy Class',
          source,
          payload: {
            equipmentOptions: {
              standard: [
                { choice: { count: 2, from: 'simple weapons' } },
                { items: ['Thieves\' Tools', 'Dungeoneer\'s Pack'] }
              ],
              goldAlternative: { formula: '5d4 * 10', currency: 'gp', requiresForgoClassAndBackgroundEquipment: true }
            }
          }
        },
        {
          id: 'legacy-feature',
          kind: 'feature',
          name: 'Legacy Feature',
          source,
          payload: { sourceType: 'classFeature', classId: '', levelGained: null }
        },
        {
          id: 'legacy-feat',
          kind: 'feat',
          name: 'Legacy Feat',
          source,
          payload: { abilityScoreIncrease: { amount: 1, abilityOptions: ['CON', 'WIS'], maximumScore: 20, choose: 1 } }
        },
        {
          id: 'legacy-creature',
          kind: 'creatureStatBlock',
          name: 'Legacy Creature',
          source,
          payload: {
            size: 'Medium', creatureType: 'Elemental', armorClass: 12, hitPoints: 20, speed: { walk: 30 },
            resistances: [{ type: 'acid', form: 'Water only' }]
          }
        }
      ]
    });

    const klass = pack.value?.items.find((item) => item.id === 'legacy-class');
    expect(klass?.kind === 'class' ? klass.payload.equipmentOptions?.standard : undefined).toEqual(expect.objectContaining({
      items: ["Thieves' Tools", "Dungeoneer's Pack"],
      requiresStructuredChoiceResolution: true,
      legacyEntries: expect.any(Array)
    }));
    expect(klass?.kind === 'class' ? klass.payload.equipmentOptions?.goldAlternative : undefined).toEqual(expect.objectContaining({
      formula: '5d4 * 10',
      currencyUnit: 'gp',
      requiresForgoClassAndBackgroundEquipment: true
    }));

    const feature = pack.value?.items.find((item) => item.id === 'legacy-feature');
    expect(feature?.kind === 'feature' ? feature.payload.classId : undefined).toBeUndefined();
    expect(feature?.kind === 'feature' ? feature.payload.levelGained : undefined).toBeUndefined();

    const feat = pack.value?.items.find((item) => item.id === 'legacy-feat');
    expect(feat?.kind === 'feat' ? feat.payload.abilityScoreIncrease : undefined).toEqual([
      expect.objectContaining({ amount: 1, abilities: ['CON', 'WIS'], max: 20, choose: 1 })
    ]);

    const creature = pack.value?.items.find((item) => item.id === 'legacy-creature');
    expect(creature?.kind === 'creatureStatBlock' ? creature.payload.resistances : undefined).toBeUndefined();
    expect(creature?.kind === 'creatureStatBlock' ? creature.payload.conditionalResistances : undefined).toEqual([
      { type: 'acid', form: 'Water only' }
    ]);
  });

  it('canonicalizes structured creature languages and action ranges without losing the source structure', () => {
    const rawPack = {
      templateVersion: 'dnd-combat-import.v2',
      id: 'creature-structured-fields',
      source,
      items: [{
        id: 'creature-steel-defender-like',
        kind: 'creatureStatBlock',
        name: 'Steel Defender Like',
        source,
        payload: {
          size: 'Medium',
          creatureType: 'Construct',
          armorClass: 15,
          hitPoints: 20,
          speed: { walk: 40 },
          languages: { understands: 'languages known by owner', speaks: [] },
          actions: [{
            name: 'Force Bolt',
            type: 'attack',
            actionCost: 'action',
            attackBonus: 5,
            range: { normal: 30, long: 90, unit: 'ft' }
          }]
        }
      }]
    };

    const normalized = normalizeCompendiumImportPack(rawPack);
    const creature = normalized.value?.items[0];
    expect(creature?.kind === 'creatureStatBlock' ? creature.payload.languages : undefined)
      .toBe('Understands languages known by owner; Cannot speak');
    expect(creature?.kind === 'creatureStatBlock' ? creature.payload.languageDetails : undefined)
      .toEqual({ understands: 'languages known by owner', speaks: [] });
    expect(creature?.kind === 'creatureStatBlock' ? creature.payload.actions?.[0]?.range : undefined)
      .toBe('30/90 ft');
    expect(creature?.kind === 'creatureStatBlock' ? creature.payload.actions?.[0]?.rangeDefinition : undefined)
      .toEqual({ normal: 30, long: 90, unit: 'ft' });

    const parsed = parseImportPack(JSON.stringify(normalized.value), { validateSemantics: false });
    expect(parsed.ok).toBe(true);
    expect(parsed.issues.filter((entry) => entry.code === 'IMPORT_V2_SCHEMA_ERROR')).toEqual([]);
  });

  it('canonicalizes formula armor class and hit points, senses arrays, and variable class spellcasting ability losslessly', () => {
    const rawPack = {
      templateVersion: 'dnd-combat-import.v2',
      id: 'tasha-shaped-fields',
      source,
      items: [
        {
          id: 'summoned-spirit',
          kind: 'creatureStatBlock',
          name: 'Summoned Spirit',
          source,
          payload: {
            size: 'Medium',
            creatureType: 'Monstrosity',
            armorClass: '11 + spell level',
            hitPoints: '5 + five times your Ranger level',
            speed: { walk: 40 },
            senses: ['darkvision 60 ft.', 'passive Perception 10']
          }
        },
        {
          id: 'sidekick-spellcaster',
          kind: 'class',
          name: 'Spellcaster',
          source,
          payload: {
            level: 1,
            spellcasting: {
              progression: 'sidekick-half-like',
              ability: 'chosen by Spellcaster role',
              roleOptions: [
                { role: 'Mage', ability: 'INT' },
                { role: 'Healer', ability: 'WIS' },
                { role: 'Prodigy', ability: 'CHA' }
              ],
              ritualCasting: { allowed: true, requiresPrepared: true, requiresRitualTag: true }
            }
          }
        }
      ]
    };

    const normalized = normalizeCompendiumImportPack(rawPack);
    const creature = normalized.value?.items[0];
    const sidekick = normalized.value?.items[1];
    expect(creature?.kind === 'creatureStatBlock' ? creature.payload.armorClass : undefined)
      .toEqual({ formula: '11 + spell level', original: '11 + spell level' });
    expect(creature?.kind === 'creatureStatBlock' ? creature.payload.hitPoints : undefined)
      .toEqual({ formula: '5 + five times your Ranger level', original: '5 + five times your Ranger level' });
    expect(creature?.kind === 'creatureStatBlock' ? creature.payload.senses : undefined)
      .toBe('darkvision 60 ft.; passive Perception 10');
    expect(creature?.kind === 'creatureStatBlock' ? creature.payload.senseDetails : undefined)
      .toEqual(['darkvision 60 ft.', 'passive Perception 10']);
    expect(sidekick?.kind === 'class' ? sidekick.payload.spellcasting?.ability : undefined).toBeUndefined();
    expect(sidekick?.kind === 'class' ? sidekick.payload.spellcasting?.abilityDescription : undefined)
      .toBe('chosen by Spellcaster role');
    expect(sidekick?.kind === 'class' ? sidekick.payload.spellcasting?.ritualCasting : undefined).toBe(true);
    expect(sidekick?.kind === 'class' ? sidekick.payload.spellcasting?.ritualCastingDetails : undefined)
      .toEqual({ allowed: true, requiresPrepared: true, requiresRitualTag: true });

    const parsed = parseImportPack(JSON.stringify(normalized.value), { validateSemantics: false });
    expect(parsed.ok).toBe(true);
    expect(parsed.issues.filter((entry) => entry.code === 'IMPORT_V2_SCHEMA_ERROR')).toEqual([]);

    const replay = normalizeCompendiumImportPack(normalized.value);
    expect(replay.value).toEqual(normalized.value);
  });

  it('keeps already-structured conditional creature speeds idempotent', () => {
    const pack = {
      templateVersion: 'dnd-combat-import.v2',
      id: 'speed-roundtrip',
      source,
      items: [{
        id: 'creature-spirit',
        kind: 'creatureStatBlock',
        name: 'Spirit',
        source,
        payload: {
          size: 'Medium',
          creatureType: 'Elemental',
          armorClass: 13,
          hitPoints: 20,
          speed: {
            walk: 30,
            fly: { value: 40, condition: 'Air only', original: '40 Air only' }
          }
        }
      }]
    };
    const first = normalizeCompendiumImportPack(pack).value;
    const second = normalizeCompendiumImportPack(first).value;
    const firstCreature = first?.items[0];
    const secondCreature = second?.items[0];
    expect(firstCreature?.kind === 'creatureStatBlock' ? firstCreature.payload.speed.fly : undefined)
      .toEqual({ value: 40, condition: 'Air only', original: '40 Air only' });
    expect(secondCreature).toEqual(firstCreature);
  });

  it('preserves legacy per-item provenance as V2 metadata, never gameplay payload', () => {
    const result = normalizeCompendiumImportPack({
      templateVersion: 'dnd-combat-import.v1',
      id: 'provenance-pack',
      source,
      items: [{
        id: 'condition-provenance',
        kind: 'condition',
        name: 'Condition Provenance',
        source,
        payload: { conditionId: 'condition-provenance' },
        _importMeta: { sourceFile: 'conditions.json', sourceFileOrder: 2 }
      }]
    });
    expect(result.value?.items[0].metadata?.legacyImport).toEqual({ sourceFile: 'conditions.json', sourceFileOrder: 2 });
    expect((result.value?.items[0].payload as Record<string, unknown>)._importMeta).toBeUndefined();
  });

  it('migrates V1 to one canonical V2 shape and resolves spell class ids', () => {
    const legacy: LegacyCompendiumImportInput = {
      id: 'legacy-test-pack',
      source,
      items: [
        {
          id: 'test-class-wizard', kind: 'class', name: 'Wizard', source,
          payload: { hitDie: 6, primaryAbilities: ['int'], equipmentOptions: { A: ['Book', '10 GP'] } }
        },
        {
          id: 'test-spell-fire-bolt', kind: 'spell', name: 'Fire Bolt', source,
          payload: { level: 0, classes: ['Wizard'], castingTime: 'action', damageFormula: '1d10', damageType: 'fire', targets: 1 }
        },
        {
          id: 'test-weapon-club', kind: 'weapon', name: 'Club', source,
          payload: { weaponCategory: 'simple', weaponType: 'melee', attackAbility: 'STR_OR_DEX', damageAbility: 'STR_OR_DEX', damageFormula: '1d4 + STR_OR_DEX', damageType: 'bludgeoning', cost: '1 SP' }
        }
      ]
    };
    const result = migrateImportV1ToV2(legacy, { detectedLegacyVersion: 'dnd-combat-import.v1' });
    expect(result.value?.templateVersion).toBe('dnd-combat-import.v2');
    expect(result.value?.items).toHaveLength(3);
    const spell = result.value?.items.find((item) => item.kind === 'spell');
    expect(spell?.kind === 'spell' ? spell.payload.classIds : undefined).toEqual(['test-class-wizard']);
    const weapon = result.value?.items.find((item) => item.kind === 'weapon');
    expect(weapon?.kind === 'weapon' ? weapon.payload.cost : undefined).toEqual({ amount: 1, unit: 'SP' });
  });

  it('routes V1 and V2 through the same parseImportPack canonical boundary', () => {
    const v1 = {
      templateVersion: 'dnd-combat-import.v1',
      id: 'v1', source,
      items: [{ id: 'condition-a', kind: 'condition', name: 'Condition A', source, payload: { conditionId: 'condition-a' } }]
    };
    const parsedV1 = parseImportPack(v1);
    expect(parsedV1.ok).toBe(true);
    expect(parsedV1.data?.templateVersion).toBe('dnd-combat-import.v2');

    const v2 = {
      templateVersion: 'dnd-combat-import.v2',
      id: 'v2', source,
      items: [{ id: 'condition-b', kind: 'condition', name: 'Condition B', source, payload: { conditionId: 'condition-b' } }]
    };
    const parsedV2 = parseImportPack(v2);
    expect(parsedV2.ok).toBe(true);
    expect(parsedV2.data?.templateVersion).toBe('dnd-combat-import.v2');
  });


  it('normalizes legacy spell component arrays and variable resource costs without breaking V2 parsing', () => {
    const pack = {
      templateVersion: 'dnd-combat-import.v2',
      id: 'legacy-shapes',
      source,
      items: [
        {
          id: 'spell-empty-components',
          kind: 'spell',
          name: 'Empty Components',
          source,
          payload: { level: 0, classes: ['Wizard'], castingTime: 'action', components: [] }
        },
        {
          id: 'feature-variable-cost',
          kind: 'feature',
          name: 'Variable Cost',
          source,
          payload: { sourceType: 'classFeature', consumes: [{ resourceId: 'points', amount: '1-5' }] }
        }
      ]
    };
    const parsed = parseImportPack(pack);
    expect(parsed.ok).toBe(true);
    const spell = parsed.data?.items.find((item) => item.id === 'spell-empty-components');
    expect(spell?.kind === 'spell' ? spell.payload.components : undefined).toBeUndefined();
    const feature = parsed.data?.items.find((item) => item.id === 'feature-variable-cost');
    expect(feature?.kind === 'feature' ? feature.payload.consumes?.[0]?.amount : undefined).toBe('1-5');
  });

  it('keeps needs-review legacy spell imports safe when classes are omitted and defaults unknown weapon type to manual', () => {
    const migrated = migrateImportV1ToV2({
      id: 'needs-review-legacy',
      source,
      items: [
        { id: 'spell-draft', kind: 'spell', name: 'Draft Spell', source, payload: { level: 0, castingTime: 'action' } },
        { id: 'weapon-draft', kind: 'weapon', name: 'Draft Weapon', source, payload: { damageFormula: '1d8 + STR', actionCost: 'action' } }
      ]
    });
    const spell = migrated.value?.items.find((item) => item.id === 'spell-draft');
    expect(spell?.kind === 'spell' ? spell.payload.classes : undefined).toEqual([]);
    const weapon = migrated.value?.items.find((item) => item.id === 'weapon-draft');
    expect(weapon?.kind === 'weapon' ? weapon.payload.weaponType : undefined).toBe('manual');
  });

  it('migrates the current PHB 2024 package through the canonical pipeline', () => {
    const fixturePath = path.resolve(process.cwd(), 'assets/compendium/phb-2024-full-consolidated-import-pack-v5-complete-invocations.json');
    const parsed = parseImportPack(fs.readFileSync(fixturePath, 'utf8'));
    const errors = parsed.issues.filter((entry) => entry.severity === 'error');
    expect(errors).toEqual([]);
    expect(parsed.data?.items).toHaveLength(1284);
    expect(new Set(parsed.data?.items.map((item) => item.id)).size).toBe(1284);
    expect(parsed.data?.items.filter((item) => item.kind === 'spell')).toHaveLength(391);
  });
});
