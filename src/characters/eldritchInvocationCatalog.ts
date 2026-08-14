import type { CompendiumItemInput } from '../compendium/schemas';
import type { StoredCompendiumItem } from '../compendium/types';

interface InvocationDefinition {
  slug: string;
  name: string;
  summary: string;
  level: number;
  prerequisite?: string;
  repeatable?: boolean;
}

const SOURCE = {
  id: 'phb-2024',
  book: 'Player’s Handbook',
  page: '155-157',
  version: '2024',
  status: 'active' as const,
  confidence: 'exact' as const,
  notes: 'Catálogo mecânico resumido de Eldritch Invocations do PHB 2024.'
};

const DEFINITIONS: InvocationDefinition[] = [
  { slug: 'agonizing-blast', name: 'Agonizing Blast', level: 2, repeatable: true, prerequisite: 'Level 2+ Warlock, a Warlock cantrip that deals damage', summary: 'Escolha um cantrip de Warlock que cause dano; some seu modificador de Carisma às rolagens de dano dele.' },
  { slug: 'armor-of-shadows', name: 'Armor of Shadows', level: 1, summary: 'Você pode conjurar Mage Armor em si mesmo sem gastar espaço de magia.' },
  { slug: 'ascendant-step', name: 'Ascendant Step', level: 5, prerequisite: 'Level 5+ Warlock', summary: 'Você pode conjurar Levitate em si mesmo sem gastar espaço de magia.' },
  { slug: 'devils-sight', name: "Devil's Sight", level: 2, prerequisite: 'Level 2+ Warlock', summary: 'Você enxerga normalmente em luz fraca e escuridão, mágicas ou não, a até 120 pés.' },
  { slug: 'devouring-blade', name: 'Devouring Blade', level: 12, prerequisite: 'Level 12+ Warlock, Thirsting Blade invocation', summary: 'Thirsting Blade passa a conceder dois ataques extras, em vez de um, com sua arma de pacto.' },
  { slug: 'eldritch-mind', name: 'Eldritch Mind', level: 1, summary: 'Você tem vantagem em salvaguardas de Constituição para manter concentração.' },
  { slug: 'eldritch-smite', name: 'Eldritch Smite', level: 5, prerequisite: 'Level 5+ Warlock, Pact of the Blade invocation', summary: 'Uma vez por turno, ao acertar com a arma de pacto, gaste um espaço de Pact Magic para causar dano de Force extra e possivelmente derrubar o alvo.' },
  { slug: 'eldritch-spear', name: 'Eldritch Spear', level: 2, repeatable: true, prerequisite: 'Level 2+ Warlock, a damaging Warlock cantrip with range 10+ feet', summary: 'Escolha um cantrip de Warlock elegível; o alcance dele aumenta em 30 pés por nível de Warlock.' },
  { slug: 'fiendish-vigor', name: 'Fiendish Vigor', level: 2, prerequisite: 'Level 2+ Warlock', summary: 'Você pode conjurar False Life em si mesmo sem gastar espaço e recebe o valor máximo dos pontos de vida temporários.' },
  { slug: 'gaze-of-two-minds', name: 'Gaze of Two Minds', level: 5, prerequisite: 'Level 5+ Warlock', summary: 'Conecte-se aos sentidos de uma criatura voluntária e, enquanto mantiver o vínculo, conjure magias a partir do espaço dela dentro do alcance permitido.' },
  { slug: 'gift-of-the-depths', name: 'Gift of the Depths', level: 5, prerequisite: 'Level 5+ Warlock', summary: 'Você respira debaixo d’água, ganha deslocamento de natação igual ao seu e pode conjurar Water Breathing uma vez por descanso longo sem espaço.' },
  { slug: 'gift-of-the-protectors', name: 'Gift of the Protectors', level: 9, prerequisite: 'Level 9+ Warlock, Pact of the Tome invocation', summary: 'Nomes escritos em seu Book of Shadows podem cair para 1 PV, em vez de 0, uma vez por descanso longo.' },
  { slug: 'investment-of-the-chain-master', name: 'Investment of the Chain Master', level: 5, prerequisite: 'Level 5+ Warlock, Pact of the Chain invocation', summary: 'Aprimora seu familiar com deslocamento adicional, ataque por ação bônus, dano alternativo, sua CD de magia e uma reação defensiva.' },
  { slug: 'lessons-of-the-first-ones', name: 'Lessons of the First Ones', level: 2, repeatable: true, prerequisite: 'Level 2+ Warlock', summary: 'Você recebe um Origin Feat para o qual se qualifique. Pode repetir, escolhendo um Origin Feat diferente.' },
  { slug: 'lifedrinker', name: 'Lifedrinker', level: 9, prerequisite: 'Level 9+ Warlock, Pact of the Blade invocation', summary: 'Uma vez por turno, sua arma de pacto causa 1d6 extra de dano Necrotic, Psychic ou Radiant; você também pode gastar um Hit Die para se curar.' },
  { slug: 'mask-of-many-faces', name: 'Mask of Many Faces', level: 2, prerequisite: 'Level 2+ Warlock', summary: 'Você pode conjurar Disguise Self sem gastar espaço de magia.' },
  { slug: 'master-of-myriad-forms', name: 'Master of Myriad Forms', level: 5, prerequisite: 'Level 5+ Warlock', summary: 'Você pode conjurar Alter Self sem gastar espaço de magia.' },
  { slug: 'misty-visions', name: 'Misty Visions', level: 2, prerequisite: 'Level 2+ Warlock', summary: 'Você pode conjurar Silent Image sem gastar espaço de magia.' },
  { slug: 'one-with-shadows', name: 'One with Shadows', level: 5, prerequisite: 'Level 5+ Warlock', summary: 'Em luz fraca ou escuridão, você pode conjurar Invisibility em si mesmo sem gastar espaço.' },
  { slug: 'otherworldly-leap', name: 'Otherworldly Leap', level: 2, prerequisite: 'Level 2+ Warlock', summary: 'Você pode conjurar Jump em si mesmo sem gastar espaço de magia.' },
  { slug: 'pact-of-the-blade', name: 'Pact of the Blade', level: 1, summary: 'Conjure ou vincule uma arma de pacto; ganhe proficiência, use-a como foco e possa usar Carisma para suas jogadas de ataque e dano.' },
  { slug: 'pact-of-the-chain', name: 'Pact of the Chain', level: 1, summary: 'Aprenda Find Familiar, conjure-o sem espaço e tenha acesso a formas especiais, podendo abrir mão de um ataque para o familiar atacar.' },
  { slug: 'pact-of-the-tome', name: 'Pact of the Tome', level: 1, summary: 'Seu Book of Shadows concede três cantrips e duas magias rituais de nível 1 de quaisquer listas, tratadas como magias de Warlock.' },
  { slug: 'repelling-blast', name: 'Repelling Blast', level: 2, repeatable: true, prerequisite: 'Level 2+ Warlock, a damaging Warlock cantrip that uses an attack roll', summary: 'Escolha um cantrip de ataque de Warlock; ao acertar uma criatura Grande ou menor, empurre-a até 10 pés.' },
  { slug: 'thirsting-blade', name: 'Thirsting Blade', level: 5, prerequisite: 'Level 5+ Warlock, Pact of the Blade invocation', summary: 'Você recebe Extra Attack somente com sua arma de pacto.' },
  { slug: 'visions-of-distant-realms', name: 'Visions of Distant Realms', level: 9, prerequisite: 'Level 9+ Warlock', summary: 'Você pode conjurar Arcane Eye sem gastar espaço de magia.' },
  { slug: 'whispers-of-the-grave', name: 'Whispers of the Grave', level: 7, prerequisite: 'Level 7+ Warlock', summary: 'Você pode conjurar Speak with Dead sem gastar espaço de magia.' },
  { slug: 'witch-sight', name: 'Witch Sight', level: 15, prerequisite: 'Level 15+ Warlock', summary: 'Você possui Truesight com alcance de 30 pés.' }
];

const normalize = (value: string): string => value
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .trim()
  .toLowerCase();

const createFallbackItem = (definition: InvocationDefinition): StoredCompendiumItem => {
  const importItemId = `phb-2024-feature-warlock-${definition.slug}`;
  const rawJson: CompendiumItemInput = {
    id: importItemId,
    kind: 'feature',
    name: definition.name,
    summary: definition.summary,
    source: SOURCE,
    payload: {
      sourceType: 'eldritchInvocation',
      classId: 'phb-2024-class-warlock',
      levelGained: definition.level,
      prerequisite: definition.prerequisite,
      repeatable: definition.repeatable ?? false,
      engineKey: `warlock.${definition.slug}`,
      builtInFallback: true
    }
  };
  return {
    id: `builtin:${importItemId}`,
    importItemId,
    packId: 'builtin-phb-2024-eldritch-invocations',
    sourceId: SOURCE.id,
    type: 'feature',
    name: definition.name,
    summary: definition.summary,
    version: '2024',
    rawJson,
    normalizedJson: rawJson.payload,
    tags: ['phb-2024', 'warlock', 'eldritch-invocation', 'builtin-fallback'],
    status: 'validated',
    reviewDecision: 'approved',
    reviewNotes: 'Fallback mecânico incorporado para completar a lista do PHB 2024.',
    reviewedBy: 'Catálogo interno PHB 2024',
    reviewedAt: '2026-07-15T00:00:00.000Z',
    createdAt: '2026-07-15T00:00:00.000Z',
    updatedAt: '2026-07-15T00:00:00.000Z'
  };
};

export const BUILTIN_ELDRITCH_INVOCATIONS: StoredCompendiumItem[] = DEFINITIONS.map(createFallbackItem);

export const withBuiltinEldritchInvocations = (
  items: StoredCompendiumItem[]
): StoredCompendiumItem[] => {
  const importedByReference = new Set<string>();
  const importedByName = new Set<string>();
  for (const item of items) {
    importedByReference.add(item.importItemId);
    importedByName.add(normalize(item.name));
  }
  return [
    ...items,
    ...BUILTIN_ELDRITCH_INVOCATIONS.filter(
      (item) => !importedByReference.has(item.importItemId) && !importedByName.has(normalize(item.name))
    )
  ];
};
