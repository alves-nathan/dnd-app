import {
  ARTISAN_TOOL_OPTIONS,
  GAMING_SET_OPTIONS,
  MUSICAL_INSTRUMENT_OPTIONS,
  STANDARD_LANGUAGE_OPTIONS,
  getToolOptionsForDescriptor,
  parseToolProficiencyEntries,
  toggleChoice
} from '../characters/choiceOptions';

describe('controlled rule choice options', () => {
  it('maps tool descriptors to their exact selectable families', () => {
    expect(getToolOptionsForDescriptor('Musical Instruments')).toEqual(MUSICAL_INSTRUMENT_OPTIONS);
    expect(getToolOptionsForDescriptor("Artisan's Tools")).toEqual(ARTISAN_TOOL_OPTIONS);
    expect(getToolOptionsForDescriptor('Gaming Set')).toEqual(GAMING_SET_OPTIONS);
  });

  it('derives class and background choice requirements without persisting placeholder text', () => {
    expect(parseToolProficiencyEntries(['musicalInstrument:3'])).toMatchObject({
      fixedTools: [],
      choiceCount: 3,
      choiceLabel: 'instrumentos musicais'
    });
    expect(parseToolProficiencyEntries(["one Artisan's Tools"])).toMatchObject({
      fixedTools: [],
      choiceCount: 1
    });
    expect(parseToolProficiencyEntries(["Thieves' Tools"])).toMatchObject({
      fixedTools: ["Thieves' Tools"],
      choiceCount: 0
    });
  });

  it('keeps selected choices removable after the limit is reached', () => {
    const full = ['Bagpipes', 'Lute', 'Viol'];
    expect(toggleChoice(full, 'Flute', 3)).toEqual(full);
    expect(toggleChoice(full, 'Lute', 3)).toEqual(['Bagpipes', 'Viol']);
  });

  it('provides the standard language choices without duplicating Common', () => {
    expect(STANDARD_LANGUAGE_OPTIONS).toContain('Common Sign Language');
    expect(STANDARD_LANGUAGE_OPTIONS).toContain('Elvish');
    expect(STANDARD_LANGUAGE_OPTIONS).not.toContain('Common');
  });
});
