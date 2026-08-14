import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Button } from '../../../src/components/Button';
import { Card } from '../../../src/components/Card';
import { Chip } from '../../../src/components/Chip';
import { Field } from '../../../src/components/Field';
import { Screen } from '../../../src/components/Screen';
import { StatRow } from '../../../src/components/StatRow';
import { useCharacterStore } from '../../../src/store/characterStore';
import { useAppTheme } from '../../../src/theme';
import { getCharacterDisplayName } from '../../../src/ui/characterIdentity';
import {
  adjustCompanionResource,
  buildPactChainCompanionAttackActions,
  setCompanionCondition,
  setCompanionHitPoints
} from '../../../src/characters/pactChainCompanionRules';
import { analyzeActionDamage } from '../../../src/rules-engine/damage/calculateDamage';
import { defaultCombatState } from '../../../src/data/mockData';

const getId = (value: string | string[] | undefined) => Array.isArray(value) ? value[0] : value;
const commonConditions = ['blinded', 'charmed', 'frightened', 'grappled', 'incapacitated', 'invisible', 'paralyzed', 'poisoned', 'prone', 'restrained', 'stunned'];

export default function FamiliarScreen() {
  const { colors } = useAppTheme();
  const id = getId(useLocalSearchParams().id);
  const character = useCharacterStore((state) => state.characters.find((entry) => entry.id === id));
  const updateCharacter = useCharacterStore((state) => state.updateCharacter);
  const familiar = character?.companions?.[0];
  const [name, setName] = useState(familiar?.name ?? '');
  const [currentHp, setCurrentHp] = useState(String(familiar?.hitPoints.current ?? 0));
  const [notes, setNotes] = useState(familiar?.notes ?? '');

  useEffect(() => {
    setName(familiar?.name ?? '');
    setCurrentHp(String(familiar?.hitPoints.current ?? 0));
    setNotes(familiar?.notes ?? '');
  }, [familiar?.id, familiar?.updatedAt]);

  if (!character || !id) return <Screen title="Personagem não encontrado" onBack={() => router.back()} />;

  const combatActions = familiar ? buildPactChainCompanionAttackActions(familiar) : [];
  const activeConditionIds = new Set(
    (familiar?.activeEffects ?? []).flatMap((effect) => effect.status === 'active' ? effect.conditionIds ?? [] : [])
  );

  const save = () => {
    if (!familiar) return;
    updateCharacter(character.id, (current) => {
      const withIdentity = {
        ...current,
        companions: (current.companions ?? []).map((entry) => entry.id === familiar.id ? {
          ...entry,
          name: name.trim() || entry.name,
          customName: Boolean(name.trim() && name.trim() !== entry.name),
          notes: notes.trim() || undefined,
          updatedAt: new Date().toISOString()
        } : entry)
      };
      return setCompanionHitPoints(withIdentity, familiar.id, Number(currentHp) || 0, 'PV salvo na ficha do familiar');
    });
    router.back();
  };

  const adjustHp = (delta: number) => {
    if (!familiar) return;
    updateCharacter(character.id, (current) => setCompanionHitPoints(
      current,
      familiar.id,
      familiar.hitPoints.current + delta,
      delta < 0 ? 'Dano manual' : 'Cura manual'
    ));
  };

  return (
    <Screen
      eyebrow={getCharacterDisplayName(character)}
      title="Pact Familiar"
      subtitle="O familiar tem iniciativa própria, recursos, condições e ações integradas às rotações do Warlock."
      onBack={() => router.back()}
      footer={<Button label="Salvar familiar" icon="checkmark" disabled={!familiar} onPress={save} />}
    >
      {!familiar ? (
        <Card variant="filled" title="Nenhum familiar configurado" subtitle="Escolha Pact of the Chain e uma forma de familiar na tela de Eldritch Invocations.">
          <Button label="Abrir Eldritch Invocations" onPress={() => router.push(`/characters/${character.id}/invocations`)} />
        </Card>
      ) : (
        <>
          <Card variant="hero" title={familiar.name} subtitle={`${familiar.size ?? 'Tamanho não informado'} · ${familiar.creatureType ?? 'Tipo não informado'} · forma ${familiar.variant === 'special' ? 'especial' : 'comum'}`}>
            <StatRow label="CA" value={familiar.armorClass} />
            <StatRow label="PV" value={`${familiar.hitPoints.current} / ${familiar.hitPoints.max}`} />
            <StatRow label="Iniciativa" value="Própria" />
            <StatRow label="Comando para atacar" value={familiar.command === 'bonusAction' ? 'Ação bônus do Warlock' : 'Abrir mão de um ataque'} />
            <StatRow label="Deslocamentos" value={Object.entries(familiar.speed).map(([kind, value]) => `${kind} ${value} ft`).join(' · ') || 'Não informado'} />
            <StatRow label="Sentidos" value={familiar.senses ?? 'Não informado'} />
            <StatRow label="Idiomas" value={familiar.languages ?? 'Não informado'} />
            {familiar.investment?.warlockSpellSaveDC ? <StatRow label="CD dos efeitos" value={familiar.investment.warlockSpellSaveDC} /> : null}
          </Card>

          <Card title="Estado atual">
            <Field label="Nome do familiar" value={name} onChangeText={setName} placeholder={familiar.name} />
            <Field label={`PV atual (máximo ${familiar.hitPoints.max})`} value={currentHp} onChangeText={setCurrentHp} keyboardType="number-pad" />
            <View style={styles.row}>
              <View style={styles.flex}><Button label="−1 PV" variant="outlined" onPress={() => adjustHp(-1)} /></View>
              <View style={styles.flex}><Button label="+1 PV" variant="outlined" onPress={() => adjustHp(1)} /></View>
            </View>
            <Field label="Notas" value={notes} onChangeText={setNotes} multiline />
          </Card>

          {familiar.investment?.active ? (
            <Card variant="filled" title="Investment of the Chain Master" subtitle="Melhorias aplicadas ao familiar.">
              <Text style={{ color: colors.onSurface }}>• Comando de ataque por ação bônus.</Text>
              <Text style={{ color: colors.onSurface }}>• {familiar.investment.movementMode === 'fly' ? 'Voo' : 'Natação'} de pelo menos {familiar.investment.movementSpeed ?? 40} ft.</Text>
              <Text style={{ color: colors.onSurface }}>• Salvaguardas usam CD {familiar.investment.warlockSpellSaveDC ?? 'do Warlock'}.</Text>
              <Text style={{ color: colors.onSurface }}>• Dano físico pode ser convertido para {familiar.investment.damageType ?? 'Necrótico ou Radiante'}.</Text>
              <Text style={{ color: colors.onSurface }}>• Reação defensiva concede Resistência ao dano recebido.</Text>
            </Card>
          ) : null}

          <Card title={`Recursos (${familiar.resources.length})`} subtitle="Usos limitados do stat block são consumidos pelas ações da rotação e recuperados no descanso correspondente.">
            {familiar.resources.map((resource) => (
              <View key={resource.id} style={[styles.resourceRow, { borderBottomColor: colors.outlineVariant }]}>
                <View style={styles.flex}>
                  <Text style={[styles.title, { color: colors.onSurface }]}>{resource.name}</Text>
                  <Text style={{ color: colors.onSurfaceVariant }}>{resource.current}/{resource.max} · recarga {resource.recharge === 'longRest' ? 'descanso longo' : 'manual'}</Text>
                </View>
                <Button
                  label="Gastar"
                  compact
                  variant="outlined"
                  disabled={resource.current <= 0}
                  onPress={() => updateCharacter(character.id, (current) => adjustCompanionResource(current, familiar.id, resource.id, -1))}
                />
                <Button
                  label="Recuperar"
                  compact
                  variant="text"
                  disabled={resource.current >= resource.max}
                  onPress={() => updateCharacter(character.id, (current) => adjustCompanionResource(current, familiar.id, resource.id, 1))}
                />
              </View>
            ))}
            {!familiar.resources.length ? <Text style={{ color: colors.onSurfaceVariant }}>Nenhum uso limitado estruturado.</Text> : null}
          </Card>

          <Card title="Condições do familiar" subtitle="Condições persistem separadamente dos efeitos do Warlock.">
            <View style={styles.chips}>
              {commonConditions.map((conditionId) => (
                <Chip
                  key={conditionId}
                  label={conditionId}
                  selected={activeConditionIds.has(conditionId)}
                  onPress={() => updateCharacter(character.id, (current) => setCompanionCondition(current, familiar.id, conditionId, !activeConditionIds.has(conditionId)))}
                />
              ))}
            </View>
          </Card>

          <Card title={`Ações (${familiar.actions.length})`} subtitle="Resolvidas a partir do creature stat block. Ataques podem ser incluídos diretamente nas rotações do personagem.">
            {familiar.actions.map((action) => (
              <View key={action.id} style={[styles.entry, { borderBottomColor: colors.outlineVariant }]}>
                <Text style={[styles.title, { color: colors.onSurface }]}>{action.name} · {action.actionCost}</Text>
                <Text style={{ color: colors.onSurfaceVariant }}>
                  {[
                    action.attackBonus !== undefined ? `Ataque +${action.attackBonus}` : undefined,
                    action.reach ?? action.range,
                    action.damageFormula,
                    action.damageType,
                    action.saveAbility ? `Salvaguarda ${action.saveAbility} CD ${action.saveDC ?? familiar.investment?.warlockSpellSaveDC ?? '—'}` : undefined,
                    action.uses,
                    action.summary
                  ].filter(Boolean).join(' · ') || 'Ação sem dados adicionais.'}
                </Text>
                {action.conditionIds?.length ? <Text style={{ color: colors.onSurfaceVariant }}>Pode aplicar: {action.conditionIds.join(', ')}</Text> : null}
              </View>
            ))}
            {!familiar.actions.length ? <Text style={{ color: colors.onSurfaceVariant }}>Nenhuma ação estruturada no stat block.</Text> : null}
          </Card>

          {combatActions.map((action) => {
            const analysis = analyzeActionDamage({ action, character, combatState: defaultCombatState });
            return (
              <Card key={action.id} variant="outlined" title={action.name} subtitle={`Ataque do familiar · ${action.actionCost}`}>
                <StatRow label="Dano mínimo" value={analysis.total.min} />
                <StatRow label="Dano máximo" value={analysis.total.max} />
                <StatRow label="Dano médio" value={analysis.total.average} />
                {action.attackBonusOverride !== undefined ? <StatRow label="Bônus de ataque" value={`+${action.attackBonusOverride}`} /> : null}
                {action.ruleNotes?.map((note, index) => <Text key={`${action.id}-note-${index}`} style={{ color: colors.onSurfaceVariant }}>• {note}</Text>)}
              </Card>
            );
          })}

          <Card title={`Traits (${familiar.traits.length})`}>
            {familiar.traits.map((trait) => (
              <View key={trait.id} style={[styles.entry, { borderBottomColor: colors.outlineVariant }]}>
                <Text style={[styles.title, { color: colors.onSurface }]}>{trait.name}</Text>
                {trait.summary ? <Text style={{ color: colors.onSurfaceVariant }}>{trait.summary}</Text> : null}
              </View>
            ))}
          </Card>

          <Card title="Histórico recente" subtitle="Dano, cura, recursos e condições do familiar.">
            {[...familiar.transactions].reverse().slice(0, 20).map((transaction) => (
              <View key={transaction.id} style={[styles.entry, { borderBottomColor: colors.outlineVariant }]}>
                <Text style={[styles.title, { color: colors.onSurface }]}>{transaction.label}</Text>
                <Text style={{ color: colors.onSurfaceVariant }}>
                  {transaction.action}{transaction.before !== undefined && transaction.after !== undefined ? ` · ${transaction.before} → ${transaction.after}` : ''} · {new Date(transaction.createdAt).toLocaleString()}
                </Text>
              </View>
            ))}
            {!familiar.transactions.length ? <Text style={{ color: colors.onSurfaceVariant }}>Nenhuma alteração registrada.</Text> : null}
          </Card>
        </>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  entry: { gap: 3, paddingVertical: 10, borderBottomWidth: 1 },
  title: { fontSize: 14, lineHeight: 20, fontWeight: '800' },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  flex: { flex: 1, minWidth: 120 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  resourceRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8, paddingVertical: 10, borderBottomWidth: 1 }
});
