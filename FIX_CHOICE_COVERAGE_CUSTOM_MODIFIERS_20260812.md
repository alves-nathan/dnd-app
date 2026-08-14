# Fixed 20 — Choice coverage and generic custom modifiers

## Character-creation choice coverage

- Artificer now reads `skillChoiceCount`, `skillProficienciesChoice`, fixed tools, and structured `mechanics.toolProficiencyChoice` from the imported class payload instead of relying on PHB-only class tables.
- Custom Lineage exposes direct size choice, Darkvision-or-skill variable trait, additional feat choice, and its direct language choice.
- Imported species with direct `sizeOptions` or `languageProficiencyChoice` are exposed through the species choice resolver.
- House Agent exposes the Dragonmarked House choice; direct background tool choices remain handled by proficiency rules.
- Feat parsing now supports plural `spellChoices` used by Artificer Initiate and Aberrant Dragonmark and singular generic `spellChoice` used by Boon of Siberys.
- Feat choice families that still require specialized dynamic catalogs (Eldritch Adept invocation, Fighting Initiate style, Metamagic Adept options, Martial Adept maneuvers) fail closed with `FEAT_CHOICE_EDITOR_UNAVAILABLE` instead of silently applying an incomplete feat.

## Generic custom feat/feature modifier model

Custom feat/features can persist declarative modifier rules. Supported runtime targets exposed by the editor are:

- proficiencies: grant/remove skill, tool, saving throw, weapon, armor, language;
- ability/skill/tool checks and saving throws;
- attack rolls and spell attack rolls;
- spell save DC;
- spell damage and general outgoing damage;
- incoming damage;
- Armor Class;
- initiative.

Supported operations include additive positive/negative terms, multiplication, advantage/disadvantage, and proficiency grants/removals. Additive formulas can combine a flat term, an arbitrary multiplier of proficiency bonus, and an arbitrary multiplier of a chosen ability modifier. Selectors can scope rules by skill, tool, ability, spell item/name, spell school, damage type, action type, and proficiency kind/value.

The model is intentionally declarative. It does not execute arbitrary JavaScript or user scripts. New engine dimensions can be added by wiring another typed target into the same resolver.
