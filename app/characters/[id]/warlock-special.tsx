import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { Alert, StyleSheet, Text, View } from 'react-native';
import { Button } from '../../../src/components/Button';
import { Card } from '../../../src/components/Card';
import { Chip } from '../../../src/components/Chip';
import { Field } from '../../../src/components/Field';
import { MetricTile } from '../../../src/components/MetricTile';
import { PendingChoiceContextCard } from '../../../src/components/PendingChoiceContextCard';
import { Screen } from '../../../src/components/Screen';
import { findEldritchInvocationById } from '../../../src/characters/eldritchInvocationRules';
import {
  activateOneWithShadows,
  endGazeOfTwoMinds,
  endOneWithShadows,
  gazeCastingOriginIssues,
  getEffectiveCharacterSenses,
  inscribeGiftOfProtectorsName,
  maintainGazeOfTwoMinds,
  startGazeOfTwoMinds,
  triggerGiftOfProtectors,
  eraseGiftOfProtectorsName
} from '../../../src/characters/warlockSpecializedInvocations';
import { useCharacterProgressionSession } from '../../../src/characters/useCharacterProgressionSession';
import { useCharacterChoiceBridge } from '../../../src/catalog/useCharacterChoiceBridge';
import { useAppTheme } from '../../../src/theme';
import { getCharacterDisplayName } from '../../../src/ui/characterIdentity';
import type {
  GazeCastingOrigin,
  OneWithShadowsLightLevel
} from '../../../src/types';

const getId = (value: string | string[] | undefined) => Array.isArray(value) ? value[0] : value;
const normalize = (value: string): string => value
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .trim()
  .toLowerCase();

export default function WarlockSpecialScreen() {
  const { colors } = useAppTheme();
  const params = useLocalSearchParams();
  const id = getId(params.id);
  const pendingId = getId(params.pendingId);
  const progressionSession = useCharacterProgressionSession(id);
  const character = progressionSession.character;
  const updateCharacter = progressionSession.updateCharacter;
  const bridge = useCharacterChoiceBridge();
  const { items } = bridge;
  const pendingChoice = character?.pendingChoices?.find((choice) => choice.id === pendingId);
  const pendingResolution = character && pendingChoice ? bridge.resolvePendingChoice(character, pendingChoice) : undefined;

  const [targetName, setTargetName] = useState('');
  const [targetCompanionId, setTargetCompanionId] = useState<string>();
  const [targetSenses, setTargetSenses] = useState('');
  const [distanceFeet, setDistanceFeet] = useState('0');
  const [samePlane, setSamePlane] = useState(true);
  const [spellOrigin, setSpellOrigin] = useState<GazeCastingOrigin>('self');
  const [gazeNotes, setGazeNotes] = useState('');
  const [giftName, setGiftName] = useState('');
  const [lightLevel, setLightLevel] = useState<OneWithShadowsLightLevel>('dim');


  useEffect(() => {
    const gaze = character?.buildChoices?.gazeOfTwoMinds;
    setTargetName(gaze?.targetName ?? '');
    setTargetCompanionId(gaze?.targetCompanionId);
    setTargetSenses(gaze?.targetSenses ?? '');
    setDistanceFeet(String(gaze?.distanceFeet ?? 0));
    setSamePlane(gaze?.samePlane ?? true);
    setSpellOrigin(gaze?.spellOrigin ?? 'self');
    setGazeNotes(gaze?.notes ?? '');
    setLightLevel(character?.buildChoices?.oneWithShadows?.lightLevel ?? 'dim');
  }, [character?.id]);

  const selectedInvocations = useMemo(() => {
    if (!character) return [];
    return Object.entries(character.buildChoices?.eldritchInvocationCounts ?? {})
      .filter(([, count]) => count > 0)
      .map(([itemId]) => findEldritchInvocationById(items, itemId))
      .filter((item): item is NonNullable<typeof item> => Boolean(item));
  }, [character, items]);

  if (!character || !id) return <Screen title="Personagem não encontrado" onBack={() => router.back()} />;

  const invocation = (key: string, name: string) => selectedInvocations.find((item) => {
    const engineKey = typeof item.normalizedJson.engineKey === 'string' ? item.normalizedJson.engineKey : '';
    return normalize(engineKey) === normalize(key) || normalize(item.name) === normalize(name);
  });

  const gazeInvocation = invocation('warlock.gaze-of-two-minds', 'Gaze of Two Minds');
  const giftInvocation = invocation('warlock.gift-of-the-protectors', 'Gift of the Protectors');
  const devilsSight = invocation('warlock.devils-sight', "Devil's Sight");
  const witchSight = invocation('warlock.witch-sight', 'Witch Sight');
  const oneWithShadows = invocation('warlock.one-with-shadows', 'One with Shadows');
  const gaze = character.buildChoices?.gazeOfTwoMinds;
  const gift = character.buildChoices?.giftOfProtectors;
  const giftResource = gift ? character.resources.find((resource) => resource.id === gift.resourceId) : undefined;
  const shadowState = character.buildChoices?.oneWithShadows;
  const shadowActive = Boolean(
    shadowState?.activeEffectId
    && character.activeEffects.some((effect) => effect.id === shadowState.activeEffectId && effect.status === 'active')
  );
  const senses = getEffectiveCharacterSenses(character);
  const castingIssues = gazeCastingOriginIssues(character, spellOrigin);

  const saveGaze = () => {
    if (!gazeInvocation) return;
    if (!targetName.trim()) {
      Alert.alert('Criatura necessária', 'Informe a criatura voluntária conectada por Gaze of Two Minds.');
      return;
    }
    updateCharacter(character.id, (current) => startGazeOfTwoMinds(current, {
      invocationItemId: gazeInvocation.id,
      targetName,
      targetCompanionId,
      targetSenses,
      distanceFeet: Math.max(0, Number(distanceFeet) || 0),
      samePlane,
      spellOrigin,
      notes: gazeNotes
    }));
  };

  const selectCompanionAsGazeTarget = (companionId: string) => {
    const companion = (character.companions ?? []).find((entry) => entry.id === companionId);
    if (!companion) return;
    setTargetName(companion.name);
    setTargetCompanionId(companion.id);
    setTargetSenses(companion.senses ?? '');
  };

  const activateShadows = () => {
    if (!oneWithShadows) return;
    const result = activateOneWithShadows(character, oneWithShadows.id, lightLevel);
    if (result.issues.length) {
      Alert.alert('One with Shadows indisponível', result.issues.map((entry) => entry.message).join('\n'));
      return;
    }
    updateCharacter(character.id, () => result.character);
  };

  return (
    <Screen
      eyebrow={getCharacterDisplayName(character)}
      title="Poderes especializados de Warlock"
      subtitle="Gerencie sentidos, vínculos, Book of Shadows e estados ativáveis concedidos por Eldritch Invocations."
      onBack={() => progressionSession.hasActiveTransaction ? router.replace(`/characters/${character.id}/progression`) : router.back()}
    >
      <PendingChoiceContextCard pendingChoice={pendingChoice} resolution={pendingResolution} />
      {pendingChoice ? (
        <Button
          label="Marcar configuração como concluída"
          variant="outlined"
          onPress={() => {
            progressionSession.completePendingChoice(pendingChoice.id, `Configuração concluída: ${pendingChoice.title}`);
            if (progressionSession.hasActiveTransaction) router.replace(`/characters/${character.id}/progression`);
          }}
        />
      ) : null}
      <View style={styles.metrics}>
        <MetricTile label="Sentidos" value={senses.length} />
        <MetricTile label="Gaze" value={gaze?.active ? 'Ativo' : 'Inativo'} />
        <MetricTile label="Protectors" value={giftResource ? `${giftResource.current}/${giftResource.max}` : '—'} />
        <MetricTile label="Shadows" value={shadowActive ? 'Ativo' : 'Inativo'} />
      </View>

      <Card
        variant="filled"
        title="Sentidos especiais"
        subtitle="Devil's Sight, Witch Sight e sentidos emprestados pelo vínculo são consolidados sem duplicação."
      >
        {senses.map((sense) => (
          <View key={sense.id} style={[styles.entry, { borderBottomColor: colors.outlineVariant }]}>
            <Text style={[styles.title, { color: colors.onSurface }]}>{sense.name}</Text>
            <Text style={{ color: colors.onSurfaceVariant }}>
              {[
                sense.kind,
                sense.rangeFeet ? `${sense.rangeFeet} ft` : undefined,
                sense.magicalDarkness ? 'escuridão mágica' : undefined,
                sense.notes
              ].filter(Boolean).join(' · ')}
            </Text>
          </View>
        ))}
        {!senses.length ? <Text style={{ color: colors.onSurfaceVariant }}>Nenhum sentido especial ativo.</Text> : null}
        {devilsSight ? <Text style={{ color: colors.onSurfaceVariant }}>• Devil's Sight permite visão normal em escuridão mágica e não mágica até 120 ft.</Text> : null}
        {witchSight ? <Text style={{ color: colors.onSurfaceVariant }}>• Witch Sight concede Truesight de 30 ft.</Text> : null}
      </Card>

      {gazeInvocation ? (
        <Card
          variant={gaze?.active ? 'hero' : 'outlined'}
          title="Gaze of Two Minds"
          subtitle="Use uma ação bônus para criar ou manter o vínculo. Os sentidos da criatura são emprestados; magias podem partir do espaço dela quando estiver a até 60 ft."
        >
          {(character.companions ?? []).length ? (
            <>
              <Text style={[styles.label, { color: colors.onSurfaceVariant }]}>Usar companion como alvo</Text>
              <View style={styles.chips}>
                {(character.companions ?? []).map((companion) => (
                  <Chip
                    key={companion.id}
                    label={companion.name}
                    selected={targetCompanionId === companion.id}
                    onPress={() => selectCompanionAsGazeTarget(companion.id)}
                  />
                ))}
              </View>
            </>
          ) : null}
          <Field label="Criatura voluntária" value={targetName} onChangeText={(value) => { setTargetName(value); setTargetCompanionId(undefined); }} placeholder="Nome ou identificação" />
          <Field label="Sentidos especiais da criatura" value={targetSenses} onChangeText={setTargetSenses} placeholder="Ex.: Darkvision 60 ft, Tremorsense 30 ft" />
          <Field label="Distância atual (ft)" value={distanceFeet} onChangeText={setDistanceFeet} keyboardType="number-pad" />
          <Text style={[styles.label, { color: colors.onSurfaceVariant }]}>Mesmo plano de existência</Text>
          <View style={styles.chips}>
            <Chip label="Sim" selected={samePlane} onPress={() => setSamePlane(true)} />
            <Chip label="Não" selected={!samePlane} onPress={() => setSamePlane(false)} />
          </View>
          <Text style={[styles.label, { color: colors.onSurfaceVariant }]}>Origem padrão das magias elegíveis</Text>
          <View style={styles.chips}>
            <Chip label="Espaço do Warlock" selected={spellOrigin === 'self'} onPress={() => setSpellOrigin('self')} />
            <Chip label="Espaço da criatura" selected={spellOrigin === 'gazeTarget'} onPress={() => setSpellOrigin('gazeTarget')} />
          </View>
          {castingIssues.map((entry) => <Text key={entry.code} style={{ color: colors.error }}>• {entry.message}</Text>)}
          <Field label="Notas do vínculo" value={gazeNotes} onChangeText={setGazeNotes} multiline />
          <View style={styles.row}>
            <View style={styles.flex}><Button label={gaze?.active ? 'Atualizar vínculo' : 'Iniciar vínculo'} onPress={saveGaze} /></View>
            <View style={styles.flex}><Button label="Manter por ação bônus" variant="outlined" disabled={!gaze?.active} onPress={() => updateCharacter(character.id, maintainGazeOfTwoMinds)} /></View>
          </View>
          <Button label="Encerrar vínculo" variant="text" disabled={!gaze?.active} onPress={() => updateCharacter(character.id, endGazeOfTwoMinds)} />
          {gaze?.active ? (
            <Text style={{ color: colors.onSurfaceVariant }}>
              Ativo com {gaze.targetName} · {gaze.distanceFeet} ft · {gaze.samePlane ? 'mesmo plano' : 'plano diferente'} · janela restante {gaze.remainingTurnWindows}.
            </Text>
          ) : null}
        </Card>
      ) : null}

      {giftInvocation && gift ? (
        <Card
          variant="outlined"
          title="Gift of the Protectors"
          subtitle={`Book of Shadows: ${gift.names.length}/${gift.maxNames} nome(s). A proteção é compartilhada e recarrega em descanso longo.`}
        >
          <Field label="Novo nome" value={giftName} onChangeText={setGiftName} placeholder="Criatura que escreveu o nome" />
          <Button
            label="Inscrever nome"
            disabled={!giftName.trim() || gift.names.length >= gift.maxNames}
            onPress={() => {
              updateCharacter(character.id, (current) => inscribeGiftOfProtectorsName(current, giftName));
              setGiftName('');
            }}
          />
          {gift.names.map((name) => (
            <View key={name} style={[styles.giftRow, { borderBottomColor: colors.outlineVariant }]}>
              <View style={styles.flex}>
                <Text style={[styles.title, { color: colors.onSurface }]}>{name}</Text>
                <Text style={{ color: colors.onSurfaceVariant }}>
                  {gift.lastTriggeredName === name ? `Último disparo: ${gift.lastTriggeredAt ?? 'registrado'}` : 'Nome inscrito'}
                </Text>
              </View>
              <Button
                label="Ativar"
                compact
                disabled={(giftResource?.current ?? 0) < 1}
                onPress={() => updateCharacter(character.id, (current) => triggerGiftOfProtectors(current, name))}
              />
              <Button label="Apagar" compact variant="text" onPress={() => updateCharacter(character.id, (current) => eraseGiftOfProtectorsName(current, name))} />
            </View>
          ))}
          {!gift.names.length ? <Text style={{ color: colors.onSurfaceVariant }}>Nenhum nome inscrito.</Text> : null}
          <Text style={{ color: colors.onSurfaceVariant }}>
            Proteção disponível: {giftResource?.current ?? 0}/{giftResource?.max ?? 1}. Ao disparar, a criatura fica com 1 PV em vez de 0, se não morrer instantaneamente.
          </Text>
          {(character.protectionTransactions ?? []).slice(-8).reverse().map((transaction) => (
            <Text key={transaction.id} style={{ color: colors.onSurfaceVariant }}>
              • {transaction.action} · {transaction.name} · {new Date(transaction.createdAt).toLocaleString()}
            </Text>
          ))}
        </Card>
      ) : null}

      {oneWithShadows ? (
        <Card
          variant={shadowActive ? 'hero' : 'outlined'}
          title="One with Shadows"
          subtitle="Conjura Invisibility em si mesmo sem slot em luz fraca ou escuridão. O efeito termina ao atacar ou conjurar uma magia."
        >
          <Text style={[styles.label, { color: colors.onSurfaceVariant }]}>Iluminação atual</Text>
          <View style={styles.chips}>
            <Chip label="Luz plena" selected={lightLevel === 'bright'} onPress={() => setLightLevel('bright')} />
            <Chip label="Luz fraca" selected={lightLevel === 'dim'} onPress={() => setLightLevel('dim')} />
            <Chip label="Escuridão" selected={lightLevel === 'darkness'} onPress={() => setLightLevel('darkness')} />
          </View>
          <View style={styles.row}>
            <View style={styles.flex}><Button label={shadowActive ? 'Reiniciar invisibilidade' : 'Ativar invisibilidade'} onPress={activateShadows} /></View>
            <View style={styles.flex}><Button label="Encerrar" variant="outlined" disabled={!shadowActive} onPress={() => updateCharacter(character.id, endOneWithShadows)} /></View>
          </View>
          <Text style={{ color: colors.onSurfaceVariant }}>Estado: {shadowActive ? 'invisível' : 'inativo'}.</Text>
        </Card>
      ) : null}

      {!gazeInvocation && !giftInvocation && !devilsSight && !witchSight && !oneWithShadows ? (
        <Card
          variant="filled"
          title="Nenhuma invocation especializada selecionada"
          subtitle="Escolha Gaze of Two Minds, Gift of the Protectors, Devil's Sight, Witch Sight ou One with Shadows para liberar esta central."
        >
          <Button label="Abrir Eldritch Invocations" onPress={() => router.push(`/characters/${character.id}/invocations`)} />
        </Card>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  metrics: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  entry: { gap: 3, paddingVertical: 10, borderBottomWidth: 1 },
  title: { fontSize: 14, lineHeight: 20, fontWeight: '800' },
  label: { fontSize: 13, lineHeight: 18, fontWeight: '700' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  flex: { flex: 1, minWidth: 140 },
  giftRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8, paddingVertical: 10, borderBottomWidth: 1 }
});
