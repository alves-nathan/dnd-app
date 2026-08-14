import { buildSemiStructuredImportDraft, splitSemiStructuredTextIntoSections } from '../compendium/semiStructuredImport';

const source = { id: 'owned-source', book: 'Fonte própria', page: '12', version: '2024' };

describe('semi structured import assistant', () => {
  it('splits markdown headings into rule sections', () => {
    const sections = splitSemiStructuredTextIntoSections('## First\nDamage: 1d8 + STR\n\n## Second\nAction. Damage: 2d6');
    expect(sections).toHaveLength(2);
    expect(sections[0]?.heading).toBe('First');
    expect(sections[1]?.heading).toBe('Second');
  });

  it('creates needs-review compendium JSON with detected formulas', () => {
    const draft = buildSemiStructuredImportDraft('## Training Blade\nWeapon, melee. Action. Damage: 1d8 + STR.', {
      packId: 'semi-pack',
      source,
      defaultKind: 'auto'
    });

    expect(draft.ok).toBe(true);
    expect(draft.pack.items).toHaveLength(1);
    expect(draft.pack.source.status).toBe('needsReview');
    expect(draft.pack.source.confidence).toBe('importedNeedsReview');
    expect(draft.pack.items[0]?.kind).toBe('weapon');
    expect(draft.pack.items[0]?.payload.damageFormula).toBe('1d8 + STR');
    expect(draft.candidates[0]?.evidence.join(' ')).toContain('1d8 + STR');
    expect(draft.issues.some((issue) => issue.code === 'SEMI_STRUCTURED_REVIEW_REQUIRED')).toBe(true);
  });

  it('infers spell hints without validating the rule automatically', () => {
    const draft = buildSemiStructuredImportDraft('## Test Ray\nCantrip spell. Action. Spell attack. Damage: 2d10. Range 120 ft.', {
      source,
      defaultKind: 'auto'
    });

    const payload = draft.pack.items[0]?.payload ?? {};
    expect(draft.pack.items[0]?.kind).toBe('spell');
    expect(payload.level).toBe(0);
    expect(payload.requiresAttackRoll).toBe(true);
    expect(payload.damageFormula).toBe('2d10');
    expect(draft.pack.items[0]?.source.confidence).toBe('importedNeedsReview');
  });

  it('returns an error for empty text', () => {
    const draft = buildSemiStructuredImportDraft('   ', { source, defaultKind: 'auto' });
    expect(draft.ok).toBe(false);
    expect(draft.issues[0]?.code).toBe('SEMI_STRUCTURED_EMPTY_TEXT');
  });
});
