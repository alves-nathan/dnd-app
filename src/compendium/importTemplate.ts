import type { RuleValidationIssue } from '../types';
import type { CompendiumEntityKind, CompendiumImportSource } from './importDomain';
import { buildImportSchemaDocumentation } from './importV2Documentation';
import type { CompendiumImportItemV2Input, CompendiumImportV2Input } from './importV2Schemas';
import { parseImportPack } from './parseImportPack';
import { IMPORT_TEMPLATE_VERSION_V2, LEGACY_IMPORT_TEMPLATE_VERSION_V1 } from './importVersions';

/** New templates and extractor prompts always target V2. V1 remains import-compatible. */
export const STANDARD_IMPORT_TEMPLATE_VERSION = IMPORT_TEMPLATE_VERSION_V2;
export { IMPORT_TEMPLATE_VERSION_V2, LEGACY_IMPORT_TEMPLATE_VERSION_V1 };

export type StandardImportFormat = 'json' | 'markdown';

export interface StandardImportTemplateOptions {
  packId?: string;
  sourceId?: string;
  book?: string;
  page?: string;
  version?: string;
  publisher?: string;
  rulesEra?: '2024' | 'legacy';
  contentType?: 'official' | 'third-party' | 'homebrew';
  includeExamples?: boolean;
  includeAllTypes?: boolean;
}

export interface ExtractorPromptOptions extends StandardImportTemplateOptions {
  sourceName?: string;
  outputFormat?: StandardImportFormat;
  language?: 'pt-BR' | 'en-US';
}

export interface StandardImportTemplateValidation {
  ok: boolean;
  data?: CompendiumImportV2Input;
  issues: RuleValidationIssue[];
}

interface TemplateItemBlueprint {
  kind: CompendiumEntityKind;
  id: string;
  name: string;
  summary: string;
  payload: CompendiumImportItemV2Input['payload'];
  notes: string[];
}

const defaultSource = (options: StandardImportTemplateOptions = {}): CompendiumImportSource => ({
  id: options.sourceId ?? 'source-id-slug',
  book: options.book ?? 'Nome do livro/fonte legalmente obtida',
  page: options.page ?? 'página ou intervalo',
  version: options.version ?? '2024',
  status: 'needsReview',
  confidence: 'importedNeedsReview',
  publisher: options.publisher,
  rulesEra: options.rulesEra ?? '2024',
  contentType: options.contentType ?? 'official',
  notes: 'Extração inicial. Revise manualmente contra a fonte antes de validar para uso automático.'
});

/**
 * Representative V2 examples. They are intentionally connected by canonical IDs
 * so the same structural + semantic validators used by imports can validate the template.
 */
export const itemBlueprints: TemplateItemBlueprint[] = [
  {
    kind: 'class',
    id: 'source-2024-class-example-class',
    name: 'Example Class',
    summary: 'Exemplo de classe com progressão, proficiências, recurso e spellcasting.',
    payload: {
      hitDie: 8,
      primaryAbilities: ['INT'],
      savingThrowProficiencies: ['INT', 'WIS'],
      skillChoiceCount: 2,
      skillProficienciesChoice: { count: 2, from: 'skills', options: ['Arcana', 'History', 'Investigation'] },
      weaponProficiencies: ['Simple weapons'],
      armorTraining: [],
      toolProficiencies: [],
      featureIds: ['source-2024-feature-example-feature'],
      progression: [{ level: 1, featureIds: ['source-2024-feature-example-feature'] }],
      spellcasting: {
        ability: 'INT',
        progression: 'full',
        preparationSource: 'prepared',
        cantripsKnownByLevel: [3],
        preparedSpellsByLevel: [4],
        slotsByLevel: { '1': { '1': 2 } },
        ritualCasting: true,
        spellcastingFocus: ['Arcane Focus']
      },
      resources: [{ id: 'example-resource', name: 'Example Resource', max: 1, recharge: 'longRest' }],
      equipmentOptions: {
        A: { label: 'Pacote A', itemIds: ['source-2024-equipment-example-kit'], currency: [{ amount: 10, unit: 'GP' }] }
      },
      extractionNotes: ['Use IDs de features/equipamentos; não guarde progressão apenas na descrição.']
    },
    notes: ['Classes devem preservar progression, spellcasting, proficiências, resources e equipmentOptions usados pelo runtime.']
  },
  {
    kind: 'feature',
    id: 'source-2024-feature-example-feature',
    name: 'Example Feature',
    summary: 'Exemplo de feature com ownership, ação e recurso.',
    payload: {
      sourceType: 'classFeature',
      classId: 'source-2024-class-example-class',
      levelGained: 1,
      actionCost: 'bonusAction',
      resource: { id: 'feature-use', name: 'Feature Use', max: 1, recharge: 'longRest' },
      grantsActions: [{ type: 'utility', name: 'Use Example Feature', actionCost: 'bonusAction', consumes: [{ resourceId: 'feature-use', amount: 1 }] }],
      mechanics: { note: 'Extensão somente para mecânicas ainda não promovidas a campos tipados.' },
      extractionNotes: ['Mantenha sourceType e ownership por ID.']
    },
    notes: ['Eldritch Invocations podem continuar como feature especializada via sourceType quando essa for a estrutura do runtime.']
  },
  {
    kind: 'spell',
    id: 'source-2024-spell-example-bolt',
    name: 'Example Bolt',
    summary: 'Exemplo de cantrip ofensivo com scaling por nível.',
    payload: {
      level: 0,
      school: 'Evocation',
      classes: ['Example Class'],
      classIds: ['source-2024-class-example-class'],
      castingTime: { kind: 'action', actionCost: 'action', original: '1 Action' },
      range: '120 ft',
      duration: 'Instantaneous',
      components: 'V, S',
      ritual: false,
      concentration: false,
      requiresAttackRoll: true,
      damageFormula: '1d10',
      damageType: 'fire',
      targets: 1,
      consumesSpellSlot: false,
      minimumSlotLevel: 0,
      scaling: {
        kind: 'characterLevel',
        steps: [
          { level: 1, damageFormula: '1d10' },
          { level: 5, damageFormula: '2d10' },
          { level: 11, damageFormula: '3d10' },
          { level: 17, damageFormula: '4d10' }
        ]
      },
      extractionNotes: ['classes e classIds devem ser explícitos; não inferir lista de magia por descrição.']
    },
    notes: ['Use level 0 para cantrip. Para saving throw, preencha saveAbility e requiresAttackRoll=false.']
  },
  {
    kind: 'background',
    id: 'source-2024-background-example-background',
    name: 'Example Background',
    summary: 'Exemplo de background 2024 com proficiências, Origin Feat e equipamento.',
    payload: {
      abilityScoreOptions: ['DEX', 'INT', 'WIS'],
      abilityScoreIncreaseRule: {
        chooseOnePlus2AndDifferentOnePlus1: true,
        orIncreaseAllBy1: true,
        maximumScoreAfterIncrease: 20
      },
      featIds: ['source-2024-feat-example-origin-feat'],
      skillProficiencies: ['Investigation', 'Perception'],
      toolProficiencies: ['Thieves\' Tools'],
      equipmentOptions: {
        A: { label: 'Equipamento sugerido', itemIds: ['source-2024-equipment-example-kit'], currency: [{ amount: 15, unit: 'GP' }] }
      },
      extractionNotes: ['Proficiências concedidas diretamente não devem ser convertidas em choices.']
    },
    notes: ['O conteúdo importado deve trazer metadados suficientes para também alimentar o fluxo de custom background.']
  },
  {
    kind: 'feat',
    id: 'source-2024-feat-example-origin-feat',
    name: 'Example Origin Feat',
    summary: 'Exemplo de Origin Feat com choices estruturadas em mechanics.',
    payload: {
      category: 'Origin',
      prerequisite: '',
      repeatable: false,
      featureIds: [],
      mechanics: {
        proficiencyChoice: { count: 1, from: 'tools' }
      },
      extractionNotes: ['Choices conhecidas devem ser estruturadas em mechanics; evite depender de regex em descrição.']
    },
    notes: ['Origin Feats precisam ser identificáveis para listagem em backgrounds normais e customizados.']
  },
  {
    kind: 'equipment',
    id: 'source-2024-equipment-example-kit',
    name: 'Example Kit',
    summary: 'Exemplo de equipamento geral com custo estruturado.',
    payload: {
      quantity: 1,
      weight: 2,
      cost: { amount: 5, unit: 'GP' },
      equipmentCategory: 'Adventuring Gear',
      tags: ['background-eligible'],
      extractionNotes: ['Preço usado em cálculo deve ser CurrencyValue, não string.']
    },
    notes: ['Custom background usa cost estruturado para o orçamento de 50 GP.']
  },
  {
    kind: 'weapon',
    id: 'source-2024-weapon-example-spear',
    name: 'Example Spear',
    summary: 'Exemplo de arma simples elegível para custom background.',
    payload: {
      weaponCategory: 'simple',
      weaponType: 'melee',
      actionCost: 'action',
      attackAbility: 'STR',
      damageAbility: 'STR',
      damageFormula: '1d6 + STR',
      damageDie: '1d6',
      damageType: 'piercing',
      properties: ['Thrown', 'Versatile'],
      range: { normal: 20, long: 60, unit: 'ft' },
      versatileDamageFormula: '1d8 + STR',
      magicBonus: 0,
      attacksCount: 1,
      cost: { amount: 1, unit: 'GP' },
      weight: 3
    },
    notes: ['weaponCategory simple/martial é regra de domínio e deve estar estruturada.']
  },
  {
    kind: 'armor',
    id: 'source-2024-armor-example-leather',
    name: 'Example Leather Armor',
    summary: 'Exemplo de armadura com AC e custo estruturados.',
    payload: {
      armorCategory: 'light',
      baseAC: 11,
      dexCap: null,
      acBonus: 0,
      strengthRequirement: 0,
      stealthDisadvantage: false,
      weight: 10,
      cost: { amount: 10, unit: 'GP' }
    },
    notes: ['Shield pode usar baseAC 0 + acBonus quando esse for o modelo do runtime.']
  },
  {
    kind: 'subclass',
    id: 'source-2024-subclass-example-subclass',
    name: 'Example Subclass',
    summary: 'Exemplo de subclasse com classId explícito.',
    payload: {
      classId: 'source-2024-class-example-class',
      featureIds: [],
      progression: []
    },
    notes: ['Nunca relacione subclass à classe apenas pelo nome.']
  },
  {
    kind: 'species',
    id: 'source-2024-species-example-species',
    name: 'Example Species',
    summary: 'Exemplo de espécie com velocidade e featureIds.',
    payload: {
      creatureType: 'Humanoid',
      speed: 30,
      size: 'Medium',
      featureIds: [],
      engineKey: 'species.example'
    },
    notes: ['Species features devem ser referenciadas por IDs quando existirem como entidades feature.']
  },
  {
    kind: 'magicItem',
    id: 'source-2024-magic-item-example-item',
    name: 'Example Magic Item',
    summary: 'Exemplo de item mágico.',
    payload: {
      quantity: 1,
      weight: 1,
      cost: { amount: 100, unit: 'GP' },
      equipmentCategory: 'Magic Item',
      rarity: 'uncommon',
      attunement: true,
      magicBonus: 1,
      grantsActions: [],
      effectTemplates: []
    },
    notes: ['Ações e efeitos concedidos devem usar estruturas compartilhadas.']
  },
  {
    kind: 'condition',
    id: 'source-2024-condition-example-condition',
    name: 'Example Condition',
    summary: 'Exemplo de condição canônica referenciável.',
    payload: {
      conditionId: 'source-2024-condition-example-condition',
      officialCondition: false,
      tags: ['example'],
      effects: [],
      endConditions: [],
      engineNotes: 'Exemplo estrutural sem regra inventada.'
    },
    notes: ['Spells/features/creatures devem referenciar conditionIds quando aplicável.']
  },
  {
    kind: 'creatureStatBlock',
    id: 'source-2024-creature-example-creature',
    name: 'Example Creature',
    summary: 'Exemplo mínimo de stat block para summons/familiars/Polymorph.',
    payload: {
      size: 'Medium',
      creatureType: 'Beast',
      alignment: 'Unaligned',
      armorClass: { value: 12 },
      hitPoints: { average: 11, formula: '2d8 + 2' },
      speed: { walk: 30 },
      challenge: '1/2',
      proficiencyBonus: 2,
      abilities: { STR: 12, DEX: 14, CON: 12, INT: 3, WIS: 12, CHA: 6 },
      savingThrows: {},
      skills: {},
      resistances: [],
      vulnerabilities: [],
      immunities: { damage: [], conditions: [] },
      senses: 'Passive Perception 11',
      languages: [],
      traits: [],
      actions: [],
      bonusActions: [],
      reactions: [],
      mechanics: {},
      engineKey: 'creature.example'
    },
    notes: ['Use o mesmo stat block para monsters, Wild Shape, Polymorph, familiars, summons e companions.']
  }
];

const minimalBlueprintKinds: CompendiumEntityKind[] = ['class', 'feature', 'spell', 'background', 'feat', 'equipment'];

export type StandardImportTemplateObject = CompendiumImportV2Input & {
  extractionInstructions: Record<string, unknown>;
};

export const buildStandardImportJsonObject = (options: StandardImportTemplateOptions = {}): StandardImportTemplateObject => {
  const source = defaultSource(options);
  const selectedBlueprints = options.includeAllTypes === false
    ? itemBlueprints.filter((blueprint) => minimalBlueprintKinds.includes(blueprint.kind))
    : itemBlueprints;
  const includeExamples = options.includeExamples ?? true;

  return {
    templateVersion: IMPORT_TEMPLATE_VERSION_V2,
    id: options.packId ?? 'pack-id-slug',
    source,
    metadata: {
      generatedBy: 'D&D Combat Math import template',
      schema: IMPORT_TEMPLATE_VERSION_V2,
      reviewRequired: true
    },
    extractionInstructions: {
      rule: 'Extraia somente dados mecânicos necessários ao domínio. Não copie blocos longos de texto protegido e não invente regras ausentes.',
      review: 'Conteúdo extraído por IA deve começar como needsReview/importedNeedsReview até revisão humana.',
      ids: 'Use IDs estáveis e determinísticos. Relações devem usar IDs, não nomes, quando o ID existir.',
      unknownData: 'Preserve informação desconhecida em extractionNotes/mechanics quando necessário; não a descarte silenciosamente.',
      canonicalSchemaDocumentation: buildImportSchemaDocumentation({ format: 'prompt', includeEntityDetails: false })
    },
    items: includeExamples
      ? selectedBlueprints.map((blueprint) => ({
          id: blueprint.id,
          kind: blueprint.kind,
          name: blueprint.name,
          summary: blueprint.summary,
          source,
          payload: {
            ...blueprint.payload,
            extractionNotes: Array.from(new Set([...(Array.isArray((blueprint.payload as { extractionNotes?: string[] }).extractionNotes) ? (blueprint.payload as { extractionNotes?: string[] }).extractionNotes ?? [] : []), ...blueprint.notes]))
          }
        })) as CompendiumImportItemV2Input[]
      : []
  };
};

export const buildStandardImportJsonTemplate = (options: StandardImportTemplateOptions = {}): string =>
  JSON.stringify(buildStandardImportJsonObject(options), null, 2);

export const buildStandardImportMarkdownTemplate = (options: StandardImportTemplateOptions = {}): string => {
  const source = defaultSource(options);
  const blueprints = options.includeAllTypes === false
    ? itemBlueprints.filter((blueprint) => minimalBlueprintKinds.includes(blueprint.kind))
    : itemBlueprints;
  const header = [
    `# ${options.packId ?? 'pack-id-slug'}`,
    '',
    `TemplateVersion: ${IMPORT_TEMPLATE_VERSION_V2}`,
    `SourceId: ${source.id}`,
    `Book: ${source.book ?? ''}`,
    `Page: ${source.page ?? ''}`,
    `Version: ${source.version ?? ''}`,
    `RulesEra: ${source.rulesEra ?? ''}`,
    `ContentType: ${source.contentType ?? ''}`,
    `Status: ${source.status}`,
    `Confidence: ${source.confidence}`,
    '',
    'Instruções:',
    '- Produza ao final um envelope JSON dnd-combat-import.v2.',
    '- Extraia somente dados mecânicos necessários para cálculo/modelagem.',
    '- Não copie texto protegido longo.',
    '- Não invente regra ausente; registre dúvida em extractionNotes.',
    '- Use IDs estáveis/determinísticos e relações por ID.',
    ''
  ];

  const sections = blueprints.map((blueprint) => [
    `## ${blueprint.kind}: ${blueprint.name}`,
    `Id: ${blueprint.id}`,
    `Kind: ${blueprint.kind}`,
    `Summary: ${blueprint.summary}`,
    'Payload:',
    '```json',
    JSON.stringify(blueprint.payload, null, 2),
    '```',
    'Notas de extração:',
    ...blueprint.notes.map((note) => `- ${note}`),
    ''
  ].join('\n'));

  return [...header, ...sections].join('\n');
};

export const buildExtractorPrompt = (options: ExtractorPromptOptions = {}): string => {
  const format = options.outputFormat ?? 'json';
  const sourceName = options.sourceName ?? options.book ?? 'a fonte legalmente obtida fornecida pelo usuário';
  const template = format === 'markdown'
    ? buildStandardImportMarkdownTemplate(options)
    : buildStandardImportJsonTemplate(options);
  const schemaDocumentation = buildImportSchemaDocumentation({ format: 'prompt', includeEntityDetails: true });

  return [
    'Você é um extrator de dados mecânicos para o D&D Combat Math.',
    '',
    `Fonte a processar: ${sourceName}.`,
    '',
    'O código atual do app e o schema dnd-combat-import.v2 são a fonte de verdade.',
    'Não crie um domínio alternativo e não reduza entidades complexas a name/description.',
    '',
    'Regras obrigatórias:',
    '1. Extraia somente dados mecânicos necessários para criação, progressão, spellcasting, inventário e combate.',
    '2. Não reproduza trechos longos, lore, exemplos narrativos ou texto protegido extenso.',
    '3. Não invente regra. Dados ambíguos devem permanecer needsReview/importedNeedsReview e ser registrados em extractionNotes.',
    '4. Preserve source, página, version, rulesEra e contentType quando disponíveis.',
    '5. Use IDs estáveis/determinísticos; referências entre entidades devem usar IDs quando disponíveis.',
    '6. Não deduplique apenas por nome e não sobrescreva conteúdo 2024 com Legacy.',
    '7. Use CurrencyValue estruturado para custos usados em cálculo.',
    '8. Use valores canônicos para abilities, skills, action costs e damage types.',
    '9. Preserve mechanics como escape hatch somente para regra ainda não formalizada; campos conhecidos devem usar propriedades tipadas.',
    '10. Responda somente no formato solicitado, sem comentários fora do envelope/template.',
    '',
    schemaDocumentation,
    '',
    `Responda somente com ${format === 'json' ? 'JSON válido' : 'Markdown estruturado'} seguindo este exemplo validado pelo mesmo schema do importador:`,
    '',
    template
  ].join('\n');
};

export const validateStandardImportTemplateJson = (input: string): StandardImportTemplateValidation => {
  const parsed = parseImportPack(input);
  return { ok: parsed.ok, data: parsed.data, issues: parsed.issues };
};

export const importTemplateFileNameFor = (format: StandardImportFormat): string =>
  format === 'json' ? 'dnd-combat-import-v2.template.json' : 'dnd-combat-import-v2.template.md';
