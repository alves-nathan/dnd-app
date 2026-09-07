import type {
  AutomaticSpellAccessSource,
  Character,
  RuleValidationIssue,
  Spell
} from '../types';
import type { StoredCompendiumItem } from '../compendium/types';
import { applyCompendiumItemToCharacter } from '../compendium/mapper';
import { findCompendiumItemByReference } from '../compendium/classProgression';
import {
  characterLinkMatchesCompendiumItem,
  findCompendiumItemForCharacterLink
} from '../compendium/characterLinkIdentity';
import { resolveCharacterSpellAccess } from './characterSpellAccess';
import { annotateLatestSpellWithClass, getActiveSubclassItemForClass, getClassOrSubclassSpellcastingProfile } from './spellcastingRules';


const explicitlyApprovedAutomaticSpellItem = (item: StoredCompendiumItem): StoredCompendiumItem =>
  item.status === 'validated'
    ? item
    : {
        ...item,
        status: 'validated',
        reviewDecision: 'approved',
        reviewedBy: 'Reconciliação automática de magia concedida por regra ativa',
        reviewedAt: new Date().toISOString()
      };

const uniqueSources = (sources: readonly AutomaticSpellAccessSource[]): AutomaticSpellAccessSource[] =>
  Array.from(new Map(sources.map((source) => [`${source.kind}|${source.sourceItemId}`, source] as const)).values());

const sameSources = (
  left: readonly AutomaticSpellAccessSource[] | undefined,
  right: readonly AutomaticSpellAccessSource[]
): boolean => {
  const leftKeys = new Set((left ?? []).map((source) => `${source.kind}|${source.sourceItemId}`));
  const rightKeys = new Set(right.map((source) => `${source.kind}|${source.sourceItemId}`));
  return leftKeys.size === rightKeys.size && Array.from(leftKeys).every((key) => rightKeys.has(key));
};

const activeLink = (
  character: Character,
  appliedAs: 'class' | 'subclass' | 'spell',
  entityId: string
) => (character.compendiumLinks ?? []).find((link) =>
  link.appliedAs === appliedAs && link.appliedEntityId === entityId && link.status === 'active'
);

const presentSpellLink = (character: Character, entityId: string) =>
  (character.compendiumLinks ?? []).find((link) =>
    link.appliedAs === 'spell' && link.appliedEntityId === entityId && link.status !== 'removed'
  );

const removeSpellEntities = (character: Character, entityIds: ReadonlySet<string>): Character => ({
  ...character,
  spells: character.spells.filter((spell) => !entityIds.has(spell.id)),
  compendiumLinks: (character.compendiumLinks ?? []).map((link) =>
    link.appliedAs === 'spell' && entityIds.has(link.appliedEntityId) && link.status !== 'removed'
      ? { ...link, status: 'removed' as const }
      : link
  )
});

interface DesiredAutomaticSpell {
  classEntityId: string;
  className: string;
  classAbility?: string;
  spellItem: StoredCompendiumItem;
  sources: AutomaticSpellAccessSource[];
  ritualOnly: boolean;
}

const desiredAutomaticSpells = (
  character: Character,
  items: StoredCompendiumItem[]
): Map<string, DesiredAutomaticSpell> => {
  const desired = new Map<string, DesiredAutomaticSpell>();

  for (const classEntity of character.classes) {
    const classLink = activeLink(character, 'class', classEntity.id);
    const classItem = classLink ? findCompendiumItemForCharacterLink(items, classLink) : undefined;
    if (!classItem) continue;
    const subclassEntity = character.subclasses.find((entry) => entry.classId === classEntity.id);
    const subclassLink = subclassEntity ? activeLink(character, 'subclass', subclassEntity.id) : undefined;
    const subclassItem = getActiveSubclassItemForClass(character, classEntity.id, items)
      ?? (subclassLink ? findCompendiumItemForCharacterLink(items, subclassLink) : undefined);
    const profile = getClassOrSubclassSpellcastingProfile(classItem, classEntity.level, subclassItem, items);

    const resolution = resolveCharacterSpellAccess({
      classItem,
      classLevel: classEntity.level,
      items,
      subclassItem,
      subclassChoices: character.buildChoices?.subclassChoices,
      classFeatureChoices: character.buildChoices?.classFeatureChoices,
      characterLevel: character.level
    });

    for (const entry of resolution.entries) {
      if (entry.kind !== 'alwaysPrepared' && entry.kind !== 'granted') continue;
      const spellItem = findCompendiumItemByReference(items, entry.spellReference);
      if (!spellItem || spellItem.type !== 'spell' || spellItem.status === 'disabled') continue;
      const key = `${classEntity.id}|${spellItem.id}`;
      const source: AutomaticSpellAccessSource = {
        kind: entry.kind,
        sourceItemId: entry.source.itemId,
        sourceName: entry.source.name
      };
      const current = desired.get(key);
      desired.set(key, {
        classEntityId: classEntity.id,
        className: classEntity.name,
        classAbility: entry.spellcastingAbility ?? profile?.ability,
        spellItem,
        sources: uniqueSources([...(current?.sources ?? []), source]),
        ritualOnly: Boolean(current?.ritualOnly || entry.ritualOnly)
      });
    }
  }

  return desired;
};

export interface AutomaticSpellAccessReconciliationResult {
  character: Character;
  addedSpellCount: number;
  removedSpellCount: number;
  updatedSpellCount: number;
  issues: RuleValidationIssue[];
}

/**
 * Materializes automatic class/subclass spell access on the character sheet.
 *
 * Existing manual spells are never destroyed merely because an automatic source
 * later disappears: they temporarily gain automatic access metadata and revert
 * to normal-limit behavior when that source is gone. Spells created solely by
 * this resolver are removed when their final automatic source becomes inactive.
 */
export const reconcileAutomaticSpellAccess = (
  character: Character,
  items: StoredCompendiumItem[]
): AutomaticSpellAccessReconciliationResult => {
  let next = character;
  const desired = desiredAutomaticSpells(next, items);
  const issues: RuleValidationIssue[] = [];
  let addedSpellCount = 0;
  let removedSpellCount = 0;
  let updatedSpellCount = 0;

  const staleAutoOnlyIds = new Set<string>();
  next = {
    ...next,
    spells: next.spells.map((spell) => {
      if (!(spell.automaticSpellAccessSources?.length)) return spell;
      const spellLink = presentSpellLink(next, spell.id);
      const linkedSpellItem = spellLink
        ? findCompendiumItemForCharacterLink(items, spellLink)
        : undefined;
      const key = spell.spellcastingClassId && linkedSpellItem
        ? `${spell.spellcastingClassId}|${linkedSpellItem.id}`
        : undefined;
      const desiredEntry = key ? desired.get(key) : undefined;
      if (desiredEntry) {
        const desiredRitualOnly = desiredEntry.ritualOnly;
        if (
          sameSources(spell.automaticSpellAccessSources, desiredEntry.sources) &&
          spell.prepared !== false &&
          Boolean(spell.automaticSpellRitualOnly) === desiredRitualOnly &&
          (!desiredRitualOnly || spell.ritualOnly === true)
        ) return spell;
        updatedSpellCount += 1;
        return {
          ...spell,
          automaticSpellAccessSources: desiredEntry.sources,
          automaticSpellRitualOnly: desiredRitualOnly || undefined,
          ritualOnly: desiredRitualOnly ? true : spell.automaticSpellRitualOnly ? false : spell.ritualOnly,
          prepared: true
        };
      }
      if (spell.automaticSpellAccessOnly && !(spell.externalSpellGrantSources?.length)) {
        staleAutoOnlyIds.add(spell.id);
        return spell;
      }
      updatedSpellCount += 1;
      const {
        automaticSpellAccessSources: _sources,
        automaticSpellAccessOnly: _only,
        automaticSpellRitualOnly: _ritualMarker,
        ...rest
      } = spell;
      return {
        ...rest,
        // If this entity was originally created by automatic access but another
        // external grant still owns it, transfer grant-only cleanup ownership
        // instead of deleting/recreating the same compendium spell.
        externalSpellGrantOnly: spell.automaticSpellAccessOnly && spell.externalSpellGrantSources?.length
          ? true
          : spell.externalSpellGrantOnly,
        ritualOnly: spell.automaticSpellRitualOnly ? false : spell.ritualOnly
      } as Spell;
    })
  };

  if (staleAutoOnlyIds.size) {
    next = removeSpellEntities(next, staleAutoOnlyIds);
    removedSpellCount += staleAutoOnlyIds.size;
    issues.push({
      severity: 'warning',
      code: 'AUTOMATIC_SPELLS_REMOVED_BY_RECONCILIATION',
      message: `${staleAutoOnlyIds.size} magia(s) automática(s) foi/foram removida(s) porque a classe, subclasse ou nível correspondente deixou de concedê-la(s).`
    });
  }

  for (const desiredEntry of desired.values()) {
    const spellLinks = (next.compendiumLinks ?? []).filter((link) =>
      link.appliedAs === 'spell' &&
      link.status !== 'removed' &&
      characterLinkMatchesCompendiumItem(items, link, desiredEntry.spellItem)
    );
    const sameClassSpell = spellLinks
      .map((link) => next.spells.find((spell) => spell.id === link.appliedEntityId))
      .find((spell): spell is Spell => Boolean(
        spell && (spell.spellcastingClassId === desiredEntry.classEntityId || !spell.spellcastingClassId)
      ));

    if (sameClassSpell) {
      if (!sameSources(sameClassSpell.automaticSpellAccessSources, desiredEntry.sources) || sameClassSpell.prepared !== true) {
        next = {
          ...next,
          spells: next.spells.map((spell) => spell.id === sameClassSpell.id ? {
            ...spell,
            spellcastingClassId: spell.spellcastingClassId ?? desiredEntry.classEntityId,
            spellcastingClassName: spell.spellcastingClassName ?? desiredEntry.className,
            automaticSpellAccessSources: desiredEntry.sources,
            automaticSpellAccessOnly: spell.automaticSpellAccessOnly ?? false,
            automaticSpellRitualOnly: desiredEntry.ritualOnly || undefined,
            ritualOnly: desiredEntry.ritualOnly ? true : spell.automaticSpellRitualOnly ? false : spell.ritualOnly,
            prepared: true
          } : spell)
        };
        updatedSpellCount += 1;
      }
      continue;
    }

    if (spellLinks.length) {
      // The current one-entity-per-compendium-spell model cannot represent the
      // same spell independently for two spellcasting classes. Preserve the
      // existing entity rather than silently re-attributing it.
      issues.push({
        severity: 'warning',
        code: 'AUTOMATIC_SPELL_MULTICLASS_ENTITY_CONFLICT',
        message: `${desiredEntry.spellItem.name} já está vinculada a outra classe; o acesso automático de ${desiredEntry.className} foi preservado semanticamente, mas não criou uma segunda entidade.`
      });
      continue;
    }

    const before = next;
    const applied = applyCompendiumItemToCharacter(next, explicitlyApprovedAutomaticSpellItem(desiredEntry.spellItem));
    if (!applied.ok) {
      issues.push(...applied.issues);
      continue;
    }
    next = annotateLatestSpellWithClass(
      before,
      applied.character,
      desiredEntry.classEntityId,
      desiredEntry.className,
      desiredEntry.classAbility
    );
    const beforeIds = new Set(before.spells.map((spell) => spell.id));
    const added = next.spells.find((spell) => !beforeIds.has(spell.id));
    if (!added) continue;
    next = {
      ...next,
      spells: next.spells.map((spell) => spell.id === added.id ? {
        ...spell,
        automaticSpellAccessSources: desiredEntry.sources,
        automaticSpellAccessOnly: true,
        automaticSpellRitualOnly: desiredEntry.ritualOnly || undefined,
        ritualOnly: desiredEntry.ritualOnly ? true : spell.ritualOnly,
        prepared: true
      } : spell)
    };
    addedSpellCount += 1;
  }

  return { character: next, addedSpellCount, removedSpellCount, updatedSpellCount, issues };
};
