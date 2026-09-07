import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { Alert, StyleSheet, Text, View } from 'react-native';
import { Button } from '../../../src/components/Button';
import { Card } from '../../../src/components/Card';
import { Field } from '../../../src/components/Field';
import { IssueList } from '../../../src/components/IssueList';
import { MetricTile } from '../../../src/components/MetricTile';
import { PendingChoiceContextCard } from '../../../src/components/PendingChoiceContextCard';
import { Screen } from '../../../src/components/Screen';
import { SubclassChoiceEditor } from '../../../src/components/SubclassChoiceEditor';
import { validateMulticlassPrerequisites } from '../../../src/characters/characterBuildRules';
import { reconcileCharacterSnapshot } from '../../../src/characters/characterReconciliation';
import { reconcileCharacterBuild } from '../../../src/characters/buildReconciliation';
import { manualSource } from '../../../src/data/mockData';
import { getProficiencyBonus, getTotalLevel } from '../../../src/rules-engine/characters/derivedStats';
import { useCharacterProgressionSession } from '../../../src/characters/useCharacterProgressionSession';
import { useCharacterChoiceBridge } from '../../../src/catalog/useCharacterChoiceBridge';
import { useAppTheme } from '../../../src/theme';
import type { CharacterClass, RuleValidationIssue } from '../../../src/types';
import { getCharacterDisplayName } from '../../../src/ui/characterIdentity';
import { createId } from '../../../src/utils/id';
import { getSubclassChoiceRequirements, validateSubclassChoices } from '../../../src/characters/subclassChoiceRules';

const getId = (value: string | string[] | undefined) => Array.isArray(value) ? value[0] : value;
const normalizedLevel = (value: string | number) => Math.max(1, Math.min(20, Number(value) || 1));

export default function ClassesScreen() {
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
  const [showManual, setShowManual] = useState(false);
  const [name, setName] = useState('');
  const [level, setLevel] = useState('1');
  const [classLevels, setClassLevels] = useState<Record<string, string>>({});
  const [lastIssues, setLastIssues] = useState<RuleValidationIssue[]>([]);


  useEffect(() => {
    if (character) setClassLevels(Object.fromEntries(character.classes.map((entry) => [entry.id, String(entry.level)])));
  }, [character?.classes, character?.id]);

  const editedTotal = useMemo(
    () => character?.classes.reduce((sum, entry) => sum + normalizedLevel(classLevels[entry.id] ?? entry.level), 0) ?? 0,
    [character?.classes, classLevels]
  );

  const subclassChoiceRequirements = useMemo(() => {
    if (!character) return [];
    return (character.compendiumLinks ?? [])
      .filter((link) => link.appliedAs === 'subclass' && link.status === 'active')
      .flatMap((link) => {
        const subclassItem = items.find((item) => item.id === link.itemId && item.type === 'subclass');
        const subclassEntity = character.subclasses.find((entry) => entry.id === link.appliedEntityId);
        const classLevel = subclassEntity
          ? character.classes.find((entry) => entry.id === subclassEntity.classId)?.level ?? character.level
          : character.level;
        return getSubclassChoiceRequirements(subclassItem, items, classLevel);
      });
  }, [character, items]);

  const subclassChoiceIssues = useMemo(
    () => validateSubclassChoices(subclassChoiceRequirements, character?.buildChoices?.subclassChoices),
    [character?.buildChoices?.subclassChoices, subclassChoiceRequirements]
  );

  if (!character || !id) return <Screen title="Personagem não encontrado" onBack={() => router.back()} />;

  const linkedClassItems = character.classes
    .map((classEntity) => {
      const link = (character.compendiumLinks ?? []).find(
        (entry) => entry.appliedAs === 'class' && entry.appliedEntityId === classEntity.id && entry.status === 'active'
      );
      const choice = choiceForItemId(link?.choiceId ?? link?.itemId ?? '');
      const itemId = choice?.choiceId ?? link?.itemId;
      return items.find((candidate) => candidate.id === itemId);
    })
    .filter((item): item is NonNullable<typeof item> => Boolean(item));

  const saveLevels = () => {
    if (editedTotal > 20) {
      Alert.alert('Níveis inválidos', 'A soma não pode ultrapassar 20.');
      return;
    }
    const classes = character.classes.map((entry) => ({
      ...entry,
      level: normalizedLevel(classLevels[entry.id] ?? entry.level)
    }));
    const leveled = { ...character, classes, level: classes.reduce((sum, entry) => sum + entry.level, 0) };
    const prerequisites = validateMulticlassPrerequisites(linkedClassItems, leveled.abilities);
    if (prerequisites.length) {
      setLastIssues(prerequisites);
      Alert.alert('Multiclasse inválida', prerequisites.map((issue) => issue.message).join('\n'));
      return;
    }
    const reconciliation = reconcileCharacterSnapshot(leveled, items);
    setLastIssues(reconciliation.issues);
    updateCharacter(id, () => reconciliation.character);
    Alert.alert(
      'Níveis salvos',
      [
        `Nível total: ${reconciliation.character.level}.`,
        reconciliation.summary.appliedFeatureCount ? `${reconciliation.summary.appliedFeatureCount} feature(s) adicionada(s).` : undefined,
        reconciliation.summary.removedFeatureCount ? `${reconciliation.summary.removedFeatureCount} feature(s) removida(s).` : undefined,
        reconciliation.summary.removedSubclassCount ? `${reconciliation.summary.removedSubclassCount} subclasse(s) removida(s).` : undefined,
        reconciliation.summary.removedResourceCount ? `${reconciliation.summary.removedResourceCount} recurso(s) removido(s).` : undefined
      ].filter(Boolean).join('\n')
    );
  };

  const removeSubclass = (subclassId: string, nameValue: string) => Alert.alert(
    'Remover subclasse?',
    nameValue,
    [
      { text: 'Cancelar', style: 'cancel' },
      {
        text: 'Remover',
        style: 'destructive',
        onPress: () => updateCharacter(id, (current) => ({
          ...current,
          subclasses: current.subclasses.filter((subclass) => subclass.id !== subclassId),
          compendiumLinks: (current.compendiumLinks ?? []).map((link) =>
            link.appliedAs === 'subclass' && link.appliedEntityId === subclassId && link.status === 'active'
              ? { ...link, status: 'removed' as const }
              : link
          )
        }))
      }
    ]
  );

  const addClass = () => {
    if (!name.trim()) return;
    const next: CharacterClass = {
      id: createId('class'),
      name: name.trim(),
      level: normalizedLevel(level),
      source: manualSource
    };
    if (getTotalLevel(character) + next.level > 20) {
      Alert.alert('Níveis inválidos', 'A soma não pode ultrapassar 20.');
      return;
    }
    updateCharacter(id, (current) => {
      const classes = [...current.classes, next];
      return { ...current, classes, level: classes.reduce((sum, entry) => sum + entry.level, 0) };
    });
    setName('');
    setLevel('1');
    setShowManual(false);
  };

  return (
    <Screen
      eyebrow={getCharacterDisplayName(character)}
      title="Classes e níveis"
      subtitle="Edite a distribuição, valide multiclasse e reconcilie features automaticamente."
      onBack={() => router.push(progressionSession.hasActiveTransaction ? `/characters/${character.id}/progression` : `/characters/${character.id}`)}
    >
      <PendingChoiceContextCard pendingChoice={pendingChoice} resolution={pendingResolution} />
      <View style={styles.metrics}>
        <MetricTile label="Nível atual" value={getTotalLevel(character)} />
        <MetricTile label="Nível editado" value={editedTotal} />
        <MetricTile label="Proficiência" value={`+${getProficiencyBonus(character)}`} />
      </View>
      <Card variant="filled" title="Distribuição entre classes">
        {character.classes.length ? character.classes.map((cls) => (
          <View key={cls.id} style={[styles.row, { borderBottomColor: colors.outlineVariant }]}>
            <View style={styles.flex}>
              <Text style={{ fontWeight: '800' }}>{cls.name}</Text>
              <Text style={{ color: colors.onSurfaceVariant }}>{cls.source?.book ?? 'Entrada manual'}</Text>
            </View>
            <View style={styles.levelField}>
              <Field label="Nível" value={classLevels[cls.id] ?? String(cls.level)} onChangeText={(value) => setClassLevels((current) => ({ ...current, [cls.id]: value.replace(/\D/g, '') }))} keyboardType="number-pad" />
            </View>
          </View>
        )) : <Text>Nenhuma classe.</Text>}
        <Button label="Salvar e reconciliar" onPress={saveLevels} />
        <Button label="Subir exatamente um nível" variant="outlined" onPress={() => router.push(`/characters/${character.id}/level-up`)} />
      </Card>
      {lastIssues.length ? <Card variant="outlined" title="Resultado da reconciliação"><IssueList issues={lastIssues} /></Card> : null}
      <Card variant="filled" title="Subclasses">
        {character.subclasses.length ? character.subclasses.map((subclass) => (
          <View key={subclass.id} style={[styles.row, { borderBottomColor: colors.outlineVariant }]}>
            <View style={styles.flex}>
              <Text style={{ fontWeight: '800' }}>{subclass.name}</Text>
              <Text>{character.classes.find((entry) => entry.id === subclass.classId)?.name ?? 'Classe-base não resolvida'}</Text>
            </View>
            <Button label="Remover" variant="text" onPress={() => removeSubclass(subclass.id, subclass.name)} />
          </View>
        )) : <Text>Nenhuma subclasse escolhida.</Text>}
        <Button label="Escolher ou trocar subclasse" variant="outlined" onPress={() => router.push(`/characters/${character.id}/compendium?type=subclass${pendingId ? `&pendingId=${encodeURIComponent(pendingId)}` : ''}`)} />
      </Card>
      {subclassChoiceRequirements.length ? (
        <Card variant="filled" title="Configuração de subclasses" subtitle="Escolhas internas que definem benefícios, elementos ou modos da subclasse.">
          <SubclassChoiceEditor
            requirements={subclassChoiceRequirements}
            choices={character.buildChoices?.subclassChoices ?? []}
            onChange={(choices) => updateCharacter(id, (current) => {
              const configured = {
                ...current,
                buildChoices: {
                  ...(current.buildChoices ?? {
                    speciesChoices: [],
                    classSkillChoices: [],
                    classToolChoices: [],
                    expertiseSkills: [],
                    languages: [],
                    spellAssignments: {},
                    spellbookAssignments: {},
                    equipmentSelections: [],
                    eldritchInvocationCounts: {},
                    eldritchInvocationChoices: []
                  }),
                  subclassChoices: choices
                }
              };
              return reconcileCharacterBuild(configured, items).character;
            })}
          />
          {subclassChoiceIssues.length ? <IssueList issues={subclassChoiceIssues} /> : null}
        </Card>
      ) : null}
      <Card variant="hero" title="Adicionar do compêndio">
        <Button label="Procurar classes validadas" onPress={() => router.push(`/characters/${character.id}/compendium?type=class${pendingId ? `&pendingId=${encodeURIComponent(pendingId)}` : ''}`)} />
      </Card>
      <Button label={showManual ? 'Cancelar entrada manual' : 'Criar classe manual'} variant="text" onPress={() => setShowManual((value) => !value)} />
      {showManual ? (
        <Card variant="outlined" title="Classe personalizada">
          <Field label="Nome" value={name} onChangeText={setName} />
          <Field label="Níveis" value={level} onChangeText={(value) => setLevel(value.replace(/\D/g, ''))} keyboardType="number-pad" />
          <Button label="Adicionar" onPress={addClass} disabled={!name.trim()} />
        </Card>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  metrics: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  row: { minHeight: 76, flexDirection: 'row', alignItems: 'center', gap: 12, borderBottomWidth: StyleSheet.hairlineWidth, paddingVertical: 8 },
  flex: { flex: 1 },
  levelField: { width: 104 }
});
