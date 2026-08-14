import fs from 'node:fs';
import path from 'node:path';
import { analyzeCompendiumImportV2Semantics } from '../compendium/importSemanticValidation';
import { compendiumImportV2Schema, IMPORT_TEMPLATE_VERSION_V2 } from '../compendium/importV2Schemas';
import { parseImportPack } from '../compendium/parseImportPack';

const source = {
  id: 'semantic-test',
  book: 'Semantic Test',
  version: '2024',
  status: 'needsReview' as const,
  confidence: 'importedNeedsReview' as const,
  rulesEra: '2024' as const,
  contentType: 'official' as const
};

const pack = (items: unknown[]) => compendiumImportV2Schema.parse({
  templateVersion: IMPORT_TEMPLATE_VERSION_V2,
  id: 'semantic-test-pack',
  source,
  items
});

const condition = (id = 'condition-stunned', conditionId = 'stunned') => ({
  id,
  kind: 'condition' as const,
  name: 'Stunned',
  source,
  payload: { conditionId }
});

const wizard = {
  id: 'class-wizard',
  kind: 'class' as const,
  name: 'Wizard',
  source,
  payload: {
    hitDie: 6,
    featureIds: ['feature-spellcasting'],
    progression: [{ level: 1, featureIds: ['feature-spellcasting'] }],
    spellcasting: {
      ability: 'INT',
      progression: 'fullCaster',
      cantripsKnownByLevel: Array(20).fill(3),
      preparedSpellsByLevel: Array(20).fill(4),
      slotsByLevel: { '1': { '1': 2 } }
    }
  }
};

const spellcastingFeature = {
  id: 'feature-spellcasting',
  kind: 'feature' as const,
  name: 'Spellcasting',
  source,
  payload: { sourceType: 'classFeature', classId: 'class-wizard', levelGained: 1 }
};

describe('dnd-combat-import.v2 semantic validation', () => {
  it('returns structured error/warning/info buckets and paths', () => {
    const result = analyzeCompendiumImportV2Semantics(pack([
      condition('condition-a', 'duplicate-condition'),
      condition('condition-b', 'duplicate-condition')
    ]));

    expect(result.valid).toBe(false);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toEqual(expect.objectContaining({
      code: 'IMPORT_V2_DUPLICATE_CONDITION_ID',
      path: 'payload.conditionId',
      itemId: 'condition-b'
    }));
    expect(result.summary.errorCount).toBe(1);
    expect(result.summary.byCode.IMPORT_V2_DUPLICATE_CONDITION_ID).toBe(1);
  });

  it('validates class/subclass/feature ownership and progression timing', () => {
    const result = analyzeCompendiumImportV2Semantics(pack([
      wizard,
      spellcastingFeature,
      {
        id: 'subclass-evoker', kind: 'subclass', name: 'Evoker', source,
        payload: { classId: 'class-wizard', featureIds: ['feature-evoker'], progression: [{ level: 3, featureIds: ['feature-evoker'] }] }
      },
      {
        id: 'feature-evoker', kind: 'feature', name: 'Evoker Feature', source,
        payload: { sourceType: 'subclassFeature', classId: 'class-wizard', subclassId: 'subclass-evoker', levelGained: 4 }
      }
    ]));

    expect(result.errors.some((entry) => entry.code === 'IMPORT_V2_FEATURE_GRANTED_BEFORE_LEVEL_GAINED')).toBe(true);
  });

  it('allows the same feature entity to reappear at later upgrade levels', () => {
    const result = analyzeCompendiumImportV2Semantics(pack([
      {
        ...wizard,
        payload: {
          ...wizard.payload,
          featureIds: ['feature-asi'],
          progression: [
            { level: 4, featureIds: ['feature-asi'] },
            { level: 8, featureIds: ['feature-asi'] },
            { level: 12, featureIds: ['feature-asi'] }
          ]
        }
      },
      {
        id: 'feature-asi', kind: 'feature', name: 'Ability Score Improvement', source,
        payload: { sourceType: 'classFeature', classId: 'class-wizard', levelGained: 4 }
      }
    ]));

    expect(result.errors.filter((entry) => entry.code.includes('FEATURE_GRANTED_BEFORE'))).toEqual([]);
  });

  it('validates spell class references, slot semantics and saving-throw metadata', () => {
    const result = analyzeCompendiumImportV2Semantics(pack([
      wizard,
      spellcastingFeature,
      {
        id: 'spell-bad-cantrip', kind: 'spell', name: 'Bad Cantrip', source,
        payload: {
          level: 0,
          classes: [],
          classIds: ['missing-class'],
          castingTime: { kind: 'action', actionCost: 'action' },
          consumesSpellSlot: true,
          damageOnSaveSuccess: 'half'
        }
      }
    ]));

    expect(result.errors.map((entry) => entry.code)).toEqual(expect.arrayContaining([
      'IMPORT_V2_SPELL_CLASSES_EMPTY',
      'IMPORT_V2_CANTRIP_CONSUMES_SLOT'
    ]));
    expect(result.warnings.map((entry) => entry.code)).toEqual(expect.arrayContaining([
      'IMPORT_V2_SPELL_CLASS_MISSING',
      'IMPORT_V2_SAVE_DAMAGE_WITHOUT_SAVE'
    ]));
  });

  it('validates resources, consumed items and granted-action references', () => {
    const result = analyzeCompendiumImportV2Semantics(pack([
      wizard,
      spellcastingFeature,
      condition(),
      {
        id: 'equipment-focus', kind: 'equipment', name: 'Focus', source,
        payload: { cost: { amount: 5, unit: 'GP' }, equipmentCategory: 'focus' }
      },
      {
        id: 'spell-action', kind: 'spell', name: 'Action Spell', source,
        payload: { level: 1, classes: ['Wizard'], classIds: ['class-wizard'], castingTime: { kind: 'action', actionCost: 'action' } }
      },
      {
        id: 'feature-resource', kind: 'feature', name: 'Resource Feature', source,
        payload: {
          sourceType: 'classFeature',
          classId: 'class-wizard',
          resource: {
            id: 'focus-points',
            max: { kind: 'classLevel', steps: [{ level: 1, value: 1 }, { level: 1, value: 2 }] },
            recharge: 'longRest'
          },
          consumes: [{ itemId: 'equipment-focus', amount: 1 }],
          grantsActions: [{
            type: 'spell',
            name: 'Cast Action Spell',
            spellId: 'spell-action',
            conditionIds: ['stunned'],
            consumes: [{ itemId: 'equipment-focus', amount: 1 }]
          }]
        }
      }
    ]));

    expect(result.errors.some((entry) => entry.code === 'IMPORT_V2_RESOURCE_SCALING_DUPLICATE_LEVEL')).toBe(true);
    expect(result.issues.some((entry) => entry.code === 'IMPORT_V2_ACTION_SPELL_MISSING')).toBe(false);
    expect(result.issues.some((entry) => entry.code === 'IMPORT_V2_CONSUMED_ITEM_MISSING')).toBe(false);
    expect(result.issues.some((entry) => entry.code === 'IMPORT_V2_CONDITION_REFERENCE_MISSING')).toBe(false);
  });

  it('validates equipment eligibility metadata without rejecting AC-bonus shields', () => {
    const result = analyzeCompendiumImportV2Semantics(pack([
      {
        id: 'weapon-bad', kind: 'weapon', name: 'Bad Weapon', source,
        payload: { weaponType: 'melee', damageFormula: '1d6', properties: ['Versatile'], cost: { amount: 1, unit: 'GP' } }
      },
      {
        id: 'armor-shield', kind: 'armor', name: 'Shield', source,
        payload: { armorCategory: 'shield', baseAC: 0, acBonus: 2, cost: { amount: 10, unit: 'GP' } }
      }
    ]));

    expect(result.errors.some((entry) => entry.code === 'IMPORT_V2_WEAPON_CATEGORY_MISSING')).toBe(true);
    expect(result.warnings.some((entry) => entry.code === 'IMPORT_V2_WEAPON_VERSATILE_DAMAGE_MISSING')).toBe(true);
    expect(result.errors.some((entry) => entry.itemId === 'armor-shield')).toBe(false);
  });

  it('allows incremental packs to resolve owners from existing catalog context', () => {
    const result = analyzeCompendiumImportV2Semantics(pack([
      {
        id: 'subclass-existing-owner', kind: 'subclass', name: 'Existing Owner', source,
        payload: { classId: 'class-existing' }
      }
    ]), {
      externalItems: [{ id: 'class-existing', kind: 'class' }]
    });

    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it('keeps the current PHB 2024 package free of semantic errors after the canonical boundary', () => {
    const fixturePath = path.resolve(process.cwd(), 'assets/compendium/phb-2024-full-consolidated-import-pack-v5-complete-invocations.json');
    const parsed = parseImportPack(fs.readFileSync(fixturePath, 'utf8'));

    expect(parsed.ok).toBe(true);
    expect(parsed.data?.items).toHaveLength(1284);
    expect(parsed.semanticValidation?.errors).toEqual([]);
    expect(parsed.semanticValidation?.summary.uniqueItemIds).toBe(1284);
  });
});
