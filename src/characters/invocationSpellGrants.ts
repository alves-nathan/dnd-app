import type { StoredCompendiumItem } from '../compendium/types';

export interface InvocationSpellGrantDefinition {
  invocationName: string;
  engineKey: string;
  spellName: string;
  selfOnly: boolean;
  usage: 'atWill' | 'oncePerLongRest';
  notes?: string;
}

export const INVOCATION_SPELL_GRANTS: InvocationSpellGrantDefinition[] = [
  { invocationName: 'Armor of Shadows', engineKey: 'warlock.armor-of-shadows', spellName: 'Mage Armor', selfOnly: true, usage: 'atWill' },
  { invocationName: 'Ascendant Step', engineKey: 'warlock.ascendant-step', spellName: 'Levitate', selfOnly: true, usage: 'atWill' },
  { invocationName: 'Fiendish Vigor', engineKey: 'warlock.fiendish-vigor', spellName: 'False Life', selfOnly: true, usage: 'atWill', notes: 'Ao conjurar por esta invocation, use o valor máximo dos pontos de vida temporários.' },
  { invocationName: 'Gift of the Depths', engineKey: 'warlock.gift-of-the-depths', spellName: 'Water Breathing', selfOnly: false, usage: 'oncePerLongRest' },
  { invocationName: 'Mask of Many Faces', engineKey: 'warlock.mask-of-many-faces', spellName: 'Disguise Self', selfOnly: false, usage: 'atWill' },
  { invocationName: 'Master of Myriad Forms', engineKey: 'warlock.master-of-myriad-forms', spellName: 'Alter Self', selfOnly: true, usage: 'atWill' },
  { invocationName: 'Misty Visions', engineKey: 'warlock.misty-visions', spellName: 'Silent Image', selfOnly: false, usage: 'atWill' },
  { invocationName: 'One with Shadows', engineKey: 'warlock.one-with-shadows', spellName: 'Invisibility', selfOnly: true, usage: 'atWill', notes: 'Disponível apenas enquanto o Warlock estiver em luz fraca ou escuridão.' },
  { invocationName: 'Otherworldly Leap', engineKey: 'warlock.otherworldly-leap', spellName: 'Jump', selfOnly: true, usage: 'atWill' },
  { invocationName: 'Visions of Distant Realms', engineKey: 'warlock.visions-of-distant-realms', spellName: 'Arcane Eye', selfOnly: false, usage: 'atWill' },
  { invocationName: 'Whispers of the Grave', engineKey: 'warlock.whispers-of-the-grave', spellName: 'Speak with Dead', selfOnly: false, usage: 'atWill' }
];

const normalize = (value: string): string => value
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .trim()
  .toLowerCase();

const engineKey = (item: StoredCompendiumItem): string => {
  const value = item.normalizedJson.engineKey;
  return typeof value === 'string' ? normalize(value) : '';
};

export const getInvocationSpellGrant = (
  item: StoredCompendiumItem | undefined
): InvocationSpellGrantDefinition | undefined => {
  if (!item) return undefined;
  const key = engineKey(item);
  const name = normalize(item.name);
  return INVOCATION_SPELL_GRANTS.find(
    (definition) => normalize(definition.engineKey) === key || normalize(definition.invocationName) === name
  );
};

export const invocationSpellResourceId = (invocationItemId: string): string =>
  `invocation_free_cast_${invocationItemId.replace(/[^a-zA-Z0-9_-]/g, '_')}`;
