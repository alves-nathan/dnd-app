import type {
  Character,
  CharacterGazeOfTwoMindsState,
  CharacterGiftOfProtectorsState,
  CharacterProtectionTransaction,
  CharacterSense,
  GazeCastingOrigin,
  OneWithShadowsLightLevel,
  RestType,
  ResourceTransaction,
  RuleValidationIssue,
  TurnRotation
} from '../types';
import type { StoredCompendiumItem } from '../compendium/types';
import { createId } from '../utils/id';
import { getAbilityModifier } from '../rules-engine/characters/derivedStats';
import {
  addActiveEffectToCharacter,
  removeActiveEffectFromCharacter
} from '../rules-engine/effects/activeEffects';
import { findEldritchInvocationById, getEffectiveEldritchInvocationCounts } from './eldritchInvocationRules';

const normalize = (value: string): string => value
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .trim()
  .toLowerCase();

const nowIso = (): string => new Date().toISOString();

const engineKey = (item?: StoredCompendiumItem): string => {
  const value = item?.normalizedJson.engineKey;
  return typeof value === 'string' ? normalize(value) : '';
};

const selectedInvocationItems = (
  character: Character,
  items: StoredCompendiumItem[]
): StoredCompendiumItem[] => Object.entries(getEffectiveEldritchInvocationCounts(character))
  .filter(([, count]) => count > 0)
  .map(([itemId]) => findEldritchInvocationById(items, itemId))
  .filter((item): item is StoredCompendiumItem => Boolean(item));

const invocationByIdentity = (
  character: Character,
  items: StoredCompendiumItem[],
  key: string,
  name: string
): StoredCompendiumItem | undefined => selectedInvocationItems(character, items).find((item) =>
  engineKey(item) === normalize(key) || normalize(item.name) === normalize(name)
);

export const hasSelectedInvocation = (
  character: Character,
  items: StoredCompendiumItem[],
  key: string,
  name: string
): boolean => Boolean(invocationByIdentity(character, items, key, name));

export const GIFT_OF_PROTECTORS_RESOURCE_ID = 'warlock_gift_of_protectors_shared_protection';

const invocationSense = (
  item: StoredCompendiumItem,
  sense: Omit<CharacterSense, 'id' | 'sourceInvocationItemId'>
): CharacterSense => ({
  ...sense,
  id: `invocation-sense-${item.id}-${sense.kind}`,
  sourceInvocationItemId: item.id
});

const reconcileInvocationSenses = (
  character: Character,
  items: StoredCompendiumItem[]
): CharacterSense[] => {
  const preserved = (character.senses ?? []).filter((sense) => !sense.sourceInvocationItemId);
  const invocationSenses: CharacterSense[] = [];
  const devilsSight = invocationByIdentity(character, items, 'warlock.devils-sight', "Devil's Sight");
  if (devilsSight) {
    invocationSenses.push(invocationSense(devilsSight, {
      name: "Devil's Sight",
      kind: 'darkvision',
      rangeFeet: 120,
      magicalDarkness: true,
      notes: 'Enxerga normalmente em luz fraca e escuridão, mágicas ou não, até 120 pés.'
    }));
  }
  const witchSight = invocationByIdentity(character, items, 'warlock.witch-sight', 'Witch Sight');
  if (witchSight) {
    invocationSenses.push(invocationSense(witchSight, {
      name: 'Witch Sight',
      kind: 'truesight',
      rangeFeet: 30,
      notes: 'Truesight com alcance de 30 pés.'
    }));
  }
  const deduped = new Map<string, CharacterSense>();
  for (const sense of [...preserved, ...invocationSenses]) {
    const key = `${sense.kind}:${sense.rangeFeet ?? 0}:${sense.magicalDarkness ? 'magic' : 'normal'}`;
    const existing = deduped.get(key);
    if (!existing || Boolean(sense.sourceInvocationItemId)) deduped.set(key, sense);
  }
  return [...deduped.values()];
};

const giftState = (
  character: Character,
  invocationItemId: string
): CharacterGiftOfProtectorsState => {
  const maxNames = Math.max(1, getAbilityModifier(character.abilities, 'CHA'));
  const existing = character.buildChoices?.giftOfProtectors;
  return {
    invocationItemId,
    names: Array.from(new Set((existing?.names ?? []).map((name) => name.trim()).filter(Boolean))).slice(0, maxNames),
    maxNames,
    resourceId: GIFT_OF_PROTECTORS_RESOURCE_ID,
    lastTriggeredName: existing?.lastTriggeredName,
    lastTriggeredAt: existing?.lastTriggeredAt
  };
};

export const reconcileWarlockSpecializedInvocations = (
  character: Character,
  items: StoredCompendiumItem[]
): Character => {
  let next: Character = { ...character, senses: reconcileInvocationSenses(character, items) };
  const gaze = invocationByIdentity(next, items, 'warlock.gaze-of-two-minds', 'Gaze of Two Minds');
  const gift = invocationByIdentity(next, items, 'warlock.gift-of-the-protectors', 'Gift of the Protectors');
  const tome = invocationByIdentity(next, items, 'warlock.pact-of-the-tome', 'Pact of the Tome');
  const shadows = invocationByIdentity(next, items, 'warlock.one-with-shadows', 'One with Shadows');

  const buildChoices = {
    ...(next.buildChoices ?? {
      speciesChoices: [], classSkillChoices: [], classToolChoices: [], expertiseSkills: [], languages: [], spellAssignments: {}, spellbookAssignments: {}, equipmentSelections: []
    }),
    gazeOfTwoMinds: gaze ? next.buildChoices?.gazeOfTwoMinds : undefined,
    giftOfProtectors: gift && tome ? giftState(next, gift.id) : undefined,
    oneWithShadows: shadows ? next.buildChoices?.oneWithShadows : undefined
  };

  const hasGift = Boolean(gift && tome);
  const existingGiftResource = next.resources.find((resource) => resource.id === GIFT_OF_PROTECTORS_RESOURCE_ID);
  const resources = hasGift
    ? [
        ...next.resources.filter((resource) => resource.id !== GIFT_OF_PROTECTORS_RESOURCE_ID),
        {
          id: GIFT_OF_PROTECTORS_RESOURCE_ID,
          name: 'Gift of the Protectors',
          max: 1,
          current: Math.min(1, Math.max(0, existingGiftResource?.current ?? 1)),
          recharge: 'longRest' as const,
          sourceInvocationItemId: gift?.id,
          notes: 'Uso compartilhado por todos os nomes inscritos no Book of Shadows.'
        }
      ]
    : next.resources.filter((resource) => resource.id !== GIFT_OF_PROTECTORS_RESOURCE_ID);

  let activeEffects = next.activeEffects;
  const oneWithShadowsState = buildChoices.oneWithShadows;
  if (!shadows && oneWithShadowsState?.activeEffectId) {
    activeEffects = activeEffects.filter((effect) => effect.id !== oneWithShadowsState.activeEffectId);
  }

  if (!gaze && next.buildChoices?.gazeOfTwoMinds?.active) {
    buildChoices.gazeOfTwoMinds = undefined;
  }

  return { ...next, buildChoices, resources, activeEffects };
};

export const getEffectiveCharacterSenses = (character: Character): CharacterSense[] => {
  const senses = [...(character.senses ?? [])];
  const gaze = character.buildChoices?.gazeOfTwoMinds;
  const linkedCompanion = gaze?.targetCompanionId
    ? (character.companions ?? []).find((companion) => companion.id === gaze.targetCompanionId)
    : undefined;
  const borrowedSenses = linkedCompanion?.senses ?? gaze?.targetSenses;
  if (gaze?.active && borrowedSenses) {
    senses.push({
      id: `gaze-borrowed-${gaze.targetCompanionId ?? normalize(gaze.targetName)}`,
      name: `Sentidos de ${linkedCompanion?.name ?? gaze.targetName}`,
      kind: 'borrowed',
      sourceCompanionId: gaze.targetCompanionId,
      notes: borrowedSenses
    });
  }
  return senses;
};

export const startGazeOfTwoMinds = (
  character: Character,
  params: {
    invocationItemId: string;
    targetName: string;
    targetCompanionId?: string;
    targetSenses?: string;
    distanceFeet?: number;
    samePlane?: boolean;
    spellOrigin?: GazeCastingOrigin;
    notes?: string;
  }
): Character => {
  const state: CharacterGazeOfTwoMindsState = {
    invocationItemId: params.invocationItemId,
    targetName: params.targetName.trim() || 'Criatura conectada',
    targetCompanionId: params.targetCompanionId,
    targetSenses: params.targetSenses?.trim() || undefined,
    distanceFeet: Math.max(0, params.distanceFeet ?? 0),
    samePlane: params.samePlane ?? true,
    active: true,
    remainingTurnWindows: 2,
    spellOrigin: params.spellOrigin ?? 'self',
    startedAt: nowIso(),
    notes: params.notes?.trim() || undefined
  };
  return {
    ...character,
    buildChoices: {
      ...(character.buildChoices ?? {
        speciesChoices: [], classSkillChoices: [], classToolChoices: [], expertiseSkills: [], languages: [], spellAssignments: {}, spellbookAssignments: {}, equipmentSelections: []
      }),
      gazeOfTwoMinds: state
    }
  };
};

export const maintainGazeOfTwoMinds = (character: Character): Character => {
  const current = character.buildChoices?.gazeOfTwoMinds;
  if (!current?.active) return character;
  return {
    ...character,
    buildChoices: {
      ...character.buildChoices!,
      gazeOfTwoMinds: { ...current, remainingTurnWindows: 2, maintainedAt: nowIso() }
    }
  };
};

export const endGazeOfTwoMinds = (character: Character): Character => {
  const current = character.buildChoices?.gazeOfTwoMinds;
  if (!current) return character;
  return {
    ...character,
    buildChoices: {
      ...character.buildChoices!,
      gazeOfTwoMinds: { ...current, active: false, remainingTurnWindows: 0, spellOrigin: 'self' }
    }
  };
};

export const advanceGazeOfTwoMindsTurn = (character: Character): Character => {
  const current = character.buildChoices?.gazeOfTwoMinds;
  if (!current?.active) return character;
  const remaining = Math.max(0, current.remainingTurnWindows - 1);
  return remaining > 0
    ? { ...character, buildChoices: { ...character.buildChoices!, gazeOfTwoMinds: { ...current, remainingTurnWindows: remaining } } }
    : endGazeOfTwoMinds(character);
};

export const gazeCastingOriginIssues = (
  character: Character,
  origin: GazeCastingOrigin
): RuleValidationIssue[] => {
  if (origin !== 'gazeTarget') return [];
  const gaze = character.buildChoices?.gazeOfTwoMinds;
  if (!gaze?.active) return [{ severity: 'error', code: 'GAZE_LINK_INACTIVE', message: 'A origem de conjuração pelo vínculo exige Gaze of Two Minds ativo.' }];
  if (!gaze.samePlane) return [{ severity: 'error', code: 'GAZE_DIFFERENT_PLANE', message: 'A criatura conectada precisa estar no mesmo plano de existência.' }];
  if (gaze.distanceFeet > 60) return [{ severity: 'error', code: 'GAZE_CASTING_DISTANCE', message: 'Conjurar a partir do espaço da criatura exige distância de até 60 pés.' }];
  return [];
};

const protectionTransaction = (
  character: Character,
  name: string,
  action: CharacterProtectionTransaction['action'],
  notes?: string
): CharacterProtectionTransaction => ({
  id: createId('protectionTx'),
  characterId: character.id,
  name,
  action,
  createdAt: nowIso(),
  notes
});

export const inscribeGiftOfProtectorsName = (character: Character, name: string): Character => {
  const state = character.buildChoices?.giftOfProtectors;
  const clean = name.trim();
  if (!state || !clean || state.names.some((entry) => normalize(entry) === normalize(clean)) || state.names.length >= state.maxNames) return character;
  return {
    ...character,
    buildChoices: { ...character.buildChoices!, giftOfProtectors: { ...state, names: [...state.names, clean] } },
    protectionTransactions: [...(character.protectionTransactions ?? []), protectionTransaction(character, clean, 'inscribed')]
  };
};

export const eraseGiftOfProtectorsName = (character: Character, name: string): Character => {
  const state = character.buildChoices?.giftOfProtectors;
  if (!state) return character;
  const nextNames = state.names.filter((entry) => normalize(entry) !== normalize(name));
  if (nextNames.length === state.names.length) return character;
  return {
    ...character,
    buildChoices: { ...character.buildChoices!, giftOfProtectors: { ...state, names: nextNames } },
    protectionTransactions: [...(character.protectionTransactions ?? []), protectionTransaction(character, name, 'erased')]
  };
};

export const triggerGiftOfProtectors = (character: Character, name: string): Character => {
  const state = character.buildChoices?.giftOfProtectors;
  const resource = character.resources.find((entry) => entry.id === GIFT_OF_PROTECTORS_RESOURCE_ID);
  if (!state || !resource || resource.current < 1 || !state.names.some((entry) => normalize(entry) === normalize(name))) return character;
  const at = nowIso();
  return {
    ...character,
    resources: character.resources.map((entry) => entry.id === resource.id ? { ...entry, current: 0 } : entry),
    buildChoices: {
      ...character.buildChoices!,
      giftOfProtectors: { ...state, lastTriggeredName: name, lastTriggeredAt: at }
    },
    protectionTransactions: [...(character.protectionTransactions ?? []), protectionTransaction(character, name, 'triggered', 'A criatura fica com 1 PV em vez de 0, se não tiver morrido instantaneamente.')]
  };
};


export const restoreGiftOfProtectorsOnRest = (
  character: Character,
  restType: RestType
): Character => {
  if (restType !== 'longRest') return character;
  const state = character.buildChoices?.giftOfProtectors;
  const resource = character.resources.find((entry) => entry.id === GIFT_OF_PROTECTORS_RESOURCE_ID);
  if (!state || !resource || resource.current >= resource.max) return character;
  const transaction: ResourceTransaction = {
    id: createId('resTx'),
    characterId: character.id,
    resourceId: resource.id,
    resourceName: resource.name,
    amount: resource.max - resource.current,
    before: resource.current,
    after: resource.max,
    reason: 'Descanso longo',
    restType: 'longRest',
    createdAt: nowIso()
  };
  return {
    ...character,
    resources: character.resources.map((entry) => entry.id === resource.id ? { ...entry, current: entry.max } : entry),
    resourceTransactions: [...(character.resourceTransactions ?? []), transaction],
    protectionTransactions: [
      ...(character.protectionTransactions ?? []),
      protectionTransaction(character, state.lastTriggeredName ?? 'Proteção compartilhada', 'recovered', 'Uso recuperado após descanso longo.')
    ]
  };
};

export const activateOneWithShadows = (
  character: Character,
  invocationItemId: string,
  lightLevel: OneWithShadowsLightLevel
): { character: Character; issues: RuleValidationIssue[] } => {
  if (lightLevel === 'bright') {
    return { character, issues: [{ severity: 'error', code: 'ONE_WITH_SHADOWS_LIGHT_REQUIRED', message: 'One with Shadows exige luz fraca ou escuridão.' }] };
  }
  const existingId = character.buildChoices?.oneWithShadows?.activeEffectId;
  let base = existingId ? removeActiveEffectFromCharacter(character, existingId, 'One with Shadows reiniciado') : character;
  const effectId = createId('effect');
  base = addActiveEffectToCharacter(base, {
    id: effectId,
    name: 'One with Shadows · Invisibility',
    kind: 'feature',
    sourceType: 'classFeature',
    status: 'active',
    concentration: true,
    conditionIds: ['invisible'],
    duration: { unit: 'hour', remaining: 1, expiresOn: 'manual' },
    endsOnShortRest: true,
    endsOnLongRest: true,
    notes: 'Conjurada em si mesmo sem spell slot. Termina cedo após atacar, causar dano ou conjurar uma magia.',
    sourceRef: { kind: 'compendiumLink', entityType: 'feature', itemId: invocationItemId },
    createdAt: nowIso()
  });
  return {
    character: {
      ...base,
      buildChoices: {
        ...base.buildChoices!,
        oneWithShadows: { invocationItemId, lightLevel, activeEffectId: effectId, activatedAt: nowIso() }
      }
    },
    issues: []
  };
};

export const endOneWithShadows = (character: Character, reason = 'One with Shadows encerrado'): Character => {
  const state = character.buildChoices?.oneWithShadows;
  if (!state?.activeEffectId) return character;
  const next = removeActiveEffectFromCharacter(character, state.activeEffectId, reason);
  return { ...next, buildChoices: { ...next.buildChoices!, oneWithShadows: { ...state, activeEffectId: undefined } } };
};

export const breakOneWithShadowsForRotation = (character: Character, rotation: TurnRotation): Character => {
  const activeEffectId = character.buildChoices?.oneWithShadows?.activeEffectId;
  if (!activeEffectId || !character.activeEffects.some((effect) => effect.id === activeEffectId && effect.status === 'active')) return character;
  const breaker = rotation.actions.find((entry) => entry.action.type === 'attack' || entry.action.type === 'spell');
  return breaker ? endOneWithShadows(character, `Encerrado por ${breaker.name}: ataque ou conjuração`) : character;
};
