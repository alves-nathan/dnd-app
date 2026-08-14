export const ARTISAN_TOOL_OPTIONS = [
  "Alchemist's Supplies",
  "Brewer's Supplies",
  "Calligrapher's Supplies",
  "Carpenter's Tools",
  "Cartographer's Tools",
  "Cobbler's Tools",
  "Cook's Utensils",
  "Glassblower's Tools",
  "Jeweler's Tools",
  "Leatherworker's Tools",
  "Mason's Tools",
  "Painter's Supplies",
  "Potter's Tools",
  "Smith's Tools",
  "Tinker's Tools",
  "Weaver's Tools",
  "Woodcarver's Tools"
] as const;

export const MUSICAL_INSTRUMENT_OPTIONS = [
  'Bagpipes',
  'Drum',
  'Dulcimer',
  'Flute',
  'Horn',
  'Lute',
  'Lyre',
  'Pan Flute',
  'Shawm',
  'Viol'
] as const;

export const GAMING_SET_OPTIONS = [
  'Dice Set',
  'Dragonchess Set',
  'Playing Card Set',
  'Three-Dragon Ante Set'
] as const;

export const OTHER_TOOL_OPTIONS = [
  'Disguise Kit',
  'Forgery Kit',
  'Herbalism Kit',
  "Navigator's Tools",
  "Poisoner's Kit",
  "Thieves' Tools"
] as const;

export const ALL_TOOL_OPTIONS = [
  ...ARTISAN_TOOL_OPTIONS,
  ...MUSICAL_INSTRUMENT_OPTIONS,
  ...GAMING_SET_OPTIONS,
  ...OTHER_TOOL_OPTIONS
] as const;

export const COMMON_LANGUAGE = 'Common';

export const STANDARD_LANGUAGE_OPTIONS = [
  'Common Sign Language',
  'Draconic',
  'Dwarvish',
  'Elvish',
  'Giant',
  'Gnomish',
  'Goblin',
  'Halfling',
  'Orc'
] as const;

export const RARE_LANGUAGE_OPTIONS = [
  'Abyssal',
  'Celestial',
  'Deep Speech',
  'Druidic',
  'Infernal',
  'Primordial',
  'Sylvan',
  "Thieves' Cant",
  'Undercommon'
] as const;

export const ALL_LANGUAGE_OPTIONS = [
  ...STANDARD_LANGUAGE_OPTIONS,
  ...RARE_LANGUAGE_OPTIONS
] as const;

const normalize = (value: string): string =>
  value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[’‘]/g, "'")
    .trim()
    .toLowerCase();

export const uniqueChoices = (values: readonly string[]): string[] => {
  const seen = new Set<string>();
  return values.filter((value) => {
    const key = normalize(value);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};

export const mergeChoiceOptions = (
  options: readonly string[],
  selectedValues: readonly string[]
): string[] => uniqueChoices([...selectedValues, ...options]);

export const toggleChoice = (
  selectedValues: readonly string[],
  value: string,
  maximum: number
): string[] => {
  const normalizedValue = normalize(value);
  const selected = selectedValues.some((entry) => normalize(entry) === normalizedValue);
  if (selected) return selectedValues.filter((entry) => normalize(entry) !== normalizedValue);
  if (maximum >= 0 && selectedValues.length >= maximum) return [...selectedValues];
  return uniqueChoices([...selectedValues, value]);
};

export const getToolOptionsForDescriptor = (descriptor: unknown): string[] => {
  const text = Array.isArray(descriptor)
    ? descriptor.filter((entry): entry is string => typeof entry === 'string').join(' ')
    : typeof descriptor === 'string'
      ? descriptor
      : '';
  const normalizedDescriptor = normalize(text);

  const includesArtisan = normalizedDescriptor.includes('artisan');
  const includesMusical = normalizedDescriptor.includes('musical') || normalizedDescriptor.includes('instrument');
  const includesGaming = normalizedDescriptor.includes('gaming');

  if (includesArtisan && includesMusical) {
    return uniqueChoices([...ARTISAN_TOOL_OPTIONS, ...MUSICAL_INSTRUMENT_OPTIONS]);
  }
  if (includesArtisan) return [...ARTISAN_TOOL_OPTIONS];
  if (includesMusical) return [...MUSICAL_INSTRUMENT_OPTIONS];
  if (includesGaming) return [...GAMING_SET_OPTIONS];
  return [...ALL_TOOL_OPTIONS];
};

export interface ToolChoiceRequirement {
  fixedTools: string[];
  choiceCount: number;
  choiceLabel?: string;
  choiceOptions: string[];
}

const displayToolToken = (value: string): string => {
  const known: Record<string, string> = {
    herbalismKit: 'Herbalism Kit',
    thievesTools: "Thieves' Tools"
  };
  return known[value] ?? value;
};

export const parseToolProficiencyEntries = (
  entries: readonly string[]
): ToolChoiceRequirement => {
  const fixedTools: string[] = [];
  const choiceOptions: string[] = [];
  const labels: string[] = [];
  let choiceCount = 0;

  for (const entry of entries) {
    const trimmed = entry.trim();
    const instrumentMatch = trimmed.match(/^musicalInstrument:(\d+)$/i);
    if (instrumentMatch) {
      choiceCount += Number(instrumentMatch[1]) || 0;
      choiceOptions.push(...MUSICAL_INSTRUMENT_OPTIONS);
      labels.push('instrumentos musicais');
      continue;
    }

    if (normalize(trimmed) === normalize('artisanToolOrMusicalInstrument')) {
      choiceCount += 1;
      choiceOptions.push(...ARTISAN_TOOL_OPTIONS, ...MUSICAL_INSTRUMENT_OPTIONS);
      labels.push('ferramenta de artesão ou instrumento musical');
      continue;
    }

    const oneChoiceMatch = trimmed.match(/^one\s+(.+)$/i);
    if (oneChoiceMatch?.[1]) {
      const descriptor = oneChoiceMatch[1];
      choiceCount += 1;
      choiceOptions.push(...getToolOptionsForDescriptor(descriptor));
      labels.push(descriptor.toLowerCase());
      continue;
    }

    fixedTools.push(displayToolToken(trimmed));
  }

  return {
    fixedTools: uniqueChoices(fixedTools),
    choiceCount,
    choiceLabel: uniqueChoices(labels).join(' ou ') || undefined,
    choiceOptions: uniqueChoices(choiceOptions)
  };
};
