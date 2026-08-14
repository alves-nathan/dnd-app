import { z } from 'zod';
import {
  ABILITY_SCORES,
  ACTION_COSTS,
  COMPENDIUM_ENTITY_KINDS,
  CURRENCY_UNITS,
  DAMAGE_TYPES,
  SKILLS,
  type CompendiumEntityKind
} from './importDomain';
import { compendiumImportV2Schema } from './importV2Schemas';
import { IMPORT_TEMPLATE_VERSION_V2 } from './importVersions';

export interface ImportEntityDocumentation {
  kind: CompendiumEntityKind;
  purpose: string;
  requiredPayloadFields: string[];
  importantPayloadFields: string[];
  relationFields: string[];
}

export const IMPORT_V2_ID_STRATEGY = [
  'Use IDs estáveis, determinísticos, legíveis e independentes da ordem de importação.',
  'Prefira <source>-<era>-<kind>-<slug>, por exemplo phb-2024-spell-fire-bolt.',
  'Nunca deduplique apenas por name. Conteúdo de fontes/eras diferentes deve coexistir com IDs diferentes.',
  'Relações devem usar IDs sempre que a entidade relacionada possuir ID canônico.'
] as const;

export const IMPORT_V2_MERGE_SEMANTICS = [
  'ID inexistente: create.',
  'Mesmo ID e mesmo conteúdo canônico: unchanged.',
  'Mesmo ID, mesma identidade/source e conteúdo diferente: update.',
  'Mesmo ID com kind/source/rulesEra incompatível: conflict.',
  'O preview/diff deve ocorrer antes da persistência transacional.'
] as const;

export const IMPORT_V2_ENTITY_DOCUMENTATION: Record<CompendiumEntityKind, ImportEntityDocumentation> = {
  class: {
    kind: 'class',
    purpose: 'Classe jogável e tudo que criação/progressão consomem.',
    requiredPayloadFields: [],
    importantPayloadFields: ['hitDie', 'primaryAbilities', 'savingThrowProficiencies', 'skillChoiceCount', 'skillProficienciesChoice', 'weaponProficiencies', 'armorTraining', 'toolProficiencies', 'featureIds', 'progression', 'spellcasting', 'resources', 'equipmentOptions'],
    relationFields: ['featureIds', 'progression[].featureIds']
  },
  subclass: {
    kind: 'subclass',
    purpose: 'Subclasse vinculada explicitamente a uma classe.',
    requiredPayloadFields: ['classId'],
    importantPayloadFields: ['classId', 'featureIds', 'progression'],
    relationFields: ['classId', 'featureIds', 'progression[].featureIds']
  },
  species: {
    kind: 'species',
    purpose: 'Espécie e relações com species features.',
    requiredPayloadFields: [],
    importantPayloadFields: ['creatureType', 'speed', 'size', 'featureIds', 'engineKey'],
    relationFields: ['featureIds']
  },
  background: {
    kind: 'background',
    purpose: 'Background normal e metadados necessários para o fluxo de custom background.',
    requiredPayloadFields: [],
    importantPayloadFields: ['abilityScoreOptions', 'abilityScoreIncreaseRule', 'featIds', 'featChoice', 'skillProficiencies', 'skillProficiencyChoice', 'toolProficiencies', 'toolProficiencyChoice', 'languageProficiencies', 'languageProficiencyChoice', 'equipmentOptions', 'grantsFeatureIds', 'engineKey'],
    relationFields: ['featIds', 'grantsFeatureIds', 'equipmentOptions.*.itemIds']
  },
  feat: {
    kind: 'feat',
    purpose: 'Feat, incluindo Origin Feats e escolhas/mecânicas associadas.',
    requiredPayloadFields: [],
    importantPayloadFields: ['category', 'prerequisite', 'abilityScoreIncrease', 'repeatable', 'featureIds', 'mechanics', 'grantsActions', 'effectTemplates'],
    relationFields: ['featureIds', 'prerequisite.*Ids']
  },
  weapon: {
    kind: 'weapon',
    purpose: 'Arma usada por criação, custom background e cálculo de combate.',
    requiredPayloadFields: ['weaponType', 'damageFormula'],
    importantPayloadFields: ['weaponCategory', 'weaponType', 'attackAbility', 'damageAbility', 'damageFormula', 'damageDie', 'damageType', 'properties', 'mastery', 'range', 'versatileDamageFormula', 'magicBonus', 'attacksCount', 'cost', 'weight'],
    relationFields: []
  },
  armor: {
    kind: 'armor',
    purpose: 'Armadura/escudo com cálculo de AC e custo estruturado.',
    requiredPayloadFields: ['baseAC'],
    importantPayloadFields: ['armorCategory', 'baseAC', 'dexCap', 'acBonus', 'strengthRequirement', 'stealthDisadvantage', 'stacksWithArmor', 'weight', 'cost'],
    relationFields: []
  },
  equipment: {
    kind: 'equipment',
    purpose: 'Equipamento geral elegível para inventário/background.',
    requiredPayloadFields: [],
    importantPayloadFields: ['quantity', 'weight', 'cost', 'equipmentCategory', 'tags', 'grantsActions', 'effectTemplates'],
    relationFields: []
  },
  magicItem: {
    kind: 'magicItem',
    purpose: 'Item mágico com efeitos, ações e modificadores.',
    requiredPayloadFields: [],
    importantPayloadFields: ['quantity', 'weight', 'cost', 'equipmentCategory', 'rarity', 'attunement', 'magicBonus', 'grantsActions', 'effectTemplates'],
    relationFields: []
  },
  spell: {
    kind: 'spell',
    purpose: 'Magia/cantrip e todos os dados consumidos por seleção e cálculo.',
    requiredPayloadFields: ['level', 'classes', 'castingTime'],
    importantPayloadFields: ['level', 'school', 'classes', 'classIds', 'castingTime', 'range', 'duration', 'components', 'specificMaterial', 'ritual', 'concentration', 'requiresAttackRoll', 'saveAbility', 'damageFormula', 'damageType', 'healingFormula', 'targets', 'area', 'consumesSpellSlot', 'minimumSlotLevel', 'scaling', 'damageOnSaveSuccess', 'grantsActions', 'effectTemplates', 'engineKey'],
    relationFields: ['classIds']
  },
  feature: {
    kind: 'feature',
    purpose: 'Feature de classe/subclasse/espécie/invocation e outras mecânicas de primeira classe.',
    requiredPayloadFields: ['sourceType'],
    importantPayloadFields: ['sourceType', 'classId', 'subclassId', 'speciesId', 'levelGained', 'actionCost', 'actionTiming', 'prerequisite', 'requiresConcentration', 'damageFormula', 'damageType', 'conditionalDamage', 'resource', 'consumes', 'grantsActions', 'effectTemplates', 'oncePerTurnKey', 'engineKey', 'mechanics'],
    relationFields: ['classId', 'subclassId', 'speciesId', 'prerequisite.*Ids']
  },
  condition: {
    kind: 'condition',
    purpose: 'Condição canônica referenciável por ações, efeitos e criaturas.',
    requiredPayloadFields: ['conditionId'],
    importantPayloadFields: ['conditionId', 'officialCondition', 'tags', 'effects', 'endConditions', 'engineNotes'],
    relationFields: []
  },
  creatureStatBlock: {
    kind: 'creatureStatBlock',
    purpose: 'Stat block para monsters, Wild Shape, Polymorph, familiars, summons e companions.',
    requiredPayloadFields: ['size', 'creatureType', 'armorClass', 'hitPoints', 'speed'],
    importantPayloadFields: ['size', 'creatureType', 'alignment', 'armorClass', 'hitPoints', 'speed', 'challenge', 'proficiencyBonus', 'abilities', 'savingThrows', 'skills', 'resistances', 'vulnerabilities', 'immunities', 'senses', 'languages', 'traits', 'actions', 'bonusActions', 'reactions', 'mechanics', 'engineKey'],
    relationFields: ['actions[].conditionIds', 'bonusActions[].conditionIds', 'reactions[].conditionIds']
  }
};

export interface BuildImportSchemaDocumentationOptions {
  format?: 'markdown' | 'prompt';
  includeEntityDetails?: boolean;
}

const bullet = (values: readonly string[]): string => values.map((value) => `- ${value}`).join('\n');

export const buildImportSchemaDocumentation = (options: BuildImportSchemaDocumentationOptions = {}): string => {
  const format = options.format ?? 'markdown';
  const includeEntityDetails = options.includeEntityDetails ?? true;
  const compact = format === 'prompt';
  const lines: string[] = [
    compact ? `Schema canônico: ${IMPORT_TEMPLATE_VERSION_V2}` : `# D&D Combat Math — Compendium Import V2`,
    '',
    `TemplateVersion: ${IMPORT_TEMPLATE_VERSION_V2}`,
    `Entity kinds: ${COMPENDIUM_ENTITY_KINDS.join(', ')}`,
    `Abilities: ${ABILITY_SCORES.join(', ')}`,
    `Action costs: ${ACTION_COSTS.join(', ')}`,
    `Skills: ${SKILLS.join(', ')}`,
    `Damage types: ${DAMAGE_TYPES.join(', ')}`,
    `Currency units: ${CURRENCY_UNITS.join(', ')}`,
    'Item metadata: opcional; use somente para proveniência/editorial fora de payload. `_importMeta` legado migra para metadata.legacyImport.',
    '',
    compact ? 'Regras de ID:' : '## Estratégia de IDs',
    bullet(IMPORT_V2_ID_STRATEGY),
    '',
    compact ? 'Semântica de merge:' : '## Merge / upsert',
    bullet(IMPORT_V2_MERGE_SEMANTICS)
  ];

  if (includeEntityDetails) {
    lines.push('', compact ? 'Payloads por kind:' : '## Payloads por kind');
    for (const kind of COMPENDIUM_ENTITY_KINDS) {
      const entry = IMPORT_V2_ENTITY_DOCUMENTATION[kind];
      lines.push('', compact ? `${kind}: ${entry.purpose}` : `### ${kind}`, compact ? '' : entry.purpose);
      if (entry.requiredPayloadFields.length) lines.push(`Obrigatórios: ${entry.requiredPayloadFields.join(', ')}`);
      lines.push(`Campos principais: ${entry.importantPayloadFields.join(', ') || '(nenhum obrigatório além do domínio base)'}`);
      if (entry.relationFields.length) lines.push(`Relações por ID: ${entry.relationFields.join(', ')}`);
    }
  }

  return lines.filter((line, index, all) => !(line === '' && all[index - 1] === '')).join('\n');
};

/**
 * JSON Schema is derived directly from the Zod schema used by the importer.
 * This prevents importer/schema documentation drift.
 */
export const buildImportV2JsonSchema = (): Record<string, unknown> => {
  const generated = z.toJSONSchema(compendiumImportV2Schema, { target: 'draft-7' }) as Record<string, unknown>;
  return {
    ...generated,
    $id: 'https://dnd-combat-math.local/schemas/dnd-combat-import-v2.schema.json',
    title: 'D&D Combat Math Import V2',
    description: 'Canonical serializable representation of the D&D Combat Math compendium domain.',
    examples: []
  };
};

export const buildImportV2JsonSchemaText = (): string => JSON.stringify(buildImportV2JsonSchema(), null, 2);
