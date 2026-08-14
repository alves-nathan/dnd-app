import { buildPersistedCompendiumImport } from '../compendium/importer';
import { buildEngineReadinessForItem, buildEngineReadinessReport, engineReadinessReportToMarkdown } from '../compendium/engineReadiness';
import type { CompendiumImportInput } from '../compendium/schemas';

const source = { id: 'ready-source', book: 'Fonte legal própria', page: '42', version: '2024', status: 'active' as const, confidence: 'exact' as const };

const buildPack = (items: CompendiumImportInput['items']) =>
  buildPersistedCompendiumImport({
    id: 'ready-pack',
    source,
    items
  });

describe('engineReadiness', () => {
  it('marks a validated weapon with damage as ready for action and damage calculation', () => {
    const pack = buildPack([
      {
        id: 'weapon-a',
        kind: 'weapon',
        name: 'Ready Weapon',
        source,
        payload: { damageFormula: '1d8 + STR', actionCost: 'action', attackAbility: 'STR', weaponType: 'melee' }
      }
    ]);

    const row = buildEngineReadinessForItem(pack.items[0], { source, pack: pack.pack, enabledSource: true });

    expect(row.status).toBe('ready');
    expect(row.canApplyToCharacter).toBe(true);
    expect(row.canBuildAction).toBe(true);
    expect(row.canCalculateDamage).toBe(true);
    expect(row.capabilities).toContain('calculateDamage');
  });

  it('blocks a validated weapon without damage formula before the engine can use it', () => {
    const pack = buildPack([
      {
        id: 'weapon-b',
        kind: 'weapon',
        name: 'Incomplete Weapon',
        source,
        payload: { actionCost: 'action', weaponType: 'melee' }
      }
    ]);

    const row = buildEngineReadinessForItem(pack.items[0], { source, pack: pack.pack, enabledSource: true });

    expect(row.status).toBe('blocked');
    expect(row.canBuildAction).toBe(false);
    expect(row.issues.some((issue) => issue.code === 'ENGINE_WEAPON_DAMAGE_REQUIRED')).toBe(true);
  });

  it('warns about unresolved damage tokens instead of silently approving math', () => {
    const pack = buildPack([
      {
        id: 'spell-a',
        kind: 'spell',
        name: 'Manual Token Spell',
        source,
        payload: { level: 0, castingTime: 'action', damageFormula: '1d8 + MODIFICADOR_MISTERIOSO' }
      }
    ]);

    const row = buildEngineReadinessForItem(pack.items[0], { source, pack: pack.pack, enabledSource: true });

    expect(row.status).toBe('partial');
    expect(row.canCalculateDamage).toBe(true);
    expect(row.issues.some((issue) => issue.code === 'ENGINE_DAMAGE_UNRESOLVED_TOKENS')).toBe(true);
  });

  it('summarizes compatibility suites across validated compendium items', () => {
    const pack = buildPack([
      {
        id: 'weapon-c',
        kind: 'weapon',
        name: 'Ready Weapon',
        source,
        payload: { damageFormula: '1d6 + STR', actionCost: 'action', attackAbility: 'STR' }
      },
      {
        id: 'feature-c',
        kind: 'feature',
        name: 'Limited Feature',
        source,
        payload: {
          summary: 'Feature autoral para teste.',
          resource: { id: 'limited', name: 'Limited', max: 1, recharge: 'longRest' },
          grantsActions: [{ type: 'attack', name: 'Burst', actionCost: 'free', damageFormula: '1d6', sourceType: 'classFeature' }]
        }
      }
    ]);

    const report = buildEngineReadinessReport({
      items: pack.items,
      sources: [source],
      packs: [pack.pack],
      enabledSourceIds: [source.id],
      filters: { onlyValidated: true }
    });

    expect(report.summary.totalItems).toBe(2);
    expect(report.summary.actionItems).toBeGreaterThanOrEqual(2);
    expect(report.summary.resourceItems).toBe(1);
    expect(report.suites.some((entry) => entry.id === 'build-actions')).toBe(true);
  });

  it('exports markdown with summary and compatibility suites', () => {
    const pack = buildPack([
      {
        id: 'weapon-d',
        kind: 'weapon',
        name: 'Markdown Weapon',
        source,
        payload: { damageFormula: '1d4 + STR', actionCost: 'action', attackAbility: 'STR' }
      }
    ]);
    const report = buildEngineReadinessReport({ items: pack.items, sources: [source], packs: [pack.pack], enabledSourceIds: [source.id] });
    const markdown = engineReadinessReportToMarkdown(report);

    expect(markdown).toContain('Relatório de prontidão pré-engine');
    expect(markdown).toContain('Suites de compatibilidade');
  });
});
