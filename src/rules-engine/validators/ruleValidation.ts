import { Character, RuleValidationResult } from '../../types';
import { getTotalLevel } from '../characters/derivedStats';

export const validateCharacterRules = (character: Character): RuleValidationResult => {
  const issues: RuleValidationResult['issues'] = [];


  if (!character.classes.length) {
    issues.push({ severity: 'warning', code: 'NO_CLASS', message: 'Nenhuma classe cadastrada. Algumas regras não poderão ser calculadas.' });
  }

  const totalLevel = getTotalLevel(character);
  if (totalLevel !== character.level) {
    issues.push({
      severity: 'info',
      code: 'LEVEL_DERIVED_FROM_MULTICLASS',
      message: `Nível total derivado das classes: ${totalLevel}. Campo level atual: ${character.level}.`
    });
  }

  for (const spell of character.spells) {
    if (!spell.source || spell.source.confidence === 'ambiguous' || spell.source.status === 'needsReview') {
      issues.push({
        severity: 'warning',
        code: 'SPELL_SOURCE_NEEDS_REVIEW',
        message: `Magia "${spell.name}" sem fonte exata ou marcada para revisão.`,
        source: spell.source
      });
    }
  }

  for (const weapon of character.weapons) {
    if (weapon.damage.unresolvedTokens?.length) {
      issues.push({
        severity: 'warning',
        code: 'WEAPON_DAMAGE_UNRESOLVED',
        message: `Arma "${weapon.name}" tem tokens não resolvidos: ${weapon.damage.unresolvedTokens.join(', ')}.`
      });
    }
  }


  const activeConcentrations = (character.activeEffects ?? []).filter((effect) => effect.status === 'active' && effect.concentration);
  if (activeConcentrations.length > 1) {
    issues.push({
      severity: 'error',
      code: 'MULTIPLE_ACTIVE_CONCENTRATIONS',
      message: `A ficha possui múltiplos efeitos de concentração ativos: ${activeConcentrations.map((effect) => effect.name).join(', ')}.`
    });
  }

  for (const effect of character.activeEffects ?? []) {
    if (effect.status === 'active' && effect.duration.unit !== 'manual' && effect.duration.remaining !== undefined && effect.duration.remaining <= 0) {
      issues.push({
        severity: 'warning',
        code: 'ACTIVE_EFFECT_EXPIRED_COUNTER',
        message: `Efeito ativo "${effect.name}" tem duração 0 e deve ser removido ou expirado.`
      });
    }
  }

  for (const link of character.compendiumLinks ?? []) {
    if (link.status === 'removed') continue;
    if (link.status !== 'active') {
      issues.push({
        severity: 'warning',
        code: 'COMPENDIUM_LINK_NEEDS_REVIEW',
        message: `Item importado "${link.appliedEntityName}" está vinculado como ${link.status}. Revise antes de confiar no cálculo.`
      });
    }

    const entityExists =
      (link.appliedAs === 'weapon' && character.weapons.some((item) => item.id === link.appliedEntityId)) ||
      (link.appliedAs === 'spell' && character.spells.some((item) => item.id === link.appliedEntityId)) ||
      (link.appliedAs === 'feature' && character.features.some((item) => item.id === link.appliedEntityId)) ||
      (link.appliedAs === 'class' && character.classes.some((item) => item.id === link.appliedEntityId)) ||
      (link.appliedAs === 'subclass' && character.subclasses.some((item) => item.id === link.appliedEntityId)) ||
      (link.appliedAs === 'feat' && character.feats.some((item) => item.id === link.appliedEntityId)) ||
      (link.appliedAs === 'equipment' && character.equipment.some((item) => item.id === link.appliedEntityId)) ||
      (link.appliedAs === 'magicItem' && character.magicItems.some((item) => item.id === link.appliedEntityId)) ||
      (link.appliedAs === 'armor' && character.armor?.id === link.appliedEntityId) ||
      (link.appliedAs === 'species' && character.species?.id === link.appliedEntityId) ||
      (link.appliedAs === 'background' && character.background?.id === link.appliedEntityId);

    if (!entityExists) {
      issues.push({
        severity: 'warning',
        code: 'COMPENDIUM_LINK_ORPHANED',
        message: `Vínculo do compêndio para "${link.appliedEntityName}" não encontra mais a entidade aplicada na ficha.`
      });
    }
  }

  return { ok: issues.every((issue) => issue.severity !== 'error'), issues };
};
