import type { Character } from '../types';

export const characterCompletion = (character: Character): number => {
  const checks = [
    character.classes.length > 0,
    Boolean(character.species),
    Boolean(character.background),
    Object.values(character.abilities).every((value) => value > 0),
    character.proficiencies.skills.length > 0 || character.proficiencies.savingThrows.length > 0,
    character.rotations.length > 0
  ];
  return checks.filter(Boolean).length / checks.length;
};

export const nextCharacterStep = (character: Character) => {
  if (!character.classes.length) return { key: 'class', label: 'Escolher classe', description: 'Defina a classe e os níveis do personagem.', route: `/characters/${character.id}/classes` };
  if (!character.species || !character.background) return { key: 'origin', label: 'Completar origem', description: 'Escolha espécie, background e Origin Feat.', route: `/characters/${character.id}/identity` };
  if (!character.proficiencies.skills.length && !character.proficiencies.savingThrows.length) return { key: 'proficiencies', label: 'Definir proficiências', description: 'Escolha perícias e outras proficiências.', route: `/characters/${character.id}/proficiencies` };
  if (!character.rotations.length) return { key: 'rotation', label: 'Criar rotação', description: 'Monte uma sequência de ações para calcular o turno.', route: `/characters/${character.id}/rotations/new` };
  return { key: 'ready', label: 'Ficha pronta', description: 'Os dados essenciais estão disponíveis para uso.', route: `/characters/${character.id}` };
};

export const characterClassSummary = (character: Character): string => character.classes.length
  ? character.classes.map((entry) => `${entry.name} ${entry.level}`).join(' / ')
  : 'classe pendente';
