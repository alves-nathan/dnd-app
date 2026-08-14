import { StyleSheet, Text, View } from 'react-native';
import type { StoredCompendiumItem } from '../compendium/types';
import { getCompendiumChoiceDescription } from '../characters/creationData';
import { spellItemLevel } from '../characters/spellcastingRules';
import { useAppTheme } from '../theme';
import { Card } from './Card';

const asRecord = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};

const asText = (value: unknown): string | undefined =>
  typeof value === 'string' && value.trim() ? value.trim() : undefined;

const componentsLabel = (payload: Record<string, unknown>): string | undefined => {
  const components = asRecord(payload.components);
  const labels = [
    components.verbal === true || payload.verbal === true ? 'V' : undefined,
    components.somatic === true || payload.somatic === true ? 'S' : undefined,
    components.material === true || payload.material === true ? 'M' : undefined
  ].filter(Boolean);
  return labels.length ? labels.join(', ') : undefined;
};


export const getSpellChoiceInlineDescription = (item: StoredCompendiumItem): string => {
  const payload = asRecord(item.normalizedJson);
  const castingTime = asText(payload.castingTime) ?? 'não informado';
  const range = asText(payload.range) ?? 'não informado';
  const duration = asText(payload.duration) ?? 'não informada';
  const components = componentsLabel(payload);
  const traits = [
    payload.concentration === true ? 'Concentração' : undefined,
    payload.ritual === true ? 'Ritual' : undefined
  ].filter(Boolean);
  return [
    getCompendiumChoiceDescription(item),
    `Conjuração: ${castingTime} · Alcance: ${range}`,
    `Duração: ${duration}${components ? ` · Componentes: ${components}` : ''}`,
    traits.length ? traits.join(' · ') : undefined
  ].filter((entry): entry is string => Boolean(entry)).join('\n');
};

export interface SpellChoiceDetailsProps {
  item: StoredCompendiumItem;
  selected?: boolean;
  selectionLabel?: string;
}

export function SpellChoiceDetails({ item, selected = false, selectionLabel }: SpellChoiceDetailsProps) {
  const { colors } = useAppTheme();
  const payload = asRecord(item.normalizedJson);
  const level = spellItemLevel(item);
  const school = asText(payload.school) ?? 'Escola não informada';
  const castingTime = asText(payload.castingTime) ?? 'Tempo de conjuração não informado';
  const range = asText(payload.range) ?? 'Alcance não informado';
  const duration = asText(payload.duration) ?? 'Duração não informada';
  const components = componentsLabel(payload);
  const concentration = payload.concentration === true ? 'Concentração' : undefined;
  const ritual = payload.ritual === true ? 'Ritual' : undefined;
  const status = selectionLabel ?? (selected ? 'Selecionada' : 'Visualizando detalhes');

  return (
    <Card
      variant={selected ? 'hero' : 'filled'}
      title={`Detalhes · ${item.name}`}
      subtitle={`${level === 0 ? 'Cantrip' : `Nível ${level}`} · ${school}`}
      accessibilityLabel={`Detalhes da magia ${item.name}. ${status}.`}
    >
      <Text style={[styles.description, { color: selected ? colors.onPrimaryContainer : colors.onSurface }]}>
        {getCompendiumChoiceDescription(item)}
      </Text>
      <View style={styles.metadata}>
        <Text style={[styles.meta, { color: selected ? colors.onPrimaryContainer : colors.onSurfaceVariant }]}>Conjuração: {castingTime}</Text>
        <Text style={[styles.meta, { color: selected ? colors.onPrimaryContainer : colors.onSurfaceVariant }]}>Alcance: {range}</Text>
        <Text style={[styles.meta, { color: selected ? colors.onPrimaryContainer : colors.onSurfaceVariant }]}>Duração: {duration}</Text>
        {components ? <Text style={[styles.meta, { color: selected ? colors.onPrimaryContainer : colors.onSurfaceVariant }]}>Componentes: {components}</Text> : null}
        {concentration || ritual ? (
          <Text style={[styles.meta, { color: selected ? colors.onPrimaryContainer : colors.onSurfaceVariant }]}>
            {[concentration, ritual].filter(Boolean).join(' · ')}
          </Text>
        ) : null}
      </View>
      <Text style={[styles.status, { color: selected ? colors.onPrimaryContainer : colors.primary }]}>{status}</Text>
    </Card>
  );
}

const styles = StyleSheet.create({
  description: { fontSize: 14, lineHeight: 20 },
  metadata: { gap: 3 },
  meta: { fontSize: 12, lineHeight: 17 },
  status: { fontSize: 12, lineHeight: 17, fontWeight: '900' }
});
