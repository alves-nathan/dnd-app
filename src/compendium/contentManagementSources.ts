import type { RuleSource } from '../types';

export interface CompendiumContentPackLike {
  id: string;
  sourceId: string;
}

export interface CompendiumContentItemLike {
  sourceId: string;
}

export interface CompendiumContentBundledDefinitionLike {
  id: string;
  sourceId?: string;
  predecessorPackIds?: readonly string[];
}

export interface ImportedCompendiumSourceRow {
  sourceId: string;
  label: string;
  itemCount: number;
  packCount: number;
  enabled: boolean;
  source: RuleSource;
}

const importedSourceLabels: Record<string, string> = {
  'xgte-2017': "Xanathar's Guide to Everything (2017)",
  'mtof-2018': "Mordenkainen's Tome of Foes (2018)",
  'eberron-rising-2019': 'Eberron: Rising from the Last War (2019)',
  'egtw-2020': "Explorer's Guide to Wildemount (2020)",
  'one-grung-above-2017': 'One Grung Above (2017)',
  'hold-back-the-dead-2025': 'Hold Back the Dead (2025)',
  'malady-of-minarrh': 'The Malady of Minarrh',
  'spelljammer-academy-2022': 'Spelljammer Academy (2022)',
  'welcome-to-hellfire-club-2025': 'Welcome to the Hellfire Club (2025)',
  'bomt-2023': 'The Book of Many Things (2023)',
  'mm-2014': 'Monster Manual (2014) — dependências Legacy',
  'dmg-2014': "Dungeon Master's Guide (2014) — dependências Legacy"
};

const titleCaseWords = (value: string): string => value
  .replace(/[_-]+/g, ' ')
  .replace(/\s+/g, ' ')
  .trim()
  .replace(/\b\w/g, (letter) => letter.toUpperCase());

export const formatImportedCompendiumSourceLabel = (source: RuleSource): string => {
  const explicit = importedSourceLabels[source.id];
  if (explicit) return explicit;

  const rawBook = source.book?.trim();
  if (rawBook) {
    const humanized = titleCaseWords(rawBook);
    return source.version && !humanized.includes(source.version)
      ? `${humanized} (${source.version})`
      : humanized;
  }

  return titleCaseWords(source.id);
};

const bundledSourceIds = (
  packs: readonly CompendiumContentPackLike[],
  definitions: readonly CompendiumContentBundledDefinitionLike[]
): Set<string> => {
  const covered = new Set<string>();

  for (const definition of definitions) {
    if (definition.sourceId) covered.add(definition.sourceId);

    const matchingPack = packs.find((pack) =>
      pack.id === definition.id || definition.predecessorPackIds?.includes(pack.id)
    );
    if (matchingPack) covered.add(matchingPack.sourceId);
  }

  return covered;
};

export const buildImportedCompendiumSourceRows = (input: {
  sources: readonly RuleSource[];
  packs: readonly CompendiumContentPackLike[];
  items: readonly CompendiumContentItemLike[];
  enabledSourceIds: readonly string[];
  bundledDefinitions: readonly CompendiumContentBundledDefinitionLike[];
}): ImportedCompendiumSourceRow[] => {
  const coveredSourceIds = bundledSourceIds(input.packs, input.bundledDefinitions);
  const enabled = new Set(input.enabledSourceIds);

  return input.sources
    .filter((source) => !coveredSourceIds.has(source.id))
    .map((source) => ({
      sourceId: source.id,
      label: formatImportedCompendiumSourceLabel(source),
      itemCount: input.items.filter((item) => item.sourceId === source.id).length,
      packCount: input.packs.filter((pack) => pack.sourceId === source.id).length,
      enabled: enabled.has(source.id),
      source
    }))
    .filter((row) => row.itemCount > 0 || row.packCount > 0)
    .sort((left, right) => left.label.localeCompare(right.label, 'pt-BR'));
};
