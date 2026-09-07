export type BundledCompendiumImportFormat = 'v1' | 'v2';

export interface BundledCompendiumPackDefinition {
  id: string;
  fileName: string;
  label: string;
  /** Stable source id used to federate bundled and locally imported packs in content management. */
  sourceId?: string;
  importFormat: BundledCompendiumImportFormat;
  /** Older bundled pack ids that this pack may upgrade transactionally. */
  predecessorPackIds?: readonly string[];
  load: () => unknown;
}

/**
 * Manifesto estático dos pacotes incluídos no bundle nativo.
 *
 * O require precisa permanecer literal para o Metro localizar e empacotar o
 * JSON durante a build Android/iOS. Novos livros podem ser adicionados aqui
 * sem alterar o bootstrap ou o repositório SQLite.
 *
 * Desde o Import V2 Phase 10, o PHB oficial embarcado usa o artefato canônico
 * `dnd-combat-import.v2`. O id lógico do pacote permanece o mesmo do V1 para
 * que instalações existentes sejam reconciliadas sem recriar itens/storage ids.
 */
export const BUNDLED_COMPENDIUM_PACKS: readonly BundledCompendiumPackDefinition[] = [
  {
    id: 'phb-2024-full-consolidated-import-pack-v5-complete-invocations',
    fileName: 'phb-2024-full-consolidated-import-pack-v2-canonical.json',
    label: 'Player’s Handbook 2024 — pacote canônico Import V2',
    sourceId: 'phb',
    importFormat: 'v2',
    load: () => require('../../assets/compendium/phb-2024-full-consolidated-import-pack-v2-canonical.json') as unknown
  },
  {
    id: 'mm-2024-runtime-dependency-delta-v1',
    fileName: 'mm-2024-runtime-dependency-delta-v2-canonical.json',
    label: 'Monster Manual 2024 — delta mínimo de dependências runtime',
    sourceId: 'mm-2024',
    importFormat: 'v2',
    load: () => require('../../assets/compendium/mm-2024-runtime-dependency-delta-v2-canonical.json') as unknown
  },
  {
    id: 'forge-artificer-2025-full-consolidated-import-pack-v1',
    fileName: 'forge-artificer-2025-full-consolidated-import-pack-v2-canonical.json',
    label: 'Eberron: Forge of the Artificer 2025 — pacote canônico Import V2',
    sourceId: 'forge-artificer-2025',
    importFormat: 'v2',
    load: () => require('../../assets/compendium/forge-artificer-2025-full-consolidated-import-pack-v2-canonical.json') as unknown
  },
  {
    id: 'spelljammer-2022-full-consolidated-import-pack-v1',
    fileName: 'spelljammer-2022-2024-compatible-import-pack-v2-canonical.json',
    label: 'Spelljammer: Adventures in Space 2022 — pacote canônico Import V2',
    sourceId: 'spelljammer-2022',
    importFormat: 'v2',
    load: () => require('../../assets/compendium/spelljammer-2022-2024-compatible-import-pack-v2-canonical.json') as unknown
  },
  {
    id: 'tcoe-2020-2024-compatible-import-pack-v2',
    fileName: 'tcoe-2020-2024-compatible-import-pack-v2-canonical.json',
    label: 'Tasha’s Cauldron of Everything 2020 — perfil 2024-first + legacy',
    sourceId: 'tcoe-2020',
    importFormat: 'v2',
    predecessorPackIds: ['tcoe-2020-2024-compatible-import-pack-v1', 'tcoe-2020-full-consolidated-import-pack-v1'],
    load: () => require('../../assets/compendium/tcoe-2020-2024-compatible-import-pack-v2-canonical.json') as unknown
  },
  {
    id: 'phb-2014-2024-compatible-delta-v1',
    fileName: 'phb-2014-2024-compatible-delta-v2-canonical.json',
    label: 'Player’s Handbook 2014 — delta legacy compatível com PHB 2024',
    sourceId: 'phb-2014',
    importFormat: 'v2',
    load: () => require('../../assets/compendium/phb-2014-2024-compatible-delta-v2-canonical.json') as unknown
  }
];

export const REQUIRED_CHARACTER_CREATION_BUNDLED_PACK_IDS = [
  'phb-2024-full-consolidated-import-pack-v5-complete-invocations'
] as const;

export const REQUIRED_CHARACTER_CREATION_BUNDLED_PACKS = BUNDLED_COMPENDIUM_PACKS.filter(
  (pack) => (REQUIRED_CHARACTER_CREATION_BUNDLED_PACK_IDS as readonly string[]).includes(pack.id)
);

export const isRequiredCharacterCreationBundledPack = (packId: string): boolean =>
  (REQUIRED_CHARACTER_CREATION_BUNDLED_PACK_IDS as readonly string[]).includes(packId);

export const serializeBundledCompendiumPack = (
  pack: BundledCompendiumPackDefinition
): string => JSON.stringify(pack.load());
