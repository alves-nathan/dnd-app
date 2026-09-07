import type { AbilityScore, Character, ResourcePool, ResourceRestRecoveryRule } from '../types';
import type { StoredCompendiumItem } from './types';
import { getAbilityModifier, getProficiencyBonus } from '../rules-engine/characters/derivedStats';

const asRecord = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};

const asString = (value: unknown): string | undefined =>
  typeof value === 'string' && value.trim() ? value.trim() : undefined;

const asNumber = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isFinite(value) ? value : undefined;

const normalizeRecharge = (value: unknown): ResourcePool['recharge'] | undefined => {
  const recharge = asString(value)?.replace(/\s+/g, '');
  if (!recharge) return undefined;
  if (/^shortOrLongRest$/i.test(recharge) || /^shortorlongrest$/i.test(recharge)) return 'shortRest';
  if (/^longRestOnUse$/i.test(recharge)) return 'longRest';
  if (/^longrest$/i.test(recharge)) return 'longRest';
  if (/^shortrest$/i.test(recharge)) return 'shortRest';
  if (/^turn$/i.test(recharge)) return 'turn';
  if (/^day$/i.test(recharge)) return 'day';
  if (/^manual$/i.test(recharge)) return 'manual';
  return undefined;
};

const referenceKey = (value?: string): string => (value ?? '')
  .replace(/^catalog:/, '')
  .replace(/^compendium:/, '')
  .trim();

const referencesMatch = (left?: string, right?: string): boolean => {
  const a = referenceKey(left);
  const b = referenceKey(right);
  if (!a || !b) return false;
  return a === b || a.endsWith(`:${b}`) || b.endsWith(`:${a}`);
};

const classLevelForPayload = (character: Character, payload: Record<string, unknown>): number | undefined => {
  const classRef = asString(payload.classId) ?? asString(payload.ownerClassId);
  if (classRef) {
    const link = (character.compendiumLinks ?? []).find((candidate) =>
      candidate.status === 'active' &&
      candidate.appliedAs === 'class' &&
      [candidate.itemId, candidate.importItemId, candidate.choiceId, candidate.catalogEntityId]
        .some((reference) => referencesMatch(reference, classRef))
    );
    const linkedClass = link ? character.classes.find((entry) => entry.id === link.appliedEntityId) : undefined;
    if (linkedClass) return linkedClass.level;
  }
  if (character.classes.length === 1) return character.classes[0]?.level;
  return undefined;
};

const valueFromLevelMap = (value: unknown, level?: number): number | undefined => {
  if (level === undefined) return undefined;
  const record = asRecord(value);
  const candidates = Object.entries(record)
    .map(([threshold, raw]) => ({ threshold: Number(threshold), value: asNumber(raw) }))
    .filter((entry): entry is { threshold: number; value: number } => Number.isFinite(entry.threshold) && entry.value !== undefined && entry.threshold <= level)
    .sort((left, right) => right.threshold - left.threshold);
  return candidates[0]?.value;
};

const abilityFromText = (value?: string): AbilityScore | undefined => {
  const match = value ? /\b(STR|DEX|CON|INT|WIS|CHA)\b/i.exec(value) : undefined;
  return match ? match[1].toUpperCase() as AbilityScore : undefined;
};

const evaluateSimpleResourceFormula = (
  formula: string,
  character: Character,
  payload: Record<string, unknown>,
  minimum = 0
): number | undefined => {
  const rawText = formula.replace(/×/g, '*').trim();
  const minimumMatch = /\(\s*minimum\s+(\d+)\s*\)/i.exec(rawText);
  const effectiveMinimum = minimumMatch ? Math.max(minimum, Number(minimumMatch[1])) : minimum;
  const text = rawText.replace(/\(\s*minimum\s+\d+\s*\)/ig, '').trim();
  const maxWrapper = /^max\(\s*(\d+)\s*,\s*(.+)\)$/i.exec(text);
  if (maxWrapper) {
    const nested = evaluateSimpleResourceFormula(maxWrapper[2], character, payload, Math.max(effectiveMinimum, Number(maxWrapper[1])));
    return nested === undefined ? undefined : Math.max(effectiveMinimum, Number(maxWrapper[1]), nested);
  }
  const pb = getProficiencyBonus(character);
  const classLevel = classLevelForPayload(character, payload);
  const ability = abilityFromText(text);
  if (/^(STR|DEX|CON|INT|WIS|CHA)(?:\s+mod(?:ifier)?)?$/i.test(text) && ability) {
    return Math.max(effectiveMinimum, getAbilityModifier(character.abilities, ability));
  }
  if (/^(PB|proficiency\s*bonus)$/i.test(text)) return Math.max(effectiveMinimum, pb);

  let match = /^(\d+)\s*\*\s*(PB|proficiency\s*bonus)$/i.exec(text)
    ?? /^(PB|proficiency\s*bonus)\s*\*\s*(\d+)$/i.exec(text);
  if (match) {
    const numeric = Number(/^\d+$/.test(match[1]) ? match[1] : match[2]);
    return Math.max(effectiveMinimum, numeric * pb);
  }

  if (classLevel !== undefined) {
    match = /^(\d+)\s*\*\s*[A-Za-z][A-Za-z\s'-]*Level$/i.exec(text);
    if (match) return Math.max(effectiveMinimum, Number(match[1]) * classLevel);
    match = /^(\d+)\s*\+\s*[A-Za-z][A-Za-z\s'-]*Level$/i.exec(text);
    if (match) return Math.max(effectiveMinimum, Number(match[1]) + classLevel);
    match = /^[A-Za-z][A-Za-z\s'-]*Level\s*\+\s*(\d+)$/i.exec(text);
    if (match) return Math.max(effectiveMinimum, classLevel + Number(match[1]));
    if (/^[A-Za-z][A-Za-z\s'-]*Level$/i.test(text)) return Math.max(effectiveMinimum, classLevel);
  }

  return undefined;
};

const maxFromSpec = (
  spec: Record<string, unknown>,
  payload: Record<string, unknown>,
  character: Character
): number | undefined => {
  const direct = asNumber(spec.max) ?? asNumber(spec.maximum) ?? asNumber(spec.uses) ?? asNumber(spec.maxUses);
  if (direct !== undefined) return direct;

  const usesExpression = asString(spec.uses) ?? asString(spec.maxUses);
  if (usesExpression) {
    const resolved = evaluateSimpleResourceFormula(usesExpression, character, payload, asNumber(spec.minimum) ?? 0);
    if (resolved !== undefined) return resolved;
  }

  const maxRecord = asRecord(spec.max);
  const kind = asString(maxRecord.kind);
  if (kind === 'proficiencyBonus') return getProficiencyBonus(character);
  if (kind === 'abilityModifier' || kind === 'custom') {
    const formula = asString(maxRecord.formula) ?? asString(maxRecord.ability);
    const value = formula ? evaluateSimpleResourceFormula(formula, character, payload, asNumber(spec.minimum) ?? asNumber(maxRecord.minimum) ?? 0) : undefined;
    if (value !== undefined) return value;
  }
  if (kind === 'classLevel') {
    const level = classLevelForPayload(character, payload);
    if (level !== undefined && Array.isArray(maxRecord.steps)) {
      const candidates = maxRecord.steps
        .map(asRecord)
        .map((entry) => ({ level: asNumber(entry.level), value: asNumber(entry.value) }))
        .filter((entry): entry is { level: number; value: number } => entry.level !== undefined && entry.value !== undefined && entry.level <= level)
        .sort((left, right) => right.level - left.level);
      if (candidates[0]) return candidates[0].value;
    }
  }

  const classLevel = classLevelForPayload(character, payload);
  for (const [key, value] of Object.entries(spec)) {
    if (/By[A-Za-z]+Level$/i.test(key)) {
      const resolved = valueFromLevelMap(value, classLevel);
      if (resolved !== undefined) return resolved;
    }
  }

  const formula = Object.entries(spec).find(([key, value]) => /UsesFormula$/i.test(key) && typeof value === 'string')?.[1];
  if (typeof formula === 'string') {
    const resolved = evaluateSimpleResourceFormula(formula, character, payload, asNumber(spec.minimum) ?? 0);
    if (resolved !== undefined) return resolved;
  }
  return undefined;
};

const recoveryRulesFromSpec = (spec: Record<string, unknown>): ResourceRestRecoveryRule[] => {
  const raw = Array.isArray(spec.recoveryRules) ? spec.recoveryRules : [];
  return raw.flatMap((entry): ResourceRestRecoveryRule[] => {
    const record = asRecord(entry);
    const trigger = asString(record.trigger);
    const amountRaw = record.amount;
    if (trigger !== 'shortRest' && trigger !== 'longRest') return [];
    const amount: number | 'all' | undefined = amountRaw === 'all' ? 'all' : asNumber(amountRaw);
    return amount === undefined ? [] : [{ trigger, amount }];
  });
};

const customRecoveryNotes = (spec: Record<string, unknown>): string[] => {
  const raw = Array.isArray(spec.recoveryRules) ? spec.recoveryRules : [];
  return raw.flatMap((entry): string[] => {
    const record = asRecord(entry);
    if (asString(record.trigger) !== 'custom') return [];
    const condition = asString(record.condition);
    if (!condition) return [];
    const known: Record<string, string> = {
      longRestOrLevel3Slot: 'Também pode ser recuperado gastando um spell slot de nível 3+.',
      longRestOrRageUse: 'Também pode ser recuperado pelo uso alternativo indicado pela feature.',
      longRestAndOneBonusActionPerShortRest: 'A feature possui uma recuperação adicional limitada por descanso curto.'
    };
    return [known[condition] ?? `Recuperação alternativa: ${condition}.`];
  });
};

const poolFromSpec = (
  spec: Record<string, unknown>,
  item: StoredCompendiumItem,
  character: Character,
  options?: { idSuffix?: string; nameSuffix?: string; defaultMax?: number }
): ResourcePool | undefined => {
  const payload = item.normalizedJson;
  const max = maxFromSpec(spec, payload, character) ?? options?.defaultMax;
  if (max === undefined) return undefined;
  const recoveryRules = recoveryRulesFromSpec(spec);
  const recharge = normalizeRecharge(spec.recharge) ?? normalizeRecharge(spec.refresh) ?? 'longRest';
  const actionCost = asString(payload.actionCost);
  const actionLabel = actionCost && actionCost !== 'free'
    ? ({ action: 'Ação', bonusAction: 'Ação bônus', reaction: 'Reação' } as Record<string, string>)[actionCost]
    : undefined;
  const notes = [
    item.summary,
    actionLabel ? `Ativação: ${actionLabel}.` : undefined,
    asString(spec.notes),
    ...customRecoveryNotes(spec)
  ].filter((entry): entry is string => Boolean(entry)).join(' ');
  const baseId = asString(spec.id) ?? item.id;
  return {
    id: options?.idSuffix ? `${baseId}-${options.idSuffix}` : baseId,
    name: asString(spec.name) ?? asString(spec.label) ?? (options?.nameSuffix ? `${item.name} · ${options.nameSuffix}` : item.name),
    max: Math.max(0, Math.floor(max)),
    current: Math.max(0, Math.floor(max)),
    recharge,
    recoveryRules: recoveryRules.length ? recoveryRules : undefined,
    notes: notes || undefined,
    source: item.rawJson.source
  };
};

/**
 * Materializes limited-use resources from the supported canonical and legacy
 * feature shapes. The extractor is intentionally declarative: it reads uses,
 * formulas and recharge metadata instead of matching class/subclass names.
 */
export const resourcePoolsFromAutomaticFeature = (
  character: Character,
  item: StoredCompendiumItem
): ResourcePool[] => {
  const payload = item.normalizedJson;
  const root = asRecord(payload.resource ?? payload.resourcePool);
  const pools: ResourcePool[] = [];

  if (Object.keys(root).length) {
    // Some imported resources encode multiple independent use formulas inside
    // one resource object (for example alternate armor modes).
    const formulaEntries = Object.entries(root).filter(([key, value]) => /UsesFormula$/i.test(key) && typeof value === 'string');
    const rootPool = formulaEntries.length > 1
      ? undefined
      : poolFromSpec(root, item, character, { defaultMax: normalizeRecharge(root.recharge) ? 1 : undefined });
    if (rootPool) {
      const engineKey = asString(payload.engineKey);
      if (engineKey === 'subclass.bard.college_of_glamour.beguiling_magic') {
        rootPool.notes = [rootPool.notes, 'Pode ser recuperado gastando 1 uso de Bardic Inspiration.'].filter(Boolean).join(' ');
      }
      pools.push(rootPool);
    }

    if (!rootPool && formulaEntries.length > 1) {
      for (const [key, formula] of formulaEntries) {
        const max = evaluateSimpleResourceFormula(formula as string, character, payload, 1);
        if (max === undefined) continue;
        const label = key.replace(/UsesFormula$/i, '').replace(/([a-z])([A-Z])/g, '$1 $2').trim();
        pools.push({
          id: `${asString(root.id) ?? item.id}-${key.replace(/UsesFormula$/i, '').toLowerCase()}`,
          name: `${item.name} · ${label || 'Uso'}`,
          max,
          current: max,
          recharge: normalizeRecharge(root.recharge) ?? 'longRest',
          source: item.rawJson.source
        });
      }
    }
  }

  if (!Object.keys(root).length) {
    const directSpec: Record<string, unknown> = {
      id: `${item.id}-uses`,
      name: item.name,
      uses: asNumber(payload.uses),
      usesFormula: asString(payload.usesFormula),
      minimum: asNumber(payload.minimumUses),
      recharge: payload.recharge
    };
    if ((directSpec.uses !== undefined || directSpec.usesFormula) && normalizeRecharge(directSpec.recharge)) {
      const pool = poolFromSpec(directSpec, item, character);
      if (pool) pools.push(pool);
    }
  }

  const mechanics = asRecord(payload.mechanics);
  if (Object.keys(mechanics).length) {
    const mechanicsSpec: Record<string, unknown> = {
      id: `${item.id}-uses`,
      name: item.name,
      uses: asNumber(mechanics.uses) ?? asString(mechanics.uses),
      usesFormula: asString(mechanics.usesFormula),
      recharge: mechanics.recharge
    };
    if ((mechanicsSpec.uses !== undefined || mechanicsSpec.usesFormula) && normalizeRecharge(mechanicsSpec.recharge)) {
      const pool = poolFromSpec(mechanicsSpec, item, character);
      if (pool) pools.push(pool);
    }

    for (const [key, raw] of Object.entries(mechanics)) {
      if (/freeCast/i.test(key)) continue; // free-cast resources are reconciled by externalSpellGrantRules.
      const nested = asRecord(raw);
      if (!Object.keys(nested).length) continue;
      const uses = asNumber(nested.uses) ?? asString(nested.uses);
      const usesFormula = asString(nested.usesFormula);
      const recharge = nested.recharge;
      const impliedSingleUse = key === 'invoke' && normalizeRecharge(recharge) !== undefined;
      if (uses === undefined && !usesFormula && !impliedSingleUse) continue;
      const pool = poolFromSpec({
        ...nested,
        id: `${item.id}-${key}`,
        name: `${item.name} · ${key.replace(/([a-z])([A-Z])/g, '$1 $2')}`,
        uses: uses ?? (impliedSingleUse ? 1 : undefined),
        usesFormula,
        recharge
      }, item, character);
      if (pool) pools.push(pool);
    }
  }

  // Khoravar and similar imported rules can recharge after a non-standard
  // number of Long Rests. Keep them trackable, but manual, instead of falsely
  // claiming every Long Rest restores the use.
  if (!pools.length) {
    const mechanicsRecharge = asRecord(mechanics.recharge);
    const uses = asNumber(mechanics.uses);
    if (uses !== undefined && asString(mechanicsRecharge.type) === 'longRests') {
      pools.push({
        id: `${item.id}-uses`,
        name: item.name,
        max: uses,
        current: uses,
        recharge: 'manual',
        notes: `Recuperação especial: ${asString(mechanicsRecharge.formula) ?? '?'} descanso(s) longo(s).`,
        source: item.rawJson.source
      });
    }
  }

  return Array.from(new Map(pools.map((pool) => [pool.id, pool] as const)).values());
};

/**
 * Automatic class/species/subclass grants are mechanically owned by an active
 * character choice. Editorial state belongs to the Compendium and must not
 * prevent a non-disabled owned feature from functioning on the character.
 *
 * The transient validated status only crosses the mapper boundary. The stored
 * Compendium item is never mutated, while the generated character link keeps
 * manualReviewRequired so catalog maintenance can still surface the review.
 */
export const prepareAutomaticFeatureForCharacter = (
  item: StoredCompendiumItem
): StoredCompendiumItem => {
  if (item.status === 'validated' || item.status === 'disabled') return item;

  const existingMetadata = asRecord(item.normalizedJson.__characterChoice);
  return {
    ...item,
    status: 'validated',
    reviewDecision: 'approved',
    normalizedJson: {
      ...item.normalizedJson,
      __characterChoice: {
        ...existingMetadata,
        origin: asString(existingMetadata.origin) ?? 'compendium',
        choiceId: asString(existingMetadata.choiceId) ?? item.id,
        manualReviewRequired: true
      },
      originalCompendiumItemId: asString(item.normalizedJson.originalCompendiumItemId) ?? item.id
    }
  };
};

/** Applies declarative resources and upgrades made by automatic features to
 * an already-materialized character. Existing current values are preserved. */
export const reconcileAutomaticFeatureResourceUpdates = (
  character: Character,
  item: StoredCompendiumItem
): Character => {
  let next = character;
  const desired = resourcePoolsFromAutomaticFeature(next, item);
  for (const resource of desired) {
    const existing = next.resources.find((candidate) => candidate.id === resource.id);
    if (!existing) {
      next = { ...next, resources: [...next.resources, resource] };
      continue;
    }
    if (
      existing.max !== resource.max ||
      existing.recharge !== resource.recharge ||
      JSON.stringify(existing.recoveryRules ?? []) !== JSON.stringify(resource.recoveryRules ?? []) ||
      existing.notes !== resource.notes
    ) {
      next = {
        ...next,
        resources: next.resources.map((candidate) => candidate.id === resource.id ? {
          ...candidate,
          max: resource.max,
          current: Math.min(resource.max, candidate.current),
          recharge: resource.recharge,
          recoveryRules: resource.recoveryRules,
          notes: resource.notes ?? candidate.notes
        } : candidate)
      };
    }
  }

  const updates = Array.isArray(item.normalizedJson.resourceUpdates)
    ? item.normalizedJson.resourceUpdates
    : [];
  if (!updates.length) return next;

  let changed = false;
  const resources = next.resources.map((resource) => {
    const update = updates
      .map(asRecord)
      .find((candidate) => asString(candidate.resourceId) === resource.id);
    if (!update) return resource;

    const recharge = normalizeRecharge(update.recharge);
    if (!recharge || recharge === resource.recharge) return resource;
    changed = true;
    return { ...resource, recharge };
  });

  return changed ? { ...next, resources } : next;
};
