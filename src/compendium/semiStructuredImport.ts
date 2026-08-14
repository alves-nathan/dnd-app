import type { CompendiumImportInput } from './schemas';
import type { CompendiumItemType } from './types';
import type { ActionCost, RuleSource, RuleValidationIssue, SourceConfidence } from '../types';

export interface SemiStructuredSourceDraft {
  id: string;
  book?: string;
  page?: string;
  version?: string;
  notes?: string;
}

export interface SemiStructuredImportOptions {
  packId?: string;
  defaultKind?: CompendiumItemType | 'auto';
  source: SemiStructuredSourceDraft;
  maxCandidates?: number;
}

export interface SemiStructuredImportCandidate {
  id: string;
  kind: CompendiumItemType;
  name: string;
  summary?: string;
  source: RuleSource;
  payload: Record<string, unknown>;
  evidence: string[];
  confidence: SourceConfidence;
  issues: RuleValidationIssue[];
}

export interface SemiStructuredImportDraft {
  ok: boolean;
  pack: CompendiumImportInput;
  candidates: SemiStructuredImportCandidate[];
  issues: RuleValidationIssue[];
  generatedJson: string;
}

const itemKinds: CompendiumItemType[] = ['class', 'subclass', 'species', 'background', 'feat', 'weapon', 'armor', 'equipment', 'magicItem', 'spell', 'feature', 'condition', 'creatureStatBlock'];
const abilityTokens = ['STR', 'DEX', 'CON', 'INT', 'WIS', 'CHA', 'PB'];
const damageFormulaPattern = /\b\d+d\d+(?:\s*(?:\+|-)\s*(?:\d+|STR|DEX|CON|INT|WIS|CHA|PB|proficiency bonus|profici[êe]ncia|mod(?:ifier|ificador)?))*/gi;
const savePattern = /\b(STR|DEX|CON|INT|WIS|CHA|strength|dexterity|constitution|intelligence|wisdom|charisma)\s+(?:save|saving throw|resistência|resistencia|salvaguarda|teste de resistência|teste de resistencia)\b/i;

const normalize = (value: string): string =>
  value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();

const slugify = (value: string, fallback = 'item'): string => {
  const slug = normalize(value)
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64);
  return slug || fallback;
};

const unique = <T>(values: T[]): T[] => Array.from(new Set(values));

const clampCandidates = (values: SemiStructuredImportCandidate[], maxCandidates?: number): SemiStructuredImportCandidate[] =>
  typeof maxCandidates === 'number' && maxCandidates > 0 ? values.slice(0, maxCandidates) : values;

const sourceFromOptions = (options: SemiStructuredImportOptions): RuleSource => ({
  id: options.source.id.trim() || 'semi-structured-source',
  book: options.source.book?.trim() || undefined,
  page: options.source.page?.trim() || undefined,
  version: options.source.version?.trim() || undefined,
  status: 'needsReview',
  confidence: 'importedNeedsReview',
  notes: options.source.notes?.trim() || 'Criado pelo assistente de importação semi-estruturada. Requer revisão manual antes de alimentar a engine.'
});

interface TextSection {
  heading: string;
  body: string;
  startLine: number;
}

const stripMarkdownMarks = (line: string): string => line.replace(/^#{1,6}\s+/, '').replace(/^[-*]\s+/, '').replace(/[*_`]/g, '').trim();

export const splitSemiStructuredTextIntoSections = (input: string): TextSection[] => {
  const lines = input.replace(/\r\n/g, '\n').split('\n');
  const sections: TextSection[] = [];
  let current: TextSection | undefined;

  const pushCurrent = () => {
    if (!current) return;
    const body = current.body.trim();
    if (current.heading.trim() || body) sections.push({ ...current, heading: current.heading.trim(), body });
  };

  lines.forEach((rawLine, index) => {
    const line = rawLine.trim();
    const isHeading = /^#{1,6}\s+\S+/.test(line);
    const isNameLine = !isHeading && Boolean(line) && line.length <= 80 && !/[.:;]$/.test(line) && index + 1 < lines.length && Boolean(lines[index + 1]?.trim());

    if (isHeading || (!current && isNameLine)) {
      pushCurrent();
      current = { heading: stripMarkdownMarks(line), body: '', startLine: index + 1 };
      return;
    }

    if (!current) {
      if (!line) return;
      current = { heading: stripMarkdownMarks(line).slice(0, 80), body: '', startLine: index + 1 };
      return;
    }

    current.body += `${rawLine}\n`;
  });

  pushCurrent();

  if (sections.length <= 1) {
    return input
      .split(/\n\s*\n+/)
      .map((block, index) => block.trim())
      .filter(Boolean)
      .map((block, index) => {
        const [firstLine = `Item ${index + 1}`, ...rest] = block.split('\n');
        return { heading: stripMarkdownMarks(firstLine).slice(0, 80), body: rest.join('\n').trim() || block, startLine: index + 1 };
      });
  }

  return sections;
};

const inferKind = (section: TextSection, requested?: CompendiumItemType | 'auto'): CompendiumItemType => {
  if (requested && requested !== 'auto' && itemKinds.includes(requested)) return requested;
  const text = normalize(`${section.heading}\n${section.body}`);

  if (/\b(cantrip|spell|magia|truque|slot|casting time|tempo de conjuracao|alcance|components?)\b/.test(text)) return 'spell';
  if (/\b(weapon|arma|melee|ranged|versatile|finesse|nick|vex|sap|slow|mastery|maestria)\b/.test(text)) return 'weapon';
  if (/\b(armor|armadura|shield|escudo|ac\s*\d+|ca\s*\d+)\b/.test(text)) return 'armor';
  if (/\b(condition|condicao|condição|restrained|prone|frightened|poisoned|grappled|invisible)\b/.test(text)) return 'condition';
  if (/\b(feat|talento)\b/.test(text)) return 'feat';
  if (/\b(species|especie|espécie|race|raca|raça)\b/.test(text)) return 'species';
  if (/\b(background|antecedente)\b/.test(text)) return 'background';
  if (/\b(subclass|subclasse|patron|patrono|domain|dominio|domínio|school|tradition)\b/.test(text)) return 'subclass';
  if (/\b(class|classe|hit die|dado de vida)\b/.test(text)) return 'class';
  if (/\b(magic item|item magico|item mágico|attunement|sintonizacao|sintonização)\b/.test(text)) return 'magicItem';
  if (/\b(equipment|equipamento|tool|ferramenta)\b/.test(text)) return 'equipment';
  return 'feature';
};

const inferActionCost = (text: string): ActionCost | undefined => {
  const normalized = normalize(text);
  if (/\bbonus action\b|\bacao bonus\b|\bação bônus\b/.test(normalized)) return 'bonusAction';
  if (/\breaction\b|\breacao\b|\breação\b/.test(normalized)) return 'reaction';
  if (/\bmovement\b|\bmovimento\b/.test(normalized)) return 'movement';
  if (/\bfree action\b|\bsem acao\b|\bsem ação\b|\bfree\b/.test(normalized)) return 'free';
  if (/\bspecial\b|\bespecial\b/.test(normalized)) return 'special';
  if (/\baction\b|\bacao\b|\bação\b|\battack action\b/.test(normalized)) return 'action';
  return undefined;
};

const inferWeaponType = (text: string): string | undefined => {
  const normalized = normalize(text);
  if (/\bfinesse\b|\bacuidade\b/.test(normalized)) return 'finesse';
  if (/\bthrown\b|\barremess/.test(normalized)) return 'thrown';
  if (/\branged\b|\bdistancia\b|\bà distância\b/.test(normalized)) return 'ranged';
  if (/\bmelee\b|\bcorpo a corpo\b/.test(normalized)) return 'melee';
  return undefined;
};

const inferSpellLevel = (text: string): number | undefined => {
  const normalized = normalize(text);
  if (/\bcantrip\b|\btruque\b/.test(normalized)) return 0;
  const explicit = normalized.match(/(?:level|nivel|nível|circulo|círculo)\s*(\d)/);
  if (explicit?.[1]) return Number(explicit[1]);
  const ordinal = normalized.match(/(\d)(?:st|nd|rd|th)[-\s]*level/);
  if (ordinal?.[1]) return Number(ordinal[1]);
  return undefined;
};

const inferSaveAbility = (text: string): string | undefined => {
  const match = text.match(savePattern);
  if (!match?.[1]) return undefined;
  const token = normalize(match[1]);
  if (token.startsWith('str') || token.startsWith('for')) return 'STR';
  if (token.startsWith('dex') || token.startsWith('des')) return 'DEX';
  if (token.startsWith('con')) return 'CON';
  if (token.startsWith('int')) return 'INT';
  if (token.startsWith('wis') || token.startsWith('sab')) return 'WIS';
  if (token.startsWith('cha') || token.startsWith('car')) return 'CHA';
  return undefined;
};

const extractDamageFormulas = (text: string): string[] => {
  const matches = text.match(damageFormulaPattern) ?? [];
  return unique(
    matches
      .map((match) =>
        match
          .replace(/proficiency bonus|profici[êe]ncia/gi, 'PB')
          .replace(/mod(?:ifier|ificador)?/gi, '')
          .replace(/\s+/g, ' ')
          .trim()
      )
      .filter(Boolean)
  );
};

const inferResourceHints = (text: string): Record<string, unknown> => {
  const normalized = normalize(text);
  const payload: Record<string, unknown> = {};
  const rest = normalized.match(/(?:per|por)\s+(short rest|long rest|descanso curto|descanso longo|day|dia)/);
  const uses = normalized.match(/(?:use|uses|uso|usos|vez(?:es)?)\s*(?:equal to|igual a|:)?\s*(\d+|proficiency bonus|pb|profici[êe]ncia)/);

  if (uses?.[1]) {
    payload.resourceHint = {
      amount: uses[1].replace(/proficiency bonus|profici[êe]ncia/gi, 'PB'),
      recharge: rest?.[1]?.includes('short') || rest?.[1]?.includes('curto') ? 'shortRest' : rest?.[1]?.includes('long') || rest?.[1]?.includes('longo') ? 'longRest' : rest?.[1]?.includes('day') || rest?.[1]?.includes('dia') ? 'day' : 'manual'
    };
  }

  if (/once per turn|uma vez por turno/.test(normalized)) payload.oncePerTurnHint = true;
  if (/concentration|concentracao|concentração/.test(normalized)) payload.requiresConcentration = true;

  return payload;
};

const firstSentence = (text: string): string | undefined => {
  const clean = text.replace(/\s+/g, ' ').trim();
  if (!clean) return undefined;
  const sentence = clean.match(/^.{1,220}?(?:[.!?]|$)/)?.[0]?.trim();
  return sentence || clean.slice(0, 220);
};

const createCandidateIssues = (candidate: Pick<SemiStructuredImportCandidate, 'name' | 'kind' | 'payload' | 'source'>, evidence: string[]): RuleValidationIssue[] => {
  const issues: RuleValidationIssue[] = [
    {
      severity: 'warning',
      code: 'SEMI_STRUCTURED_REVIEW_REQUIRED',
      message: `"${candidate.name}" foi detectado a partir de texto/Markdown. Revise campos, página e interpretação antes de validar.`,
      source: candidate.source
    }
  ];

  if (!evidence.length) {
    issues.push({ severity: 'warning', code: 'SEMI_STRUCTURED_NO_MECHANICAL_EVIDENCE', message: `Nenhuma fórmula, ação ou custo mecânico claro foi detectado em "${candidate.name}".`, source: candidate.source });
  }

  if (candidate.kind === 'spell' && !('damageFormula' in candidate.payload) && !('effectTemplates' in candidate.payload)) {
    issues.push({ severity: 'warning', code: 'SEMI_STRUCTURED_SPELL_INCOMPLETE', message: `A magia "${candidate.name}" não tem dano ou efeito ativo detectado automaticamente.`, source: candidate.source });
  }

  return issues;
};

export const buildSemiStructuredCandidate = (
  section: TextSection,
  index: number,
  options: SemiStructuredImportOptions,
  source: RuleSource
): SemiStructuredImportCandidate => {
  const fullText = `${section.heading}\n${section.body}`.trim();
  const kind = inferKind(section, options.defaultKind);
  const formulas = extractDamageFormulas(fullText);
  const actionCost = inferActionCost(fullText);
  const payload: Record<string, unknown> = {
    importedText: fullText,
    importedLine: section.startLine,
    mappingStatus: 'draftFromSemiStructuredText'
  };
  const evidence: string[] = [];

  if (formulas.length) {
    payload.damageFormula = formulas[0];
    if (formulas.length > 1) payload.detectedDamageFormulas = formulas;
    evidence.push(`Fórmula(s) detectada(s): ${formulas.join(', ')}`);
  }
  if (actionCost) {
    payload.actionCost = actionCost;
    evidence.push(`Custo de ação detectado: ${actionCost}`);
  }

  if (kind === 'weapon') {
    const weaponType = inferWeaponType(fullText);
    if (weaponType) payload.weaponType = weaponType;
  }

  if (kind === 'spell') {
    const spellLevel = inferSpellLevel(fullText);
    const saveAbility = inferSaveAbility(fullText);
    if (spellLevel !== undefined) payload.level = spellLevel;
    if (saveAbility) payload.saveAbility = saveAbility;
    if (/spell attack|ataque de magia/.test(normalize(fullText))) payload.requiresAttackRoll = true;
    if (/half damage|metade do dano|meio dano/.test(normalize(fullText))) payload.saveForHalfHint = true;
    if (/higher levels?|slot superior|círculo superior|circulo superior/.test(normalize(fullText))) payload.scalingHint = 'Texto menciona escala/upcast; revise e converta para steps explícitos no editor visual.';
  }

  if (kind === 'armor') {
    const armorClass = normalize(fullText).match(/(?:ac|ca|armor class|classe de armadura)\s*[:=]?\s*(\d+)/);
    if (armorClass?.[1]) payload.baseAC = Number(armorClass[1]);
  }

  Object.assign(payload, inferResourceHints(fullText));

  const candidate = {
    id: `${slugify(section.heading || `item-${index + 1}`)}-${index + 1}`,
    kind,
    name: stripMarkdownMarks(section.heading || `Item ${index + 1}`),
    summary: firstSentence(section.body || section.heading),
    source,
    payload,
    evidence,
    confidence: 'importedNeedsReview' as const,
    issues: [] as RuleValidationIssue[]
  };

  return { ...candidate, issues: createCandidateIssues(candidate, evidence) };
};

export const buildSemiStructuredImportDraft = (text: string, options: SemiStructuredImportOptions): SemiStructuredImportDraft => {
  const source = sourceFromOptions(options);
  const issues: RuleValidationIssue[] = [];

  if (!text.trim()) {
    const pack: CompendiumImportInput = { id: options.packId || 'semi-structured-empty', source, items: [] };
    const issue = { severity: 'error' as const, code: 'SEMI_STRUCTURED_EMPTY_TEXT', message: 'Cole texto ou Markdown antes de gerar rascunho.', source };
    return { ok: false, pack, candidates: [], issues: [issue], generatedJson: JSON.stringify(pack, null, 2) };
  }

  if (!options.source.book && !options.source.notes) {
    issues.push({ severity: 'warning', code: 'SEMI_STRUCTURED_SOURCE_METADATA_INCOMPLETE', message: 'Informe livro/fonte ou notas para auditoria da importação.', source });
  }

  const sections = splitSemiStructuredTextIntoSections(text);
  const candidates = clampCandidates(
    sections
      .filter((section) => section.heading || section.body)
      .map((section, index) => buildSemiStructuredCandidate(section, index, options, source)),
    options.maxCandidates
  );

  if (!candidates.length) {
    issues.push({ severity: 'error', code: 'SEMI_STRUCTURED_NO_CANDIDATES', message: 'Nenhum candidato de regra foi detectado no texto colado.', source });
  }

  const pack: CompendiumImportInput = {
    id: options.packId?.trim() || `semi-${slugify(options.source.book || options.source.id || 'import')}`,
    source,
    items: candidates.map((candidate) => ({
      id: candidate.id,
      kind: candidate.kind,
      name: candidate.name,
      summary: candidate.summary,
      source: candidate.source,
      payload: candidate.payload
    }))
  };

  const allIssues = [...issues, ...candidates.flatMap((candidate) => candidate.issues)];
  return {
    ok: !allIssues.some((issue) => issue.severity === 'error'),
    pack,
    candidates,
    issues: allIssues,
    generatedJson: JSON.stringify(pack, null, 2)
  };
};

export const summarizeSemiStructuredDraft = (draft: SemiStructuredImportDraft): string =>
  draft.candidates
    .map((candidate) => `${candidate.name} · ${candidate.kind} · ${candidate.evidence.length ? candidate.evidence.join('; ') : 'sem evidência mecânica clara'}`)
    .join('\n');
