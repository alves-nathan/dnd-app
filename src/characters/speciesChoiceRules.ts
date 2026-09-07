import type {
  AbilityScore,
  Character,
  CharacterSpeciesChoice,
  CreatureSize,
  RuleValidationIssue
} from '../types';
import type { StoredCompendiumItem } from '../compendium/types';
import { applyCompendiumItemToCharacter } from '../compendium/mapper';
import { findCompendiumItemByReference } from '../compendium/classProgression';
import {
  characterLinkMatchesCompendiumItem,
  findCompendiumItemForCharacterLink
} from '../compendium/characterLinkIdentity';
import { prepareAutomaticFeatureForCharacter, reconcileAutomaticFeatureResourceUpdates } from '../compendium/automaticFeatureApplication';
import { itemReferenceMatches } from './creationData';
import { SKILLS } from './proficiencies';
import { ALL_LANGUAGE_OPTIONS } from './choiceOptions';
import { normalizeCharacterChoiceReference } from '../catalog/characterChoiceBridge';

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

const abilitySet = new Set<AbilityScore>(['STR', 'DEX', 'CON', 'INT', 'WIS', 'CHA']);
const creatureSizeSet = new Set<CreatureSize>(['Tiny', 'Small', 'Medium', 'Large', 'Huge', 'Gargantuan']);

const asAbilities = (value: unknown): AbilityScore[] =>
  asStringArray(value)
    .map((entry) => entry.toUpperCase())
    .filter((entry): entry is AbilityScore => abilitySet.has(entry as AbilityScore));

const titleCase = (value: string): string =>
  value
    .replace(/[-_]+/g, ' ')
    .replace(/\b\w/g, (letter) => letter.toUpperCase())
    .replace(/\bClouds\b/, "Cloud's")
    .replace(/\bFires\b/, "Fire's")
    .replace(/\bFrosts\b/, "Frost's")
    .replace(/\bHills\b/, "Hill's")
    .replace(/\bStones\b/, "Stone's")
    .replace(/\bStorms\b/, "Storm's");

const optionLabel = (id: string, value: unknown): string => {
  const base = titleCase(id);
  if (typeof value === 'string' && value.trim()) return `${base} · ${titleCase(value)}`;
  const record = asRecord(value);
  const resistance = asString(record.resistance);
  if (resistance) return `${base} · resistência a ${resistance}`;
  return base;
};

export type SpeciesChoiceKind = 'ancestry' | 'lineage' | 'legacy' | 'revelation' | 'option' | 'subrace' | 'size' | 'variableTrait' | 'language' | 'spell';

export interface SpeciesChoiceOption {
  id: string;
  label: string;
  description?: string;
  featureItemId?: string;
  skillChoiceCount?: number;
  skillOptions?: string[];
}

export interface SpeciesChoiceRequirement {
  speciesItemId: string;
  featureItemId: string;
  featureName: string;
  kind: SpeciesChoiceKind;
  levelGained: number;
  options: SpeciesChoiceOption[];
  spellcastingAbilityOptions: AbilityScore[];
}


export interface SpeciesStructuredSpellGrant {
  spellReference: string;
  minimumCharacterLevel: number;
  spellcastingAbility?: AbilityScore;
  uses?: number;
  usesFormula?: string;
  recharge?: string;
  castAtSpellLevel?: number;
  atWill?: boolean;
  canUseSpellSlots: boolean;
  noComponents?: boolean;
  ignoreMaterialComponent?: boolean;
  sharedResourceKey?: string;
  notes?: string[];
}

const asAbility = (value: unknown): AbilityScore | undefined => {
  const candidate = asString(value)?.toUpperCase();
  return candidate && abilitySet.has(candidate as AbilityScore) ? candidate as AbilityScore : undefined;
};

const ignoreMaterialComponentFrom = (
  value: Record<string, unknown>,
  fallback?: boolean
): boolean | undefined => {
  const materialRequired = asBoolean(value.materialComponentsRequired);
  if (materialRequired !== undefined) return materialRequired === false ? true : undefined;
  const componentOverride = asRecord(value.componentOverride);
  const overrideMaterial = asBoolean(componentOverride.material);
  if (overrideMaterial !== undefined) return overrideMaterial === false ? true : undefined;
  return fallback;
};

const legacyGrantNotes = (
  mechanics: Record<string, unknown>,
  reference: string,
  grant?: Record<string, unknown>
): string[] => {
  const notes: string[] = [];
  const environment = asStringArray(mechanics.environment);
  if (environment.length) notes.push(`Condição ambiental da fonte: ${environment.join(', ')}.`);
  const restriction = asRecord(asRecord(mechanics.spellRestrictions)[reference]);
  if (Object.keys(restriction).length) notes.push(`Restrição específica da fonte: ${JSON.stringify(restriction)}.`);
  const castingRestriction = asRecord(mechanics.castingRestriction);
  if (Object.keys(castingRestriction).length) notes.push(`Restrição de conjuração da fonte: ${JSON.stringify(castingRestriction)}.`);
  const targetRestriction = asString(grant?.targetRestriction);
  if (targetRestriction) notes.push(`Restrição de alvo da fonte: ${targetRestriction}.`);
  const optionRestriction = asString(grant?.optionRestriction);
  if (optionRestriction) notes.push(`Restrição de opção da fonte: ${optionRestriction}.`);
  const sourceNote = asString(mechanics.note);
  if (sourceNote) notes.push(sourceNote);
  notes.push(...asStringArray(mechanics.specialCases));
  return notes;
};

/**
 * Normalizes source-native species spell grants without guessing from arbitrary
 * spell-looking fields. Supported inputs are the explicit schemas already seen
 * in imported species packs: grantedSpells[], legacy spellRefs metadata, and
 * one-level nested feature objects containing spellId/spells[].
 *
 * Spell-list expansions (for example Eberron's Spells of the Mark) are
 * intentionally excluded here and remain owned by spellListRules.ts.
 */
export const getSpeciesStructuredSpellGrants = (
  featureItem: StoredCompendiumItem | undefined,
  characterLevel: number
): SpeciesStructuredSpellGrant[] => {
  if (!featureItem || featureItem.type !== 'feature') return [];
  const payload = asRecord(featureItem.normalizedJson);
  const mechanics = asRecord(payload.mechanics);
  const grants: SpeciesStructuredSpellGrant[] = [];
  const configuredAbility = asAbility(mechanics.spellcastingAbility) ?? asAbility(payload.spellcastingAbility);
  const configuredRecharge = asString(mechanics.recharge);
  const configuredNoComponents = asBoolean(mechanics.noComponents)
    ?? (asBoolean(mechanics.requiresComponents) === false ? true : undefined);
  const configuredIgnoreMaterialComponent = ignoreMaterialComponentFrom(mechanics);
  const levelGranted = asRecord(mechanics.levelGranted);
  const freeCasts = mechanics.freeCasts;
  const freeCastMap = asRecord(freeCasts);
  const numericFreeCasts = asNumber(freeCasts);
  const sharedNonCantripFreeCasts = asNumber(mechanics.sharedNonCantripFreeCasts);
  const rootAtWill = asBoolean(mechanics.atWill);
  const usesFormula = asString(mechanics.usesFormula);
  const componentOverrides = asRecord(mechanics.componentOverrides);

  const pushGrant = (params: {
    reference?: string;
    minimumCharacterLevel?: number;
    spellcastingAbility?: AbilityScore;
    uses?: number;
    usesFormula?: string;
    recharge?: string;
    castAtSpellLevel?: number;
    atWill?: boolean;
    canUseSpellSlots?: boolean;
    noComponents?: boolean;
    ignoreMaterialComponent?: boolean;
    sharedResourceKey?: string;
    notes?: string[];
  }) => {
    const reference = params.reference;
    if (!reference) return;
    const minimumCharacterLevel = Math.max(1, Math.floor(params.minimumCharacterLevel ?? 1));
    if (minimumCharacterLevel > characterLevel) return;
    grants.push({
      spellReference: reference,
      minimumCharacterLevel,
      spellcastingAbility: params.spellcastingAbility ?? configuredAbility,
      uses: params.uses,
      usesFormula: params.usesFormula,
      recharge: params.recharge ?? configuredRecharge,
      castAtSpellLevel: params.castAtSpellLevel,
      atWill: params.atWill,
      canUseSpellSlots: params.canUseSpellSlots ?? (asBoolean(mechanics.alsoCastWithSlots) ?? asBoolean(payload.alsoCastWithSlots) ?? false),
      noComponents: params.noComponents ?? configuredNoComponents,
      ignoreMaterialComponent: params.ignoreMaterialComponent,
      sharedResourceKey: params.sharedResourceKey,
      notes: params.notes
    });
  };

  // Eberron-style structured direct grants. A recharge with no explicit count
  // means the source gives one free use; at-will entries need no resource.
  const grantedSpells = Array.isArray(mechanics.grantedSpells) ? mechanics.grantedSpells.map(asRecord) : [];
  for (const grant of grantedSpells) {
    const reference = asString(grant.spellId) ?? asString(grant.spellRef);
    const atWill = asBoolean(grant.atWill) ?? (asString(grant.usage)?.toLowerCase().includes('atwill') ? true : undefined);
    const recharge = asString(grant.recharge);
    pushGrant({
      reference,
      minimumCharacterLevel: asNumber(grant.minimumCharacterLevel),
      spellcastingAbility: asAbility(grant.spellcastingAbility),
      uses: asNumber(grant.uses) ?? (!atWill && recharge ? 1 : undefined),
      recharge,
      castAtSpellLevel: asNumber(grant.castAtLevel) ?? asNumber(grant.castAtSpellLevel),
      atWill,
      canUseSpellSlots: asBoolean(grant.canUseSpellSlots) ?? asBoolean(grant.alsoCastWithSlots),
      noComponents: asBoolean(grant.noComponents),
      ignoreMaterialComponent: ignoreMaterialComponentFrom(grant, configuredIgnoreMaterialComponent),
      notes: [
        ...legacyGrantNotes(mechanics, reference ?? '', grant),
        ...(asString(grant.notes) ? [asString(grant.notes)!] : [])
      ]
    });
  }

  // EEPC/Ebon-Tides-style legacy spellRefs plus side-car metadata.
  for (const reference of asStringArray(mechanics.spellRefs)) {
    const minimumCharacterLevel = asNumber(levelGranted[reference]) ?? 1;
    const mappedUses = asNumber(freeCastMap[reference]);
    const override = asRecord(componentOverrides[reference]);
    const mappedMaterialRequired = asBoolean(override.materialRequired);
    const mappedMaterial = asBoolean(override.material);
    const mappedIgnoreMaterialComponent = mappedMaterialRequired !== undefined
      ? mappedMaterialRequired === false ? true : undefined
      : mappedMaterial !== undefined
        ? mappedMaterial === false ? true : undefined
        : configuredIgnoreMaterialComponent;
    pushGrant({
      reference,
      minimumCharacterLevel,
      uses: mappedUses ?? numericFreeCasts ?? sharedNonCantripFreeCasts,
      usesFormula,
      recharge: configuredRecharge,
      atWill: rootAtWill,
      ignoreMaterialComponent: mappedIgnoreMaterialComponent,
      sharedResourceKey: sharedNonCantripFreeCasts !== undefined ? 'shared-non-cantrip' : undefined,
      notes: legacyGrantNotes(mechanics, reference)
    });
  }

  // Wildemount-style one-level nested mechanics. Only explicit spellId or
  // spells[] records are accepted; fields such as affectedSpells are ignored.
  const ignoredNestedKeys = /affected|exception|restriction|interaction|modifier|target|immun/i;
  for (const [key, raw] of Object.entries(mechanics)) {
    if (ignoredNestedKeys.test(key)) continue;
    const container = asRecord(raw);
    if (!Object.keys(container).length) continue;
    const nestedAbility = asAbility(container.spellcastingAbility) ?? configuredAbility;
    const nestedSpellId = asString(container.spellId);
    if (nestedSpellId) {
      const atWill = asBoolean(container.atWill) ?? (asString(container.usage)?.toLowerCase().includes('atwill') ? true : undefined);
      const recharge = asString(container.recharge) ?? configuredRecharge;
      pushGrant({
        reference: nestedSpellId,
        minimumCharacterLevel: asNumber(container.minimumCharacterLevel),
        spellcastingAbility: nestedAbility,
        uses: asNumber(container.uses) ?? (!atWill && recharge ? 1 : undefined),
        recharge,
        castAtSpellLevel: asNumber(container.castAtLevel) ?? asNumber(container.castAtSpellLevel),
        atWill,
        canUseSpellSlots: asBoolean(container.canUseSpellSlots) ?? asBoolean(container.alsoCastWithSlots),
        noComponents: asBoolean(container.noComponents),
        ignoreMaterialComponent: ignoreMaterialComponentFrom(container, configuredIgnoreMaterialComponent),
        notes: legacyGrantNotes(mechanics, nestedSpellId, container)
      });
    }
    if (!Array.isArray(container.spells)) continue;
    for (const rawSpell of container.spells) {
      const spell = asRecord(rawSpell);
      const reference = asString(spell.spellId) ?? asString(spell.spellRef);
      const atWill = asBoolean(spell.atWill) ?? (asString(spell.usage)?.toLowerCase().includes('atwill') ? true : undefined);
      const recharge = asString(spell.recharge) ?? asString(container.recharge) ?? configuredRecharge;
      pushGrant({
        reference,
        minimumCharacterLevel: asNumber(spell.minimumCharacterLevel),
        spellcastingAbility: asAbility(spell.spellcastingAbility) ?? nestedAbility,
        uses: asNumber(spell.uses) ?? (!atWill && recharge ? 1 : undefined),
        recharge,
        castAtSpellLevel: asNumber(spell.castAtLevel) ?? asNumber(spell.castAtSpellLevel),
        atWill,
        canUseSpellSlots: asBoolean(spell.canUseSpellSlots) ?? asBoolean(spell.alsoCastWithSlots) ?? asBoolean(container.alsoCastWithSlots),
        noComponents: asBoolean(spell.noComponents),
        ignoreMaterialComponent: ignoreMaterialComponentFrom(
          spell,
          ignoreMaterialComponentFrom(container, configuredIgnoreMaterialComponent)
        ),
        notes: [
          ...legacyGrantNotes(mechanics, reference ?? '', spell),
          ...(asString(spell.notes) ? [asString(spell.notes)!] : [])
        ]
      });
    }
  }

  return Array.from(new Map(grants.map((grant) => [
    [grant.spellReference, grant.minimumCharacterLevel, grant.sharedResourceKey ?? '', grant.atWill ? 'atWill' : '', grant.uses ?? '', grant.usesFormula ?? ''].join('|'),
    grant
  ] as const)).values());
};

export interface SpeciesFeatChoiceRequirement {
  speciesItemId: string;
  count: number;
  mustQualify: boolean;
  acquisitionLevel: number;
  restriction?: string;
}

const optionsFromRecord = (value: unknown): SpeciesChoiceOption[] =>
  Object.entries(asRecord(value)).map(([id, option]) => ({ id, label: optionLabel(id, option) }));

const effectTemplateOptions = (payload: Record<string, unknown>): SpeciesChoiceOption[] => {
  const templates = Array.isArray(payload.effectTemplates) ? payload.effectTemplates : [];
  for (const template of templates) {
    const record = asRecord(template);
    if (!record.choiceRequired || !Array.isArray(record.options)) continue;
    const options = record.options
      .map((entry) => asRecord(entry))
      .map((entry) => asString(entry.id))
      .filter((entry): entry is string => Boolean(entry))
      .map((id) => ({ id, label: titleCase(id) }));
    if (options.length) return options;
  }
  return [];
};

const spellChoiceOptions = (
  featureItem: StoredCompendiumItem,
  allItems: StoredCompendiumItem[]
): SpeciesChoiceOption[] => {
  const payload = asRecord(featureItem.normalizedJson);
  const mechanics = asRecord(payload.mechanics);
  const spellChoice = asRecord(mechanics.spellChoice);
  const explicitReferences = asStringArray(mechanics.spellChoices);
  const count = Math.max(0, Math.floor(asNumber(spellChoice.count) ?? asNumber(mechanics.knownCantrips) ?? 0));
  const choiceType = (asString(mechanics.choiceType) ?? '').toLowerCase();
  if (!explicitReferences.length && !Object.keys(spellChoice).length && choiceType !== 'cantrip') return [];
  if (count > 1) return [];

  const spellLevel = Math.max(0, Math.floor(asNumber(spellChoice.level) ?? (choiceType === 'cantrip' ? 0 : 0)));
  const sourceLists = asStringArray(spellChoice.sourceLists)
    .concat(asString(spellChoice.sourceList) ? [asString(spellChoice.sourceList)!] : [])
    .map((entry) => entry.toLowerCase());
  const initialSpellId = asString(spellChoice.initialSpellId);
  const replacementTiming = (asString(spellChoice.replacementTiming) ?? '').toLowerCase();
  const replacementAfterRest = Boolean(initialSpellId && replacementTiming.includes('long rest'));
  const references = replacementAfterRest
    ? [initialSpellId as string]
    : explicitReferences.length
      ? explicitReferences
      : allItems
          .filter((item) => item.type === 'spell' && item.status !== 'disabled')
          .filter((item) => Math.max(0, Math.floor(asNumber(asRecord(item.normalizedJson).level) ?? 0)) === spellLevel)
          .filter((item) => {
            if (!sourceLists.length) return true;
            const classes = asStringArray(asRecord(item.normalizedJson).classes).map((entry) => entry.toLowerCase());
            return classes.some((className) => sourceLists.includes(className));
          })
          .map((item) => item.id);

  const ordered = Array.from(new Set([...(initialSpellId ? [initialSpellId] : []), ...references]));
  return ordered.flatMap((reference): SpeciesChoiceOption[] => {
    const spell = allItems.find((item) => item.type === 'spell' && itemReferenceMatches(item, reference));
    if (!spell) return [];
    return [{
      id: spell.id,
      label: spell.name,
      description: initialSpellId && itemReferenceMatches(spell, initialSpellId)
        ? replacementAfterRest
          ? 'Magia inicial concedida pela feature; substituições posteriores exigem concluir um Descanso Longo.'
          : 'Magia inicial sugerida pela feature; a escolha pode representar uma substituição permitida pela própria regra.'
        : spell.summary
    }];
  });
};

const choiceDefinition = (
  speciesItem: StoredCompendiumItem,
  featureItem: StoredCompendiumItem,
  allItems: StoredCompendiumItem[]
): SpeciesChoiceRequirement | undefined => {
  const payload = asRecord(featureItem.normalizedJson);
  const levelGained = Math.max(1, asNumber(payload.levelGained) ?? 1);
  const mechanics = asRecord(payload.mechanics);
  const spellcastingAbilityOptions = Array.from(new Set([
    ...asAbilities(payload.spellcastingAbilityChoice),
    ...asAbilities(mechanics.spellcastingAbilityChoice),
    ...asAbilities(asRecord(mechanics.spellChoice).spellcastingAbilityChoice)
  ]));

  const definitions: Array<{ key: string; kind: SpeciesChoiceKind }> = [
    { key: 'ancestryOptions', kind: 'ancestry' },
    { key: 'lineageOptions', kind: 'lineage' },
    { key: 'legacyOptions', kind: 'legacy' },
    { key: 'options', kind: 'option' }
  ];

  for (const definition of definitions) {
    const options = optionsFromRecord(payload[definition.key]);
    if (options.length) {
      return {
        speciesItemId: speciesItem.id,
        featureItemId: featureItem.id,
        featureName: featureItem.name,
        kind: definition.kind,
        levelGained,
        options,
        spellcastingAbilityOptions
      };
    }
  }

  const spellOptions = spellChoiceOptions(featureItem, allItems);
  if (spellOptions.length) {
    return {
      speciesItemId: speciesItem.id,
      featureItemId: featureItem.id,
      featureName: featureItem.name,
      kind: 'spell',
      levelGained,
      options: spellOptions,
      spellcastingAbilityOptions
    };
  }

  const revelationOptions = effectTemplateOptions(payload);
  if (revelationOptions.length) {
    return {
      speciesItemId: speciesItem.id,
      featureItemId: featureItem.id,
      featureName: featureItem.name,
      kind: 'revelation',
      levelGained,
      options: revelationOptions,
      spellcastingAbilityOptions
    };
  }

  // Some legacy species (notably Wildemount Genasi) model the required
  // subrace as a choice-marker feature whose mechanics point at concrete
  // feature records. Resolve those feature ids into real selectable options
  // instead of showing the marker itself with no choices.
  const choiceType = asString(mechanics.choiceType) ?? asString(payload.choiceType);
  const optionFeatureIds = asStringArray(mechanics.optionFeatureIds ?? payload.optionFeatureIds);
  if (choiceType === 'subrace' && optionFeatureIds.length) {
    const options = optionFeatureIds.flatMap((reference): SpeciesChoiceOption[] => {
      const optionFeature = allItems.find((item) =>
        item.type === 'feature' && itemReferenceMatches(item, reference)
      );
      if (!optionFeature) return [];
      const optionMechanics = asRecord(optionFeature.normalizedJson.mechanics);
      const configuredName = asString(optionMechanics.name);
      const label = configuredName ?? optionFeature.name.replace(/^.*?Subrace:\s*/i, '').trim();
      return [{
        id: optionFeature.importItemId,
        label: label || optionFeature.name,
        description: optionFeature.summary,
        featureItemId: optionFeature.id
      }];
    });
    if (options.length) {
      return {
        speciesItemId: speciesItem.id,
        featureItemId: featureItem.id,
        featureName: featureItem.name,
        kind: 'subrace',
        levelGained,
        options,
        spellcastingAbilityOptions
      };
    }
  }

  return undefined;
};

const directChoiceDefinitions = (speciesItem: StoredCompendiumItem): SpeciesChoiceRequirement[] => {
  const payload = asRecord(speciesItem.normalizedJson);
  const requirements: SpeciesChoiceRequirement[] = [];
  const sizes = asStringArray(payload.sizeOptions).filter((entry) => creatureSizeSet.has(entry as CreatureSize));
  if (sizes.length > 1) {
    requirements.push({
      speciesItemId: speciesItem.id,
      featureItemId: `${speciesItem.id}::size`,
      featureName: 'Tamanho',
      kind: 'size',
      levelGained: 1,
      options: sizes.map((size) => ({ id: size, label: size })),
      spellcastingAbilityOptions: []
    });
  }

  const languageChoice = asRecord(payload.languageProficiencyChoice);
  const languageChoiceCount = Math.max(0, Math.floor(asNumber(languageChoice.count) ?? 0));
  if (languageChoiceCount > 0) {
    const configuredLanguages = asStringArray(languageChoice.options);
    requirements.push({
      speciesItemId: speciesItem.id,
      featureItemId: `${speciesItem.id}::language`,
      featureName: 'Idioma da espécie',
      kind: 'language',
      levelGained: 1,
      options: (configuredLanguages.length ? configuredLanguages : ALL_LANGUAGE_OPTIONS).map((language) => ({ id: language, label: language })),
      spellcastingAbilityOptions: []
    });
  }

  const variableTraitChoice = asRecord(payload.variableTraitChoice);
  const variableOptions = Array.isArray(variableTraitChoice.options) ? variableTraitChoice.options : [];
  if (variableOptions.length) {
    const options: SpeciesChoiceOption[] = variableOptions.flatMap((raw): SpeciesChoiceOption[] => {
      const option = asRecord(raw);
      const id = asString(option.id);
      if (!id) return [];
      const grants = asRecord(option.grants);
      const skillChoice = asRecord(grants.skillProficiencyChoice);
      const skillChoiceCount = Math.max(0, Math.floor(asNumber(skillChoice.count) ?? 0));
      const skillDescriptor = skillChoice.options;
      return [{
        id,
        label: id === 'darkvision' ? 'Darkvision · 60 ft' : id === 'skill-proficiency' ? 'Proficiência em perícia' : titleCase(id),
        skillChoiceCount,
        skillOptions: skillChoiceCount > 0
          ? (skillDescriptor === 'anySkill' ? [...SKILLS] : asStringArray(skillDescriptor))
          : undefined
      }];
    });
    if (options.length) {
      requirements.push({
        speciesItemId: speciesItem.id,
        featureItemId: `${speciesItem.id}::variable-trait`,
        featureName: 'Traço variável',
        kind: 'variableTrait',
        levelGained: 1,
        options,
        spellcastingAbilityOptions: []
      });
    }
  }
  return requirements;
};

export const getSpeciesFeatChoiceRequirement = (
  speciesItem: StoredCompendiumItem | undefined
): SpeciesFeatChoiceRequirement | undefined => {
  if (!speciesItem) return undefined;
  const featChoice = asRecord(asRecord(speciesItem.normalizedJson).featChoice);
  const count = Math.max(0, Math.floor(asNumber(featChoice.count) ?? 0));
  if (!count) return undefined;
  const speciesMechanics = asRecord(asRecord(speciesItem.normalizedJson).mechanics);
  const acquisitionLevel = Math.max(1, Math.floor(
    asNumber(featChoice.levelGained) ?? asNumber(speciesMechanics.availableAtCharacterLevel) ?? 1
  ));
  return {
    speciesItemId: speciesItem.id,
    count,
    mustQualify: featChoice.mustQualify !== false,
    acquisitionLevel,
    restriction: asString(featChoice.restriction)
  };
};

export const getSpeciesFeatureItems = (
  speciesItem: StoredCompendiumItem | undefined,
  allItems: StoredCompendiumItem[]
): StoredCompendiumItem[] => {
  if (!speciesItem) return [];
  const references = asStringArray(asRecord(speciesItem.normalizedJson).featureIds);
  return references
    .map((reference) => allItems.find((item) => item.type === 'feature' && itemReferenceMatches(item, reference)))
    .filter((item): item is StoredCompendiumItem => Boolean(item));
};

/**
 * Returns spells directly granted by the active species configuration.
 *
 * This is intentionally separate from species spell-list additions: these
 * references represent spells the species itself gives the character, so
 * they must not consume a class' normal cantrip/prepared/known limits. The
 * runtime external-grant reconciler remains the owner of persistence, free
 * casts and resources; this helper gives creation/spell-access previews the
 * same mechanical visibility before a Character has been materialized.
 */
export const getSpeciesGrantedSpellReferences = (
  speciesItem: StoredCompendiumItem | undefined,
  allItems: StoredCompendiumItem[],
  characterLevel: number,
  choices: CharacterSpeciesChoice[]
): string[] => {
  if (!speciesItem || speciesItem.type !== 'species') return [];
  const requirements = getSpeciesChoiceRequirements(speciesItem, allItems, characterLevel);
  const references: string[] = [];

  const spellId = (reference: string | undefined): string | undefined => {
    if (!reference) return undefined;
    const item = allItems.find((candidate) => candidate.type === 'spell' && itemReferenceMatches(candidate, reference));
    return item?.importItemId ?? item?.id;
  };

  const collectOptionReferences = (
    featureItem: StoredCompendiumItem,
    choice: CharacterSpeciesChoice | undefined
  ): string[] => {
    if (!choice?.optionId) return [];
    const payload = asRecord(featureItem.normalizedJson);
    for (const key of ['ancestryOptions', 'lineageOptions', 'legacyOptions', 'options']) {
      const option = asRecord(asRecord(payload[key])[choice.optionId]);
      if (!Object.keys(option).length) continue;
      const optionRefs = [...asStringArray(option.spellRefs)];
      const initialLevelOneReference = asStringArray(option.level1SpellRefs)[0];
      for (const [field, value] of Object.entries(option)) {
        const match = field.match(/^level(\d+)SpellRefs$/i);
        if (!match || characterLevel < Number(match[1])) continue;
        optionRefs.push(...asStringArray(value));
      }
      if (choice.replacementSpellItemId && asString(option.cantripReplacementOnLongRest) && initialLevelOneReference) {
        const initialSpellItemId = spellId(initialLevelOneReference);
        return [
          ...optionRefs.filter((reference) => spellId(reference) !== initialSpellItemId),
          choice.replacementSpellItemId
        ];
      }
      return optionRefs;
    }
    return [];
  };

  for (const featureItem of getSpeciesFeatureItems(speciesItem, allItems)) {
    const payload = asRecord(featureItem.normalizedJson);
    const levelGained = Math.max(1, Math.floor(asNumber(payload.levelGained) ?? 1));
    if (levelGained > characterLevel) continue;

    const requirement = requirements.find((candidate) => candidate.featureItemId === featureItem.id);
    const choice = requirement ? speciesChoiceForRequirement(choices, requirement) : undefined;
    if (requirement && (!choice?.optionId || !requirement.options.some((option) => option.id === choice.optionId))) {
      continue;
    }

    references.push(...asStringArray(payload.spellRefs));
    references.push(...getSpeciesStructuredSpellGrants(featureItem, characterLevel).map((grant) => grant.spellReference));

    if (requirement?.kind === 'spell' && choice?.optionId) {
      references.push(choice.replacementSpellItemId ?? choice.optionId);
    }

    references.push(...collectOptionReferences(featureItem, choice));

    const selectedOptionFeature = requirement
      ? getSpeciesChoiceOptionFeatureItem(requirement, choice?.optionId, allItems)
      : undefined;
    if (selectedOptionFeature) {
      const optionPayload = asRecord(selectedOptionFeature.normalizedJson);
      references.push(...asStringArray(optionPayload.spellRefs));
      references.push(...getSpeciesStructuredSpellGrants(selectedOptionFeature, characterLevel).map((grant) => grant.spellReference));
      for (const [field, value] of Object.entries(optionPayload)) {
        const match = field.match(/^level(\d+)SpellRefs$/i);
        if (!match || characterLevel < Number(match[1])) continue;
        references.push(...asStringArray(value));
      }
    }
  }

  return Array.from(new Set(
    references
      .map((reference) => spellId(reference))
      .filter((reference): reference is string => Boolean(reference))
  ));
};

export const getSpeciesChoiceRequirements = (
  speciesItem: StoredCompendiumItem | undefined,
  allItems: StoredCompendiumItem[],
  characterLevel: number
): SpeciesChoiceRequirement[] => {
  if (!speciesItem) return [];
  return [
    ...directChoiceDefinitions(speciesItem),
    ...getSpeciesFeatureItems(speciesItem, allItems)
      .map((featureItem) => choiceDefinition(speciesItem, featureItem, allItems))
      .filter((requirement): requirement is SpeciesChoiceRequirement => Boolean(requirement))
  ].filter((requirement) => requirement.levelGained <= characterLevel);
};

const speciesChoiceReferenceMatches = (left: string, right: string): boolean =>
  normalizeCharacterChoiceReference(left) === normalizeCharacterChoiceReference(right);

export const speciesChoiceForRequirement = (
  choices: CharacterSpeciesChoice[],
  requirement: SpeciesChoiceRequirement
): CharacterSpeciesChoice | undefined =>
  choices.find((choice) =>
    speciesChoiceReferenceMatches(choice.speciesItemId, requirement.speciesItemId) &&
    speciesChoiceReferenceMatches(choice.featureItemId, requirement.featureItemId)
  );

const choiceBelongsToRequirement = (
  choice: CharacterSpeciesChoice,
  requirement: SpeciesChoiceRequirement
): boolean =>
  speciesChoiceReferenceMatches(choice.speciesItemId, requirement.speciesItemId) &&
  speciesChoiceReferenceMatches(choice.featureItemId, requirement.featureItemId);

const selectedOptionMechanics = (
  featureItem: StoredCompendiumItem,
  optionId: string
): Record<string, unknown> => {
  const payload = asRecord(featureItem.normalizedJson);
  for (const key of ['ancestryOptions', 'lineageOptions', 'legacyOptions', 'options']) {
    const option = asRecord(asRecord(payload[key])[optionId]);
    if (Object.keys(option).length) return option;
  }
  return {};
};

const describeSelectedOptionMechanics = (mechanics: Record<string, unknown>): string | undefined => {
  const parts: string[] = [];
  const effect = asString(mechanics.effect);
  const trigger = asString(mechanics.trigger);
  const extraDamage = asString(mechanics.extraDamage);
  const damageReduction = asString(mechanics.damageReduction);
  const damageFormula = asString(mechanics.damageFormula);
  const damageType = asString(mechanics.damageType);
  const condition = asString(mechanics.condition);

  if (trigger) parts.push(`Gatilho: ${trigger.replace(/([a-z])([A-Z])/g, '$1 $2')}.`);
  if (effect) parts.push(`${effect}.`);
  if (extraDamage) parts.push(`Dano extra: ${extraDamage}.`);
  else if (damageFormula) parts.push(`Dano: ${damageFormula}${damageType ? ` ${damageType}` : ''}.`);
  if (damageReduction) parts.push(`Redução de dano: ${damageReduction}.`);
  if (condition) parts.push(`Efeito: ${condition}.`);
  return parts.length ? parts.join(' ') : undefined;
};

export interface SelectedSpeciesFeatureChoice {
  featureItem: StoredCompendiumItem;
  requirement: SpeciesChoiceRequirement;
  choice: CharacterSpeciesChoice;
  option: SpeciesChoiceOption;
  mechanics: Record<string, unknown>;
  description?: string;
}

/**
 * Resolves the concrete option selected for a materialized species feature.
 * This keeps presentation and turn integrations tied to the same persisted
 * CharacterSpeciesChoice instead of trying to infer a variant from feature
 * names or resource notes.
 */
export const getSelectedSpeciesFeatureChoice = (
  character: Character,
  allItems: StoredCompendiumItem[],
  featureEntityId: string
): SelectedSpeciesFeatureChoice | undefined => {
  const featureLink = (character.compendiumLinks ?? []).find((link) =>
    link.status === 'active'
    && link.appliedAs === 'feature'
    && link.appliedEntityId === featureEntityId
  );
  const featureItem = featureLink ? findCompendiumItemForCharacterLink(allItems, featureLink) : undefined;
  if (!featureItem) return undefined;

  const speciesLink = (character.compendiumLinks ?? []).find((link) =>
    link.status === 'active' && link.appliedAs === 'species'
  );
  const speciesItem = speciesLink ? findCompendiumItemForCharacterLink(allItems, speciesLink) : undefined;
  if (!speciesItem) return undefined;

  const requirement = getSpeciesChoiceRequirements(speciesItem, allItems, character.level)
    .find((candidate) => itemReferenceMatches(featureItem, candidate.featureItemId));
  if (!requirement) return undefined;
  const choice = speciesChoiceForRequirement(character.buildChoices?.speciesChoices ?? [], requirement);
  if (!choice?.optionId) return undefined;
  const option = requirement.options.find((candidate) => candidate.id === choice.optionId);
  if (!option) return undefined;
  const mechanics = selectedOptionMechanics(featureItem, choice.optionId);
  return {
    featureItem,
    requirement,
    choice,
    option,
    mechanics,
    description: option.description ?? describeSelectedOptionMechanics(mechanics)
  };
};

export const setSpeciesChoiceOption = (
  choices: CharacterSpeciesChoice[],
  requirement: SpeciesChoiceRequirement,
  optionId: string
): CharacterSpeciesChoice[] => {
  const current = speciesChoiceForRequirement(choices, requirement);
  const next: CharacterSpeciesChoice = {
    speciesItemId: requirement.speciesItemId,
    featureItemId: requirement.featureItemId,
    choiceKind: requirement.kind,
    optionId,
    spellcastingAbility: current?.spellcastingAbility,
    skill: current?.optionId === optionId ? current.skill : undefined,
    language: current?.optionId === optionId ? current.language : undefined,
    replacementSpellItemId: current?.optionId === optionId ? current.replacementSpellItemId : undefined,
    replacementUsedAt: current?.optionId === optionId ? current.replacementUsedAt : undefined
  };
  return [
    ...choices.filter((choice) => !choiceBelongsToRequirement(choice, requirement)),
    next
  ];
};

export const setSpeciesChoiceSkill = (
  choices: CharacterSpeciesChoice[],
  requirement: SpeciesChoiceRequirement,
  skill: string
): CharacterSpeciesChoice[] => {
  const current = speciesChoiceForRequirement(choices, requirement);
  const next: CharacterSpeciesChoice = {
    speciesItemId: requirement.speciesItemId,
    featureItemId: requirement.featureItemId,
    choiceKind: requirement.kind,
    optionId: current?.optionId ?? '',
    spellcastingAbility: current?.spellcastingAbility,
    skill,
    replacementSpellItemId: current?.replacementSpellItemId,
    replacementUsedAt: current?.replacementUsedAt
  };
  return [...choices.filter((choice) => !choiceBelongsToRequirement(choice, requirement)), next];
};

export const setSpeciesChoiceSpellcastingAbility = (
  choices: CharacterSpeciesChoice[],
  requirement: SpeciesChoiceRequirement,
  spellcastingAbility: AbilityScore
): CharacterSpeciesChoice[] => {
  const current = speciesChoiceForRequirement(choices, requirement);
  const next: CharacterSpeciesChoice = {
    speciesItemId: requirement.speciesItemId,
    featureItemId: requirement.featureItemId,
    choiceKind: requirement.kind,
    optionId: current?.optionId ?? '',
    spellcastingAbility,
    skill: current?.skill,
    language: current?.language,
    replacementSpellItemId: current?.replacementSpellItemId,
    replacementUsedAt: current?.replacementUsedAt
  };
  return [
    ...choices.filter((choice) => !choiceBelongsToRequirement(choice, requirement)),
    next
  ];
};

export const getSpeciesChoiceOptionFeatureItem = (
  requirement: SpeciesChoiceRequirement,
  optionId: string | undefined,
  allItems: StoredCompendiumItem[]
): StoredCompendiumItem | undefined => {
  if (!optionId) return undefined;
  const option = requirement.options.find((candidate) => candidate.id === optionId);
  if (!option?.featureItemId) return undefined;
  return allItems.find((item) => item.id === option.featureItemId && item.type === 'feature');
};

export const validateSpeciesChoices = (
  requirements: SpeciesChoiceRequirement[],
  choices: CharacterSpeciesChoice[]
): RuleValidationIssue[] => {
  const issues: RuleValidationIssue[] = [];
  for (const requirement of requirements) {
    const choice = speciesChoiceForRequirement(choices, requirement);
    if (!choice?.optionId) {
      issues.push({ severity: 'error', code: 'SPECIES_OPTION_REQUIRED', message: `Escolha uma opção para ${requirement.featureName}.` });
      continue;
    }
    const option = requirement.options.find((candidate) => candidate.id === choice.optionId);
    if (!option) {
      issues.push({ severity: 'error', code: 'SPECIES_OPTION_INVALID', message: `A opção escolhida para ${requirement.featureName} não está disponível.` });
      continue;
    }
    if (option.skillChoiceCount && (!choice.skill || !(option.skillOptions ?? []).includes(choice.skill))) {
      issues.push({ severity: 'error', code: 'SPECIES_SKILL_REQUIRED', message: `Escolha uma perícia para ${requirement.featureName}.` });
    }
    if (
      requirement.spellcastingAbilityOptions.length > 0 &&
      (!choice.spellcastingAbility || !requirement.spellcastingAbilityOptions.includes(choice.spellcastingAbility))
    ) {
      issues.push({ severity: 'error', code: 'SPECIES_SPELLCASTING_ABILITY_REQUIRED', message: `Escolha o atributo de conjuração de ${requirement.featureName}.` });
    }
  }
  return issues;
};

export const getSpeciesChoiceProficiencyGrants = (
  requirements: SpeciesChoiceRequirement[],
  choices: CharacterSpeciesChoice[]
): { skills: string[]; languages: string[] } => ({
  skills: Array.from(new Set(requirements.flatMap((requirement) => {
    const option = requirement.options.find((candidate) => candidate.id === speciesChoiceForRequirement(choices, requirement)?.optionId);
    const choice = speciesChoiceForRequirement(choices, requirement);
    return option?.skillChoiceCount && choice?.skill && (option.skillOptions ?? []).includes(choice.skill) ? [choice.skill] : [];
  }))),
  languages: Array.from(new Set(requirements.flatMap((requirement) => {
    const choice = speciesChoiceForRequirement(choices, requirement);
    return requirement.kind === 'language' && choice?.optionId && requirement.options.some((option) => option.id === choice.optionId)
      ? [choice.optionId]
      : [];
  })))
});

export const applyDirectSpeciesChoiceEffects = (
  character: Character,
  speciesItem: StoredCompendiumItem,
  requirements: SpeciesChoiceRequirement[],
  choices: CharacterSpeciesChoice[]
): Character => {
  let next = character;
  const sizeRequirement = requirements.find((requirement) => requirement.kind === 'size');
  const sizeChoice = sizeRequirement ? speciesChoiceForRequirement(choices, sizeRequirement) : undefined;
  if (next.species && sizeChoice && creatureSizeSet.has(sizeChoice.optionId as CreatureSize)) {
    next = { ...next, species: { ...next.species, size: sizeChoice.optionId as CreatureSize } };
  }

  const senseId = `species-choice-${speciesItem.id}-darkvision`;
  const variableRequirement = requirements.find((requirement) => requirement.kind === 'variableTrait');
  const variableChoice = variableRequirement ? speciesChoiceForRequirement(choices, variableRequirement) : undefined;
  const retainedSenses = (next.senses ?? []).filter((sense) => sense.id !== senseId);
  if (variableChoice?.optionId === 'darkvision') {
    next = {
      ...next,
      senses: [...retainedSenses, { id: senseId, name: 'Darkvision', kind: 'darkvision', rangeFeet: 60, notes: `Escolha de ${speciesItem.name}.` }]
    };
  } else if ((next.senses ?? []).length !== retainedSenses.length) {
    next = { ...next, senses: retainedSenses };
  }
  return next;
};

const speciesReference = (speciesItem: StoredCompendiumItem): string =>
  asString(asRecord(speciesItem.rawJson).id) ?? speciesItem.importItemId;

const featureSpeciesReference = (featureItem: StoredCompendiumItem): string | undefined =>
  asString(asRecord(featureItem.normalizedJson).speciesId);

const choiceExistsForFeature = (
  character: Character,
  speciesItem: StoredCompendiumItem,
  featureItem: StoredCompendiumItem,
  allItems: StoredCompendiumItem[]
): boolean => {
  const requirement = choiceDefinition(speciesItem, featureItem, allItems);
  if (!requirement || requirement.levelGained > character.level) return true;
  return validateSpeciesChoices([requirement], character.buildChoices?.speciesChoices ?? []).length === 0;
};

export const removeSpeciesProgressionFeatures = (
  character: Character,
  allItems: StoredCompendiumItem[]
): Character => {
  const speciesFeatureLinks = (character.compendiumLinks ?? []).filter((link) => {
    if (link.appliedAs !== 'feature' || link.status !== 'active') return false;
    const item = findCompendiumItemForCharacterLink(allItems, link);
    return Boolean(item && featureSpeciesReference(item));
  });
  if (!speciesFeatureLinks.length) return character;
  const entityIds = new Set(speciesFeatureLinks.map((link) => link.appliedEntityId));
  const resourceIds = new Set(
    character.features
      .filter((feature) => entityIds.has(feature.id))
      .map((feature) => feature.resource?.id)
      .filter((id): id is string => Boolean(id))
  );
  return {
    ...character,
    features: character.features.filter((feature) => !entityIds.has(feature.id)),
    resources: character.resources.filter((resource) => !resourceIds.has(resource.id)),
    compendiumLinks: (character.compendiumLinks ?? []).map((link) =>
      speciesFeatureLinks.some((speciesLink) => speciesLink.id === link.id)
        ? { ...link, status: 'removed' as const }
        : link
    )
  };
};

export interface ApplyAutomaticSpeciesProgressionResult {
  character: Character;
  appliedItems: StoredCompendiumItem[];
  issues: RuleValidationIssue[];
}

export const applyAutomaticSpeciesProgression = (
  character: Character,
  allItems: StoredCompendiumItem[]
): ApplyAutomaticSpeciesProgressionResult => {
  const speciesLink = (character.compendiumLinks ?? []).find(
    (link) => link.appliedAs === 'species' && link.status === 'active'
  );
  const speciesItem = speciesLink
    ? findCompendiumItemForCharacterLink(allItems, speciesLink)
    : undefined;
  if (!speciesItem) return { character, appliedItems: [], issues: [] };

  let next = character;
  const issues: RuleValidationIssue[] = [];
  const appliedItems: StoredCompendiumItem[] = [];
  const currentSpeciesReference = speciesReference(speciesItem);

  const staleFeatureLinks = (next.compendiumLinks ?? []).filter((link) => {
    if (link.appliedAs !== 'feature' || link.status !== 'active') return false;
    const item = findCompendiumItemForCharacterLink(allItems, link);
    const owner = item ? featureSpeciesReference(item) : undefined;
    return Boolean(owner && owner !== currentSpeciesReference);
  });

  if (staleFeatureLinks.length) {
    const staleEntityIds = new Set(staleFeatureLinks.map((link) => link.appliedEntityId));
    const staleResourceIds = new Set(
      next.features
        .filter((feature) => staleEntityIds.has(feature.id))
        .map((feature) => feature.resource?.id)
        .filter((id): id is string => Boolean(id))
    );
    next = {
      ...next,
      features: next.features.filter((feature) => !staleEntityIds.has(feature.id)),
      resources: next.resources.filter((resource) => !staleResourceIds.has(resource.id)),
      compendiumLinks: (next.compendiumLinks ?? []).map((link) =>
        staleFeatureLinks.some((stale) => stale.id === link.id)
          ? { ...link, status: 'removed' as const }
          : link
      )
    };
  }

  for (const featureItem of getSpeciesFeatureItems(speciesItem, allItems)) {
    const levelGained = Math.max(1, asNumber(asRecord(featureItem.normalizedJson).levelGained) ?? 1);
    if (levelGained > next.level) continue;
    if (!choiceExistsForFeature(next, speciesItem, featureItem, allItems)) {
      issues.push({
        severity: 'warning',
        code: 'SPECIES_FEATURE_CHOICE_PENDING',
        message: `A escolha de ${featureItem.name} ainda está pendente.`
      });
      continue;
    }
    if (featureItem.status === 'disabled') {
      issues.push({
        severity: 'warning',
        code: 'SPECIES_FEATURE_DISABLED',
        message: `A feature automática de espécie "${featureItem.name}" está desabilitada no Compêndio.`
      });
      continue;
    }
    const alreadyLinked = (next.compendiumLinks ?? []).some((link) => {
      if (link.status !== 'active') return false;
      return characterLinkMatchesCompendiumItem(allItems, link, featureItem);
    });
    if (!alreadyLinked) {
      const result = applyCompendiumItemToCharacter(next, prepareAutomaticFeatureForCharacter(featureItem));
      if (result.ok) {
        next = reconcileAutomaticFeatureResourceUpdates(result.character, featureItem);
        appliedItems.push(featureItem);
      } else {
        issues.push(...result.issues);
      }
    } else {
      next = reconcileAutomaticFeatureResourceUpdates(next, featureItem);
    }

    const requirement = choiceDefinition(speciesItem, featureItem, allItems);
    const choice = requirement
      ? speciesChoiceForRequirement(next.buildChoices?.speciesChoices ?? [], requirement)
      : undefined;
    const selectedOptionFeature = requirement
      ? getSpeciesChoiceOptionFeatureItem(requirement, choice?.optionId, allItems)
      : undefined;
    if (!selectedOptionFeature) continue;
    if (selectedOptionFeature.status === 'disabled') {
      issues.push({
        severity: 'warning',
        code: 'SPECIES_OPTION_FEATURE_DISABLED',
        message: `A opção automática de espécie "${selectedOptionFeature.name}" está desabilitada no Compêndio.`
      });
      continue;
    }
    const optionAlreadyLinked = (next.compendiumLinks ?? []).some((link) => {
      if (link.status !== 'active') return false;
      return characterLinkMatchesCompendiumItem(allItems, link, selectedOptionFeature);
    });
    if (optionAlreadyLinked) {
      next = reconcileAutomaticFeatureResourceUpdates(next, selectedOptionFeature);
      continue;
    }
    const optionResult = applyCompendiumItemToCharacter(next, prepareAutomaticFeatureForCharacter(selectedOptionFeature));
    if (optionResult.ok) {
      next = reconcileAutomaticFeatureResourceUpdates(optionResult.character, selectedOptionFeature);
      appliedItems.push(selectedOptionFeature);
    } else {
      issues.push(...optionResult.issues);
    }
  }

  return { character: next, appliedItems, issues };
};
