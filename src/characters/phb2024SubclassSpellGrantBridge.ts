/**
 * Compact spell-grant evidence projected from catalog v4.8.0 and canonicalized
 * to the current Compendium V2 ids.
 *
 * This bridge preserves ownership and referenced spell ids. FIX39 also attaches
 * conservative runtime policies only where the bundled Compendium already states
 * that the subclass spells are always prepared/granted. Conditional terrain lists,
 * subclass spellcasting, spellbook rules, and special free-cast features stay out
 * of this bridge behavior and are handled by later dedicated phases.
 */
export interface Phb2024SubclassSpellGrantBridgeGroup {
  groupIndex: number;
  spellReferences: readonly string[];
}

export interface Phb2024SubclassSpellGrantBridgeEntry {
  id: string;
  runtimeClassId: string;
  classId: string;
  runtimeSubclassId: string;
  subclassId: string;
  groups: readonly Phb2024SubclassSpellGrantBridgeGroup[];
}

export const PHB2024_SUBCLASS_SPELL_GRANT_BRIDGE: readonly Phb2024SubclassSpellGrantBridgeEntry[] = [
  {
    id: "phb-2024-subclass-spell-grant-barbarian-wild-heart",
    runtimeClassId: "phb-2024-class-barbarian",
    classId: "phb-2024-class-barbarian",
    runtimeSubclassId: "phb-2024-subclass-barbarian-wild-heart",
    subclassId: "phb-2024-subclass-barbarian-path-of-the-wild-heart",
    groups: [
      { groupIndex: 0, spellReferences: ["phb-2024-spell-beast-sense", "phb-2024-spell-speak-with-animals"] },
      { groupIndex: 1, spellReferences: ["phb-2024-spell-commune-with-nature"] },
    ]
  },
  {
    id: "phb-2024-subclass-spell-grant-bard-glamour",
    runtimeClassId: "phb-2024-class-bard",
    classId: "phb-2024-class-bard",
    runtimeSubclassId: "phb-2024-subclass-bard-glamour",
    subclassId: "phb-2024-subclass-bard-college-of-glamour",
    groups: [
      { groupIndex: 0, spellReferences: ["phb-2024-spell-charm-person", "phb-2024-spell-mirror-image"] },
      { groupIndex: 1, spellReferences: ["phb-2024-spell-command"] },
    ]
  },
  {
    id: "phb-2024-subclass-spell-grant-cleric-life-domain",
    runtimeClassId: "phb-2024-class-cleric",
    classId: "phb-2024-class-cleric",
    runtimeSubclassId: "phb-2024-subclass-cleric-life-domain",
    subclassId: "phb-2024-subclass-cleric-life-domain",
    groups: [
      { groupIndex: 0, spellReferences: ["phb-2024-spell-aid", "phb-2024-spell-bless", "phb-2024-spell-cure-wounds", "phb-2024-spell-lesser-restoration"] },
      { groupIndex: 1, spellReferences: ["phb-2024-spell-mass-healing-word", "phb-2024-spell-revivify"] },
      { groupIndex: 2, spellReferences: ["phb-2024-spell-aura-of-life", "phb-2024-spell-death-ward"] },
      { groupIndex: 3, spellReferences: ["phb-2024-spell-greater-restoration", "phb-2024-spell-mass-cure-wounds"] },
    ]
  },
  {
    id: "phb-2024-subclass-spell-grant-cleric-light-domain",
    runtimeClassId: "phb-2024-class-cleric",
    classId: "phb-2024-class-cleric",
    runtimeSubclassId: "phb-2024-subclass-cleric-light-domain",
    subclassId: "phb-2024-subclass-cleric-light-domain",
    groups: [
      { groupIndex: 0, spellReferences: ["phb-2024-spell-burning-hands", "phb-2024-spell-faerie-fire", "phb-2024-spell-scorching-ray", "phb-2024-spell-see-invisibility"] },
      { groupIndex: 1, spellReferences: ["phb-2024-spell-daylight", "phb-2024-spell-fireball"] },
      { groupIndex: 2, spellReferences: ["phb-2024-spell-arcane-eye", "phb-2024-spell-wall-of-fire"] },
      { groupIndex: 3, spellReferences: ["phb-2024-spell-flame-strike", "phb-2024-spell-scrying"] },
    ]
  },
  {
    id: "phb-2024-subclass-spell-grant-cleric-trickery-domain",
    runtimeClassId: "phb-2024-class-cleric",
    classId: "phb-2024-class-cleric",
    runtimeSubclassId: "phb-2024-subclass-cleric-trickery-domain",
    subclassId: "phb-2024-subclass-cleric-trickery-domain",
    groups: [
      { groupIndex: 0, spellReferences: ["phb-2024-spell-charm-person", "phb-2024-spell-disguise-self", "phb-2024-spell-invisibility", "phb-2024-spell-pass-without-trace"] },
      { groupIndex: 1, spellReferences: ["phb-2024-spell-hypnotic-pattern", "phb-2024-spell-nondetection"] },
      { groupIndex: 2, spellReferences: ["phb-2024-spell-confusion", "phb-2024-spell-dimension-door"] },
      { groupIndex: 3, spellReferences: ["phb-2024-spell-dominate-person", "phb-2024-spell-modify-memory"] },
    ]
  },
  {
    id: "phb-2024-subclass-spell-grant-cleric-war-domain",
    runtimeClassId: "phb-2024-class-cleric",
    classId: "phb-2024-class-cleric",
    runtimeSubclassId: "phb-2024-subclass-cleric-war-domain",
    subclassId: "phb-2024-subclass-cleric-war-domain",
    groups: [
      { groupIndex: 0, spellReferences: ["phb-2024-spell-guiding-bolt", "phb-2024-spell-magic-weapon", "phb-2024-spell-shield-of-faith", "phb-2024-spell-spiritual-weapon"] },
      { groupIndex: 1, spellReferences: ["phb-2024-spell-crusader-s-mantle", "phb-2024-spell-spirit-guardians"] },
      { groupIndex: 2, spellReferences: ["phb-2024-spell-fire-shield", "phb-2024-spell-freedom-of-movement"] },
      { groupIndex: 3, spellReferences: ["phb-2024-spell-hold-monster", "phb-2024-spell-steel-wind-strike"] },
    ]
  },
  {
    id: "phb-2024-subclass-spell-grant-druid-land-arid",
    runtimeClassId: "phb-2024-class-druid",
    classId: "phb-2024-class-druid",
    runtimeSubclassId: "phb-2024-subclass-druid-land",
    subclassId: "phb-2024-subclass-druid-circle-of-the-land",
    groups: [
      { groupIndex: 0, spellReferences: ["phb-2024-spell-blur", "phb-2024-spell-burning-hands", "phb-2024-spell-fire-bolt"] },
      { groupIndex: 1, spellReferences: ["phb-2024-spell-fireball"] },
      { groupIndex: 2, spellReferences: ["phb-2024-spell-blight"] },
      { groupIndex: 3, spellReferences: ["phb-2024-spell-wall-of-stone"] },
    ]
  },
  {
    id: "phb-2024-subclass-spell-grant-druid-land-polar",
    runtimeClassId: "phb-2024-class-druid",
    classId: "phb-2024-class-druid",
    runtimeSubclassId: "phb-2024-subclass-druid-land",
    subclassId: "phb-2024-subclass-druid-circle-of-the-land",
    groups: [
      { groupIndex: 0, spellReferences: ["phb-2024-spell-fog-cloud", "phb-2024-spell-hold-person", "phb-2024-spell-ray-of-frost"] },
      { groupIndex: 1, spellReferences: ["phb-2024-spell-sleet-storm"] },
      { groupIndex: 2, spellReferences: ["phb-2024-spell-ice-storm"] },
      { groupIndex: 3, spellReferences: ["phb-2024-spell-cone-of-cold"] },
    ]
  },
  {
    id: "phb-2024-subclass-spell-grant-druid-land-temperate",
    runtimeClassId: "phb-2024-class-druid",
    classId: "phb-2024-class-druid",
    runtimeSubclassId: "phb-2024-subclass-druid-land",
    subclassId: "phb-2024-subclass-druid-circle-of-the-land",
    groups: [
      { groupIndex: 0, spellReferences: ["phb-2024-spell-misty-step", "phb-2024-spell-shocking-grasp", "phb-2024-spell-sleep"] },
      { groupIndex: 1, spellReferences: ["phb-2024-spell-lightning-bolt"] },
      { groupIndex: 2, spellReferences: ["phb-2024-spell-freedom-of-movement"] },
      { groupIndex: 3, spellReferences: ["phb-2024-spell-tree-stride"] },
    ]
  },
  {
    id: "phb-2024-subclass-spell-grant-druid-land-tropical",
    runtimeClassId: "phb-2024-class-druid",
    classId: "phb-2024-class-druid",
    runtimeSubclassId: "phb-2024-subclass-druid-land",
    subclassId: "phb-2024-subclass-druid-circle-of-the-land",
    groups: [
      { groupIndex: 0, spellReferences: ["phb-2024-spell-acid-splash", "phb-2024-spell-ray-of-sickness", "phb-2024-spell-web"] },
      { groupIndex: 1, spellReferences: ["phb-2024-spell-stinking-cloud"] },
      { groupIndex: 2, spellReferences: ["phb-2024-spell-polymorph"] },
      { groupIndex: 3, spellReferences: ["phb-2024-spell-insect-plague"] },
    ]
  },
  {
    id: "phb-2024-subclass-spell-grant-druid-moon",
    runtimeClassId: "phb-2024-class-druid",
    classId: "phb-2024-class-druid",
    runtimeSubclassId: "phb-2024-subclass-druid-moon",
    subclassId: "phb-2024-subclass-druid-circle-of-the-moon",
    groups: [
      { groupIndex: 0, spellReferences: ["phb-2024-spell-cure-wounds", "phb-2024-spell-moonbeam", "phb-2024-spell-starry-wisp"] },
      { groupIndex: 1, spellReferences: ["phb-2024-spell-conjure-animals"] },
      { groupIndex: 2, spellReferences: ["phb-2024-spell-fount-of-moonlight"] },
      { groupIndex: 3, spellReferences: ["phb-2024-spell-mass-cure-wounds"] },
    ]
  },
  {
    id: "phb-2024-subclass-spell-grant-druid-sea",
    runtimeClassId: "phb-2024-class-druid",
    classId: "phb-2024-class-druid",
    runtimeSubclassId: "phb-2024-subclass-druid-sea",
    subclassId: "phb-2024-subclass-druid-circle-of-the-sea",
    groups: [
      { groupIndex: 0, spellReferences: ["phb-2024-spell-fog-cloud", "phb-2024-spell-gust-of-wind", "phb-2024-spell-ray-of-frost", "phb-2024-spell-shatter", "phb-2024-spell-thunderwave"] },
      { groupIndex: 1, spellReferences: ["phb-2024-spell-lightning-bolt", "phb-2024-spell-water-breathing"] },
      { groupIndex: 2, spellReferences: ["phb-2024-spell-control-water", "phb-2024-spell-ice-storm"] },
      { groupIndex: 3, spellReferences: ["phb-2024-spell-conjure-elemental", "phb-2024-spell-hold-monster"] },
    ]
  },
  {
    id: "phb-2024-subclass-spell-grant-druid-stars",
    runtimeClassId: "phb-2024-class-druid",
    classId: "phb-2024-class-druid",
    runtimeSubclassId: "phb-2024-subclass-druid-stars",
    subclassId: "phb-2024-subclass-druid-circle-of-the-stars",
    groups: [
      { groupIndex: 0, spellReferences: ["phb-2024-spell-guidance", "phb-2024-spell-guiding-bolt"] },
    ]
  },
  {
    id: "phb-2024-subclass-spell-grant-fighter-psi-warrior",
    runtimeClassId: "phb-2024-class-fighter",
    classId: "phb-2024-class-fighter",
    runtimeSubclassId: "phb-2024-subclass-fighter-psi-warrior",
    subclassId: "phb-2024-subclass-fighter-psi-warrior",
    groups: [
      { groupIndex: 0, spellReferences: ["phb-2024-spell-telekinesis"] },
    ]
  },
  {
    id: "phb-2024-subclass-spell-grant-monk-elements",
    runtimeClassId: "phb-2024-class-monk",
    classId: "phb-2024-class-monk",
    runtimeSubclassId: "phb-2024-subclass-monk-elements",
    subclassId: "phb-2024-subclass-monk-warrior-of-the-elements",
    groups: [
      { groupIndex: 0, spellReferences: ["phb-2024-spell-elementalism"] },
    ]
  },
  {
    id: "phb-2024-subclass-spell-grant-monk-shadow",
    runtimeClassId: "phb-2024-class-monk",
    classId: "phb-2024-class-monk",
    runtimeSubclassId: "phb-2024-subclass-monk-shadow",
    subclassId: "phb-2024-subclass-monk-warrior-of-shadow",
    groups: [
      { groupIndex: 0, spellReferences: ["phb-2024-spell-darkness", "phb-2024-spell-minor-illusion"] },
    ]
  },
  {
    id: "phb-2024-subclass-spell-grant-paladin-ancients",
    runtimeClassId: "phb-2024-class-paladin",
    classId: "phb-2024-class-paladin",
    runtimeSubclassId: "phb-2024-subclass-paladin-ancients",
    subclassId: "phb-2024-subclass-paladin-oath-of-the-ancients",
    groups: [
      { groupIndex: 0, spellReferences: ["phb-2024-spell-ensnaring-strike", "phb-2024-spell-speak-with-animals"] },
      { groupIndex: 1, spellReferences: ["phb-2024-spell-misty-step", "phb-2024-spell-moonbeam"] },
      { groupIndex: 2, spellReferences: ["phb-2024-spell-protection-from-energy"] },
      { groupIndex: 3, spellReferences: ["phb-2024-spell-ice-storm", "phb-2024-spell-stoneskin"] },
      { groupIndex: 4, spellReferences: ["phb-2024-spell-commune-with-nature", "phb-2024-spell-tree-stride"] },
    ]
  },
  {
    id: "phb-2024-subclass-spell-grant-paladin-devotion",
    runtimeClassId: "phb-2024-class-paladin",
    classId: "phb-2024-class-paladin",
    runtimeSubclassId: "phb-2024-subclass-paladin-devotion",
    subclassId: "phb-2024-subclass-paladin-oath-of-devotion",
    groups: [
      { groupIndex: 0, spellReferences: ["phb-2024-spell-protection-from-evil-and-good", "phb-2024-spell-shield-of-faith"] },
      { groupIndex: 1, spellReferences: ["phb-2024-spell-aid", "phb-2024-spell-zone-of-truth"] },
      { groupIndex: 2, spellReferences: ["phb-2024-spell-beacon-of-hope", "phb-2024-spell-dispel-magic"] },
      { groupIndex: 3, spellReferences: ["phb-2024-spell-freedom-of-movement", "phb-2024-spell-guardian-of-faith"] },
      { groupIndex: 4, spellReferences: ["phb-2024-spell-commune", "phb-2024-spell-flame-strike"] },
    ]
  },
  {
    id: "phb-2024-subclass-spell-grant-paladin-glory",
    runtimeClassId: "phb-2024-class-paladin",
    classId: "phb-2024-class-paladin",
    runtimeSubclassId: "phb-2024-subclass-paladin-glory",
    subclassId: "phb-2024-subclass-paladin-oath-of-glory",
    groups: [
      { groupIndex: 0, spellReferences: ["phb-2024-spell-guiding-bolt", "phb-2024-spell-heroism"] },
      { groupIndex: 1, spellReferences: ["phb-2024-spell-enhance-ability", "phb-2024-spell-magic-weapon"] },
      { groupIndex: 2, spellReferences: ["phb-2024-spell-haste", "phb-2024-spell-protection-from-energy"] },
      { groupIndex: 3, spellReferences: ["phb-2024-spell-compulsion", "phb-2024-spell-freedom-of-movement"] },
      { groupIndex: 4, spellReferences: ["phb-2024-spell-legend-lore", "phb-2024-spell-yolande-s-regal-presence"] },
    ]
  },
  {
    id: "phb-2024-subclass-spell-grant-paladin-vengeance",
    runtimeClassId: "phb-2024-class-paladin",
    classId: "phb-2024-class-paladin",
    runtimeSubclassId: "phb-2024-subclass-paladin-vengeance",
    subclassId: "phb-2024-subclass-paladin-oath-of-vengeance",
    groups: [
      { groupIndex: 0, spellReferences: ["phb-2024-spell-bane", "phb-2024-spell-hunter-s-mark"] },
      { groupIndex: 1, spellReferences: ["phb-2024-spell-hold-person", "phb-2024-spell-misty-step"] },
      { groupIndex: 2, spellReferences: ["phb-2024-spell-haste", "phb-2024-spell-protection-from-energy"] },
      { groupIndex: 3, spellReferences: ["phb-2024-spell-banishment", "phb-2024-spell-dimension-door"] },
      { groupIndex: 4, spellReferences: ["phb-2024-spell-hold-monster", "phb-2024-spell-scrying"] },
    ]
  },
  {
    id: "phb-2024-subclass-spell-grant-ranger-fey-wanderer",
    runtimeClassId: "phb-2024-class-ranger",
    classId: "phb-2024-class-ranger",
    runtimeSubclassId: "phb-2024-subclass-ranger-fey-wanderer",
    subclassId: "phb-2024-subclass-ranger-fey-wanderer",
    groups: [
      { groupIndex: 0, spellReferences: ["phb-2024-spell-charm-person"] },
      { groupIndex: 1, spellReferences: ["phb-2024-spell-misty-step"] },
      { groupIndex: 2, spellReferences: ["phb-2024-spell-summon-fey"] },
      { groupIndex: 3, spellReferences: ["phb-2024-spell-dimension-door"] },
      { groupIndex: 4, spellReferences: ["phb-2024-spell-mislead"] },
    ]
  },
  {
    id: "phb-2024-subclass-spell-grant-ranger-fey-wanderer-free",
    runtimeClassId: "phb-2024-class-ranger",
    classId: "phb-2024-class-ranger",
    runtimeSubclassId: "phb-2024-subclass-ranger-fey-wanderer",
    subclassId: "phb-2024-subclass-ranger-fey-wanderer",
    groups: [
      { groupIndex: 0, spellReferences: ["phb-2024-spell-summon-fey"] },
      { groupIndex: 1, spellReferences: ["phb-2024-spell-misty-step"] },
    ]
  },
  {
    id: "phb-2024-subclass-spell-grant-ranger-gloom-stalker",
    runtimeClassId: "phb-2024-class-ranger",
    classId: "phb-2024-class-ranger",
    runtimeSubclassId: "phb-2024-subclass-ranger-gloom-stalker",
    subclassId: "phb-2024-subclass-ranger-gloom-stalker",
    groups: [
      { groupIndex: 0, spellReferences: ["phb-2024-spell-disguise-self"] },
      { groupIndex: 1, spellReferences: ["phb-2024-spell-rope-trick"] },
      { groupIndex: 2, spellReferences: ["phb-2024-spell-fear"] },
      { groupIndex: 3, spellReferences: ["phb-2024-spell-greater-invisibility"] },
      { groupIndex: 4, spellReferences: ["phb-2024-spell-seeming"] },
    ]
  },
  {
    id: "phb-2024-subclass-spell-grant-rogue-arcane-trickster",
    runtimeClassId: "phb-2024-class-rogue",
    classId: "phb-2024-class-rogue",
    runtimeSubclassId: "phb-2024-subclass-rogue-arcane-trickster",
    subclassId: "phb-2024-subclass-rogue-arcane-trickster",
    groups: [
      { groupIndex: 0, spellReferences: ["phb-2024-spell-mage-hand"] },
    ]
  },
  {
    id: "phb-2024-subclass-spell-grant-sorcerer-aberrant",
    runtimeClassId: "phb-2024-class-sorcerer",
    classId: "phb-2024-class-sorcerer",
    runtimeSubclassId: "phb-2024-subclass-sorcerer-aberrant",
    subclassId: "phb-2024-subclass-sorcerer-aberrant-sorcery",
    groups: [
      { groupIndex: 0, spellReferences: ["phb-2024-spell-arms-of-hadar", "phb-2024-spell-calm-emotions", "phb-2024-spell-detect-thoughts", "phb-2024-spell-dissonant-whispers"] },
      { groupIndex: 1, spellReferences: ["phb-2024-spell-hunger-of-hadar", "phb-2024-spell-sending"] },
      { groupIndex: 2, spellReferences: ["phb-2024-spell-evard-s-black-tentacles", "phb-2024-spell-summon-aberration"] },
      { groupIndex: 3, spellReferences: ["phb-2024-spell-rarys-telepathic-bond", "phb-2024-spell-telekinesis"] },
    ]
  },
  {
    id: "phb-2024-subclass-spell-grant-sorcerer-clockwork",
    runtimeClassId: "phb-2024-class-sorcerer",
    classId: "phb-2024-class-sorcerer",
    runtimeSubclassId: "phb-2024-subclass-sorcerer-clockwork",
    subclassId: "phb-2024-subclass-sorcerer-clockwork-sorcery",
    groups: [
      { groupIndex: 0, spellReferences: ["phb-2024-spell-aid", "phb-2024-spell-alarm", "phb-2024-spell-lesser-restoration", "phb-2024-spell-protection-from-evil-and-good"] },
      { groupIndex: 1, spellReferences: ["phb-2024-spell-dispel-magic", "phb-2024-spell-protection-from-energy"] },
      { groupIndex: 2, spellReferences: ["phb-2024-spell-freedom-of-movement", "phb-2024-spell-summon-construct"] },
      { groupIndex: 3, spellReferences: ["phb-2024-spell-greater-restoration", "phb-2024-spell-wall-of-force"] },
    ]
  },
  {
    id: "phb-2024-subclass-spell-grant-sorcerer-draconic",
    runtimeClassId: "phb-2024-class-sorcerer",
    classId: "phb-2024-class-sorcerer",
    runtimeSubclassId: "phb-2024-subclass-sorcerer-draconic",
    subclassId: "phb-2024-subclass-sorcerer-draconic-sorcery",
    groups: [
      { groupIndex: 0, spellReferences: ["phb-2024-spell-alter-self", "phb-2024-spell-chromatic-orb", "phb-2024-spell-command", "phb-2024-spell-dragons-breath"] },
      { groupIndex: 1, spellReferences: ["phb-2024-spell-fear", "phb-2024-spell-fly"] },
      { groupIndex: 2, spellReferences: ["phb-2024-spell-arcane-eye", "phb-2024-spell-charm-monster"] },
      { groupIndex: 3, spellReferences: ["phb-2024-spell-legend-lore", "phb-2024-spell-summon-dragon"] },
    ]
  },
  {
    id: "phb-2024-subclass-spell-grant-sorcerer-draconic-free",
    runtimeClassId: "phb-2024-class-sorcerer",
    classId: "phb-2024-class-sorcerer",
    runtimeSubclassId: "phb-2024-subclass-sorcerer-draconic",
    subclassId: "phb-2024-subclass-sorcerer-draconic-sorcery",
    groups: [
      { groupIndex: 0, spellReferences: ["phb-2024-spell-summon-dragon"] },
    ]
  },
  {
    id: "phb-2024-subclass-spell-grant-warlock-archfey",
    runtimeClassId: "phb-2024-class-warlock",
    classId: "phb-2024-class-warlock",
    runtimeSubclassId: "phb-2024-subclass-warlock-archfey",
    subclassId: "phb-2024-subclass-warlock-archfey-patron",
    groups: [
      { groupIndex: 0, spellReferences: ["phb-2024-spell-calm-emotions", "phb-2024-spell-faerie-fire", "phb-2024-spell-misty-step", "phb-2024-spell-phantasmal-force", "phb-2024-spell-sleep"] },
      { groupIndex: 1, spellReferences: ["phb-2024-spell-blink"] },
      { groupIndex: 2, spellReferences: ["phb-2024-spell-dominate-beast", "phb-2024-spell-greater-invisibility"] },
      { groupIndex: 3, spellReferences: ["phb-2024-spell-dominate-person", "phb-2024-spell-seeming"] },
    ]
  },
  {
    id: "phb-2024-subclass-spell-grant-warlock-celestial",
    runtimeClassId: "phb-2024-class-warlock",
    classId: "phb-2024-class-warlock",
    runtimeSubclassId: "phb-2024-subclass-warlock-celestial",
    subclassId: "phb-2024-subclass-warlock-celestial-patron",
    groups: [
      { groupIndex: 0, spellReferences: ["phb-2024-spell-aid", "phb-2024-spell-cure-wounds", "phb-2024-spell-guiding-bolt", "phb-2024-spell-lesser-restoration", "phb-2024-spell-light", "phb-2024-spell-sacred-flame"] },
      { groupIndex: 1, spellReferences: ["phb-2024-spell-daylight", "phb-2024-spell-revivify"] },
      { groupIndex: 2, spellReferences: ["phb-2024-spell-guardian-of-faith", "phb-2024-spell-wall-of-fire"] },
      { groupIndex: 3, spellReferences: ["phb-2024-spell-greater-restoration"] },
    ]
  },
  {
    id: "phb-2024-subclass-spell-grant-warlock-fiend",
    runtimeClassId: "phb-2024-class-warlock",
    classId: "phb-2024-class-warlock",
    runtimeSubclassId: "phb-2024-subclass-warlock-fiend",
    subclassId: "phb-2024-subclass-warlock-fiend-patron",
    groups: [
      { groupIndex: 0, spellReferences: ["phb-2024-spell-burning-hands", "phb-2024-spell-command", "phb-2024-spell-scorching-ray", "phb-2024-spell-suggestion"] },
      { groupIndex: 1, spellReferences: ["phb-2024-spell-fireball", "phb-2024-spell-stinking-cloud"] },
      { groupIndex: 2, spellReferences: ["phb-2024-spell-fire-shield", "phb-2024-spell-wall-of-fire"] },
      { groupIndex: 3, spellReferences: ["phb-2024-spell-geas", "phb-2024-spell-insect-plague"] },
    ]
  },
  {
    id: "phb-2024-subclass-spell-grant-warlock-great-old-one",
    runtimeClassId: "phb-2024-class-warlock",
    classId: "phb-2024-class-warlock",
    runtimeSubclassId: "phb-2024-subclass-warlock-great-old-one",
    subclassId: "phb-2024-subclass-warlock-great-old-one-patron",
    groups: [
      { groupIndex: 0, spellReferences: ["phb-2024-spell-detect-thoughts", "phb-2024-spell-dissonant-whispers", "phb-2024-spell-phantasmal-force"] },
      { groupIndex: 1, spellReferences: ["phb-2024-spell-hunger-of-hadar"] },
      { groupIndex: 2, spellReferences: ["phb-2024-spell-confusion", "phb-2024-spell-summon-aberration"] },
      { groupIndex: 3, spellReferences: ["phb-2024-spell-modify-memory", "phb-2024-spell-telekinesis"] },
      { groupIndex: 4, spellReferences: ["phb-2024-spell-hex"] },
    ]
  },
  {
    id: "phb-2024-subclass-spell-grant-wizard-abjurer",
    runtimeClassId: "phb-2024-class-wizard",
    classId: "phb-2024-class-wizard",
    runtimeSubclassId: "phb-2024-subclass-wizard-abjurer",
    subclassId: "phb-2024-subclass-wizard-abjurer",
    groups: [
      { groupIndex: 0, spellReferences: ["phb-2024-spell-counterspell", "phb-2024-spell-dispel-magic"] },
    ]
  },
  {
    id: "phb-2024-subclass-spell-grant-wizard-diviner",
    runtimeClassId: "phb-2024-class-wizard",
    classId: "phb-2024-class-wizard",
    runtimeSubclassId: "phb-2024-subclass-wizard-diviner",
    subclassId: "phb-2024-subclass-wizard-diviner",
    groups: [
      { groupIndex: 0, spellReferences: ["phb-2024-spell-see-invisibility"] },
    ]
  },
  {
    id: "phb-2024-subclass-spell-grant-wizard-illusionist",
    runtimeClassId: "phb-2024-class-wizard",
    classId: "phb-2024-class-wizard",
    runtimeSubclassId: "phb-2024-subclass-wizard-illusionist",
    subclassId: "phb-2024-subclass-wizard-illusionist",
    groups: [
      { groupIndex: 0, spellReferences: ["phb-2024-spell-minor-illusion"] },
      { groupIndex: 1, spellReferences: ["phb-2024-spell-summon-beast", "phb-2024-spell-summon-fey"] },
    ]
  },
];

export type Phb2024AutomaticSubclassSpellGrantKind = 'alwaysPrepared' | 'granted';

export interface Phb2024AutomaticSubclassSpellGrantPolicyGroup {
  groupIndex: number;
  minimumClassLevel: number;
  kind: Phb2024AutomaticSubclassSpellGrantKind;
}

export interface Phb2024AutomaticSubclassSpellGrantPolicy {
  bridgeId: string;
  groups: readonly Phb2024AutomaticSubclassSpellGrantPolicyGroup[];
}

const alwaysPreparedGroups = (
  bridgeId: string,
  minimumClassLevels: readonly number[],
  includedGroupIndexes?: readonly number[]
): Phb2024AutomaticSubclassSpellGrantPolicy => ({
  bridgeId,
  groups: minimumClassLevels.flatMap((minimumClassLevel, groupIndex) =>
    includedGroupIndexes && !includedGroupIndexes.includes(groupIndex)
      ? []
      : [{ groupIndex, minimumClassLevel, kind: 'alwaysPrepared' as const }]
  )
});

/**
 * Conservative behavior projection for PHB 2024 subclass spell tables.
 *
 * Important exclusions:
 * - Circle of the Land is conditional on a terrain choice and is intentionally
 *   deferred to the conditional-list phase.
 * - Fighter/Monk/Rogue/Wizard bridge entries are special grants or subclass
 *   spellcasting/spellbook mechanics, not automatic subclass spell tables.
 * - Fey Wanderer/Draconic "free" bridge entries describe special free-cast
 *   upgrades already duplicated by their main spell tables; they are not a
 *   second automatic spell source.
 */
export const PHB2024_AUTOMATIC_SUBCLASS_SPELL_GRANT_POLICIES: readonly Phb2024AutomaticSubclassSpellGrantPolicy[] = [
  // College of Glamour: Beguiling Magic always prepares Charm Person and Mirror Image.
  // Command belongs to Mantle of Majesty and remains a special-cast grant for a later phase.
  alwaysPreparedGroups('phb-2024-subclass-spell-grant-bard-glamour', [3, 6], [0]),

  alwaysPreparedGroups('phb-2024-subclass-spell-grant-cleric-life-domain', [3, 5, 7, 9]),
  alwaysPreparedGroups('phb-2024-subclass-spell-grant-cleric-light-domain', [3, 5, 7, 9]),
  alwaysPreparedGroups('phb-2024-subclass-spell-grant-cleric-trickery-domain', [3, 5, 7, 9]),
  alwaysPreparedGroups('phb-2024-subclass-spell-grant-cleric-war-domain', [3, 5, 7, 9]),

  alwaysPreparedGroups('phb-2024-subclass-spell-grant-druid-moon', [3, 5, 7, 9]),
  alwaysPreparedGroups('phb-2024-subclass-spell-grant-druid-sea', [3, 5, 7, 9]),
  {
    bridgeId: 'phb-2024-subclass-spell-grant-druid-stars',
    groups: [{ groupIndex: 0, minimumClassLevel: 3, kind: 'granted' }]
  },

  alwaysPreparedGroups('phb-2024-subclass-spell-grant-paladin-ancients', [3, 5, 9, 13, 17]),
  alwaysPreparedGroups('phb-2024-subclass-spell-grant-paladin-devotion', [3, 5, 9, 13, 17]),
  alwaysPreparedGroups('phb-2024-subclass-spell-grant-paladin-glory', [3, 5, 9, 13, 17]),
  alwaysPreparedGroups('phb-2024-subclass-spell-grant-paladin-vengeance', [3, 5, 9, 13, 17]),

  alwaysPreparedGroups('phb-2024-subclass-spell-grant-ranger-fey-wanderer', [3, 5, 9, 13, 17]),
  alwaysPreparedGroups('phb-2024-subclass-spell-grant-ranger-gloom-stalker', [3, 5, 9, 13, 17]),

  alwaysPreparedGroups('phb-2024-subclass-spell-grant-sorcerer-aberrant', [3, 5, 7, 9]),
  alwaysPreparedGroups('phb-2024-subclass-spell-grant-sorcerer-clockwork', [3, 5, 7, 9]),
  alwaysPreparedGroups('phb-2024-subclass-spell-grant-sorcerer-draconic', [3, 5, 7, 9]),

  alwaysPreparedGroups('phb-2024-subclass-spell-grant-warlock-archfey', [3, 5, 7, 9]),
  alwaysPreparedGroups('phb-2024-subclass-spell-grant-warlock-celestial', [3, 5, 7, 9]),
  alwaysPreparedGroups('phb-2024-subclass-spell-grant-warlock-fiend', [3, 5, 7, 9]),
  // Great Old One also gains Hex as always prepared from Eldritch Hex at level 10.
  alwaysPreparedGroups('phb-2024-subclass-spell-grant-warlock-great-old-one', [3, 5, 7, 9, 10])
];

export interface Phb2024AutomaticSubclassSpellGrant {
  bridgeId: string;
  subclassId: string;
  kind: Phb2024AutomaticSubclassSpellGrantKind;
  minimumClassLevel: number;
  spellReference: string;
}

export const getPhb2024AutomaticSubclassSpellGrants = (
  subclassId: string,
  classLevel: number
): Phb2024AutomaticSubclassSpellGrant[] => {
  const bridgeEntries = PHB2024_SUBCLASS_SPELL_GRANT_BRIDGE.filter(
    (entry) => entry.subclassId === subclassId || entry.runtimeSubclassId === subclassId
  );
  const bridgeById = new Map(bridgeEntries.map((entry) => [entry.id, entry] as const));

  return PHB2024_AUTOMATIC_SUBCLASS_SPELL_GRANT_POLICIES.flatMap((policy) => {
    const bridge = bridgeById.get(policy.bridgeId);
    if (!bridge) return [];
    return policy.groups.flatMap((policyGroup) => {
      if (classLevel < policyGroup.minimumClassLevel) return [];
      const group = bridge.groups.find((candidate) => candidate.groupIndex === policyGroup.groupIndex);
      if (!group) return [];
      return group.spellReferences.map((spellReference) => ({
        bridgeId: bridge.id,
        subclassId: bridge.subclassId,
        kind: policyGroup.kind,
        minimumClassLevel: policyGroup.minimumClassLevel,
        spellReference
      }));
    });
  });
};

export const getPhb2024SubclassSpellGrantBridgeEntries = (subclassId: string): readonly Phb2024SubclassSpellGrantBridgeEntry[] =>
  PHB2024_SUBCLASS_SPELL_GRANT_BRIDGE.filter((entry) => entry.subclassId === subclassId || entry.runtimeSubclassId === subclassId);

export type Phb2024ConditionalSubclassSpellListOption = 'arid' | 'polar' | 'temperate' | 'tropical';

export interface Phb2024ConditionalSubclassSpellGrant {
  bridgeId: string;
  subclassId: string;
  optionId: Phb2024ConditionalSubclassSpellListOption;
  minimumClassLevel: number;
  spellReference: string;
}

const LAND_BRIDGE_BY_OPTION: Readonly<Record<Phb2024ConditionalSubclassSpellListOption, string>> = {
  arid: 'phb-2024-subclass-spell-grant-druid-land-arid',
  polar: 'phb-2024-subclass-spell-grant-druid-land-polar',
  temperate: 'phb-2024-subclass-spell-grant-druid-land-temperate',
  tropical: 'phb-2024-subclass-spell-grant-druid-land-tropical'
};

const LAND_GROUP_MINIMUM_LEVELS = [3, 5, 7, 9] as const;

/**
 * Resolves the 2024 Circle of the Land table selected by the character.
 * The four runtime grant carriers are intentionally conditional: exactly one
 * terrain table is active at a time, and its spells are always prepared.
 */
export const getPhb2024ConditionalSubclassSpellGrants = (
  subclassId: string,
  mode: string,
  optionId: string | undefined,
  classLevel: number
): Phb2024ConditionalSubclassSpellGrant[] => {
  if (mode !== 'landChoice' || !optionId || !(optionId in LAND_BRIDGE_BY_OPTION)) return [];
  const typedOption = optionId as Phb2024ConditionalSubclassSpellListOption;
  const bridgeId = LAND_BRIDGE_BY_OPTION[typedOption];
  const bridge = PHB2024_SUBCLASS_SPELL_GRANT_BRIDGE.find((entry) =>
    entry.id === bridgeId && (entry.subclassId === subclassId || entry.runtimeSubclassId === subclassId)
  );
  if (!bridge) return [];

  return bridge.groups.flatMap((group) => {
    const minimumClassLevel = LAND_GROUP_MINIMUM_LEVELS[group.groupIndex];
    if (!minimumClassLevel || classLevel < minimumClassLevel) return [];
    return group.spellReferences.map((spellReference) => ({
      bridgeId: bridge.id,
      subclassId: bridge.subclassId,
      optionId: typedOption,
      minimumClassLevel,
      spellReference
    }));
  });
};

export const getPhb2024ConditionalSubclassSpellListOptions = (
  subclassId: string,
  mode: string
): Array<{ optionId: Phb2024ConditionalSubclassSpellListOption; bridgeId: string; spellReferences: string[] }> => {
  if (mode !== 'landChoice') return [];
  return (Object.entries(LAND_BRIDGE_BY_OPTION) as Array<[Phb2024ConditionalSubclassSpellListOption, string]>).flatMap(([optionId, bridgeId]) => {
    const bridge = PHB2024_SUBCLASS_SPELL_GRANT_BRIDGE.find((entry) =>
      entry.id === bridgeId && (entry.subclassId === subclassId || entry.runtimeSubclassId === subclassId)
    );
    return bridge ? [{
      optionId,
      bridgeId,
      spellReferences: Array.from(new Set(bridge.groups.flatMap((group) => group.spellReferences)))
    }] : [];
  });
};
