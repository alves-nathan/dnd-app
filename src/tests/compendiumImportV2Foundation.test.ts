import { COMPENDIUM_ENTITY_KINDS, ACTION_COSTS, ABILITY_SCORES, SKILLS } from '../compendium/importDomain';
import { compendiumImportV2Schema, IMPORT_TEMPLATE_VERSION_V2 } from '../compendium/importV2Schemas';
import { detectCompendiumImportVersion } from '../compendium/importVersion';
import { validateCompendiumImportV2Semantics } from '../compendium/importSemanticValidation';

const source = {
  id: 'test-source',
  book: 'Test Book',
  version: '2024',
  status: 'active' as const,
  confidence: 'exact' as const,
  rulesEra: '2024' as const,
  contentType: 'official' as const
};

const buildPack = (items: unknown[]) => ({
  templateVersion: IMPORT_TEMPLATE_VERSION_V2,
  id: 'test-pack',
  source,
  metadata: { purpose: 'unit-test' },
  items
});

describe('dnd-combat-import.v2 foundation', () => {
  it('exposes the real entity kinds currently supported by the compendium', () => {
    expect(COMPENDIUM_ENTITY_KINDS).toEqual([
      'class', 'subclass', 'species', 'background', 'feat', 'weapon', 'armor', 'equipment', 'magicItem', 'spell', 'feature', 'condition', 'creatureStatBlock'
    ]);
    expect(ABILITY_SCORES).toHaveLength(6);
    expect(ACTION_COSTS).toContain('bonusAction');
    expect(SKILLS).toContain('Sleight of Hand');
  });

  it('detects v1, v2 and unversioned legacy envelopes', () => {
    expect(detectCompendiumImportVersion(buildPack([]))).toBe('dnd-combat-import.v2');
    expect(detectCompendiumImportVersion({ templateVersion: 'dnd-combat-import.v1', id: 'v1', source, items: [] })).toBe('dnd-combat-import.v1');
    expect(detectCompendiumImportVersion({ id: 'legacy', source, items: [] })).toBe('legacy-unversioned');
    expect(detectCompendiumImportVersion({ templateVersion: 'future-v99' })).toBe('unknown');
  });

  it('validates a typed V2 class/feature/spell package', () => {
    const parsed = compendiumImportV2Schema.parse(buildPack([
      {
        id: 'test-class-wizard', kind: 'class', name: 'Wizard', source,
        payload: {
          hitDie: 6,
          primaryAbilities: ['INT'],
          savingThrowProficiencies: ['INT', 'WIS'],
          featureIds: ['test-feature-spellcasting'],
          progression: [{ level: 1, featureIds: ['test-feature-spellcasting'] }],
          spellcasting: { ability: 'INT', progression: 'fullCaster', cantripsKnownByLevel: [3] },
          resources: []
        }
      },
      {
        id: 'test-feature-spellcasting', kind: 'feature', name: 'Spellcasting', source,
        payload: { sourceType: 'classFeature', classId: 'test-class-wizard', levelGained: 1, actionCost: 'free' }
      },
      {
        id: 'test-spell-fire-bolt', kind: 'spell', name: 'Fire Bolt', source,
        payload: {
          level: 0,
          school: 'Evocation',
          classes: ['Wizard'],
          classIds: ['test-class-wizard'],
          castingTime: { kind: 'action', actionCost: 'action' },
          range: '120 ft',
          requiresAttackRoll: true,
          damageFormula: '1d10',
          damageType: 'fire',
          consumesSpellSlot: false,
          minimumSlotLevel: 0,
          scaling: { kind: 'characterLevel', steps: [{ level: 1, damageFormula: '1d10' }] }
        }
      }
    ]));

    expect(parsed.items).toHaveLength(3);
    expect(validateCompendiumImportV2Semantics(parsed).filter((entry) => entry.severity === 'error')).toEqual([]);
  });

  it('requires classes for V2 spells instead of accepting an opaque payload', () => {
    const result = compendiumImportV2Schema.safeParse(buildPack([
      {
        id: 'spell-invalid', kind: 'spell', name: 'Invalid Spell', source,
        payload: { level: 1, castingTime: 'action' }
      }
    ]));
    expect(result.success).toBe(false);
  });

  it('detects duplicate IDs and missing subclass owners semantically', () => {
    const parsed = compendiumImportV2Schema.parse(buildPack([
      { id: 'subclass-a', kind: 'subclass', name: 'Subclass A', source, payload: { classId: 'missing-class' } },
      { id: 'duplicate', kind: 'condition', name: 'One', source, payload: { conditionId: 'one' } },
      { id: 'duplicate', kind: 'condition', name: 'Two', source, payload: { conditionId: 'two' } }
    ]));
    const issues = validateCompendiumImportV2Semantics(parsed);
    expect(issues.some((entry) => entry.code === 'IMPORT_V2_DUPLICATE_ID')).toBe(true);
    expect(issues.some((entry) => entry.code === 'IMPORT_V2_SUBCLASS_CLASS_MISSING')).toBe(true);
  });

  it('requires structured currency in canonical V2', () => {
    const structured = compendiumImportV2Schema.safeParse(buildPack([
      { id: 'weapon-spear', kind: 'weapon', name: 'Spear', source, payload: { weaponCategory: 'simple', weaponType: 'melee', damageFormula: '1d6 + STR', cost: { amount: 1, unit: 'GP' } } }
    ]));
    const legacy = compendiumImportV2Schema.safeParse(buildPack([
      { id: 'weapon-club', kind: 'weapon', name: 'Club', source, payload: { weaponCategory: 'simple', weaponType: 'melee', damageFormula: '1d4 + STR', cost: '1 SP' } }
    ]));
    expect(structured.success).toBe(true);
    expect(legacy.success).toBe(false);
  });
});
