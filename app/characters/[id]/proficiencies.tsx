import { router, useLocalSearchParams } from 'expo-router';
import { useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Button } from '../../../src/components/Button';
import { Card } from '../../../src/components/Card';
import { Chip } from '../../../src/components/Chip';
import { ChoiceChipSelector } from '../../../src/components/ChoiceChipSelector';
import { Screen } from '../../../src/components/Screen';
import {
  ALL_LANGUAGE_OPTIONS,
  ALL_TOOL_OPTIONS,
  COMMON_LANGUAGE,
  mergeChoiceOptions
} from '../../../src/characters/choiceOptions';
import { SKILLS } from '../../../src/characters/proficiencies';
import { useCharacterProgressionSession } from '../../../src/characters/useCharacterProgressionSession';
import { useCharacterChoiceBridge } from '../../../src/catalog/useCharacterChoiceBridge';
import { getCharacterDisplayName } from '../../../src/ui/characterIdentity';

const getId = (value: string | string[] | undefined) => Array.isArray(value) ? value[0] : value;

const BASE_WEAPON_PROFICIENCY_OPTIONS = [
  'simple',
  'martial',
  'martial finesse or light',
  'martialLightMelee'
] as const;

const ARMOR_PROFICIENCY_OPTIONS = ['light', 'medium', 'heavy', 'shields'] as const;

export default function ProficienciesScreen() {
  const params = useLocalSearchParams();
  const id = getId(params.id);
  const pendingId = getId(params.pendingId);
  const progressionSession = useCharacterProgressionSession(id);
  const character = progressionSession.character;
  const updateCharacter = progressionSession.updateCharacter;
  const { items } = useCharacterChoiceBridge();
  const [skills, setSkills] = useState(character?.proficiencies.skills ?? []);
  const [expertiseSkills, setExpertiseSkills] = useState(character?.proficiencies.expertiseSkills ?? []);
  const [tools, setTools] = useState(character?.proficiencies.tools ?? []);
  const [weapons, setWeapons] = useState(character?.proficiencies.weapons ?? []);
  const [armor, setArmor] = useState(character?.proficiencies.armor ?? []);
  const [languages, setLanguages] = useState(character?.proficiencies.languages ?? []);
  const [savingThrows, setSavingThrows] = useState(character?.proficiencies.savingThrows ?? []);

  const weaponOptions = useMemo(
    () => mergeChoiceOptions(
      [
        ...BASE_WEAPON_PROFICIENCY_OPTIONS,
        ...items
          .filter((item) => item.type === 'weapon' && item.status !== 'disabled')
          .map((item) => item.name)
      ],
      weapons
    ),
    [items, weapons]
  );

  if (!character || !id) return <Screen title="Personagem não encontrado" onBack={() => router.back()} />;

  const returnRoute = progressionSession.hasActiveTransaction
    ? `/characters/${character.id}/progression`
    : `/characters/${character.id}`;

  const save = () => {
    updateCharacter(id, (current) => {
      const proficiencies = {
        skills,
        expertiseSkills: expertiseSkills.filter((skill) => skills.includes(skill)),
        tools,
        weapons,
        armor,
        languages,
        savingThrows
      };
      return {
        ...current,
        proficiencies,
        pendingChoices: pendingId
          ? (current.pendingChoices ?? []).filter((choice) => choice.id !== pendingId)
          : current.pendingChoices,
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
          manualProficiencies: proficiencies
        }
      };
    });
    router.replace(returnRoute as never);
  };

  return (
    <Screen
      eyebrow={getCharacterDisplayName(character)}
      title="Proficiências"
      subtitle={progressionSession.hasActiveTransaction ? 'As alterações permanecerão no rascunho até o commit da progressão.' : 'Edite perícias, salvamentos, ferramentas, armas, armaduras e idiomas.'}
      onBack={() => router.replace(returnRoute as never)}
    >
      <Card variant="hero" title="Perícias">
        <View style={styles.chips}>
          {SKILLS.map((skill) => (
            <Chip key={skill} label={skill} selected={skills.includes(skill)} onPress={() => setSkills((current) => current.includes(skill) ? current.filter((entry) => entry !== skill) : [...current, skill])} />
          ))}
        </View>
      </Card>
      <Card variant="outlined" title="Expertise" subtitle="Escolha apenas entre perícias em que o personagem já é proficiente.">
        <View style={styles.chips}>
          {skills.map((skill) => (
            <Chip key={skill} label={skill} selected={expertiseSkills.includes(skill)} onPress={() => setExpertiseSkills((current) => current.includes(skill) ? current.filter((entry) => entry !== skill) : [...current, skill])} />
          ))}
        </View>
      </Card>
      <Card variant="filled" title="Testes de resistência">
        <View style={styles.chips}>
          {(['STR', 'DEX', 'CON', 'INT', 'WIS', 'CHA'] as const).map((ability) => (
            <Chip key={ability} label={ability} selected={savingThrows.includes(ability)} onPress={() => setSavingThrows((current) => current.includes(ability) ? current.filter((entry) => entry !== ability) : [...current, ability])} />
          ))}
        </View>
      </Card>
      <ChoiceChipSelector
        title="Ferramentas"
        options={ALL_TOOL_OPTIONS}
        selectedValues={tools}
        onChange={setTools}
        testIDPrefix="manual-tool"
      />
      <ChoiceChipSelector
        title="Armas"
        options={weaponOptions}
        selectedValues={weapons}
        onChange={setWeapons}
        pageSize={28}
        testIDPrefix="manual-weapon"
      />
      <ChoiceChipSelector
        title="Armaduras"
        options={ARMOR_PROFICIENCY_OPTIONS}
        selectedValues={armor}
        onChange={setArmor}
        testIDPrefix="manual-armor"
      />
      <ChoiceChipSelector
        title="Idiomas"
        options={[COMMON_LANGUAGE, ...ALL_LANGUAGE_OPTIONS]}
        selectedValues={languages}
        onChange={setLanguages}
        testIDPrefix="manual-language"
      />
      <Button label={progressionSession.hasActiveTransaction ? 'Salvar no rascunho' : 'Salvar proficiências'} onPress={save} />
    </Screen>
  );
}

const styles = StyleSheet.create({ chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 } });
