import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { Alert, StyleSheet, Text, View } from 'react-native';
import { Button } from '../../../src/components/Button';
import { Card } from '../../../src/components/Card';
import { Chip } from '../../../src/components/Chip';
import { IssueList } from '../../../src/components/IssueList';
import { PaginatedOptionCardList } from '../../../src/components/PaginatedOptionCardList';
import { PendingChoiceContextCard } from '../../../src/components/PendingChoiceContextCard';
import { Screen } from '../../../src/components/Screen';
import {
  getPactWeaponCandidates,
  hasPactOfTheBlade,
  PACT_WEAPON_DAMAGE_TYPES,
  setPactWeapon,
  validatePactWeaponChoice
} from '../../../src/characters/pactWeaponRules';
import { useCharacterProgressionSession } from '../../../src/characters/useCharacterProgressionSession';
import { useCharacterChoiceBridge } from '../../../src/catalog/useCharacterChoiceBridge';
import { useAppTheme } from '../../../src/theme';
import type { PactWeaponDamageType } from '../../../src/types';
import { getCharacterDisplayName } from '../../../src/ui/characterIdentity';

const getId = (value: string | string[] | undefined) => Array.isArray(value) ? value[0] : value;
const damageLabels: Record<PactWeaponDamageType, string> = {
  normal: 'Original da arma',
  necrotic: 'Necrótico',
  psychic: 'Psíquico',
  radiant: 'Radiante'
};

export default function PactWeaponScreen() {
  const { colors } = useAppTheme();
  const params = useLocalSearchParams();
  const id = getId(params.id);
  const pendingId = getId(params.pendingId);
  const progressionSession = useCharacterProgressionSession(id);
  const character = progressionSession.character;
  const updateCharacter = progressionSession.updateCharacter;
  const bridge = useCharacterChoiceBridge();
  const { items, enabledSourceIds } = bridge;
  const pendingChoice = character?.pendingChoices?.find((choice) => choice.id === pendingId);
  const pendingResolution = character && pendingChoice ? bridge.resolvePendingChoice(character, pendingChoice) : undefined;
  const pendingCandidateIds = useMemo(() => new Set(pendingResolution?.candidateChoices.map((choice) => choice.choiceId) ?? []), [pendingResolution]);
  const [candidateId, setCandidateId] = useState<string>();
  const [damageType, setDamageType] = useState<PactWeaponDamageType>('normal');


  useEffect(() => {
    const choice = character?.buildChoices?.pactWeapon;
    if (!choice) return;
    setCandidateId(choice.mode === 'bound'
      ? `bound:${choice.weaponEntityId}`
      : `conjured:${choice.sourceWeaponItemId}`);
    setDamageType(choice.damageType);
  }, [character?.id]);

  const candidates = useMemo(
    () => character ? getPactWeaponCandidates(character, items, enabledSourceIds) : [],
    [character, enabledSourceIds, items]
  );

  if (!character || !id) return <Screen title="Personagem não encontrado" onBack={() => router.back()} />;

  const selected = candidates.find((candidate) => candidate.id === candidateId);
  const currentIssues = validatePactWeaponChoice(character, items);
  const pactAvailable = hasPactOfTheBlade(character, items);
  const boundCandidates = candidates.filter((candidate) => candidate.mode === 'bound');
  const conjuredCandidates = candidates.filter((candidate) =>
    candidate.mode === 'conjured'
    && (!pendingResolution || (candidate.item ? pendingCandidateIds.has(candidate.item.id) : false))
  );

  const save = () => {
    if (!selected) {
      Alert.alert('Escolha uma arma', 'Selecione uma arma existente ou uma arma corpo a corpo do compêndio.');
      return;
    }
    const result = setPactWeapon(character, {
      mode: selected.mode,
      weaponEntityId: selected.weapon?.id,
      sourceWeaponItemId: selected.item?.id,
      damageType
    }, items);
    if (result.issues.length) {
      Alert.alert('Não foi possível invocar', result.issues.map((entry) => entry.message).join('\n'));
      return;
    }
    const next = pendingId
      ? { ...result.character, pendingChoices: (result.character.pendingChoices ?? []).filter((choice) => choice.id !== pendingId) }
      : result.character;
    updateCharacter(character.id, () => next);
    Alert.alert('Arma de pacto invocada', `${selected.name} agora usa Carisma para ataque e dano.`, [
      { text: progressionSession.hasActiveTransaction ? 'Voltar à transação' : 'Ver cálculos', onPress: () => router.replace(progressionSession.hasActiveTransaction ? `/characters/${character.id}/progression` : `/characters/${character.id}/combat`) }
    ]);
  };

  return (
    <Screen
      eyebrow={getCharacterDisplayName(character)}
      title="Pact Weapon"
      subtitle="Vincule uma arma da ficha ou conjure uma arma corpo a corpo. O cálculo usa Carisma e os bônus mágicos da arma."
      onBack={() => progressionSession.hasActiveTransaction ? router.replace(`/characters/${character.id}/progression`) : router.back()}
      footer={(
        <View style={styles.footer}>
          <Button label="Voltar" variant="text" icon="arrow-back" onPress={() => progressionSession.hasActiveTransaction ? router.replace(`/characters/${character.id}/progression`) : router.back()} />
          <Button label="Invocar arma" icon="flash" disabled={!pactAvailable || !selected} onPress={save} />
        </View>
      )}
    >
      <PendingChoiceContextCard pendingChoice={pendingChoice} resolution={pendingResolution} />
      {!pactAvailable ? (
        <Card variant="filled" title="Pact of the Blade necessário" subtitle="Escolha essa Eldritch Invocation antes de invocar uma Pact Weapon." />
      ) : null}

      {character.buildChoices?.pactWeapon ? (
        <Card
          variant="hero"
          title={character.weapons.find((weapon) => weapon.id === character.buildChoices?.pactWeapon?.weaponEntityId)?.name ?? 'Arma de pacto pendente'}
          subtitle={`${character.buildChoices.pactWeapon.mode === 'bound' ? 'Arma vinculada' : 'Arma conjurada'} · ${damageLabels[character.buildChoices.pactWeapon.damageType]} · usa CHA`}
        />
      ) : null}

      <Card variant="outlined" title="Tipo de dano" subtitle="Escolha o tipo usado pela arma de pacto. “Original” mantém o dano normal da arma.">
        <View style={styles.chips}>
          {PACT_WEAPON_DAMAGE_TYPES.map((value) => (
            <Chip key={value} label={damageLabels[value]} selected={damageType === value} onPress={() => setDamageType(value)} />
          ))}
        </View>
      </Card>

      <Text style={[styles.sectionTitle, { color: colors.onSurface }]}>Vincular arma existente</Text>
      <PaginatedOptionCardList
        items={boundCandidates}
        keyExtractor={(candidate) => candidate.id}
        titleForItem={(candidate) => candidate.name}
        descriptionForItem={(candidate) => candidate.description}
        metaForItem={(candidate) => candidate.weapon?.magicBonus ? `Bônus mágico +${candidate.weapon.magicBonus}` : 'Sem bônus mágico'}
        isSelected={(candidate) => candidate.id === candidateId}
        onPressItem={(candidate) => setCandidateId(candidate.id)}
        pageSize={8}
        resetKey={`bound:${candidateId ?? 'none'}`}
        emptyText="Nenhuma arma existente na ficha."
      />

      <Text style={[styles.sectionTitle, { color: colors.onSurface }]}>Conjurar arma do compêndio</Text>
      <PaginatedOptionCardList
        items={conjuredCandidates}
        keyExtractor={(candidate) => candidate.id}
        titleForItem={(candidate) => candidate.name}
        descriptionForItem={(candidate) => candidate.description}
        metaForItem={(candidate) => {
          const payload = candidate.item?.normalizedJson ?? {};
          const mastery = typeof payload.mastery === 'string' ? payload.mastery : undefined;
          return mastery ? `Arma corpo a corpo · Mastery: ${mastery}` : 'Arma corpo a corpo';
        }}
        isSelected={(candidate) => candidate.id === candidateId}
        onPressItem={(candidate) => setCandidateId(candidate.id)}
        pageSize={10}
        resetKey={`conjured:${candidateId ?? 'none'}`}
        emptyText="Nenhuma arma corpo a corpo disponível nas fontes ativas."
      />

      {currentIssues.length ? <IssueList issues={currentIssues} /> : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  footer: { width: '100%', maxWidth: 760, alignSelf: 'center', flexDirection: 'row', justifyContent: 'space-between', gap: 10 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  sectionTitle: { fontSize: 15, lineHeight: 21, fontWeight: '900' }
});
