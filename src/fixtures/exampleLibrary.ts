import type {
  ActiveEffect,
  AttackAction,
  Character,
  CombatScenario,
  DamageComponent,
  DamageFormula,
  Feature,
  ResourcePool,
  RuleSource,
  Spell,
  SpellSlotPool,
  TurnAction,
  TurnRotation,
  Weapon
} from '../types';
import type { CompendiumImportInput } from '../compendium/schemas';
import type { BuildPreset } from '../presets/buildPresets';
import type { BuildHistorySnapshot } from '../types';
import { parseDamageFormula } from '../rules-engine/dice/parser';
import { createCombatScenario, compareRotationsForScenario } from '../rules-engine/turns/compareRotations';
import { createBuildHistorySnapshot } from '../history/buildHistory';
import { createBuildPresetFromCharacter } from '../presets/buildPresets';
import { createCharacterDataBackup, type CharacterBackupPayload } from '../backup/characterBackup';

export const EXAMPLE_LIBRARY_VERSION = 'dnd-combat-examples.v1';
export const EXAMPLE_LIBRARY_IMPORTED_AT = '2026-07-11T12:00:00.000Z';

export interface ExampleLibraryBundle {
  characters: Character[];
  scenarios: CombatScenario[];
  buildPresets: BuildPreset[];
  buildHistorySnapshots: BuildHistorySnapshot[];
  compendiumImport: CompendiumImportInput;
  characterBackup: CharacterBackupPayload;
}

export interface ExampleLibrarySummary {
  characterCount: number;
  scenarioCount: number;
  presetCount: number;
  historySnapshotCount: number;
  compendiumItemCount: number;
  highlights: string[];
}

export const exampleRuleSource: RuleSource = {
  id: 'example-library-source',
  book: 'Example Library',
  page: '-',
  version: EXAMPLE_LIBRARY_VERSION,
  status: 'active',
  confidence: 'manual',
  notes: 'Conteúdo fictício de demonstração. Não representa regra oficial embutida.'
};

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

const now = EXAMPLE_LIBRARY_IMPORTED_AT;

const conditionalFormula = (raw: string, conditionId: string, conditionLabel: string, sourceType: DamageComponent['sourceType']): DamageFormula => ({
  ...parseDamageFormula(raw, { defaultSourceType: sourceType, application: 'conditional' }),
  components: parseDamageFormula(raw, { defaultSourceType: sourceType, application: 'conditional' }).components.map((component) => ({
    ...component,
    id: `${component.id}_${conditionId}`,
    condition: { id: conditionId, label: conditionLabel, defaultEnabled: false }
  }))
});

const appendFormula = (base: DamageFormula, extra: DamageFormula): DamageFormula => ({
  raw: `${base.raw} + ${extra.raw}`,
  components: [...base.components, ...extra.components],
  unresolvedTokens: [...(base.unresolvedTokens ?? []), ...(extra.unresolvedTokens ?? [])].length
    ? [...(base.unresolvedTokens ?? []), ...(extra.unresolvedTokens ?? [])]
    : undefined
});

const turnAction = (id: string, action: AttackAction): TurnAction => ({
  id,
  name: action.name,
  actionCost: action.actionCost,
  action,
  actionRef: action.origin
});

const resource = (id: string, name: string, max: number, recharge: ResourcePool['recharge'], current = max): ResourcePool => ({
  id,
  name,
  max,
  current,
  recharge,
  source: exampleRuleSource,
  notes: 'Recurso fictício usado para testar consumo, descanso e validação.'
});

const slot = (level: SpellSlotPool['level'], max: number, current = max): SpellSlotPool => ({
  level,
  max,
  current,
  recharge: 'longRest',
  source: exampleRuleSource,
  notes: 'Slot fictício para testar consumo e upcasting.'
});

const createStrikerCharacter = (): Character => {
  const weapon: Weapon = {
    id: 'fx_weapon_training_blade',
    name: 'Lâmina de Treino Balanceada',
    weaponType: 'melee',
    attackAbility: 'STR',
    damageAbility: 'STR',
    magicBonus: 1,
    damage: parseDamageFormula('1d8 + STR + 1', { defaultSourceType: 'weapon' }),
    actionCost: 'action',
    attacksCount: 2,
    properties: ['versatile-test'],
    mastery: 'push-test',
    source: exampleRuleSource
  };

  const offhand: Weapon = {
    id: 'fx_weapon_offhand_spark',
    name: 'Adaga de Faísca de Teste',
    weaponType: 'finesse',
    attackAbility: 'DEX',
    damageAbility: 'DEX',
    damage: parseDamageFormula('1d4 + DEX', { defaultSourceType: 'weapon' }),
    actionCost: 'bonusAction',
    attacksCount: 1,
    source: exampleRuleSource
  };

  const focusResource = resource('fx_resource_focus', 'Foco de Teste', 3, 'shortRest', 3);
  const markedCondition = 'fx_condition_marked';
  const markedExtra = conditionalFormula('1d6', markedCondition, 'Alvo marcado pelo exemplo', 'condition');
  const burstDamage = appendFormula(parseDamageFormula('1d8 + STR', { defaultSourceType: 'classFeature' }), conditionalFormula('2d6', 'fx_condition_spend_focus', 'Gasta Foco de Teste', 'classFeature'));

  const burstAction: AttackAction = {
    id: 'fx_action_focus_burst',
    type: 'attack',
    name: 'Golpe de Foco de Exemplo',
    actionCost: 'special',
    sourceType: 'classFeature',
    source: exampleRuleSource,
    attackAbility: 'STR',
    attacksCount: 1,
    damage: burstDamage,
    consumes: [{ resourceId: focusResource.id, amount: 1, label: focusResource.name, oncePerTurnKey: 'fx_focus_burst_once' }],
    tags: ['fixture', 'resource', 'burst'],
    origin: { kind: 'featureGrant', entityType: 'feature', entityId: 'fx_feature_focus_burst' }
  };

  const extraAttackFeature: Feature = {
    id: 'fx_feature_extra_attack',
    name: 'Extra Attack de Teste',
    sourceType: 'classFeature',
    source: exampleRuleSource,
    summary: 'A classe marcial fictícia pode realizar dois ataques com a Ação de Ataque.',
    attackActionAttackCount: 2
  };

  const feature: Feature = {
    id: 'fx_feature_focus_burst',
    name: 'Explosão de Foco de Teste',
    sourceType: 'classFeature',
    source: exampleRuleSource,
    summary: 'Feature fictícia para validar dano condicional, recurso limitado e once-per-turn.',
    resource: focusResource,
    oncePerTurnKey: 'fx_focus_burst_once',
    grantsActions: [burstAction],
    effectTemplates: [
      {
        id: 'fx_template_marked_target',
        name: 'Marca de Teste',
        kind: 'feature',
        sourceType: 'classFeature',
        source: exampleRuleSource,
        concentration: false,
        conditionIds: [markedCondition],
        duration: { unit: 'round', remaining: 10, expiresOn: 'turnStart' },
        notes: 'Ativa o dano condicional de marcação nas rotações de exemplo.'
      }
    ]
  };

  const markedWeapon: Weapon = {
    ...weapon,
    id: 'fx_weapon_marked_blade',
    name: 'Lâmina com Dano Condicional de Teste',
    damage: appendFormula(weapon.damage, markedExtra)
  };

  const attackAction: AttackAction = {
    id: 'attack_fx_weapon_training_blade',
    type: 'attack',
    name: weapon.name,
    actionCost: 'action',
    sourceType: 'weapon',
    source: exampleRuleSource,
    weaponId: weapon.id,
    attackAbility: 'STR',
    attackBonusExtra: weapon.magicBonus,
    damage: weapon.damage,
    attacksCount: 2,
    tags: ['fixture', 'weapon']
  };

  const markedAttackAction: AttackAction = {
    ...attackAction,
    id: 'attack_fx_weapon_marked_blade',
    name: markedWeapon.name,
    weaponId: markedWeapon.id,
    damage: markedWeapon.damage
  };

  const offhandAction: AttackAction = {
    id: 'attack_fx_weapon_offhand_spark',
    type: 'attack',
    name: offhand.name,
    actionCost: 'bonusAction',
    sourceType: 'weapon',
    source: exampleRuleSource,
    weaponId: offhand.id,
    attackAbility: 'DEX',
    damage: offhand.damage,
    attacksCount: 1,
    tags: ['fixture', 'bonus-action']
  };

  const rotations: TurnRotation[] = [
    {
      id: 'fx_rot_striker_basic',
      characterId: 'fx_char_striker',
      name: 'Básico: duas estocadas',
      favorite: true,
      actions: [turnAction('fx_turn_basic_weapon', attackAction)],
      notes: 'Teste de múltiplos ataques em uma única ação.'
    },
    {
      id: 'fx_rot_striker_marked',
      characterId: 'fx_char_striker',
      name: 'Marcado: ação + bônus',
      favorite: true,
      actions: [
        { ...turnAction('fx_turn_marked_weapon', markedAttackAction), enabledConditionIds: [markedCondition], weaponOperation: { kind: 'swap', weaponId: markedWeapon.id, offHandWeaponId: offhand.id } },
        turnAction('fx_turn_offhand', offhandAction)
      ],
      notes: 'Teste de ação + ação bônus e dano condicional ativado.'
    },
    {
      id: 'fx_rot_striker_focus_burst',
      characterId: 'fx_char_striker',
      name: 'Explosão com recurso',
      actions: [{ ...turnAction('fx_turn_focus_burst', burstAction), enabledConditionIds: ['fx_condition_spend_focus'] }],
      notes: 'Teste de recurso limitado, once-per-turn e dano condicionado por recurso.'
    }
  ];

  const activeEffect: ActiveEffect = {
    id: 'fx_effect_marked_target',
    name: 'Marca de Teste Ativa',
    kind: 'feature',
    sourceType: 'classFeature',
    source: exampleRuleSource,
    status: 'active',
    concentration: false,
    conditionIds: [markedCondition],
    duration: { unit: 'round', remaining: 6, expiresOn: 'turnStart' },
    notes: 'Efeito ativo fictício para demonstrar condições persistentes.',
    templateId: 'fx_template_marked_target',
    createdAt: now
  };

  return {
    id: 'fx_char_striker',
    name: 'Ari, Duelista de Teste',
    level: 5,
    classes: [{ id: 'fx_class_striker', name: 'Classe Marcial Fictícia', level: 5, hitDie: 10, source: exampleRuleSource }],
    subclasses: [],
    proficiencies: { skills: [], expertiseSkills: [], tools: [], weapons: [], armor: [], languages: [], savingThrows: [] },
    abilities: { STR: 18, DEX: 14, CON: 14, INT: 10, WIS: 10, CHA: 12 },
    buildChoices: {
      speciesChoices: [], classSkillChoices: [], classToolChoices: [], expertiseSkills: [], languages: [],
      spellAssignments: {}, spellbookAssignments: {}, equipmentSelections: [],
      activeLoadout: { explicit: true, mainHandWeaponId: weapon.id, offHandWeaponId: offhand.id, armorAccessoryIds: [] }
    },
    weapons: [weapon, markedWeapon, offhand],
    equipment: [],
    magicItems: [],
    feats: [],
    spells: [],
    features: [extraAttackFeature, feature],
    resources: [focusResource],
    spellSlots: [],
    activeEffects: [activeEffect],
    rotations,
    compendiumLinks: [],
    resourceTransactions: [],
    spellSlotTransactions: [],
    activeEffectTransactions: [],
    notes: 'Personagem fictício para testar múltiplos ataques, ação bônus, dano condicional e recursos.'
  };
};

const createCasterCharacter = (): Character => {
  const cantrip: Spell = {
    id: 'fx_spell_scaling_spark',
    name: 'Centelha Escalável de Teste',
    level: 0,
    castingTime: 'action',
    requiresAttackRoll: true,
    damage: parseDamageFormula('1d10', { defaultSourceType: 'spell' }),
    scaling: {
      kind: 'characterLevel',
      steps: [
        { minCharacterLevel: 1, formula: parseDamageFormula('1d10', { defaultSourceType: 'spell' }) },
        { minCharacterLevel: 5, formula: parseDamageFormula('2d10', { defaultSourceType: 'spell' }) },
        { minCharacterLevel: 11, formula: parseDamageFormula('3d10', { defaultSourceType: 'spell' }) },
        { minCharacterLevel: 17, formula: parseDamageFormula('4d10', { defaultSourceType: 'spell' }) }
      ]
    },
    targeting: { targets: 1 },
    source: exampleRuleSource
  };

  const leveled: Spell = {
    id: 'fx_spell_upcast_burst',
    name: 'Rajada Escalonável de Teste',
    level: 1,
    castingTime: 'action',
    requiresAttackRoll: false,
    saveAbility: 'DEX',
    damage: parseDamageFormula('2d6', { defaultSourceType: 'spell', application: 'onSaveFail' }),
    scaling: {
      kind: 'slotLevel',
      baseLevel: 1,
      steps: [
        { slotLevel: 1, formula: parseDamageFormula('2d6', { defaultSourceType: 'spell', application: 'onSaveFail' }) },
        { slotLevel: 2, formula: parseDamageFormula('3d6', { defaultSourceType: 'spell', application: 'onSaveFail' }) },
        { slotLevel: 3, formula: parseDamageFormula('4d6', { defaultSourceType: 'spell', application: 'onSaveFail' }) }
      ]
    },
    targeting: { targets: 2, area: 'cone-test' },
    concentration: false,
    source: exampleRuleSource
  };

  const focus: Spell = {
    id: 'fx_spell_concentration_field',
    name: 'Campo de Concentração de Teste',
    level: 1,
    castingTime: 'bonusAction',
    requiresAttackRoll: false,
    damage: conditionalFormula('1d4', 'fx_condition_focus_field', 'Campo de concentração ativo', 'buff'),
    concentration: true,
    targeting: { targets: 1 },
    effectTemplates: [
      {
        id: 'fx_template_focus_field',
        name: 'Campo de Concentração de Teste',
        kind: 'spell',
        sourceType: 'spell',
        source: exampleRuleSource,
        concentration: true,
        conditionIds: ['fx_condition_focus_field'],
        duration: { unit: 'minute', remaining: 1, expiresOn: 'manual' },
        endsOnLongRest: true,
        notes: 'Template fictício para testar conflito de concentração e efeito persistente.'
      }
    ],
    source: exampleRuleSource
  };

  const cantripAction = {
    id: 'spell_fx_spell_scaling_spark',
    type: 'spell' as const,
    name: cantrip.name,
    actionCost: 'action' as const,
    sourceType: 'spell' as const,
    source: exampleRuleSource,
    spellId: cantrip.id,
    spellLevel: 0,
    damage: parseDamageFormula('2d10', { defaultSourceType: 'spell' }),
    targets: 1,
    tags: ['fixture', 'cantrip']
  };

  const upcastAction = {
    id: 'spell_fx_spell_upcast_burst',
    type: 'spell' as const,
    name: leveled.name,
    actionCost: 'action' as const,
    sourceType: 'spell' as const,
    source: exampleRuleSource,
    spellId: leveled.id,
    spellLevel: 1,
    minimumSlotLevel: 1 as const,
    castAtSlotLevel: 2 as const,
    consumesSpellSlot: true,
    damage: parseDamageFormula('3d6', { defaultSourceType: 'spell', application: 'onSaveFail' }),
    targets: 2,
    tags: ['fixture', 'spell-slot']
  };

  const focusAction = {
    id: 'spell_fx_spell_concentration_field',
    type: 'spell' as const,
    name: focus.name,
    actionCost: 'bonusAction' as const,
    sourceType: 'spell' as const,
    source: exampleRuleSource,
    spellId: focus.id,
    spellLevel: 1,
    minimumSlotLevel: 1 as const,
    castAtSlotLevel: 1 as const,
    consumesSpellSlot: true,
    concentration: true,
    damage: focus.damage,
    targets: 1,
    tags: ['fixture', 'concentration']
  };

  const rotations: TurnRotation[] = [
    {
      id: 'fx_rot_caster_cantrip',
      characterId: 'fx_char_caster',
      name: 'Cantrip escalável',
      favorite: true,
      actions: [{ id: 'fx_turn_cantrip', name: cantripAction.name, actionCost: 'action', action: cantripAction }],
      notes: 'Teste de scaling por nível total do personagem.'
    },
    {
      id: 'fx_rot_caster_upcast',
      characterId: 'fx_char_caster',
      name: 'Magia com slot 2º círculo',
      actions: [{ id: 'fx_turn_upcast', name: upcastAction.name, actionCost: 'action', action: upcastAction, selectedSpellSlotLevel: 2 }],
      notes: 'Teste de consumo de slot e upcasting explícito.'
    },
    {
      id: 'fx_rot_caster_bonus_concentration',
      characterId: 'fx_char_caster',
      name: 'Concentração + cantrip',
      actions: [
        { id: 'fx_turn_focus_field', name: focusAction.name, actionCost: 'bonusAction', action: focusAction, selectedSpellSlotLevel: 1, enabledConditionIds: ['fx_condition_focus_field'] },
        { id: 'fx_turn_cantrip_after_focus', name: cantripAction.name, actionCost: 'action', action: cantripAction }
      ],
      notes: 'Teste de ação bônus, ação e concentração na mesma rotação.'
    }
  ];

  return {
    id: 'fx_char_caster',
    name: 'Mira, Maga de Teste',
    level: 5,
    classes: [{ id: 'fx_class_caster', name: 'Classe Mágica Fictícia', level: 5, hitDie: 6, source: exampleRuleSource }],
    subclasses: [],
    proficiencies: { skills: [], expertiseSkills: [], tools: [], weapons: [], armor: [], languages: [], savingThrows: [] },
    abilities: { STR: 8, DEX: 14, CON: 14, INT: 18, WIS: 12, CHA: 10 },
    weapons: [],
    equipment: [],
    magicItems: [],
    feats: [],
    spells: [cantrip, leveled, focus],
    features: [],
    resources: [],
    spellSlots: [slot(1, 4, 4), slot(2, 3, 3), slot(3, 2, 2)],
    activeEffects: [],
    rotations,
    compendiumLinks: [],
    resourceTransactions: [],
    spellSlotTransactions: [],
    activeEffectTransactions: [],
    notes: 'Personagem fictício para testar cantrip escalável, upcasting, slots e concentração.'
  };
};

export const createExampleCharacters = (): Character[] => [createStrikerCharacter(), createCasterCharacter()];

export const createExampleScenarios = (characters: Character[]): CombatScenario[] =>
  characters.flatMap((character) => [
    createCombatScenario({
      id: `fx_scenario_${character.id}_raw`,
      characterId: character.id,
      name: 'Dano bruto sem CA',
      favorite: true,
      now,
      combatState: { targetCount: 1, rollMode: 'normal', resistanceMultiplier: 1, critRange: 20 },
      notes: 'Cenário de fixture para comparar dano bruto.'
    }),
    createCombatScenario({
      id: `fx_scenario_${character.id}_ac16_adv`,
      characterId: character.id,
      name: 'CA 16 com vantagem',
      now,
      combatState: { targetAC: 16, targetCount: character.id === 'fx_char_caster' ? 2 : 1, rollMode: 'advantage', resistanceMultiplier: 1, critRange: 20 },
      notes: 'Cenário de fixture para testar média ponderada por acerto e múltiplos alvos.'
    })
  ]);

export const createExampleBuildPresets = (characters: Character[]): BuildPreset[] =>
  characters.map((character) =>
    createBuildPresetFromCharacter(
      character,
      `${character.name} · preset fixture`,
      'Preset fictício gerado pela biblioteca de exemplos para validar merge/replace de builds.',
      ['fixture', 'example-library']
    )
  );

export const createExampleBuildHistorySnapshots = (characters: Character[], scenarios: CombatScenario[]): BuildHistorySnapshot[] =>
  characters.map((character) => {
    const scenario = scenarios.find((candidate) => candidate.characterId === character.id && candidate.favorite) ?? scenarios.find((candidate) => candidate.characterId === character.id)!;
    const comparison = compareRotationsForScenario(character.rotations, character, scenario);
    return createBuildHistorySnapshot({
      id: `fx_snapshot_${character.id}`,
      character,
      scenario,
      comparison,
      name: `${character.name} · snapshot fixture`,
      kind: 'manual',
      now,
      notes: 'Snapshot fictício para validar histórico de evolução e relatórios.'
    });
  });

export const exampleCompendiumImport: CompendiumImportInput = {
  id: 'example-library-compendium-pack',
  source: exampleRuleSource,
  items: [
    {
      id: 'example_weapon_balanced_blade',
      kind: 'weapon',
      name: 'Lâmina Balanceada de Exemplo',
      summary: 'Arma fictícia validada para demonstrar importação, mapeamento e ação de ataque.',
      source: exampleRuleSource,
      payload: {
        type: 'weapon',
        weaponType: 'melee',
        damageFormula: '1d8 + STR + 1',
        attackAbility: 'STR',
        damageAbility: 'STR',
        magicBonus: 1,
        actionCost: 'action',
        attacksCount: 2,
        mastery: 'example-mastery',
        properties: ['example', 'fixture']
      }
    },
    {
      id: 'example_spell_scaling_spark',
      kind: 'spell',
      name: 'Centelha Escalável de Exemplo',
      summary: 'Cantrip fictício com scaling por nível do personagem.',
      source: exampleRuleSource,
      payload: {
        type: 'spell',
        level: 0,
        classes: ['Wizard'],
        castingTime: 'action',
        requiresAttackRoll: true,
        damageFormula: '1d10',
        targets: 1,
        scaling: {
          kind: 'characterLevel',
          steps: [
            { minCharacterLevel: 1, formula: '1d10' },
            { minCharacterLevel: 5, formula: '2d10' },
            { minCharacterLevel: 11, formula: '3d10' },
            { minCharacterLevel: 17, formula: '4d10' }
          ]
        }
      }
    },
    {
      id: 'example_spell_upcast_burst',
      kind: 'spell',
      name: 'Rajada Escalonável de Exemplo',
      summary: 'Magia fictícia com upcasting por slot.',
      source: exampleRuleSource,
      payload: {
        type: 'spell',
        level: 1,
        classes: ['Wizard'],
        castingTime: 'action',
        saveAbility: 'DEX',
        damageFormula: '2d6',
        targets: 2,
        consumesSpellSlot: true,
        scaling: {
          kind: 'slotLevel',
          baseLevel: 1,
          steps: [
            { slotLevel: 1, formula: '2d6' },
            { slotLevel: 2, formula: '3d6' },
            { slotLevel: 3, formula: '4d6' }
          ]
        }
      }
    },
    {
      id: 'example_feature_marker',
      kind: 'feature',
      name: 'Marcador Condicional de Exemplo',
      summary: 'Feature fictícia que cria recurso, efeito ativo e ação concedida com dano condicional.',
      source: exampleRuleSource,
      payload: {
        type: 'feature',
        sourceType: 'classFeature',
        summary: 'Exemplo de feature com ação concedida, recurso e efeito derivado.',
        oncePerTurnKey: 'example_marker_once',
        resource: { id: 'example_marker_resource', name: 'Carga de Exemplo', max: 3, current: 3, recharge: 'longRest' },
        effectTemplates: [
          {
            id: 'example_marker_effect',
            name: 'Marcado por Exemplo',
            kind: 'feature',
            sourceType: 'classFeature',
            concentration: false,
            conditionIds: ['example_marked_condition'],
            duration: { unit: 'round', remaining: 10, expiresOn: 'turnStart' },
            notes: 'Efeito fictício para ativar dano condicional.'
          }
        ],
        grantsActions: [
          {
            id: 'example_marker_strike',
            type: 'attack',
            name: 'Golpe Marcado de Exemplo',
            actionCost: 'special',
            sourceType: 'classFeature',
            attackAbility: 'STR',
            damageFormula: '1d8 + STR',
            extraDamage: [{ formula: '1d6', conditionId: 'example_marked_condition', label: 'Alvo marcado' }],
            attacksCount: 1,
            consumes: [{ resourceId: 'example_marker_resource', amount: 1, label: 'Carga de Exemplo', oncePerTurnKey: 'example_marker_once' }]
          }
        ]
      }
    }
  ]
};

export const createExampleLibraryBundle = (): ExampleLibraryBundle => {
  const characters = createExampleCharacters();
  const scenarios = createExampleScenarios(characters);
  const buildPresets = createExampleBuildPresets(characters);
  const buildHistorySnapshots = createExampleBuildHistorySnapshots(characters, scenarios);
  const characterBackup = createCharacterDataBackup(
    { characters, scenarios, buildPresets, buildHistorySnapshots },
    {
      metadata: {
        name: 'Biblioteca de exemplos',
        description: 'Backup fictício da biblioteca de exemplos para testes de roundtrip.',
        exportedBy: 'fixture-library',
        notes: 'Não inclui regras oficiais. Use apenas para validar comportamento do app.'
      }
    }
  );

  return {
    characters: clone(characters),
    scenarios: clone(scenarios),
    buildPresets: clone(buildPresets),
    buildHistorySnapshots: clone(buildHistorySnapshots),
    compendiumImport: clone(exampleCompendiumImport),
    characterBackup: clone(characterBackup)
  };
};

export const summarizeExampleLibrary = (bundle: ExampleLibraryBundle = createExampleLibraryBundle()): ExampleLibrarySummary => ({
  characterCount: bundle.characters.length,
  scenarioCount: bundle.scenarios.length,
  presetCount: bundle.buildPresets.length,
  historySnapshotCount: bundle.buildHistorySnapshots.length,
  compendiumItemCount: bundle.compendiumImport.items.length,
  highlights: [
    'dano bruto e ponderado por CA',
    'múltiplos ataques e ação bônus',
    'dano condicional ativado por efeito ativo',
    'recursos por descanso e once-per-turn',
    'spell slots, upcasting e concentração',
    'backup/restauração e histórico de build'
  ]
});

export const exampleCompendiumImportJson = (): string => JSON.stringify(exampleCompendiumImport, null, 2);
export const exampleCharacterBackupJson = (): string => JSON.stringify(createExampleLibraryBundle().characterBackup, null, 2);
