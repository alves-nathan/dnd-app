import {
  buildExtractorPrompt,
  buildStandardImportJsonObject,
  buildStandardImportJsonTemplate,
  buildStandardImportMarkdownTemplate,
  STANDARD_IMPORT_TEMPLATE_VERSION,
  validateStandardImportTemplateJson
} from '../compendium/importTemplate';
import { IMPORT_TEMPLATE_VERSION_V2 } from '../compendium/importVersions';

describe('standard import template V2', () => {
  it('generates a V2 JSON template accepted by the canonical version-aware importer', () => {
    const json = buildStandardImportJsonTemplate({ packId: 'test-pack', sourceId: 'test-source', book: 'Fonte própria', includeAllTypes: false });
    const preview = validateStandardImportTemplateJson(json);

    expect(preview.ok).toBe(true);
    expect(preview.data?.templateVersion).toBe(IMPORT_TEMPLATE_VERSION_V2);
    expect(preview.data?.id).toBe('test-pack');
    expect(preview.data?.items.length).toBe(6);
    expect(preview.data?.items[0]?.source.status).toBe('needsReview');
    expect(preview.data?.items[0]?.source.confidence).toBe('importedNeedsReview');
  });

  it('includes the six representative kinds required by the V2 template contract', () => {
    const template = buildStandardImportJsonObject({ includeAllTypes: false });
    const kinds = template.items.map((item) => item.kind);

    expect(template.templateVersion).toBe(STANDARD_IMPORT_TEMPLATE_VERSION);
    expect(kinds).toEqual(['class', 'feature', 'spell', 'background', 'feat', 'equipment']);
    expect(template.items.find((item) => item.kind === 'class')?.payload).toHaveProperty('progression');
    expect(template.items.find((item) => item.kind === 'spell')?.payload).toHaveProperty('classes');
    expect(template.items.find((item) => item.kind === 'background')?.payload).toHaveProperty('skillProficiencies');
    expect(template.items.find((item) => item.kind === 'equipment')?.payload).toHaveProperty('cost');
  });

  it('generates a full template covering every current entity kind', () => {
    const template = buildStandardImportJsonObject({ includeAllTypes: true });
    expect(new Set(template.items.map((item) => item.kind)).size).toBe(13);
    expect(validateStandardImportTemplateJson(JSON.stringify(template)).ok).toBe(true);
  });

  it('generates markdown explicitly targeting V2', () => {
    const markdown = buildStandardImportMarkdownTemplate({ sourceId: 'owned-source', book: 'Fonte própria', includeAllTypes: false });

    expect(markdown).toContain('TemplateVersion: dnd-combat-import.v2');
    expect(markdown).toContain('SourceId: owned-source');
    expect(markdown).toContain('```json');
    expect(markdown).toContain('## class:');
    expect(markdown).toContain('## spell:');
  });

  it('generates an extraction prompt from V2 schema documentation instead of teaching V1', () => {
    const prompt = buildExtractorPrompt({ sourceName: 'Meu livro', outputFormat: 'json', includeAllTypes: false });

    expect(prompt).toContain('dnd-combat-import.v2');
    expect(prompt).toContain('Não invente regra');
    expect(prompt).toContain('Não reproduza trechos longos');
    expect(prompt).toContain('Payloads por kind');
    expect(prompt).toContain('CurrencyValue estruturado');
    expect(prompt).toContain('JSON válido');
    expect(prompt).not.toContain('dnd-combat-import.v1');
  });
});
