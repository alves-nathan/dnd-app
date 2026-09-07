import { Ionicons } from '@expo/vector-icons';
import { router, useLocalSearchParams } from 'expo-router';
import { useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { BottomNavigation } from '../../../src/components/BottomNavigation';
import { Button } from '../../../src/components/Button';
import { Card } from '../../../src/components/Card';
import { IssueList } from '../../../src/components/IssueList';
import { MetricTile } from '../../../src/components/MetricTile';
import { ProgressBar } from '../../../src/components/ProgressBar';
import { Screen } from '../../../src/components/Screen';
import { defaultCombatState } from '../../../src/data/mockData';
import { getArmorClass, getInitiative, getProficiencyBonus, getTotalLevel } from '../../../src/rules-engine/characters/derivedStats';
import {
  formatSignedBonus,
  getCharacterSheetAbilities,
  getCharacterSheetSkills,
  getCharacterSheetWeapons,
  getCharacterSheetSpellcasting,
  getCharacterSheetExternalSpells,
  getCharacterSheetSpellSlots,
  getCharacterSheetProficiencyGroups,
  getCharacterSheetSenses,
  getCharacterSheetFeatGroups,
  getCharacterSheetResourceUses,
  getCharacterWalkingSpeed,
  getHitDiceSummary,
  getPassivePerception
} from '../../../src/ui/characterSheetPresentation';
import { analyzeTurnRotation } from '../../../src/rules-engine/turns/analyzeTurn';
import { validateCharacterRules } from '../../../src/rules-engine/validators/ruleValidation';
import { useCharacterStore } from '../../../src/store/characterStore';
import { useCompendiumStore } from '../../../src/store/compendiumStore';
import { useCharacterChoiceBridge } from '../../../src/catalog/useCharacterChoiceBridge';
import { useAppTheme } from '../../../src/theme';
import { characterClassSummary, characterCompletion, nextCharacterStep } from '../../../src/ui/characterPresentation';
import { formatNumber } from '../../../src/utils/format';
import { getCharacterDisplayName } from '../../../src/ui/characterIdentity';
import { deleteCharacterData } from '../../../src/characters/deleteCharacterData';
import { hasPactOfTheBlade } from '../../../src/characters/pactWeaponRules';
import { getCharacterSubclassChoiceSummaries } from '../../../src/characters/subclassChoiceRules';
import { getSelectedSpeciesFeatureChoice } from '../../../src/characters/speciesChoiceRules';
import { getCharacterMetamagicSources } from '../../../src/characters/metamagicRules';

const getId = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);

const resourceRechargeLabel = (recharge: string): string => {
  if (recharge === 'turn') return 'por turno';
  if (recharge === 'shortRest') return 'descanso curto';
  if (recharge === 'longRest') return 'descanso longo';
  if (recharge === 'day') return 'dia/descanso longo';
  return 'manual';
};


const spellPreparationLabel = (mode: string): string => {
  if (mode === 'spellbook') return 'spellbook';
  if (mode === 'known') return 'magias conhecidas';
  if (mode === 'pactKnown') return 'Pact Magic';
  return 'magias preparadas';
};

const spellFlagLabel = (spell: { prepared: boolean; concentration: boolean; ritualOnly: boolean; freeCasts: number; atWill: boolean }): string => {
  const flags: string[] = [];
  if (spell.prepared) flags.push('preparada');
  if (spell.concentration) flags.push('concentração');
  if (spell.ritualOnly) flags.push('ritual');
  if (spell.atWill) flags.push('à vontade');
  if (spell.freeCasts > 0) flags.push(`${spell.freeCasts} conjuração(ões) sem slot`);
  return flags.join(' · ');
};

const activeEffectDurationLabel = (effect: { duration: { unit: string; remaining?: number; expiresOn?: string } }): string => {
  const remaining = effect.duration.remaining;
  if (effect.duration.unit === 'manual') return 'até ser encerrado';
  if (remaining === undefined) return effect.duration.unit;
  const unit = effect.duration.unit === 'round' ? 'rodada(s)' : effect.duration.unit === 'turn' ? 'turno(s)' : effect.duration.unit === 'minute' ? 'minuto(s)' : 'hora(s)';
  return `${remaining} ${unit}`;
};

const currencySummary = (currency: { cp: number; sp: number; ep: number; gp: number; pp: number } | undefined): string => {
  if (!currency) return '—';
  const parts = [
    currency.pp ? `${currency.pp} pp` : '',
    currency.gp ? `${currency.gp} gp` : '',
    currency.ep ? `${currency.ep} ep` : '',
    currency.sp ? `${currency.sp} sp` : '',
    currency.cp ? `${currency.cp} cp` : ''
  ].filter(Boolean);
  return parts.length ? parts.join(' · ') : '0 gp';
};

const pendingChoiceRoute = (characterId: string, kind: string): string => {
  if (kind === 'feat' || kind === 'featOptions') return `/characters/${characterId}/feats`;
  if (kind === 'metamagic') return `/characters/${characterId}/metamagic`;
  if (kind === 'spellSelection' || kind === 'spellReplacement' || kind === 'spellbookFeature' || kind === 'mysticArcanum' || kind === 'mysticArcanumReplacement') return `/characters/${characterId}/spells`;
  if (kind === 'proficiency') return `/characters/${characterId}/proficiencies`;
  if (kind === 'equipment') return `/characters/${characterId}/equipment`;
  if (kind === 'subclass' || kind === 'subclassOptions') return `/characters/${characterId}/classes`;
  if (kind === 'speciesOption') return `/characters/${characterId}/identity`;
  if (kind === 'pactWeapon') return `/characters/${characterId}/pact-weapon`;
  if (kind === 'eldritchInvocation' || kind === 'eldritchInvocationOptions') return `/characters/${characterId}/invocations`;
  return `/characters/${characterId}/compendium`;
};

export default function CharacterDetailScreen() {
  const { colors, radii } = useAppTheme();
  const { id: idParam } = useLocalSearchParams();
  const id = getId(idParam);
  const character = useCharacterStore((state) => state.characters.find((item) => item.id === id));
  const progressionDraft = useCharacterStore((state) => id ? state.progressionDrafts[id] : undefined);
  const compendiumItems = useCompendiumStore((state) => state.items);
  const characterChoiceBridge = useCharacterChoiceBridge();
  const characterRuleItems = characterChoiceBridge.items.length ? characterChoiceBridge.items : compendiumItems;
  const [showMore, setShowMore] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleteError, setDeleteError] = useState<string>();
  const subclassChoiceSummaries = useMemo(
    () => character ? getCharacterSubclassChoiceSummaries(character, compendiumItems) : [],
    [character, compendiumItems]
  );
  const pactOfTheBlade = useMemo(
    () => Boolean(character && hasPactOfTheBlade(character, compendiumItems)),
    [character, compendiumItems]
  );
  const metamagicSources = useMemo(
    () => character ? getCharacterMetamagicSources(character, characterRuleItems) : [],
    [character, characterRuleItems]
  );
  const sheetAbilities = useMemo(() => character ? getCharacterSheetAbilities(character) : [], [character]);
  const sheetSkills = useMemo(() => character ? getCharacterSheetSkills(character) : [], [character]);
  const sheetWeapons = useMemo(() => character ? getCharacterSheetWeapons(character) : [], [character]);
  const walkingSpeed = useMemo(() => character ? getCharacterWalkingSpeed(character, compendiumItems) : undefined, [character, compendiumItems]);
  const passivePerception = useMemo(() => character ? getPassivePerception(character) : 10, [character]);
  const spellcastingSections = useMemo(() => character ? getCharacterSheetSpellcasting(character, compendiumItems) : [], [character, compendiumItems]);
  const externalSpellSection = useMemo(() => character ? getCharacterSheetExternalSpells(character, spellcastingSections) : { spells: [] }, [character, spellcastingSections]);
  const spellSlotRows = useMemo(() => character ? getCharacterSheetSpellSlots(character) : [], [character]);
  const proficiencyGroups = useMemo(() => character ? getCharacterSheetProficiencyGroups(character) : [], [character]);
  const characterSenses = useMemo(() => character ? getCharacterSheetSenses(character) : [], [character]);
  const featGroups = useMemo(() => character ? getCharacterSheetFeatGroups(character) : { primary: [], granted: [] }, [character]);
  const sharedResourceUses = useMemo(() => character ? getCharacterSheetResourceUses(character, compendiumItems) : [], [character, compendiumItems]);
  const sheetArmors = useMemo(() => {
    if (!character) return [];
    const armors = [...(character.armors ?? []), ...(character.armor ? [character.armor] : [])];
    return armors.filter((armor, index) => armors.findIndex((candidate) => candidate.id === armor.id) === index);
  }, [character]);

  const damageSummary = useMemo(() => {
    if (!character) return undefined;
    const rotation = character.rotations.find((entry) => entry.favorite) ?? character.rotations[0];
    if (!rotation) return undefined;
    return { rotation, result: analyzeTurnRotation(rotation, character, defaultCombatState) };
  }, [character]);

  if (!character) {
    return <Screen title="Personagem não encontrado" onBack={() => router.replace('/')}><Button label="Voltar aos personagens" onPress={() => router.replace('/')} /></Screen>;
  }

  const validation = validateCharacterRules(character);
  const completion = characterCompletion(character);
  const next = nextCharacterStep(character);
  const importedCount = (character.compendiumLinks ?? []).filter((link) => link.status === 'active').length;
  const footer = (
    <BottomNavigation
      activeKey="sheet"
      items={[
        { key: 'sheet', label: 'Ficha', icon: 'person', onPress: () => undefined },
        { key: 'table', label: 'Mesa', icon: 'dice', onPress: () => router.push(`/characters/${character.id}/table`) },
        { key: 'damage', label: 'Dano', icon: 'analytics', onPress: () => router.push(`/characters/${character.id}/analysis`) }
      ]}
    />
  );

  return (
    <Screen
      eyebrow={`Nível ${getTotalLevel(character)}`}
      title={getCharacterDisplayName(character)}
      subtitle={`${characterClassSummary(character)} · ${character.species?.name ?? 'espécie pendente'} · ${character.background?.name ?? 'background pendente'}`}
      onBack={() => router.replace('/')}
      footer={footer}
    >
      {progressionDraft ? (
        <Card
          variant="filled"
          title={progressionDraft.recovery.status === 'recoverable' ? 'Progressão recuperada' : progressionDraft.recovery.status === 'conflicted' ? 'Progressão com conflito' : 'Progressão em andamento'}
          subtitle={progressionDraft.recovery.status === 'active' ? 'A ficha publicada permanece protegida até o commit.' : progressionDraft.recovery.reason}
        >
          <Button label="Abrir central de progressão" icon="git-compare-outline" onPress={() => router.push(`/characters/${character.id}/progression`)} />
        </Card>
      ) : null}

      {completion < 1 ? (
        <Card variant="hero" title={next.label} subtitle={next.description}>
          <ProgressBar value={completion} showPercent />
          <Button label={next.label} icon="arrow-forward" onPress={() => router.push(next.route as never)} />
        </Card>
      ) : null}

      {(character.pendingChoices ?? []).length ? (
        <Card variant="filled" title={`Escolhas pendentes (${character.pendingChoices?.length ?? 0})`} subtitle="A ficha foi preservada e pode ser concluída por partes.">
          {(character.pendingChoices ?? []).slice(0, 6).map((choice) => (
            <View key={choice.id} style={styles.summaryRow}>
              <View style={styles.flex}>
                <Text style={[styles.summaryValue, { color: colors.onSurface, textAlign: 'left' }]}>{choice.title}</Text>
                <Text style={[styles.summaryLabel, { color: colors.onSurfaceVariant }]}>{choice.description}</Text>
              </View>
              <Button label="Resolver" variant="text" onPress={() => router.push(pendingChoiceRoute(character.id, choice.kind) as never)} />
            </View>
          ))}
        </Card>
      ) : null}

      <Text style={[styles.sectionTitle, { color: colors.onSurface }]}>Ficha rápida</Text>
      <View style={styles.metrics}>
        <MetricTile label="PV" value={character.hitPoints?.max ? `${character.hitPoints.current}/${character.hitPoints.max}` : '—'} supporting={character.hitPoints?.temporary ? `${character.hitPoints.temporary} temporários` : character.hitPoints?.method ? `Método: ${character.hitPoints.method}` : undefined} />
        <MetricTile label="CA" value={getArmorClass(character)} />
        <MetricTile label="Iniciativa" value={formatSignedBonus(getInitiative(character))} />
        <MetricTile label="Deslocamento" value={walkingSpeed !== undefined ? `${walkingSpeed} ft` : '—'} />
        <MetricTile label="PB" value={`+${getProficiencyBonus(character)}`} />
        <MetricTile label="Percepção passiva" value={passivePerception} />
      </View>
      {!character.hitPoints?.method || !character.hitPoints?.max ? (
        <Card variant="outlined" title="Pontos de Vida ainda não definidos" subtitle="Escolha rolagem RAW, média fixa, dados cheios ou valor manual. O método fica salvo na ficha e acompanha alterações de nível/CON.">
          <Button label="Definir Pontos de Vida" onPress={() => router.push(`/characters/${character.id}/resources`)} />
        </Card>
      ) : null}

      <Card variant="filled" title="Atributos e salvamentos" subtitle="Valores finais da ficha. O marcador • indica proficiência no salvamento.">
        <View style={styles.abilityGrid}>
          {sheetAbilities.map((entry) => (
            <View key={entry.ability} style={[styles.abilityCell, { backgroundColor: colors.surfaceContainerLow, borderColor: colors.outlineVariant }]}>
              <Text style={[styles.abilityCode, { color: colors.onSurfaceVariant }]}>{entry.ability}</Text>
              <Text style={[styles.abilityScore, { color: colors.onSurface }]}>{entry.score}</Text>
              <Text style={[styles.abilityModifier, { color: colors.primary }]}>{formatSignedBonus(entry.modifier)}</Text>
              <Text style={[styles.abilitySave, { color: colors.onSurfaceVariant }]}>Save {entry.savingThrowProficient ? '• ' : ''}{formatSignedBonus(entry.savingThrow)}</Text>
            </View>
          ))}
        </View>
        <Button label="Editar atributos" icon="options-outline" variant="outlined" onPress={() => router.push(`/characters/${character.id}/attributes`)} />
      </Card>

      <Card variant="outlined" title="Perícias" subtitle="Bônus finais já incluindo proficiência, Expertise, Jack of All Trades e modificadores personalizados.">
        <View style={styles.skillColumns}>
          {sheetSkills.map((entry) => (
            <View key={entry.skill} style={styles.skillRow}>
              <View style={styles.flex}>
                <Text style={[styles.skillName, { color: colors.onSurface }]}>{entry.expertise ? '◆ ' : entry.proficient ? '● ' : entry.jackOfAllTrades ? '◐ ' : '○ '}{entry.skill}</Text>
                <Text style={[styles.skillMeta, { color: colors.onSurfaceVariant }]}>{entry.ability}{entry.rollMode !== 'normal' ? ` · ${entry.rollMode === 'advantage' ? 'vantagem' : 'desvantagem'}` : ''}</Text>
              </View>
              <Text style={[styles.skillBonus, { color: entry.expertise ? colors.primary : colors.onSurface }]}>{formatSignedBonus(entry.bonus)}</Text>
            </View>
          ))}
        </View>
        <Text style={[styles.legend, { color: colors.onSurfaceVariant }]}>○ sem proficiência · ◐ Jack of All Trades · ● proficiente · ◆ Expertise</Text>
        <Button label="Editar proficiências" icon="school-outline" variant="outlined" onPress={() => router.push(`/characters/${character.id}/proficiencies`)} />
      </Card>

      <Card variant="filled" title="Combate" subtitle={`Dados de Vida: ${getHitDiceSummary(character)}${character.armor?.name ? ` · Armadura: ${character.armor.name}` : ''}`}>
        {sheetWeapons.length ? sheetWeapons.slice(0, 8).map((weapon) => (
          <View key={weapon.weaponId} style={[styles.weaponRow, { borderBottomColor: colors.outlineVariant }]}>
            <View style={styles.flex}>
              <Text style={[styles.weaponName, { color: colors.onSurface }]}>{weapon.name}{weapon.equipped ? '' : ' · guardada'}</Text>
              <Text style={[styles.weaponMeta, { color: colors.onSurfaceVariant }]}>
                {weapon.attackAbility}{weapon.attacksCount > 1 ? ` · ${weapon.attacksCount} ataques/Ação` : ''}{weapon.range ? ` · ${weapon.range}` : ''}{weapon.mastery ? ` · ${weapon.mastery}` : ''}
              </Text>
              {weapon.properties.length ? <Text style={[styles.weaponMeta, { color: colors.onSurfaceVariant }]} numberOfLines={1}>{weapon.properties.join(' · ')}</Text> : null}
            </View>
            <View style={styles.weaponNumbers}>
              <Text style={[styles.weaponAttack, { color: colors.primary }]}>{formatSignedBonus(weapon.attackBonus)}</Text>
              <Text style={[styles.weaponDamage, { color: colors.onSurface }]} numberOfLines={1}>{weapon.damage}{weapon.damageType ? ` ${weapon.damageType}` : ''}</Text>
            </View>
          </View>
        )) : (
          <Text style={[styles.summaryLabel, { color: colors.onSurfaceVariant }]}>Nenhuma arma disponível na ficha.</Text>
        )}
        {sheetWeapons.length > 8 ? <Text style={[styles.summaryLabel, { color: colors.onSurfaceVariant }]}>+{sheetWeapons.length - 8} arma(s) adicional(is)</Text> : null}
        <View style={styles.row}>
          <View style={styles.flex}><Button label="Equipamento" icon="shield-outline" variant="outlined" onPress={() => router.push(`/characters/${character.id}/equipment`)} /></View>
          <View style={styles.flex}><Button label="Combate tático" icon="map-outline" variant="outlined" onPress={() => router.push(`/characters/${character.id}/tactical`)} /></View>
        </View>
      </Card>

      {(character.resources.length || sharedResourceUses.length) ? (
        <Card
          variant="filled"
          title={`Recursos (${character.resources.length})`}
          subtitle="Pools, usos limitados e habilidades que consomem recursos compartilhados ficam visíveis diretamente na ficha."
        >
          {character.resources.map((resource) => {
            const sourceFeature = character.features.find((feature) => feature.resource?.id === resource.id);
            const selectedSpeciesChoice = sourceFeature ? getSelectedSpeciesFeatureChoice(character, characterRuleItems, sourceFeature.id) : undefined;
            return (
              <View key={resource.id} style={styles.resourceSummary}>
                <View style={styles.flex}>
                  <Text style={[styles.summaryValue, { color: colors.onSurface, textAlign: 'left' }]}>{resource.name}</Text>
                  <Text style={[styles.summaryLabel, { color: colors.onSurfaceVariant }]}>Recarga: {resourceRechargeLabel(resource.recharge)}</Text>
                  {selectedSpeciesChoice ? <Text style={[styles.summaryLabel, { color: colors.primary, fontWeight: '800' }]}>Escolha ativa: {selectedSpeciesChoice.option.label}</Text> : null}
                  {selectedSpeciesChoice?.description ? <Text style={[styles.summaryLabel, { color: colors.onSurfaceVariant }]}>{selectedSpeciesChoice.description}</Text> : null}
                  {resource.notes ? <Text style={[styles.summaryLabel, { color: colors.onSurfaceVariant }]}>{resource.notes}</Text> : null}
                </View>
                <Text style={[styles.resourceValue, { color: colors.primary }]}>{resource.current}/{resource.max}</Text>
              </View>
            );
          })}
          {sharedResourceUses.length ? (
            <View style={[styles.sheetSubsection, { borderTopColor: colors.outlineVariant }]}>
              <Text style={[styles.cardSubheading, { color: colors.onSurface }]}>Usos que consomem recursos</Text>
              {sharedResourceUses.map((use) => (
                <View key={use.id} style={styles.resourceUseSummary}>
                  <Text style={[styles.summaryValue, { color: colors.onSurface, textAlign: 'left' }]}>{use.name}</Text>
                  <Text style={[styles.summaryLabel, { color: colors.primary }]}>Custo: {use.costs.join(' + ')}{use.actionLabel ? ` · ${use.actionLabel}` : ''}</Text>
                  {use.description ? <Text style={[styles.summaryLabel, { color: colors.onSurfaceVariant }]}>{use.description}</Text> : null}
                </View>
              ))}
            </View>
          ) : null}
          <Button label="Gerenciar recursos e descansos" icon="refresh-circle-outline" variant="outlined" onPress={() => router.push(`/characters/${character.id}/resources`)} />
        </Card>
      ) : null}


      {(spellcastingSections.length || externalSpellSection.spells.length || spellSlotRows.length) ? (
        <Card variant="filled" title="Conjuração e magias" subtitle="CD, ataque mágico, slots, magias preparadas/conhecidas, spellbook e concessões externas em uma única visão.">
          {spellSlotRows.length ? (
            <>
              <Text style={[styles.cardSubheading, { color: colors.onSurface }]}>Spell slots</Text>
              <View style={styles.metrics}>
                {spellSlotRows.map((slot) => (
                  <MetricTile key={slot.key} label={slot.label} value={`${slot.current}/${slot.max}`} supporting={resourceRechargeLabel(slot.recharge)} />
                ))}
              </View>
            </>
          ) : null}

          {spellcastingSections.map((section) => (
            <View key={section.classEntityId} style={[styles.sheetSubsection, { borderTopColor: colors.outlineVariant }]}>
              <View style={styles.summaryRow}>
                <View style={styles.flex}>
                  <Text style={[styles.cardSubheading, { color: colors.onSurface }]}>{section.className} {section.classLevel}</Text>
                  <Text style={[styles.summaryLabel, { color: colors.onSurfaceVariant }]}>
                    {section.ability ? `${section.ability} · ` : ''}{spellPreparationLabel(section.preparationMode)}
                  </Text>
                </View>
                {section.ability ? (
                  <View style={styles.spellNumbers}>
                    <Text style={[styles.spellNumber, { color: colors.primary }]}>CD {section.saveDC}</Text>
                    <Text style={[styles.summaryLabel, { color: colors.onSurfaceVariant }]}>Ataque {formatSignedBonus(section.attackBonus ?? 0)}</Text>
                  </View>
                ) : null}
              </View>
              <Text style={[styles.summaryLabel, { color: colors.onSurfaceVariant }]}>Truques: {section.cantrips.length}{section.cantripLimit ? `/${section.cantripLimit}` : ''} · Magias preparadas: {section.preparedCount}{section.preparedSpellLimit ? `/${section.preparedSpellLimit}` : ''}{section.preparationMode === 'spellbook' ? ` · Spellbook: ${section.spellbookCount}${section.spellbookMinimumSpellCount ? `/${section.spellbookMinimumSpellCount} mín.` : ''}` : ''}</Text>
              {[...section.cantrips, ...section.leveledSpells].map((spell) => (
                <View key={`${section.classEntityId}:${spell.id}`} style={styles.spellRow}>
                  <View style={styles.flex}>
                    <Text style={[styles.itemName, { color: colors.onSurface }]}>{spell.name}</Text>
                    <Text style={[styles.itemMeta, { color: colors.onSurfaceVariant }]}>{spell.level === 0 ? 'Truque' : `Nível ${spell.level}`}{spellFlagLabel(spell) ? ` · ${spellFlagLabel(spell)}` : ''}</Text>
                  </View>
                </View>
              ))}
              {section.preparationMode === 'spellbook' && section.spellbookSpells.length ? (
                <View style={styles.compactGroup}>
                  <Text style={[styles.itemName, { color: colors.onSurface }]}>Spellbook completo</Text>
                  <Text style={[styles.itemMeta, { color: colors.onSurfaceVariant }]}>
                    {section.spellbookSpells.map((spell) => `${spell.name}${spell.prepared ? ' ✓' : ''}`).join(' · ')}
                  </Text>
                </View>
              ) : null}
            </View>
          ))}

          {externalSpellSection.spells.length ? (
            <View style={[styles.sheetSubsection, { borderTopColor: colors.outlineVariant }]}>
              <Text style={[styles.cardSubheading, { color: colors.onSurface }]}>Magias de espécie, feat, feature ou invocation</Text>
              {externalSpellSection.spells.map((spell) => (
                <View key={`external:${spell.id}`} style={styles.spellRow}>
                  <View style={styles.flex}>
                    <Text style={[styles.itemName, { color: colors.onSurface }]}>{spell.name}</Text>
                    <Text style={[styles.itemMeta, { color: colors.onSurfaceVariant }]}>{spell.level === 0 ? 'Truque' : `Nível ${spell.level}`}{spell.sourceLabel ? ` · ${spell.sourceLabel}` : ''}{spellFlagLabel(spell) ? ` · ${spellFlagLabel(spell)}` : ''}</Text>
                  </View>
                </View>
              ))}
            </View>
          ) : null}
          <Button label="Abrir magias" icon="sparkles-outline" variant="outlined" onPress={() => router.push(`/characters/${character.id}/spells`)} />
        </Card>
      ) : null}

      <Card variant="outlined" title={`Feats e features · ${featGroups.primary.length} feat(s)${featGroups.granted.length ? ` · ${featGroups.granted.length} concessão(ões)` : ''} · ${character.features.length} feature(s)`} subtitle="Regras permanentes e opções que definem a build, com origem e resumo quando disponíveis.">
        {featGroups.primary.length ? (
          <View style={styles.compactGroup}>
            <Text style={[styles.cardSubheading, { color: colors.onSurface }]}>Feats</Text>
            {featGroups.primary.map((feat) => (
              <View key={feat.id} style={styles.itemRow}>
                <View style={styles.flex}>
                  <Text style={[styles.itemName, { color: colors.onSurface }]}>{feat.name}</Text>
                  <Text style={[styles.itemMeta, { color: colors.onSurfaceVariant }]}>{feat.source?.book ?? feat.source?.id ?? (feat.custom ? 'Personalizado' : 'Fonte não informada')}{feat.summary ? ` · ${feat.summary}` : ''}</Text>
                </View>
              </View>
            ))}
          </View>
        ) : <Text style={[styles.summaryLabel, { color: colors.onSurfaceVariant }]}>Nenhum feat registrado.</Text>}
        {featGroups.granted.length ? (
          <View style={[styles.compactGroup, { borderTopColor: colors.outlineVariant, borderTopWidth: StyleSheet.hairlineWidth, paddingTop: 10 }]}>
            <Text style={[styles.cardSubheading, { color: colors.onSurface }]}>Concessões de feats</Text>
            {featGroups.granted.map((feat) => (
              <View key={feat.id} style={styles.itemRow}>
                <View style={styles.flex}>
                  <Text style={[styles.itemName, { color: colors.onSurface }]}>{feat.name}</Text>
                  <Text style={[styles.itemMeta, { color: colors.onSurfaceVariant }]}>Concedido por outra escolha · {feat.source?.book ?? feat.source?.id ?? 'Fonte não informada'}</Text>
                </View>
              </View>
            ))}
          </View>
        ) : null}
        {character.features.length ? (
          <View style={[styles.compactGroup, { borderTopColor: colors.outlineVariant, borderTopWidth: StyleSheet.hairlineWidth, paddingTop: 10 }]}>
            <Text style={[styles.cardSubheading, { color: colors.onSurface }]}>Features</Text>
            {character.features.map((feature) => {
              const selectedSpeciesChoice = getSelectedSpeciesFeatureChoice(character, characterRuleItems, feature.id);
              return (
                <View key={feature.id} style={styles.itemRow}>
                  <View style={styles.flex}>
                    <Text style={[styles.itemName, { color: colors.onSurface }]}>{feature.name}</Text>
                    <Text style={[styles.itemMeta, { color: colors.onSurfaceVariant }]}>{feature.source?.book ?? feature.source?.id ?? (feature.custom ? 'Personalizada' : 'Fonte não informada')}{feature.actionCost && feature.actionCost !== 'free' ? ` · ${feature.actionCost}` : ''}{feature.summary ? ` · ${feature.summary}` : ''}</Text>
                    {selectedSpeciesChoice ? <Text style={[styles.itemMeta, { color: colors.primary, fontWeight: '800' }]}>Escolha ativa: {selectedSpeciesChoice.option.label}</Text> : null}
                    {selectedSpeciesChoice?.description ? <Text style={[styles.itemMeta, { color: colors.onSurfaceVariant }]}>{selectedSpeciesChoice.description}</Text> : null}
                  </View>
                </View>
              );
            })}
          </View>
        ) : null}
        {metamagicSources.length ? (
          <View style={[styles.sheetSubsection, { borderTopColor: colors.outlineVariant }]}>
            <Text style={[styles.cardSubheading, { color: colors.onSurface }]}>Metamagic</Text>
            {metamagicSources.map((source) => (
              <Text key={source.id} style={[styles.summaryLabel, { color: colors.onSurfaceVariant }]}>
                {source.label}: {source.selectedOptionIds.length}/{source.optionLimit} selecionada(s)
              </Text>
            ))}
            <Button label="Configurar Metamagic" variant="outlined" onPress={() => router.push(`/characters/${character.id}/metamagic`)} />
          </View>
        ) : null}
        <View style={styles.row}>
          <View style={styles.flex}><Button label="Feats" icon="ribbon-outline" variant="outlined" onPress={() => router.push(`/characters/${character.id}/feats`)} /></View>
          <View style={styles.flex}><Button label="Features" icon="star-outline" variant="outlined" onPress={() => router.push(`/characters/${character.id}/features`)} /></View>
        </View>
      </Card>

      <Card variant="filled" title="Proficiências, idiomas e sentidos" subtitle="Proficiências que não cabem na grade de perícias e sentidos especiais ativos.">
        {proficiencyGroups.length ? proficiencyGroups.map((group) => (
          <View key={group.label} style={styles.proficiencyGroup}>
            <Text style={[styles.itemName, { color: colors.onSurface }]}>{group.label}</Text>
            <Text style={[styles.itemMeta, { color: colors.onSurfaceVariant }]}>{group.values.join(' · ')}</Text>
          </View>
        )) : <Text style={[styles.summaryLabel, { color: colors.onSurfaceVariant }]}>Nenhuma proficiência adicional registrada.</Text>}
        <View style={[styles.compactGroup, { borderTopColor: colors.outlineVariant, borderTopWidth: StyleSheet.hairlineWidth, paddingTop: 10 }]}>
          <Text style={[styles.cardSubheading, { color: colors.onSurface }]}>Sentidos</Text>
          {characterSenses.length ? characterSenses.map((sense) => (
            <View key={sense.id} style={styles.itemRow}>
              <View style={styles.flex}>
                <Text style={[styles.itemName, { color: colors.onSurface }]}>{sense.name}{sense.rangeFeet ? ` · ${sense.rangeFeet} ft` : ''}</Text>
                {sense.notes ? <Text style={[styles.itemMeta, { color: colors.onSurfaceVariant }]}>{sense.notes}</Text> : null}
              </View>
            </View>
          )) : <Text style={[styles.summaryLabel, { color: colors.onSurfaceVariant }]}>Nenhum sentido especial registrado.</Text>}
        </View>
        <Button label="Editar proficiências" icon="school-outline" variant="outlined" onPress={() => router.push(`/characters/${character.id}/proficiencies`)} />
      </Card>

      <Card variant="outlined" title="Equipamento e inventário" subtitle={`Moedas: ${currencySummary(character.currency)} · ${character.magicItems.length} item(ns) mágico(s)`}>
        <View style={styles.compactGroup}>
          <Text style={[styles.cardSubheading, { color: colors.onSurface }]}>Armaduras</Text>
          {sheetArmors.length ? sheetArmors.map((armor) => (
            <View key={armor.id} style={styles.itemRow}>
              <Text style={[styles.itemName, { color: colors.onSurface }]}>{armor.name}{armor.equipped ? ' · equipada' : ''}</Text>
              <Text style={[styles.itemMeta, { color: colors.onSurfaceVariant }]}>CA base {armor.baseAC}{armor.acBonus ? ` · +${armor.acBonus} CA` : ''}{armor.armorCategory ? ` · ${armor.armorCategory}` : ''}</Text>
            </View>
          )) : <Text style={[styles.summaryLabel, { color: colors.onSurfaceVariant }]}>Nenhuma armadura registrada.</Text>}
        </View>
        <View style={[styles.compactGroup, { borderTopColor: colors.outlineVariant, borderTopWidth: StyleSheet.hairlineWidth, paddingTop: 10 }]}>
          <Text style={[styles.cardSubheading, { color: colors.onSurface }]}>Itens</Text>
          {character.equipment.length ? character.equipment.map((item) => (
            <View key={item.id} style={styles.summaryRow}>
              <Text style={[styles.itemName, { color: colors.onSurface }]}>{item.name}</Text>
              <Text style={[styles.itemMeta, { color: colors.onSurfaceVariant }]}>×{item.quantity}</Text>
            </View>
          )) : <Text style={[styles.summaryLabel, { color: colors.onSurfaceVariant }]}>Nenhum equipamento adicional.</Text>}
        </View>
        {character.magicItems.length ? (
          <View style={[styles.compactGroup, { borderTopColor: colors.outlineVariant, borderTopWidth: StyleSheet.hairlineWidth, paddingTop: 10 }]}>
            <Text style={[styles.cardSubheading, { color: colors.onSurface }]}>Itens mágicos</Text>
            {character.magicItems.map((item) => (
              <View key={item.id} style={styles.itemRow}>
                <View style={styles.flex}>
                  <Text style={[styles.itemName, { color: colors.onSurface }]}>{item.name} ×{item.quantity}{item.attunement ? ' · attunement' : ''}</Text>
                  {item.tags?.length ? <Text style={[styles.itemMeta, { color: colors.onSurfaceVariant }]}>{item.tags.join(' · ')}</Text> : null}
                </View>
              </View>
            ))}
          </View>
        ) : null}
        <Button label="Gerenciar equipamento" icon="bag-handle-outline" variant="outlined" onPress={() => router.push(`/characters/${character.id}/equipment`)} />
      </Card>

      <Card variant="filled" title={`Efeitos ativos (${character.activeEffects.filter((effect) => effect.status === 'active').length})`} subtitle="Concentração, condições e modificadores temporários que estão afetando a ficha agora.">
        {character.activeEffects.filter((effect) => effect.status === 'active').length ? character.activeEffects.filter((effect) => effect.status === 'active').map((effect) => (
          <View key={effect.id} style={styles.itemRow}>
            <View style={styles.flex}>
              <Text style={[styles.itemName, { color: colors.onSurface }]}>{effect.name}{effect.concentration ? ' · concentração' : ''}</Text>
              <Text style={[styles.itemMeta, { color: colors.onSurfaceVariant }]}>{effect.kind} · {activeEffectDurationLabel(effect)}{effect.conditionIds?.length ? ` · ${effect.conditionIds.join(', ')}` : ''}</Text>
              {effect.notes ? <Text style={[styles.itemMeta, { color: colors.onSurfaceVariant }]}>{effect.notes}</Text> : null}
            </View>
          </View>
        )) : <Text style={[styles.summaryLabel, { color: colors.onSurfaceVariant }]}>Nenhum efeito ativo.</Text>}
        <Button label="Gerenciar efeitos" icon="pulse-outline" variant="outlined" onPress={() => router.push(`/characters/${character.id}/effects`)} />
      </Card>

      {(character.companions ?? []).length ? (
        <Card variant="outlined" title={`Companions e familiares (${character.companions?.length ?? 0})`} subtitle="Criaturas vinculadas à ficha com PV, CA, movimento, sentidos e forma de comando.">
          {(character.companions ?? []).map((companion) => (
            <View key={companion.id} style={[styles.sheetSubsection, { borderTopColor: colors.outlineVariant }]}>
              <View style={styles.summaryRow}>
                <View style={styles.flex}>
                  <Text style={[styles.cardSubheading, { color: colors.onSurface }]}>{companion.name}</Text>
                  <Text style={[styles.itemMeta, { color: colors.onSurfaceVariant }]}>{companion.size ?? 'Tamanho não informado'} · {companion.creatureType ?? 'tipo não informado'} · comando: {companion.command === 'bonusAction' ? 'Bonus Action' : 'abrir mão de um ataque'}</Text>
                </View>
                <View style={styles.spellNumbers}>
                  <Text style={[styles.spellNumber, { color: colors.primary }]}>PV {companion.hitPoints.current}/{companion.hitPoints.max}</Text>
                  <Text style={[styles.summaryLabel, { color: colors.onSurfaceVariant }]}>CA {companion.armorClass}</Text>
                </View>
              </View>
              <Text style={[styles.itemMeta, { color: colors.onSurfaceVariant }]}>Movimento: {Object.entries(companion.speed).map(([kind, value]) => `${kind} ${value} ft`).join(' · ') || '—'}{companion.senses ? ` · Sentidos: ${companion.senses}` : ''}</Text>
              {companion.traits.length ? <Text style={[styles.itemMeta, { color: colors.onSurfaceVariant }]}>Traits: {companion.traits.map((trait) => trait.name).join(' · ')}</Text> : null}
              {companion.actions.length ? <Text style={[styles.itemMeta, { color: colors.onSurfaceVariant }]}>Ações: {companion.actions.map((action) => action.name).join(' · ')}</Text> : null}
            </View>
          ))}
          {character.classes.some((entry) => entry.name.toLowerCase() === 'warlock') ? <Button label="Abrir familiar" icon="paw-outline" variant="outlined" onPress={() => router.push(`/characters/${character.id}/familiar`)} /> : null}
        </Card>
      ) : null}

      <Card variant="filled" title="Dano por turno" subtitle={damageSummary ? damageSummary.rotation.name : 'Crie uma rotação para transformar ações em um turno completo.'}>
        {damageSummary ? (
          <>
            <Text style={[styles.damageValue, { color: colors.primary }]}>{formatNumber(damageSummary.result.weightedAverage ?? damageSummary.result.total.average)}</Text>
            <Text style={[styles.damageLabel, { color: colors.onSurfaceVariant }]}>{damageSummary.result.weightedAverage === undefined ? 'média bruta' : 'média ponderada por acerto'}</Text>
            <View style={styles.metrics}>
              <MetricTile label="Mínimo" value={formatNumber(damageSummary.result.total.min)} />
              <MetricTile label="Máximo" value={formatNumber(damageSummary.result.total.max)} />
              <MetricTile label="Ataques" value={damageSummary.result.attackCount} />
            </View>
            <Button label="Ver análise completa" icon="analytics-outline" variant="tonal" onPress={() => router.push(`/characters/${character.id}/analysis`)} />
          </>
        ) : (
          <Button label="Criar primeira rotação" icon="add" onPress={() => router.push(`/characters/${character.id}/rotations/new`)} />
        )}
      </Card>

      <Text style={[styles.sectionTitle, { color: colors.onSurface }]}>Detalhes e edição</Text>
      <Card variant="outlined" title="Identidade e construção" subtitle={`${importedCount} itens vinculados ao compêndio`}>
        <View style={styles.summaryRow}>
          <Text style={[styles.summaryLabel, { color: colors.onSurfaceVariant }]}>Classe</Text>
          <Text style={[styles.summaryValue, { color: colors.onSurface }]}>{characterClassSummary(character)}</Text>
        </View>
        <View style={styles.summaryRow}>
          <Text style={[styles.summaryLabel, { color: colors.onSurfaceVariant }]}>Espécie</Text>
          <Text style={[styles.summaryValue, { color: colors.onSurface }]}>{character.species?.name ?? 'Pendente'}</Text>
        </View>
        <View style={styles.summaryRow}>
          <Text style={[styles.summaryLabel, { color: colors.onSurfaceVariant }]}>Background</Text>
          <Text style={[styles.summaryValue, { color: colors.onSurface }]}>{character.background?.name ?? 'Pendente'}</Text>
        </View>
        <Button label="Adicionar do compêndio" icon="library-outline" onPress={() => router.push(`/characters/${character.id}/compendium`)} />
        <View style={styles.row}>
          <View style={styles.flex}><Button label="Identidade" icon="person-outline" variant="outlined" onPress={() => router.push(`/characters/${character.id}/identity`)} /></View>
          <View style={styles.flex}><Button label="Atributos" icon="options-outline" variant="outlined" onPress={() => router.push(`/characters/${character.id}/attributes`)} /></View>
        </View>
        <View style={styles.row}>
          <View style={styles.flex}><Button label="Equipamento" icon="shield-outline" variant="outlined" onPress={() => router.push(`/characters/${character.id}/equipment`)} /></View>
          <View style={styles.flex}><Button label="Magias" icon="sparkles-outline" variant="outlined" onPress={() => router.push(`/characters/${character.id}/spells`)} /></View>
        </View>
        <View style={styles.row}>
          <View style={styles.flex}><Button label="Proficiências" icon="school-outline" variant="outlined" onPress={() => router.push(`/characters/${character.id}/proficiencies`)} /></View>
          <View style={styles.flex}><Button label="Classes" icon="git-branch-outline" variant="outlined" onPress={() => router.push(`/characters/${character.id}/classes`)} /></View>
        </View>
        <View style={styles.row}>
          <View style={styles.flex}><Button label="Feats" icon="ribbon-outline" variant="outlined" onPress={() => router.push(`/characters/${character.id}/feats`)} /></View>
          <View style={styles.flex}><Button label="Features" icon="star-outline" variant="outlined" onPress={() => router.push(`/characters/${character.id}/features`)} /></View>
        </View>
        {character.classes.some((entry) => entry.name.toLowerCase() === 'warlock') ? (
          <>
          <View style={styles.row}>
            <View style={styles.flex}><Button label="Eldritch Invocations" icon="eye-outline" variant="outlined" onPress={() => router.push(`/characters/${character.id}/invocations`)} /></View>
            {pactOfTheBlade ? (
              <View style={styles.flex}><Button label="Pact Weapon" icon="flash-outline" variant="outlined" onPress={() => router.push(`/characters/${character.id}/pact-weapon`)} /></View>
            ) : null}
          </View>
          <View style={styles.row}>
            <View style={styles.flex}><Button label="Poderes de Warlock" icon="moon-outline" variant="outlined" onPress={() => router.push(`/characters/${character.id}/warlock-special`)} /></View>
            {character.companions?.length ? (
              <View style={styles.flex}><Button label="Pact Familiar" icon="paw-outline" variant="outlined" onPress={() => router.push(`/characters/${character.id}/familiar`)} /></View>
            ) : null}
          </View>
          </>
        ) : null}
      </Card>

      {subclassChoiceSummaries.length ? (
        <Card variant="outlined" title="Configuração de subclasse" subtitle="Escolhas internas que alteram como a subclasse funciona.">
          {subclassChoiceSummaries.map((summary) => (
            <View key={`${summary.subclassItemId}:${summary.title}`} style={styles.summaryRow}>
              <View style={styles.flex}>
                <Text style={[styles.summaryLabel, { color: colors.onSurfaceVariant }]}>{summary.subclassName} · {summary.title}</Text>
                <Text style={[styles.summaryValue, { color: summary.pending ? colors.error : colors.onSurface, textAlign: 'left' }]}>{summary.value ?? 'Configuração pendente'}</Text>
                {summary.detail ? <Text style={[styles.summaryLabel, { color: colors.onSurfaceVariant }]}>{summary.detail}</Text> : null}
              </View>
            </View>
          ))}
          <Button label="Abrir configurações de subclasse" variant="outlined" onPress={() => router.push(`/characters/${character.id}/classes`)} />
        </Card>
      ) : null}


      <Card variant="outlined" title="Evolução" subtitle="Suba de nível, resolva pendências e acompanhe as alterações da build.">
        <Button label={`Central de progressão${(character.pendingChoices ?? []).length ? ` · ${(character.pendingChoices ?? []).length} pendente(s)` : ''}`} icon="list-outline" onPress={() => router.push(`/characters/${character.id}/progression`)} />
        <Button label="Subir de nível" icon="trending-up" variant="outlined" onPress={() => router.push(`/characters/${character.id}/level-up`)} />
        <Button label="Histórico da build" icon="time-outline" variant="outlined" onPress={() => router.push(`/characters/${character.id}/history`)} />
      </Card>

      <Pressable accessibilityRole="button" accessibilityState={{ expanded: showMore }} onPress={() => setShowMore((current) => !current)} style={styles.moreHeader}>
        <View>
          <Text style={[styles.moreTitle, { color: colors.onSurface }]}>Opções avançadas</Text>
          <Text style={[styles.moreSubtitle, { color: colors.onSurfaceVariant }]}>Efeitos, presets, relatórios e manutenção</Text>
        </View>
        <View style={[styles.chevron, { backgroundColor: colors.surfaceContainer, borderRadius: radii.full }]}>
          <Ionicons name={showMore ? 'chevron-up' : 'chevron-down'} size={20} color={colors.onSurfaceVariant} />
        </View>
      </Pressable>

      {showMore ? (
        <Card variant="filled">
          <IssueList issues={validation.issues} />
          <Button label="Classes e multiclasse" variant="text" onPress={() => router.push(`/characters/${character.id}/classes`)} />
          <Button label="Recursos e descansos" variant="text" onPress={() => router.push(`/characters/${character.id}/resources`)} />
          <Button label="Efeitos ativos" variant="text" onPress={() => router.push(`/characters/${character.id}/effects`)} />
          <Button label="Efeitos derivados" variant="text" onPress={() => router.push(`/characters/${character.id}/derived-effects`)} />
          <Button label="Presets mecânicos" variant="text" onPress={() => router.push(`/characters/${character.id}/mechanic-presets`)} />
          <Button label="Presets de build" variant="text" onPress={() => router.push(`/characters/${character.id}/presets`)} />
          <Button label="Comparar rotações" variant="text" onPress={() => router.push(`/characters/${character.id}/comparison`)} />
          <Button label="Relatórios e exportação" variant="text" onPress={() => router.push(`/characters/${character.id}/report`)} />
          {confirmDelete ? (
            <View
              testID="delete-character-confirmation"
              accessibilityRole="alert"
              style={[styles.deleteConfirmation, { backgroundColor: colors.errorContainer, borderColor: colors.error, borderRadius: radii.lg }]}
            >
              <Text style={[styles.deleteTitle, { color: colors.error }]}>Excluir {getCharacterDisplayName(character)} permanentemente?</Text>
              <Text style={[styles.deleteDescription, { color: colors.onSurface }]}>A ficha, os cenários de combate e o histórico exclusivo deste personagem serão removidos deste dispositivo.</Text>
              {deleteError ? <Text style={[styles.deleteError, { color: colors.error }]}>{deleteError}</Text> : null}
              <View style={styles.row}>
                <View style={styles.flex}>
                  <Button testID="cancel-delete-character" label="Cancelar" variant="outlined" onPress={() => { setConfirmDelete(false); setDeleteError(undefined); }} />
                </View>
                <View style={styles.flex}>
                  <Button
                    testID="confirm-delete-character"
                    label="Excluir definitivamente"
                    icon="trash-outline"
                    variant="danger"
                    onPress={() => {
                      const result = deleteCharacterData(character.id);
                      if (!result.ok) {
                        setDeleteError('Não foi possível excluir o personagem. Tente novamente.');
                        return;
                      }
                      router.replace('/');
                    }}
                  />
                </View>
              </View>
            </View>
          ) : (
            <Button
              testID="delete-character-button"
              label="Excluir personagem"
              icon="trash-outline"
              variant="danger"
              onPress={() => { setDeleteError(undefined); setConfirmDelete(true); }}
            />
          )}
        </Card>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  metrics: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  damageValue: { fontSize: 44, lineHeight: 50, fontWeight: '900', letterSpacing: -1.2 },
  damageLabel: { marginTop: -8, fontSize: 12, lineHeight: 17, fontWeight: '700' },
  sectionTitle: { marginTop: 6, fontSize: 21, lineHeight: 27, fontWeight: '900' },
  summaryRow: { minHeight: 36, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 12 },
  summaryLabel: { fontSize: 14, lineHeight: 20 },
  summaryValue: { flex: 1, fontSize: 14, lineHeight: 20, fontWeight: '800', textAlign: 'right' },
  abilityGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  abilityCell: { flexGrow: 1, flexBasis: 96, minWidth: 92, borderWidth: 1, borderRadius: 14, padding: 10, alignItems: 'center', gap: 1 },
  abilityCode: { fontSize: 12, lineHeight: 16, fontWeight: '900' },
  abilityScore: { fontSize: 24, lineHeight: 28, fontWeight: '900' },
  abilityModifier: { fontSize: 16, lineHeight: 21, fontWeight: '900' },
  abilitySave: { fontSize: 11, lineHeight: 15, fontWeight: '700' },
  skillColumns: { gap: 2 },
  skillRow: { minHeight: 36, flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 3 },
  skillName: { fontSize: 14, lineHeight: 19, fontWeight: '800' },
  skillMeta: { fontSize: 11, lineHeight: 15 },
  skillBonus: { minWidth: 42, fontSize: 16, lineHeight: 21, fontWeight: '900', textAlign: 'right' },
  legend: { fontSize: 11, lineHeight: 16, fontWeight: '700' },
  weaponRow: { minHeight: 58, flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 8, borderBottomWidth: StyleSheet.hairlineWidth },
  weaponName: { fontSize: 15, lineHeight: 20, fontWeight: '900' },
  weaponMeta: { fontSize: 11, lineHeight: 16 },
  weaponNumbers: { minWidth: 110, alignItems: 'flex-end', gap: 2 },
  weaponAttack: { fontSize: 18, lineHeight: 23, fontWeight: '900' },
  weaponDamage: { maxWidth: 160, fontSize: 11, lineHeight: 16, fontWeight: '700', textAlign: 'right' },
  resourceSummary: { minHeight: 48, flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 6 },
  resourceUseSummary: { gap: 2, paddingVertical: 6 },
  resourceValue: { minWidth: 52, fontSize: 18, lineHeight: 24, fontWeight: '900', textAlign: 'right' },
  cardSubheading: { fontSize: 16, lineHeight: 22, fontWeight: '900' },
  sheetSubsection: { gap: 6, borderTopWidth: StyleSheet.hairlineWidth, paddingTop: 10, marginTop: 4 },
  compactGroup: { gap: 5 },
  itemRow: { minHeight: 34, paddingVertical: 4 },
  itemName: { fontSize: 14, lineHeight: 19, fontWeight: '800' },
  itemMeta: { fontSize: 12, lineHeight: 17 },
  spellRow: { minHeight: 34, flexDirection: 'row', alignItems: 'center', paddingVertical: 3 },
  spellNumbers: { minWidth: 92, alignItems: 'flex-end' },
  spellNumber: { fontSize: 16, lineHeight: 21, fontWeight: '900' },
  proficiencyGroup: { gap: 2, paddingVertical: 3 },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  flex: { flex: 1, minWidth: 130 },
  moreHeader: { minHeight: 60, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, paddingHorizontal: 2 },
  moreTitle: { fontSize: 17, lineHeight: 23, fontWeight: '800' },
  moreSubtitle: { fontSize: 12, lineHeight: 17 },
  chevron: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  deleteConfirmation: { borderWidth: 1, padding: 16, gap: 10 },
  deleteTitle: { fontSize: 16, lineHeight: 22, fontWeight: '900' },
  deleteDescription: { fontSize: 13, lineHeight: 19 },
  deleteError: { fontSize: 13, lineHeight: 19, fontWeight: '800' }
});
