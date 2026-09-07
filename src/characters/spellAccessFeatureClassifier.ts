import type { StoredCompendiumItem } from '../compendium/types';
import { getSpellAccessCatalogReconciliation } from './spellAccessCatalogReconciliation';

const asRecord = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};

const asString = (value: unknown): string | undefined =>
  typeof value === 'string' && value.trim() ? value.trim() : undefined;

const asNumber = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isFinite(value) ? value : undefined;

const asBoolean = (value: unknown): boolean | undefined =>
  typeof value === 'boolean' ? value : undefined;

const asStringArray = (value: unknown): string[] =>
  Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === 'string' && Boolean(entry.trim()))
    : [];

const unique = (values: readonly string[]): string[] => Array.from(new Set(values.filter(Boolean)));

const levelMapReferences = (value: unknown): string[] =>
  Object.values(asRecord(value)).flatMap((entry) => asStringArray(entry));

export type SpellAccessFeatureSignalKind =
  | 'expandedList'
  | 'bonusChoice'
  | 'alwaysPrepared'
  | 'granted'
  | 'ritualGrant'
  | 'conditionalList'
  | 'subclassSpellcasting'
  | 'mysticArcanumChoice'
  | 'spellbookBonusChoice'
  | 'spellbookGrant'
  | 'spellbookSpecialChoice'
  | 'specialSpellReference'
  | 'catalogReconciliationRequired';

export interface SpellAccessFeatureSignal {
  kind: SpellAccessFeatureSignalKind;
  featureItemId: string;
  featureImportItemId: string;
  featureName: string;
  classReference?: string;
  subclassReference?: string;
  spellReferences: string[];
  sourceClassNames?: string[];
  count?: number;
  spellLevel?: number;
  school?: string;
  mode?: string;
  progression?: string;
  ability?: string;
  details?: Record<string, unknown>;
}

const sourceMetadata = (feature: StoredCompendiumItem) => {
  const payload = asRecord(feature.normalizedJson);
  return {
    featureItemId: feature.id,
    featureImportItemId: feature.importItemId,
    featureName: feature.name,
    classReference: asString(payload.classId) ?? asString(payload.classRef) ?? asString(payload.ownerClassId),
    subclassReference: asString(payload.subclassId) ?? asString(payload.ownerSubclassId)
  };
};

const signal = (
  feature: StoredCompendiumItem,
  kind: SpellAccessFeatureSignalKind,
  values: Omit<SpellAccessFeatureSignal, 'kind' | 'featureItemId' | 'featureImportItemId' | 'featureName'>
): SpellAccessFeatureSignal => ({
  kind,
  ...sourceMetadata(feature),
  ...values
});

/**
 * Classifies spell-access shapes already present in imported class/subclass feature
 * carriers. This function is intentionally descriptive: a recognized signal does
 * not automatically mean the current UI already implements the rule.
 *
 * Keeping discovery separate from behavior prevents silent loss of rules when a
 * future book introduces a known shape on a different class or subclass.
 */
export const classifySpellAccessFeature = (
  feature: StoredCompendiumItem
): SpellAccessFeatureSignal[] => {
  if (feature.type !== 'feature' || feature.status === 'disabled') return [];
  const payload = asRecord(feature.normalizedJson);
  const mechanics = asRecord(payload.mechanics);
  const signals: SpellAccessFeatureSignal[] = [];

  const alwaysPrepared = unique([
    ...asStringArray(payload.alwaysPreparedSpellRefs),
    ...asStringArray(payload.alwaysPreparedSpells)
  ]);
  if (alwaysPrepared.length) {
    signals.push(signal(feature, 'alwaysPrepared', { spellReferences: alwaysPrepared }));
  }

  if (asBoolean(payload.alwaysPreparedSpellRefsNeedsReview) === true) {
    const reconciliation = getSpellAccessCatalogReconciliation(feature.importItemId);
    if (reconciliation) {
      signals.push(signal(feature, reconciliation.mode, {
        spellReferences: reconciliation.spellReferences,
        details: {
          reconciledFrom: 'runtimeCatalogBridge',
          bridgeId: reconciliation.bridgeId,
          sourceCatalogVersion: '4.8.0',
          reviewFlagPreserved: true
        }
      }));
    } else {
      signals.push(signal(feature, 'catalogReconciliationRequired', {
        spellReferences: [],
        details: { reason: 'alwaysPreparedSpellRefsNeedsReview' }
      }));
    }
  }

  const spellGrants = Array.isArray(mechanics.spellGrants) ? mechanics.spellGrants : [];
  for (const grantValue of spellGrants) {
    const grant = asRecord(grantValue);
    const references = unique([
      ...asStringArray(grant.spellIds),
      ...asStringArray(grant.spellRefs)
    ]);
    if (!references.length) continue;
    const automatic = asBoolean(grant.alwaysPrepared) === true ||
      asBoolean(grant.countsAgainstPrepared) === false ||
      asBoolean(grant.countsAgainstSpellsKnown) === false;
    signals.push(signal(feature, automatic ? 'alwaysPrepared' : 'granted', {
      spellReferences: references,
      details: {
        minimumClassLevel: asNumber(grant.classLevel) ?? asNumber(grant.level),
        countsAgainstPrepared: asBoolean(grant.countsAgainstPrepared),
        countsAgainstSpellsKnown: asBoolean(grant.countsAgainstSpellsKnown)
      }
    }));
  }

  if (asBoolean(mechanics.alwaysPrepared) === true) {
    const progression = Array.isArray(mechanics.spellProgression) ? mechanics.spellProgression : [];
    const references = unique(progression.flatMap((rowValue) => {
      const row = asRecord(rowValue);
      return [...asStringArray(row.spellIds), ...asStringArray(row.spellRefs)];
    }));
    if (references.length) {
      signals.push(signal(feature, 'alwaysPrepared', {
        spellReferences: references,
        details: { progressionRows: progression.length }
      }));
    }
  }

  const domainSpellTable = asRecord(mechanics.domainSpellTable);
  if (Object.keys(domainSpellTable).length) {
    const references = unique(Object.values(domainSpellTable).flatMap((entry) => asStringArray(entry)));
    signals.push(signal(feature,
      asBoolean(mechanics.countsAgainstPreparedSpells) === false ? 'alwaysPrepared' : 'granted', {
        spellReferences: references,
        details: { levelKeys: Object.keys(domainSpellTable) }
      }));
  }

  const grantedCantrip = asString(mechanics.grantedCantrip);
  if (grantedCantrip) {
    signals.push(signal(feature, 'granted', {
      spellReferences: [grantedCantrip],
      spellLevel: 0
    }));
  }

  const cantripId = asString(mechanics.cantripId);
  if (cantripId && (
    asBoolean(mechanics.countsAgainstPrepared) === false ||
    asBoolean(mechanics.countsAgainstSpellsKnown) === false
  )) {
    signals.push(signal(feature, 'granted', {
      spellReferences: [cantripId],
      spellLevel: 0
    }));
  }

  const spellRefs = asStringArray(payload.spellRefs);
  if (spellRefs.length) {
    const ritualOnly = asBoolean(payload.ritualOnly) === true;
    const hasExplicitSpecialCast = Boolean(
      asString(payload.freeCast) ||
      asString(payload.freeCasts) ||
      (Array.isArray(payload.consumes) && payload.consumes.length) ||
      Object.keys(asRecord(payload.resource)).length
    );
    const hasModifierShape = Boolean(
      asString(payload.trigger) ||
      asBoolean(payload.noConcentrationOption) ||
      asBoolean(payload.bonusActionDispelMagic) ||
      asStringArray(payload.componentReduction).length ||
      asNumber(payload.rangeBonus) ||
      asStringArray(payload.choices).length ||
      asString(payload.enhancesSpell)
    );
    signals.push(signal(feature, ritualOnly ? 'ritualGrant' : 'specialSpellReference', {
      spellReferences: spellRefs,
      ability: asString(payload.spellcastingAbility),
      details: {
        ritualOnly,
        mode: ritualOnly ? 'ritualGrant' : hasExplicitSpecialCast ? 'specialCast' : hasModifierShape ? 'modifier' : 'reference',
        freeCast: asString(payload.freeCast),
        freeCasts: asString(payload.freeCasts),
        noConcentrationOption: asBoolean(payload.noConcentrationOption),
        trigger: asString(payload.trigger),
        consumes: payload.consumes
      }
    }));
  }

  const expandedSpellLists = unique([
    ...asStringArray(payload.expandedSpellLists),
    ...asStringArray(mechanics.expandedSpellLists)
  ]);
  const addedWarlock = levelMapReferences(mechanics.addedToWarlockSpellListBySpellLevel);
  const commonBySpellLevel = levelMapReferences(mechanics.commonBySpellLevel);
  const byKind = Object.values(asRecord(mechanics.byKind)).flatMap((kindValue) => levelMapReferences(kindValue));
  if (expandedSpellLists.length || addedWarlock.length || commonBySpellLevel.length || byKind.length) {
    signals.push(signal(feature, 'expandedList', {
      spellReferences: unique([...addedWarlock, ...commonBySpellLevel, ...byKind]),
      sourceClassNames: expandedSpellLists,
      details: {
        hasPatronVariantMap: Object.keys(asRecord(mechanics.byKind)).length > 0,
        genieKinds: asStringArray(mechanics.genieKinds)
      }
    }));
  }

  const additionalPreparedSpells = asNumber(payload.additionalPreparedSpells);
  const spellSource = asString(payload.spellSource);
  if (additionalPreparedSpells && spellSource) {
    signals.push(signal(feature, 'bonusChoice', {
      spellReferences: [],
      count: additionalPreparedSpells,
      sourceClassNames: spellSource.split(/[|,;/]+/g).map((entry) => entry.trim()).filter(Boolean)
    }));
  }

  const cantripChoice = asRecord(mechanics.cantripChoice);
  if (asNumber(cantripChoice.count)) {
    signals.push(signal(feature, 'bonusChoice', {
      spellReferences: [],
      count: asNumber(cantripChoice.count),
      spellLevel: asNumber(cantripChoice.spellLevel) ?? 0,
      details: {
        sourceClassId: asString(cantripChoice.sourceClassId) ?? asString(cantripChoice.sourceClassRef),
        countsAs: asString(mechanics.chosenCantripCountsAs)
      }
    }));
  }

  const cantripChoiceCount = asNumber(mechanics.cantripChoiceCount);
  if (cantripChoiceCount && asString(mechanics.spellList)) {
    signals.push(signal(feature, 'bonusChoice', {
      spellReferences: [],
      count: cantripChoiceCount,
      spellLevel: 0,
      sourceClassNames: [asString(mechanics.spellList) as string],
      ability: asString(mechanics.spellcastingAbility),
      details: { countsAsClassSpellsFor: asString(mechanics.countsAsClassSpellsFor) }
    }));
  }

  const spellChoice = asRecord(mechanics.spellChoice);
  if (asNumber(spellChoice.count)) {
    signals.push(signal(feature, 'bonusChoice', {
      spellReferences: asString(spellChoice.initialSpellId) ? [asString(spellChoice.initialSpellId) as string] : [],
      count: asNumber(spellChoice.count),
      spellLevel: asNumber(spellChoice.level),
      sourceClassNames: asStringArray(spellChoice.sourceLists),
      details: { replacementTiming: asString(spellChoice.replacementTiming) }
    }));
  }

  const explicitSpellChoices = asStringArray(mechanics.spellChoices);
  const knownCantrips = asNumber(mechanics.knownCantrips);
  if (explicitSpellChoices.length && knownCantrips) {
    signals.push(signal(feature, 'bonusChoice', {
      spellReferences: explicitSpellChoices,
      count: knownCantrips,
      spellLevel: 0
    }));
  }

  for (const [containerName, containerValue] of [
    ['alternateOption', payload.alternateOption],
    ['choice', payload.choice]
  ] as const) {
    const options = containerName === 'choice'
      ? (Array.isArray(containerValue) ? containerValue : [])
      : (Object.keys(asRecord(containerValue)).length ? [containerValue] : []);
    for (const optionValue of options) {
      const option = asRecord(optionValue);
      const extraCantrips = asNumber(option.extraCantrips);
      if (!extraCantrips) continue;
      signals.push(signal(feature, 'bonusChoice', {
        spellReferences: [],
        count: extraCantrips,
        spellLevel: 0,
        sourceClassNames: asString(option.spellList) ? [asString(option.spellList) as string] : [],
        ability: asString(option.spellcastingAbility),
        details: { optionId: asString(option.id), activation: 'featureOption' }
      }));
    }
  }

  const spellListMode = asString(payload.spellListMode) ?? asString(mechanics.spellListMode);
  if (spellListMode) {
    signals.push(signal(feature, 'conditionalList', {
      spellReferences: [],
      mode: spellListMode
    }));
  }

  const spellcasting = asRecord(payload.spellcasting);
  if (Object.keys(spellcasting).length && (asString(payload.subclassId) || asString(payload.ownerSubclassId))) {
    signals.push(signal(feature, 'subclassSpellcasting', {
      spellReferences: [],
      ability: asString(spellcasting.ability),
      progression: asString(spellcasting.progression),
      details: {
        cantripsKnownByLevel: spellcasting.cantripsKnownByLevel,
        spellsKnownByLevel: spellcasting.spellsKnownByLevel,
        preparedSpellsByLevel: spellcasting.preparedSpellsByLevel
      }
    }));
  }

  const arcanumByLevel = asRecord(payload.arcanumByLevel);
  if (Object.keys(arcanumByLevel).length) {
    signals.push(signal(feature, 'mysticArcanumChoice', {
      spellReferences: [],
      details: { arcanumByLevel }
    }));
  }

  if (asBoolean(payload.freeSpells) === true && asString(payload.school)) {
    signals.push(signal(feature, 'spellbookBonusChoice', {
      spellReferences: [],
      school: asString(payload.school),
      details: { freeSpells: true }
    }));
  }

  const addsSpellToSpellbook = asString(mechanics.addsSpellToSpellbook);
  if (addsSpellToSpellbook) {
    signals.push(signal(feature, 'spellbookGrant', {
      spellReferences: [addsSpellToSpellbook]
    }));
  }

  const chooseSpells = Array.isArray(payload.chooseSpells) ? payload.chooseSpells : [];
  if (chooseSpells.length) {
    signals.push(signal(feature, 'spellbookSpecialChoice', {
      spellReferences: [],
      count: chooseSpells.reduce((sum, rowValue) => sum + (asNumber(asRecord(rowValue).count) ?? 1), 0),
      details: {
        choices: chooseSpells,
        alwaysPrepared: asBoolean(payload.alwaysPrepared),
        castAtWillAtLowestLevel: asBoolean(payload.castAtWillAtLowestLevel),
        freeCastEach: asNumber(payload.freeCastEach)
      }
    }));
  }

  return signals;
};

export const featureHasSpellAccessSignal = (feature: StoredCompendiumItem): boolean =>
  classifySpellAccessFeature(feature).length > 0;
