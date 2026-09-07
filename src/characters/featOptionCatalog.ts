export type FeatOptionKind = 'metamagic' | 'maneuver';

export interface FeatOptionDefinition {
  id: string;
  kind: FeatOptionKind;
  name: string;
  summary: string;
  sourceId: 'phb-2024' | 'tcoe-2020';
  sourceLabel: string;
  rulesEra: '2024' | 'legacy';
  sorceryPointCost?: number;
}

const metamagic = (
  slug: string,
  name: string,
  sorceryPointCost: number,
  summary: string
): FeatOptionDefinition => ({
  id: `feat-option-phb2024-metamagic-${slug}`,
  kind: 'metamagic',
  name,
  summary,
  sourceId: 'phb-2024',
  sourceLabel: 'Player’s Handbook 2024',
  rulesEra: '2024',
  sorceryPointCost
});

/**
 * The 2024 Sorcerer Metamagic catalog is kept as a typed internal option
 * provider instead of materializing synthetic compendium entities. This keeps
 * the canonical PHB import immutable while still allowing legacy feats such as
 * Metamagic Adept to target the current-rules option set.
 */
export const METAMAGIC_OPTIONS_2024: FeatOptionDefinition[] = [
  metamagic('careful-spell', 'Careful Spell', 1, 'Protege criaturas escolhidas contra uma magia com saving throw: elas passam automaticamente e não sofrem o dano que normalmente receberiam em um sucesso.'),
  metamagic('distant-spell', 'Distant Spell', 1, 'Dobra o alcance de uma magia com alcance de pelo menos 5 ft; uma magia com alcance Touch passa a ter alcance de 30 ft.'),
  metamagic('empowered-spell', 'Empowered Spell', 1, 'Permite rerrolar dados de dano da magia até seu modificador de Charisma (mínimo 1); pode ser usado mesmo com outro Metamagic na mesma conjuração.'),
  metamagic('extended-spell', 'Extended Spell', 1, 'Dobra a duração de uma magia de pelo menos 1 minuto, até 24 horas; se exigir Concentration, concede Advantage nos saves para mantê-la.'),
  metamagic('heightened-spell', 'Heightened Spell', 2, 'Impõe Disadvantage a um alvo nos saving throws contra a magia.'),
  metamagic('quickened-spell', 'Quickened Spell', 2, 'Transforma em Bonus Action a conjuração de uma magia com casting time de Action, respeitando a limitação de magias de nível 1+ no mesmo turno.'),
  metamagic('seeking-spell', 'Seeking Spell', 1, 'Após errar um spell attack, permite rerrolar o d20 e usar o novo resultado; pode ser combinado com outro Metamagic.'),
  metamagic('subtle-spell', 'Subtle Spell', 1, 'Remove componentes Verbal, Somatic e Material, exceto Material consumido pela magia ou que tenha custo especificado.'),
  metamagic('transmuted-spell', 'Transmuted Spell', 1, 'Troca Acid, Cold, Fire, Lightning, Poison ou Thunder por outro tipo dessa mesma lista ao conjurar a magia.'),
  metamagic('twinned-spell', 'Twinned Spell', 1, 'Em uma magia que pode ganhar um alvo adicional com slot superior, aumenta o nível efetivo da magia em 1 sem aumentar o slot gasto.')
];

const maneuver = (
  slug: string,
  name: string,
  summary: string,
  sourceId: 'phb-2024' | 'tcoe-2020' = 'phb-2024'
): FeatOptionDefinition => ({
  id: `feat-option-${sourceId === 'phb-2024' ? 'phb2024' : 'tcoe2020'}-maneuver-${slug}`,
  kind: 'maneuver',
  name,
  summary,
  sourceId,
  sourceLabel: sourceId === 'phb-2024' ? 'Player’s Handbook 2024' : 'Tasha’s Cauldron of Everything 2020',
  rulesEra: sourceId === 'phb-2024' ? '2024' : 'legacy'
});

/** Current Battle Master maneuver list from the 2024 Fighter. */
export const BATTLE_MASTER_MANEUVERS_2024: FeatOptionDefinition[] = [
  maneuver('ambush', 'Ambush', 'Gaste um Superiority Die em um teste de Stealth ou em Initiative e some o dado, desde que não esteja Incapacitated.'),
  maneuver('bait-and-switch', 'Bait and Switch', 'Troque de lugar com uma criatura voluntária adjacente usando 5 ft de movimento; um dos dois recebe bônus de AC igual ao Superiority Die até seu próximo turno.'),
  maneuver('commanders-strike', 'Commander’s Strike', 'Substitua um de seus ataques para permitir que um aliado use a Reaction para atacar e some o Superiority Die ao dano.'),
  maneuver('commanding-presence', 'Commanding Presence', 'Some o Superiority Die a um teste de Intimidation, Performance ou Persuasion.'),
  maneuver('disarming-attack', 'Disarming Attack', 'Ao acertar, some o Superiority Die ao dano e force um Strength save para o alvo soltar um objeto que esteja segurando.'),
  maneuver('distracting-strike', 'Distracting Strike', 'Ao acertar, some o Superiority Die ao dano e dê Advantage ao próximo ataque de outro atacante contra o alvo antes do seu próximo turno.'),
  maneuver('evasive-footwork', 'Evasive Footwork', 'Como Bonus Action, gaste um Superiority Die, use Disengage e some o resultado à AC até o começo do seu próximo turno.'),
  maneuver('feinting-attack', 'Feinting Attack', 'Como Bonus Action, obtenha Advantage no próximo ataque contra um alvo adjacente neste turno; se acertar, some o Superiority Die ao dano.'),
  maneuver('goading-attack', 'Goading Attack', 'Ao acertar, some o Superiority Die ao dano; em falha no Wisdom save, o alvo tem Disadvantage ao atacar outras criaturas até o fim do seu próximo turno.'),
  maneuver('lunging-attack', 'Lunging Attack', 'Como Bonus Action, use Dash; após avançar ao menos 5 ft em linha reta, um melee hit durante a Attack Action pode somar o Superiority Die ao dano.'),
  maneuver('maneuvering-attack', 'Maneuvering Attack', 'Ao acertar, some o Superiority Die ao dano e permita que um aliado use a Reaction para mover até metade do Speed sem Opportunity Attack do alvo.'),
  maneuver('menacing-attack', 'Menacing Attack', 'Ao acertar, some o Superiority Die ao dano; em falha no Wisdom save, o alvo fica Frightened até o fim do seu próximo turno.'),
  maneuver('parry', 'Parry', 'Use a Reaction ao sofrer dano de um melee attack para reduzi-lo pelo Superiority Die + seu modificador de Strength ou Dexterity.'),
  maneuver('precision-attack', 'Precision Attack', 'Após errar um attack roll, some o Superiority Die ao resultado, podendo transformar o erro em acerto.'),
  maneuver('pushing-attack', 'Pushing Attack', 'Ao acertar com arma ou Unarmed Strike, some o Superiority Die ao dano; em falha no Strength save, um alvo Large ou menor é empurrado até 15 ft.'),
  maneuver('rally', 'Rally', 'Como Bonus Action, conceda a um aliado em 30 ft Temporary Hit Points iguais ao Superiority Die + metade do seu nível de Fighter, arredondado para baixo.'),
  maneuver('riposte', 'Riposte', 'Use a Reaction quando uma criatura errar um melee attack contra você para realizar um melee attack; se acertar, some o Superiority Die ao dano.'),
  maneuver('sweeping-attack', 'Sweeping Attack', 'Após um melee hit, um segundo alvo adjacente dentro do seu alcance pode sofrer dano igual ao Superiority Die se o attack roll original também o acertaria.'),
  maneuver('tactical-assessment', 'Tactical Assessment', 'Some o Superiority Die a um teste de History, Investigation ou Insight.'),
  maneuver('trip-attack', 'Trip Attack', 'Ao acertar com arma ou Unarmed Strike, some o Superiority Die ao dano; em falha no Strength save, um alvo Large ou menor fica Prone.')
];

/** Tasha maneuvers that are not already reprinted in the 2024 PHB list. */
export const TASHA_UNIQUE_MANEUVERS_2020: FeatOptionDefinition[] = [
  maneuver('brace', 'Brace', 'Use a Reaction quando uma criatura visível entrar no reach da sua melee weapon para atacá-la; em hit, some o Superiority Die ao dano.', 'tcoe-2020'),
  maneuver('grappling-strike', 'Grappling Strike', 'Logo após acertar um melee attack, use uma Bonus Action para tentar Grapple e some o Superiority Die ao teste de Strength (Athletics).', 'tcoe-2020'),
  maneuver('quick-toss', 'Quick Toss', 'Como Bonus Action, faça um ranged attack com uma arma Thrown, podendo sacá-la como parte do ataque; em hit, some o Superiority Die ao dano.', 'tcoe-2020')
];

export const ALL_FEAT_OPTION_DEFINITIONS: FeatOptionDefinition[] = [
  ...METAMAGIC_OPTIONS_2024,
  ...BATTLE_MASTER_MANEUVERS_2024,
  ...TASHA_UNIQUE_MANEUVERS_2020
];

const normalizedSourceId = (value: string): string => value
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .trim()
  .toLowerCase();

/**
 * Character-choice items materialized from the catalog use source ids such as
 * `catalog:tcoe-2020` / `catalog:tashas-cauldron-of-everything`, while local
 * compendium carriers use the original `tcoe-2020`. Static feat options need to
 * recognize both representations or Tasha-only maneuvers silently disappear.
 */
const sourceIsEnabled = (sourceId: FeatOptionDefinition['sourceId'], enabledSourceIds: string[]): boolean => {
  if (!enabledSourceIds.length) return true;
  const enabled = enabledSourceIds.map(normalizedSourceId);
  if (sourceId === 'tcoe-2020') {
    return enabled.some((candidate) =>
      candidate === 'tcoe-2020'
      || candidate.endsWith(':tcoe-2020')
      || candidate.includes('tashas-cauldron-of-everything')
      || candidate.includes('tasha')
    );
  }
  return enabled.some((candidate) =>
    candidate === 'phb-2024'
    || candidate === 'phb'
    || candidate.endsWith(':phb-2024')
    || candidate.endsWith(':phb')
    || (candidate.includes('players-handbook') && candidate.includes('2024'))
  );
};

export const getMetamagicFeatOptions = (enabledSourceIds: string[] = []): FeatOptionDefinition[] =>
  METAMAGIC_OPTIONS_2024.filter((option) => sourceIsEnabled(option.sourceId, enabledSourceIds));

export const getMartialAdeptManeuverOptions = (enabledSourceIds: string[] = []): FeatOptionDefinition[] =>
  [...BATTLE_MASTER_MANEUVERS_2024, ...TASHA_UNIQUE_MANEUVERS_2020]
    .filter((option) => sourceIsEnabled(option.sourceId, enabledSourceIds));

export const findFeatOptionDefinition = (id: string | undefined): FeatOptionDefinition | undefined =>
  id ? ALL_FEAT_OPTION_DEFINITIONS.find((option) => option.id === id) : undefined;

export const describeFeatOption = (option: FeatOptionDefinition): string =>
  `${option.summary}${option.sorceryPointCost !== undefined ? ` · Custo: ${option.sorceryPointCost} Sorcery Point${option.sorceryPointCost === 1 ? '' : 's'}.` : ''}`;
