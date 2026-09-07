import type { StoredCompendiumItem } from '../compendium/types';
import type { RuleValidationIssue } from '../types';
import {
  getProgressionStepReadinessIssues,
  pruneProgressionFeatCounts,
  pruneSelectedSubclassByClass
} from '../characters/progressionStepReadiness';

const item = (
  id: string,
  type: StoredCompendiumItem['type'],
  name: string,
  payload: Record<string, unknown> = {}
): StoredCompendiumItem => ({
  id,
  importItemId: id,
  packId: 'test-pack',
  sourceId: 'test-source',
  type,
  name,
  rawJson: {} as StoredCompendiumItem['rawJson'],
  normalizedJson: payload,
  tags: [],
  status: 'validated',
  createdAt: '2026-08-14T00:00:00.000Z',
  updatedAt: '2026-08-14T00:00:00.000Z'
});

const fighter = item('fighter', 'class', 'Fighter');
const champion = item('champion', 'subclass', 'Champion');
const eldritchKnight = item('eldritch-knight', 'subclass', 'Eldritch Knight');
const generalFeat = item('general-feat', 'feat', 'General Feat', { category: 'general' });
const repeatableGeneralFeat = item('repeatable-general', 'feat', 'Repeatable General', {
  category: 'general',
  repeatable: true
});
const fightingStyle = item('fighting-style', 'feat', 'Fighting Style', { category: 'fightingStyle' });
const epicBoon = item('epic-boon', 'feat', 'Epic Boon', { category: 'epicBoon' });
const allItems = [fighter, champion, eldritchKnight, generalFeat, repeatableGeneralFeat, fightingStyle, epicBoon];
const subclassGroups = [{ classItem: fighter, level: 3, subclasses: [champion, eldritchKnight] }];

const issue = (code: string): RuleValidationIssue => ({
  severity: 'error',
  code,
  message: code
});

describe('progression step readiness', () => {
  it('prunes subclass choices that became orphaned or ineligible', () => {
    const current = { fighter: 'champion', warlock: 'genie' };
    expect(pruneSelectedSubclassByClass(current, subclassGroups)).toEqual({ fighter: 'champion' });
    expect(pruneSelectedSubclassByClass({ fighter: 'unknown' }, subclassGroups)).toEqual({});

    const stable = { fighter: 'eldritch-knight' };
    expect(pruneSelectedSubclassByClass(stable, subclassGroups)).toBe(stable);
  });

  it('trims stale feat selections to the slots exposed by the current level', () => {
    expect(pruneProgressionFeatCounts({
      'general-feat': 1,
      'repeatable-general': 2,
      'fighting-style': 1,
      'epic-boon': 1,
      missing: 1
    }, allItems, {
      general: 1,
      fightingStyle: 1,
      epicBoon: 0
    })).toEqual({
      'general-feat': 1,
      'fighting-style': 1
    });

    expect(pruneProgressionFeatCounts({
      'repeatable-general': 3
    }, allItems, {
      general: 2,
      fightingStyle: 0,
      epicBoon: 0
    })).toEqual({
      'repeatable-general': 2
    });
  });

  it('reports the same blocking conditions consumed by the progression screen', () => {
    const issues = getProgressionStepReadinessIssues({
      subclassGroups,
      selectedSubclassByClass: {},
      featRequirements: { general: 1, fightingStyle: 0, epicBoon: 0 },
      selectedFeatCounts: {},
      items: allItems,
      subclassChoiceIssues: [issue('SUBCLASS_INTERNAL_CHOICE')],
      featChoiceIssues: [issue('FEAT_INTERNAL_CHOICE')],
      invocationIssues: [issue('INVOCATION_INTERNAL_CHOICE')],
      unavailableReferences: ['disabled-item']
    });

    expect(issues.map((entry) => entry.code)).toEqual(expect.arrayContaining([
      'PROGRESSION_SUBCLASS_REQUIRED',
      'PROGRESSION_GENERAL_COUNT',
      'PROGRESSION_REFERENCE_UNAVAILABLE',
      'SUBCLASS_INTERNAL_CHOICE',
      'FEAT_INTERNAL_CHOICE',
      'INVOCATION_INTERNAL_CHOICE'
    ]));
  });

  it('blocks immediately-resolvable parent feat prerequisites on the progression step', () => {
    const issues = getProgressionStepReadinessIssues({
      subclassGroups,
      selectedSubclassByClass: { fighter: 'champion' },
      featRequirements: { general: 1, fightingStyle: 0, epicBoon: 0 },
      selectedFeatCounts: { 'general-feat': 1 },
      items: allItems,
      subclassChoiceIssues: [],
      featChoiceIssues: [],
      featPrerequisiteIssues: [issue('FEAT_MARTIAL_WEAPON_PROFICIENCY_PREREQUISITE')],
      invocationIssues: [],
      unavailableReferences: []
    });

    expect(issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'FEAT_MARTIAL_WEAPON_PROFICIENCY_PREREQUISITE' })
    ]));
  });

  it('wires non-ability feat prerequisites into character creation readiness', () => {
    const fs = require('fs');
    const path = require('path');
    const source = fs.readFileSync(path.join(process.cwd(), 'app/characters/new.tsx'), 'utf8');
    expect(source).toContain('featPrerequisiteIssues: progressionFeatPrerequisiteIssues');
    expect(source).toContain("entry.code !== 'FEAT_ABILITY_PREREQUISITE'");
  });

  it('returns no issues when subclass and feat requirements are complete', () => {
    expect(getProgressionStepReadinessIssues({
      subclassGroups,
      selectedSubclassByClass: { fighter: 'champion' },
      featRequirements: { general: 1, fightingStyle: 0, epicBoon: 0 },
      selectedFeatCounts: { 'general-feat': 1 },
      items: allItems,
      subclassChoiceIssues: [],
      featChoiceIssues: [],
      invocationIssues: [],
      unavailableReferences: []
    })).toEqual([]);
  });
});
