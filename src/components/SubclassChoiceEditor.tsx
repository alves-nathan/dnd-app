import { StyleSheet, Text, View } from 'react-native';
import type { CharacterSubclassChoice } from '../types';
import type { SubclassChoiceRequirement } from '../characters/subclassChoiceRules';
import {
  setSubclassChoiceOption,
  subclassChoiceForRequirement
} from '../characters/subclassChoiceRules';
import { Card } from './Card';
import { Chip } from './Chip';
import { useAppTheme } from '../theme';

interface SubclassChoiceEditorProps {
  requirements: SubclassChoiceRequirement[];
  choices: CharacterSubclassChoice[];
  onChange: (choices: CharacterSubclassChoice[]) => void;
  allowResolvedOverride?: boolean;
}

export const SubclassChoiceEditor = ({
  requirements,
  choices,
  onChange,
  allowResolvedOverride = false
}: SubclassChoiceEditorProps) => {
  const { colors } = useAppTheme();
  if (!requirements.length) return null;

  return (
    <View style={styles.stack}>
      {requirements.map((requirement) => {
        const selected = subclassChoiceForRequirement(choices, requirement);
        const locked = Boolean(selected && !requirement.mutable && !allowResolvedOverride);
        return (
          <Card
            key={`${requirement.subclassItemId}:${requirement.choiceId}`}
            variant="outlined"
            title={requirement.title}
            subtitle={requirement.description}
          >
            <View style={styles.chips}>
              {requirement.options.map((option) => (
                <Chip
                  key={option.id}
                  label={option.label}
                  selected={selected?.optionId === option.id}
                  disabled={locked && selected?.optionId !== option.id}
                  onPress={() => {
                    if (locked) return;
                    onChange(setSubclassChoiceOption(choices, requirement, option.id));
                  }}
                />
              ))}
            </View>
            {selected ? (
              <Text style={[styles.summary, { color: colors.onSurfaceVariant }]}>
                {requirement.options.find((option) => option.id === selected.optionId)?.summary ?? 'Opção selecionada.'}
              </Text>
            ) : (
              <Text style={[styles.required, { color: colors.error }]}>Escolha obrigatória pendente.</Text>
            )}
            {requirement.changeTiming ? <Text style={[styles.summary, { color: colors.onSurfaceVariant }]}>{requirement.changeTiming}</Text> : null}
            {locked ? <Text style={[styles.summary, { color: colors.onSurfaceVariant }]}>Escolha definida quando a subclasse foi configurada.</Text> : null}
          </Card>
        );
      })}
    </View>
  );
};

const styles = StyleSheet.create({
  stack: { gap: 10 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  summary: { marginTop: 8, lineHeight: 19 },
  required: { marginTop: 8, fontWeight: '800' }
});
