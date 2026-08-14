import {
  ActionBuildResult,
  AttackAction,
  Character,
  CharacterAction,
  CharacterCompendiumLink,
  DamageFormula,
  RuleValidationIssue,
  SpellAction,
  SpellSlotLevel
} from '../../types';
import { toSpellSlotLevel } from '../resources/spellSlotManager';
import { getAbilityModifier, getProficiencyBonus } from '../characters/derivedStats';
import { resolveCustomNumericModifiers } from '../../characters/customModifierRules';
import { resolveSpellDamageFormula } from './spellScaling';
import { buildPactChainCompanionAttackActions } from '../../characters/pactChainCompanionRules';
import { gazeCastingOriginIssues } from '../../characters/warlockSpecializedInvocations';
import { getEquippedWeapons, weaponHandsRequired } from '../../characters/equipmentLoadoutRules';
import { masteryRuleNotes, weaponMasteryApplication } from '../../characters/weaponMasteryRules';
import { normalizeTacticalAreaTemplate, spellSaveSuccessDamage } from '../targeting/areaTemplates';

const linkForEntity = (character: Character, entityId: string): CharacterCompendiumLink | undefined =>
  (character.compendiumLinks ?? []).find((link) => link.appliedEntityId === entityId && link.status === 'active');

const actionIssue = (severity: RuleValidationIssue['severity'], code: string, message: string, source?: RuleValidationIssue['source']): RuleValidationIssue => ({
  severity,
  code,
  message,
  source
});

const normalizeName = (value: string): string => value
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .trim()
  .toLowerCase();

const hasFeatureNamed = (character: Character, name: string): boolean =>
  character.features.some((feature) => normalizeName(feature.name) === normalizeName(name));

const invocationNameForItemId = (character: Character, itemId: string): string | undefined => {
  const link = (character.compendiumLinks ?? []).find((entry) =>
    entry.status === 'active' && entry.appliedAs === 'feature' && entry.itemId === itemId
  );
  return character.features.find((feature) => feature.id === link?.appliedEntityId)?.name;
};

const invocationChoicesForName = (character: Character, name: string) =>
  (character.buildChoices?.eldritchInvocationChoices ?? []).filter((choice) =>
    normalizeName(invocationNameForItemId(character, choice.invocationItemId) ?? '') === normalizeName(name)
  );

const warlockLevel = (character: Character): number =>
  character.classes.find((entry) => normalizeName(entry.name) === 'warlock')?.level ?? 0;

const parseRangeFeet = (range?: string): number | undefined => {
  const match = range?.match(/(\d+)\s*(?:ft|feet|foot|pes|pés)/i);
  return match?.[1] ? Number(match[1]) : undefined;
};

const addAbilityModifier = (formula: DamageFormula, count: number, label: string): DamageFormula => {
  if (count <= 0) return formula;
  return {
    ...formula,
    raw: `${formula.raw}${Array.from({ length: count }, () => ' + CHA').join('')} [${label}]`,
    components: [
      ...formula.components,
      ...Array.from({ length: count }, (_, index) => ({
        id: `${normalizeName(label).replace(/\s+/g, '-')}-${index + 1}`,
        kind: 'abilityModifier' as const,
        operation: 'add' as const,
        ability: 'CHA' as const,
        sourceType: 'classFeature' as const,
        application: 'onHit' as const,
        criticalBehavior: 'notDoubled' as const,
        label
      }))
    ]
  };
};

const pactMagicSlotLevel = (character: Character): SpellSlotLevel | undefined =>
  (character.spellSlots ?? [])
    .filter((slot) => slot.poolKind === 'pactMagic')
    .map((slot) => slot.level)
    .sort((left, right) => right - left)[0];

const pactWeaponDamageFormula = (
  character: Character,
  formula: DamageFormula,
  magicBonus: number
): DamageFormula => {
  const components: DamageFormula['components'] = formula.components.map((component) =>
    component.kind === 'abilityModifier'
      ? { ...component, ability: 'CHA' as const, label: component.label ?? 'Carisma (Pact Weapon)' }
      : component
  );
  if (magicBonus > 0) {
    components.push({
      id: 'pact-weapon-magic-bonus',
      kind: 'flat',
      operation: 'add',
      value: magicBonus,
      sourceType: 'magicItem',
      application: 'onHit',
      criticalBehavior: 'notDoubled',
      label: `Bônus mágico +${magicBonus}`
    });
  }

  if (hasFeatureNamed(character, 'Lifedrinker')) {
    const damageType = invocationChoicesForName(character, 'Lifedrinker')[0]?.lifedrinkerDamageType ?? 'necrotic';
    components.push({
      id: 'warlock-lifedrinker-damage',
      kind: 'dice',
      operation: 'add',
      dice: { count: 1, sides: 6 },
      sourceType: 'classFeature',
      application: 'conditional',
      criticalBehavior: 'doubleDice',
      condition: {
        id: 'warlock-lifedrinker',
        label: `Lifedrinker: +1d6 ${damageType} uma vez por turno`,
        oncePerTurnKey: 'warlock-lifedrinker'
      },
      label: `Lifedrinker (${damageType})`
    });
  }

  const smiteSlotLevel = pactMagicSlotLevel(character);
  if (hasFeatureNamed(character, 'Eldritch Smite') && smiteSlotLevel) {
    components.push({
      id: 'warlock-eldritch-smite-damage',
      kind: 'dice',
      operation: 'add',
      dice: { count: smiteSlotLevel + 1, sides: 8 },
      sourceType: 'classFeature',
      application: 'conditional',
      criticalBehavior: 'doubleDice',
      condition: {
        id: 'warlock-eldritch-smite',
        label: `Eldritch Smite: ${(smiteSlotLevel + 1)}d8 e derruba alvo Huge ou menor`,
        oncePerTurnKey: 'warlock-eldritch-smite'
      },
      label: 'Eldritch Smite'
    });
  }

  return {
    ...formula,
    raw: `${formula.raw}${magicBonus > 0 ? ` + ${magicBonus}` : ''}${hasFeatureNamed(character, 'Lifedrinker') ? ' + 1d6 conditional' : ''}${hasFeatureNamed(character, 'Eldritch Smite') ? ' + PactSlot Smite conditional' : ''} [Pact Weapon/CHA]`,
    components
  };
};

const pactWeaponAttackCount = (character: Character, base: number): number => {
  if (hasFeatureNamed(character, 'Devouring Blade')) return Math.max(base, 3);
  if (hasFeatureNamed(character, 'Thirsting Blade')) return Math.max(base, 2);
  return base;
};

const withoutPositiveAbilityModifier = (formula: DamageFormula): DamageFormula => ({
  ...formula,
  raw: `${formula.raw} [sem modificador positivo]`,
  components: formula.components.filter((component) => component.kind !== 'abilityModifier')
});

export interface BuildActionOptions {
  includeStowedWeapons?: boolean;
  weaponGrip?: 'oneHanded' | 'twoHanded';
}

export const buildWeaponAttackAction = (character: Character, weaponId: string, options: BuildActionOptions = {}): AttackAction | undefined => {
  const weapon = character.weapons.find((candidate) => candidate.id === weaponId);
  if (!weapon || (weapon.quantity ?? 1) <= 0) return undefined;
  const link = linkForEntity(character, weapon.id);
  const hasFinesse = weapon.weaponType === 'finesse' || (weapon.properties ?? []).some(
    (property) => property.toLowerCase().includes('finesse')
  );
  const isPactWeapon = weapon.pactWeapon === true;
  const resolvedAbility = isPactWeapon
    ? 'CHA'
    : weapon.attackAbility ?? weapon.damageAbility ?? (
      hasFinesse && getAbilityModifier(character.abilities, 'DEX') > getAbilityModifier(character.abilities, 'STR')
        ? 'DEX'
        : 'STR'
    );
  const magicBonus = weapon.magicBonus ?? 0;
  const attacksCount = isPactWeapon
    ? pactWeaponAttackCount(character, weapon.attacksCount ?? 1)
    : weapon.attacksCount ?? 1;
  const grip = options.weaponGrip ?? 'oneHanded';
  const baseWeaponDamage = grip === 'twoHanded' && weapon.versatileDamage ? weapon.versatileDamage : weapon.damage;
  const damage = isPactWeapon
    ? pactWeaponDamageFormula(character, baseWeaponDamage, magicBonus)
    : baseWeaponDamage;
  const damageType = weapon.pactWeaponDamageType ?? 'normal';
  const smiteSlotLevel = isPactWeapon ? pactMagicSlotLevel(character) : undefined;
  const mastery = weaponMasteryApplication(character, weapon, resolvedAbility);
  const conditionalSpellSlotCosts = smiteSlotLevel && hasFeatureNamed(character, 'Eldritch Smite') ? [{
    conditionId: 'warlock-eldritch-smite',
    slotLevel: smiteSlotLevel,
    minimumSlotLevel: smiteSlotLevel,
    amount: 1,
    poolKind: 'pactMagic' as const,
    sourceClassId: character.classes.find((entry) => normalizeName(entry.name) === 'warlock')?.id,
    label: 'Eldritch Smite · 1 slot de Pact Magic'
  }] : undefined;
  const ruleNotes = [
    ...(isPactWeapon ? [
      'Pact of the Blade usa Carisma nas jogadas de ataque e dano desta arma.',
      damageType === 'normal' ? 'Tipo de dano original da arma.' : `Tipo de dano escolhido ao invocar: ${damageType}.`,
      attacksCount > 1 ? `${attacksCount} ataques por Ação de Ataque por Thirsting/Devouring Blade.` : 'Um ataque por Ação de Ataque.',
      magicBonus > 0 ? `Bônus mágico +${magicBonus} aplicado ao ataque e ao dano.` : 'Sem bônus mágico adicional.',
      ...(hasFeatureNamed(character, 'Lifedrinker') ? ['Lifedrinker aparece como dano condicional uma vez por turno; após um acerto, a cura pode ser ativada e consome um Hit Die.'] : []),
      ...(hasFeatureNamed(character, 'Eldritch Smite') ? ['Eldritch Smite deve ser ativado na ação; consome um slot de Pact Magic e pode derrubar alvo Huge ou menor.'] : [])
    ] : []),
    ...masteryRuleNotes(mastery),
    ...(weapon.range ? [`Alcance ${weapon.range.normal}${weapon.range.long ? `/${weapon.range.long}` : ''} pés.`] : []),
    ...(weapon.ammunitionType ? [`Consome ${weapon.ammunitionPerAttack ?? 1} ${weapon.ammunitionType} por ataque.`] : [])
  ];
  return {
    id: `attack_${weapon.id}`,
    type: 'attack',
    name: isPactWeapon ? `${weapon.name} · Pact Weapon` : weapon.name,
    actionCost: weapon.actionCost ?? 'action',
    sourceType: 'weapon',
    source: weapon.source,
    weaponId: weapon.id,
    attackAbility: resolvedAbility,
    attackBonusExtra: magicBonus,
    damage,
    damageTypes: weapon.damageType ? [weapon.damageType] : (isPactWeapon && damageType !== 'normal' ? [damageType] : undefined),
    attacksCount,
    consumes: weapon.consumes,
    conditionalSpellSlotCosts,
    range: weapon.range,
    ammunitionType: weapon.ammunitionType,
    ammunitionPerAttack: weapon.ammunitionPerAttack,
    thrownWeapon: (weapon.properties ?? []).some((property) => property.toLowerCase() === 'thrown'),
    mastery,
    handsRequired: grip === 'twoHanded' ? 2 : weaponHandsRequired(weapon),
    weaponGrip: grip,
    loading: (weapon.properties ?? []).some((property) => property.toLowerCase() === 'loading'),
    light: (weapon.properties ?? []).some((property) => property.toLowerCase() === 'light'),
    tags: [
      'weapon',
      ...(isPactWeapon ? ['pact-weapon', `damage-type:${damageType}`] : []),
      ...(weapon.mastery ? [`mastery:${weapon.mastery}`] : []),
      ...(grip === 'twoHanded' ? ['grip:two-handed'] : ['grip:one-handed']),
      ...(weapon.properties ?? [])
    ],
    origin: link
      ? { kind: 'compendiumLink', entityType: 'weapon', entityId: weapon.id, itemId: link.itemId, linkId: link.id }
      : { kind: weapon.source?.confidence === 'manual' ? 'manual' : 'characterEntry', entityType: 'weapon', entityId: weapon.id },
    requiresReview: weapon.source?.status === 'needsReview' || weapon.source?.confidence === 'ambiguous' || weapon.source?.confidence === 'importedNeedsReview',
    ruleNotes
  };
};

export const buildSpellAction = (character: Character, spellId: string): SpellAction | undefined => {
  const spell = character.spells.find((candidate) => candidate.id === spellId);
  if (!spell) return undefined;
  const link = linkForEntity(character, spell.id);
  const spellItemId = link?.itemId;
  const resolved = resolveSpellDamageFormula(spell, character);
  const agonizingCount = spellItemId
    ? invocationChoicesForName(character, 'Agonizing Blast').filter((choice) => choice.targetCantripItemId === spellItemId).length
    : 0;
  const spearCount = spellItemId
    ? invocationChoicesForName(character, 'Eldritch Spear').filter((choice) => choice.targetCantripItemId === spellItemId).length
    : 0;
  const repellingCount = spellItemId
    ? invocationChoicesForName(character, 'Repelling Blast').filter((choice) => choice.targetCantripItemId === spellItemId).length
    : 0;
  const damage = resolved.formula && agonizingCount > 0
    ? addAbilityModifier(resolved.formula, agonizingCount, 'Agonizing Blast')
    : resolved.formula;
  const baseRangeFeet = parseRangeFeet(spell.range);
  const range = baseRangeFeet !== undefined && spearCount > 0
    ? `${baseRangeFeet + 30 * warlockLevel(character) * spearCount} ft`
    : spell.range;
  const gaze = character.buildChoices?.gazeOfTwoMinds;
  const gazeAvailable = gaze?.active === true && gazeCastingOriginIssues(character, 'gazeTarget').length === 0;
  const spellcastingAbility = spell.spellcastingAbility;
  const spellAttackBonus = spell.requiresAttackRoll && spellcastingAbility
    ? getProficiencyBonus(character) + getAbilityModifier(character.abilities, spellcastingAbility)
    : undefined;
  const spellSaveDCBase = spell.saveAbility && spellcastingAbility
    ? 8 + getProficiencyBonus(character) + getAbilityModifier(character.abilities, spellcastingAbility)
    : undefined;
  const spellSaveDCModifier = spellSaveDCBase !== undefined
    ? resolveCustomNumericModifiers(character, 'spellSaveDC', {
        ability: spellcastingAbility,
        actionType: 'spell',
        spellItemId,
        spellName: spell.name,
        spellSchool: spell.school,
        damageTypes: spell.damageType ? [spell.damageType] : undefined
      })
    : undefined;
  return {
    id: `spell_${spell.id}`,
    type: 'spell',
    name: spell.name,
    actionCost: spell.castingTime,
    sourceType: 'spell',
    source: spell.source,
    spellId: spell.id,
    spellLevel: spell.level,
    spellSchool: spell.school,
    spellcastingAbility,
    attackBonusOverride: spellAttackBonus,
    saveDCOverride: spellSaveDCBase !== undefined && spellSaveDCModifier
      ? Math.floor((spellSaveDCBase + spellSaveDCModifier.add) * spellSaveDCModifier.multiplier)
      : undefined,
    minimumSlotLevel: toSpellSlotLevel(spell.level),
    castAtSlotLevel: toSpellSlotLevel(spell.level),
    consumesSpellSlot: spell.level > 0 && !spell.ritualOnly && !spell.freeCast,
    damage,
    damageTypes: spell.damageType ? [spell.damageType] : undefined,
    targets: spell.targeting?.targets ?? 1,
    attacksCount: resolved.attacksCount,
    area: spell.targeting?.areaTemplate ?? normalizeTacticalAreaTemplate(spell.targeting?.area, spell.targeting?.description),
    targetDescription: spell.targeting?.description,
    saveAbility: spell.saveAbility,
    saveSuccessDamage: spellSaveSuccessDamage(spell.damageOnSaveSuccess),
    conditionIds: Array.from(new Set((spell.effectTemplates ?? [])
      .filter((template) => template.kind === 'condition' || template.kind === 'debuff')
      .flatMap((template) => template.conditionIds ?? []))),
    range,
    forcedMovementFt: repellingCount > 0 ? 10 * repellingCount : undefined,
    forcedMovementMaxTargetSize: repellingCount > 0 ? 'Large' : undefined,
    consumes: spell.consumes,
    concentration: spell.concentration,
    tags: [
      'spell',
      `level:${spell.level}`,
      ...(spell.ritualOnly ? ['ritual-only'] : []),
      ...(spell.freeCast ? ['free-cast'] : []),
      ...(spell.grantedByInvocationItemId ? ['eldritch-invocation-grant'] : []),
      ...(agonizingCount ? ['agonizing-blast'] : []),
      ...(spearCount ? ['eldritch-spear'] : []),
      ...(repellingCount ? ['repelling-blast'] : []),
      ...(spell.scaling ? [`scaling:${spell.scaling.kind}`] : [])
    ],
    origin: link
      ? { kind: 'compendiumLink', entityType: 'spell', entityId: spell.id, itemId: link.itemId, linkId: link.id }
      : { kind: spell.source?.confidence === 'manual' ? 'manual' : 'characterEntry', entityType: 'spell', entityId: spell.id },
    gazeCastingOriginAvailable: gazeAvailable,
    gazeTargetName: gazeAvailable ? gaze?.targetName : undefined,
    gazeTargetDistanceFeet: gazeAvailable ? gaze?.distanceFeet : undefined,
    components: spell.components,
    materialDescription: spell.components?.materialDescription,
    spellcastingClassName: spell.spellcastingClassName,
    requiresReview:
      spell.source?.status === 'needsReview' ||
      spell.source?.confidence === 'ambiguous' ||
      spell.source?.confidence === 'importedNeedsReview' ||
      Boolean(spell.scaling?.requiresReview),
    ruleNotes: [
      ...resolved.notes,
      ...(spell.ritualOnly ? ['Magia concedida por Pact of the Tome: pode ser conjurada somente como ritual e não consome spell slot.'] : []),
      ...(spell.freeCast ? ['Magia concedida por invocation: esta cópia não consome spell slot.'] : []),
      ...(spell.invocationSelfOnly ? ['Esta concessão da invocation só pode ter o próprio Warlock como alvo.'] : []),
      ...(spell.invocationUsage === 'atWill' ? ['Uso à vontade enquanto a invocation permanecer ativa.'] : []),
      ...(spell.invocationUsage === 'oncePerLongRest' ? ['Uso gratuito uma vez por descanso longo; o recurso é controlado na ficha.'] : []),
      ...(agonizingCount ? ['Agonizing Blast adiciona Carisma a cada rolagem de dano deste cantrip.'] : []),
      ...(spearCount ? [`Eldritch Spear aumenta o alcance em ${30 * warlockLevel(character) * spearCount} pés.`] : []),
      ...(repellingCount ? [`Repelling Blast pode empurrar o alvo em ${10 * repellingCount} pés por acerto, até tamanho Large.`] : []),
      ...(gazeAvailable ? [`Gaze of Two Minds permite conjurar a partir do espaço de ${gaze?.targetName} enquanto o vínculo estiver ativo e a distância for de até 60 pés.`] : [])
    ]
  };
};

export const buildAvailableActionsResult = (character: Character, options: BuildActionOptions = {}): ActionBuildResult => {
  const issues: RuleValidationIssue[] = [];
  const weaponPool = options.includeStowedWeapons ? character.weapons : getEquippedWeapons(character);
  const weaponActions = weaponPool.flatMap((weapon) => {
    const normal = buildWeaponAttackAction(character, weapon.id, { ...options, weaponGrip: 'oneHanded' });
    const versatile = weapon.versatileDamage
      ? buildWeaponAttackAction(character, weapon.id, { ...options, weaponGrip: 'twoHanded' })
      : undefined;
    return [normal, versatile].filter((action): action is AttackAction => Boolean(action)).map((action) =>
      action.weaponGrip === 'twoHanded'
        ? { ...action, id: `${action.id}_two_handed`, name: `${action.name} · duas mãos`, ruleNotes: [...(action.ruleNotes ?? []), 'Versatile usa o dado maior enquanto as duas mãos estiverem livres no momento do ataque.'] }
        : action
    );
  });

  const lightWeapons = weaponPool.filter((weapon) => (weapon.properties ?? []).some((property) => property.toLowerCase() === 'light'));
  const lightExtraActions: AttackAction[] = lightWeapons.flatMap((weapon) => {
    const partner = lightWeapons.find((candidate) => candidate.id !== weapon.id);
    const base = partner ? buildWeaponAttackAction(character, weapon.id, { ...options, weaponGrip: 'oneHanded' }) : undefined;
    if (!base || !partner) return [];
    return [{
      ...base,
      id: `light_extra_${base.id}`,
      name: `${weapon.name} · ataque Light`,
      actionCost: 'bonusAction' as const,
      damage: withoutPositiveAbilityModifier(base.damage),
      attacksCount: 1,
      tags: [...(base.tags ?? []), 'light-extra-attack'],
      ruleNotes: [...(base.ruleNotes ?? []), `Exige ataque anterior com outra arma Light (${partner.name}) na mesma Ação de Ataque.`]
    }];
  });
  const nickActions: AttackAction[] = lightWeapons.flatMap((weapon) => {
    const mastery = weaponMasteryApplication(character, weapon, weapon.attackAbility ?? weapon.damageAbility ?? 'STR');
    const partner = lightWeapons.find((candidate) => candidate.id !== weapon.id);
    const base = mastery?.property === 'nick' && partner ? buildWeaponAttackAction(character, weapon.id, { ...options, weaponGrip: 'oneHanded' }) : undefined;
    if (!base || !partner) return [];
    return [{
      ...base,
      id: `nick_${base.id}`,
      name: `${weapon.name} · Nick`,
      actionCost: 'free' as const,
      damage: withoutPositiveAbilityModifier(base.damage),
      attacksCount: 1,
      tags: [...(base.tags ?? []), 'nick-extra-attack'],
      ammunitionPerAttack: base.ammunitionType ? 1 : undefined,
      ruleNotes: [...(base.ruleNotes ?? []), `Exige ataque anterior com outra arma Light (${partner.name}) e só pode ser usado uma vez por turno.`]
    }];
  });
  const spellActions = character.spells
    .map((spell) => buildSpellAction(character, spell.id))
    .filter((action): action is SpellAction => Boolean(action));
  const companionActions = (character.companions ?? []).flatMap(buildPactChainCompanionAttackActions);
  const featureActions = character.features.flatMap((feature) => {
    const granted = feature.grantsActions ?? [];
    if (feature.requiresReview && granted.length) {
      issues.push(actionIssue('warning', 'FEATURE_ACTION_REQUIRES_REVIEW', `Feature "${feature.name}" concede ações, mas ainda requer revisão.`, feature.source));
    }
    return granted.map((action) => ({
      ...action,
      source: action.source ?? feature.source,
      origin: action.origin ?? { kind: 'featureGrant' as const, entityType: 'feature' as const, entityId: feature.id, parentFeatureId: feature.id },
      requiresReview: action.requiresReview ?? feature.requiresReview
    }));
  });

  const actions: CharacterAction[] = [...weaponActions, ...lightExtraActions, ...nickActions, ...spellActions, ...companionActions, ...featureActions];
  for (const action of actions) {
    if (action.requiresReview) {
      issues.push(actionIssue('warning', 'ACTION_REQUIRES_REVIEW', `Ação "${action.name}" vem de uma regra que precisa de revisão antes de ser usada como cálculo definitivo.`, action.source));
    }
    if (action.type === 'spell' && !action.damage) {
      issues.push(actionIssue('warning', 'SPELL_ACTION_WITHOUT_DAMAGE', `Magia "${action.name}" não possui dano ofensivo resolvido.`, action.source));
    }
    const unresolved = action.damage?.unresolvedTokens ?? [];
    if (unresolved.length) {
      issues.push(actionIssue('warning', 'ACTION_DAMAGE_UNRESOLVED', `Ação "${action.name}" possui tokens de dano não resolvidos: ${unresolved.join(', ')}.`, action.source));
    }
  }

  return { actions, issues };
};

export const buildAvailableActions = (character: Character, options: BuildActionOptions = {}): CharacterAction[] => buildAvailableActionsResult(character, options).actions;
