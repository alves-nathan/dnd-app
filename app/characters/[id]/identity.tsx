import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Button } from '../../../src/components/Button';
import { Card } from '../../../src/components/Card';
import { Chip } from '../../../src/components/Chip';
import { Field } from '../../../src/components/Field';
import { IssueList } from '../../../src/components/IssueList';
import { PendingChoiceContextCard } from '../../../src/components/PendingChoiceContextCard';
import { Screen } from '../../../src/components/Screen';
import {
  applyAutomaticSpeciesProgression,
  getSpeciesChoiceRequirements,
  removeSpeciesProgressionFeatures,
  setSpeciesChoiceOption,
  setSpeciesChoiceSpellcastingAbility,
  speciesChoiceForRequirement,
  validateSpeciesChoices
} from '../../../src/characters/speciesChoiceRules';
import { reconcileCharacterBuild } from '../../../src/characters/buildReconciliation';
import {
  getSpeciesSpellReplacementRequirements,
  markSpeciesSpellReplacementsUsed,
  normalizeSpeciesSpellReplacementChoices,
  setSpeciesSpellReplacement,
  speciesSpellReplacementAvailable,
  validateSpeciesSpellReplacementEdits
} from '../../../src/characters/speciesSpellReplacementRules';
import { manualSource } from '../../../src/data/mockData';
import { useCharacterProgressionSession } from '../../../src/characters/useCharacterProgressionSession';
import { useCharacterChoiceBridge } from '../../../src/catalog/useCharacterChoiceBridge';
import { useAppTheme } from '../../../src/theme';
import { getCharacterDisplayName } from '../../../src/ui/characterIdentity';
import { createId } from '../../../src/utils/id';
import type { Character, CharacterSpeciesChoice } from '../../../src/types';

const getId = (value: string | string[] | undefined) => Array.isArray(value) ? value[0] : value;

export default function IdentityScreen() {
  const { colors } = useAppTheme();
  const params = useLocalSearchParams();
  const id = getId(params.id);
  const pendingId = getId(params.pendingId);
  const progressionSession = useCharacterProgressionSession(id);
  const character = progressionSession.character;
  const updateCharacter = progressionSession.updateCharacter;
  const bridge = useCharacterChoiceBridge();
  const { items, choiceForItemId } = bridge;
  const pendingChoice = character?.pendingChoices?.find((choice) => choice.id === pendingId);
  const pendingResolution = character && pendingChoice ? bridge.resolvePendingChoice(character, pendingChoice) : undefined;
  const [name, setName] = useState(character?.name ?? '');
  const [showManual, setShowManual] = useState(false);
  const [species, setSpecies] = useState(character?.species?.name ?? '');
  const [background, setBackground] = useState(character?.background?.name ?? '');
  const [speciesChoices, setSpeciesChoices] = useState<CharacterSpeciesChoice[]>(character?.buildChoices?.speciesChoices ?? []);


  const speciesLink = character?.compendiumLinks?.find(
    (link) => link.appliedAs === 'species' && link.status === 'active'
  );
  const speciesChoice = choiceForItemId(speciesLink?.choiceId ?? speciesLink?.itemId ?? '');
  const speciesItem = items.find((item) => item.id === (speciesChoice?.choiceId ?? speciesLink?.itemId) && item.type === 'species');
  const speciesRequirements = useMemo(
    () => getSpeciesChoiceRequirements(speciesItem, items, character?.level ?? 1),
    [speciesItem?.id, items, character?.level]
  );
  const speciesIssues = useMemo(
    () => validateSpeciesChoices(speciesRequirements, speciesChoices),
    [speciesRequirements, speciesChoices]
  );
  useEffect(() => {
    setSpeciesChoices((current) => normalizeSpeciesSpellReplacementChoices(
      speciesItem,
      items,
      character?.level ?? 1,
      current
    ));
  }, [speciesItem?.id, items, character?.level]);

  const speciesReplacementRequirements = useMemo(
    () => getSpeciesSpellReplacementRequirements(speciesItem, items, character?.level ?? 1, speciesChoices),
    [speciesItem?.id, items, character?.level, speciesChoices]
  );
  const speciesReplacementIssues = useMemo(
    () => character
      ? validateSpeciesSpellReplacementEdits(
          character,
          speciesReplacementRequirements,
          character.buildChoices?.speciesChoices ?? [],
          speciesChoices
        )
      : [],
    [character, speciesReplacementRequirements, speciesChoices]
  );
  const allSpeciesIssues = [...speciesIssues, ...speciesReplacementIssues];

  if (!character || !id) return <Screen title="Personagem não encontrado" onBack={() => router.back()} />;

  const save = () => {
    updateCharacter(character.id, (current) => {
      const speciesChanged = Boolean(species.trim() && species.trim() !== current.species?.name);
      const backgroundChanged = Boolean(background.trim() && background.trim() !== current.background?.name);
      const originalSpeciesChoices = current.buildChoices?.speciesChoices ?? [];
      const persistedSpeciesChoices = speciesChanged
        ? []
        : markSpeciesSpellReplacementsUsed(
            current,
            speciesReplacementRequirements,
            originalSpeciesChoices,
            speciesChoices
          );
      let next: Character = {
        ...current,
        name: name.trim(),
        species: speciesChanged
          ? { id: createId('species'), name: species.trim(), source: manualSource, features: [] }
          : current.species,
        background: backgroundChanged
          ? { id: createId('background'), name: background.trim(), source: manualSource, features: [] }
          : current.background,
        buildChoices: {
          ...(current.buildChoices ?? {
            speciesChoices: [],
            classSkillChoices: [],
            classToolChoices: [],
            expertiseSkills: [],
            languages: [],
            spellAssignments: {},
            spellbookAssignments: {},
            equipmentSelections: []
          }),
          speciesChoices: persistedSpeciesChoices
        },
        compendiumLinks: (current.compendiumLinks ?? []).map((link) =>
          ((link.appliedAs === 'species' && speciesChanged) || (link.appliedAs === 'background' && backgroundChanged))
            ? { ...link, status: 'removed' as const }
            : link
        )
      };

      if (speciesChanged) {
        next = removeSpeciesProgressionFeatures(next, items);
      } else {
        next = applyAutomaticSpeciesProgression(next, items).character;
      }
      next = reconcileCharacterBuild(next, items).character;
      return pendingId ? { ...next, pendingChoices: (next.pendingChoices ?? []).filter((choice) => choice.id !== pendingId) } : next;
    });
    router.replace(progressionSession.hasActiveTransaction ? `/characters/${character.id}/progression` : `/characters/${character.id}`);
  };

  return (
    <Screen
      eyebrow={getCharacterDisplayName(character)}
      title="Identidade e origem"
      subtitle="O nome é opcional. Espécie, variante, background e Origin Feat podem ser alterados depois."
      onBack={() => router.replace(progressionSession.hasActiveTransaction ? `/characters/${character.id}/progression` : `/characters/${character.id}`)}
    >
      <PendingChoiceContextCard pendingChoice={pendingChoice} resolution={pendingResolution} />
      <Field
        label="Nome do personagem"
        value={name}
        onChangeText={setName}
        autoCapitalize="words"
        placeholder="Opcional"
        supportingText="Vazio usa um identificador derivado da classe ou do ID."
      />

      <Card variant="filled" title="Origem atual">
        <View style={styles.row}><Text style={[styles.label, { color: colors.onSurfaceVariant }]}>Espécie</Text><Text style={[styles.value, { color: colors.onSurface }]}>{character.species?.name ?? 'Pendente'}</Text></View>
        <View style={styles.row}><Text style={[styles.label, { color: colors.onSurfaceVariant }]}>Background</Text><Text style={[styles.value, { color: colors.onSurface }]}>{character.background?.name ?? 'Pendente'}</Text></View>
        <View style={styles.row}><Text style={[styles.label, { color: colors.onSurfaceVariant }]}>Origin Feat</Text><Text style={[styles.value, { color: colors.onSurface }]}>{character.feats.find((feat) => feat.id === character.originFeatId)?.name ?? 'Pendente'}</Text></View>
      </Card>

      {speciesRequirements.map((requirement) => {
        const selectedChoice = speciesChoiceForRequirement(speciesChoices, requirement);
        return (
          <Card
            key={requirement.featureItemId}
            variant="outlined"
            title={requirement.featureName}
            subtitle="Altere a variante ou legado sem recriar a ficha."
          >
            <View style={styles.chips}>
              {requirement.options.map((option) => (
                <Chip
                  key={`${requirement.featureItemId}-${option.id}`}
                  label={option.label}
                  selected={selectedChoice?.optionId === option.id}
                  onPress={() => setSpeciesChoices((current) => setSpeciesChoiceOption(current, requirement, option.id))}
                />
              ))}
            </View>
            {requirement.spellcastingAbilityOptions.length ? (
              <>
                <Text style={[styles.sectionTitle, { color: colors.onSurface }]}>Atributo de conjuração</Text>
                <View style={styles.chips}>
                  {requirement.spellcastingAbilityOptions.map((ability) => (
                    <Chip
                      key={`${requirement.featureItemId}-${ability}`}
                      label={ability}
                      selected={selectedChoice?.spellcastingAbility === ability}
                      onPress={() => setSpeciesChoices((current) => setSpeciesChoiceSpellcastingAbility(current, requirement, ability))}
                    />
                  ))}
                </View>
              </>
            ) : null}
          </Card>
        );
      })}
      {speciesReplacementRequirements.map((requirement) => {
        const currentChoice = speciesChoices.find((choice) => choice.featureItemId === requirement.featureItemId);
        const selectedSpellItemId = currentChoice?.replacementSpellItemId ?? requirement.initialSpellItemId;
        const available = speciesSpellReplacementAvailable(
          character,
          character.buildChoices?.speciesChoices ?? [],
          requirement
        );
        const selectedSpell = requirement.candidateSpells.find((spell) => spell.id === selectedSpellItemId);
        return (
          <Card
            key={`species-spell-replacement-${requirement.id}`}
            variant="outlined"
            title={`${requirement.featureName} · troca após Descanso Longo`}
            subtitle={available
              ? `Troca disponível. Atual: ${selectedSpell?.name ?? 'magia concedida'}. Salvar uma nova opção consome esta oportunidade até o próximo Descanso Longo.`
              : `Atual: ${selectedSpell?.name ?? 'magia concedida'}. Conclua um novo Descanso Longo para liberar outra troca.`}
          >
            <View style={styles.chips}>
              {requirement.candidateSpells.map((spell) => (
                <Chip
                  key={`${requirement.id}-${spell.id}`}
                  label={spell.name}
                  selected={selectedSpellItemId === spell.id}
                  disabled={!available}
                  onPress={() => setSpeciesChoices((current) => setSpeciesSpellReplacement(current, requirement, spell.id))}
                />
              ))}
            </View>
          </Card>
        );
      })}
      {allSpeciesIssues.length ? <IssueList issues={allSpeciesIssues} /> : null}

      <Card variant="hero" title="Escolher do compêndio">
        <Button label="Procurar espécies" onPress={() => router.push(`/characters/${character.id}/compendium?type=species${pendingId ? `&pendingId=${encodeURIComponent(pendingId)}` : ''}`)} />
        <Button label="Procurar backgrounds" variant="outlined" onPress={() => router.push(`/characters/${character.id}/compendium?type=background${pendingId ? `&pendingId=${encodeURIComponent(pendingId)}` : ''}`)} />
        <Button label="Gerenciar feats" variant="outlined" onPress={() => router.push(`/characters/${character.id}/feats${pendingId ? `?pendingId=${encodeURIComponent(pendingId)}` : ''}`)} />
      </Card>

      <Button label={showManual ? 'Ocultar alternativa manual' : 'Criar espécie ou background manual'} variant="text" onPress={() => setShowManual((value) => !value)} />
      {showManual ? (
        <Card variant="outlined" title="Origem personalizada">
          <Field label="Espécie manual" value={species} onChangeText={setSpecies} />
          <Field label="Background manual" value={background} onChangeText={setBackground} />
        </Card>
      ) : null}

      <Button label="Salvar alterações" icon="checkmark" disabled={allSpeciesIssues.length > 0} onPress={save} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  row: { minHeight: 40, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 12 },
  label: { fontSize: 14 },
  value: { flex: 1, textAlign: 'right', fontWeight: '800' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  sectionTitle: { fontSize: 14, fontWeight: '800', marginTop: 8 }
});
