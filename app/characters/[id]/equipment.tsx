import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { Alert, StyleSheet, Text, View } from 'react-native';
import { VirtualizedScreen } from '../../../src/components/VirtualizedScreen';
import { Field } from '../../../src/components/Field';
import { Button } from '../../../src/components/Button';
import { Card } from '../../../src/components/Card';
import { Chip } from '../../../src/components/Chip';
import { IssueList } from '../../../src/components/IssueList';
import { StatRow } from '../../../src/components/StatRow';
import { PendingChoiceContextCard } from '../../../src/components/PendingChoiceContextCard';
import { useCharacterProgressionSession } from '../../../src/characters/useCharacterProgressionSession';
import { useCharacterChoiceBridge } from '../../../src/catalog/useCharacterChoiceBridge';
import type { Equipment, Weapon } from '../../../src/types';
import { parseDamageFormula } from '../../../src/rules-engine/dice/parser';
import { createId } from '../../../src/utils/id';
import { manualSource } from '../../../src/data/mockData';
import {
  applyStartingEquipmentSelections,
  createEquipmentSelection,
  getStartingEquipmentOptions,
  type StartingEquipmentOption
} from '../../../src/characters/startingEquipmentRules';
import { reconcileCharacterBuild } from '../../../src/characters/buildReconciliation';
import { getCharacterDisplayName } from '../../../src/ui/characterIdentity';
import { describeMagicItemAllowance } from '../../../src/characters/higherLevelStartingRules';
import {
  equipArmor,
  equipWeapon,
  getActiveLoadout,
  getOwnedArmors,
  isShieldArmor,
  reconcileEquipmentLoadout,
  stowWeapon,
  toggleArmorAccessory,
  setHeldSpellcastingFocus,
  validateEquipmentLoadout,
  weaponHandsRequired
} from '../../../src/characters/equipmentLoadoutRules';
import { equipmentAmmunitionType } from '../../../src/characters/ammunitionRules';
import { equipmentFocusMetadata, focusMetadataFromLabel } from '../../../src/characters/spellComponentRules';
import { getArmorClass } from '../../../src/rules-engine/characters/derivedStats';

const getId = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);

export default function EquipmentScreen() {
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
  const [weaponName, setWeaponName] = useState('Nova arma');
  const [formula, setFormula] = useState('1d8 + STR');
  const [magicBonus, setMagicBonus] = useState('0');
  const [equipmentName, setEquipmentName] = useState('Novo equipamento');
  const [equipmentQuantity, setEquipmentQuantity] = useState('1');
  const [ammunitionType, setAmmunitionType] = useState('');
  const [gp, setGp] = useState(String(character?.currency?.gp ?? 0));

  useEffect(() => { setGp(String(character?.currency?.gp ?? 0)); }, [character?.currency?.gp]);

  const optionGroups = useMemo(() => {
    if (!character) return [] as StartingEquipmentOption[][];
    const classItem = items.find((item) => item.id === character.buildChoices?.startingClassItemId);
    const backgroundLink = (character.compendiumLinks ?? []).find((link) => link.appliedAs === 'background' && link.status === 'active');
    const backgroundItem = items.find((item) => item.id === backgroundLink?.itemId);
    return [getStartingEquipmentOptions(classItem, 'class'), getStartingEquipmentOptions(backgroundItem, 'background')].filter((group) => group.length);
  }, [character, items]);

  if (!character || !id) return <VirtualizedScreen title="Não encontrado" data={[]} renderItem={() => null} footerContent={<Button label="Voltar" onPress={() => router.back()} />} />;

  const loadout = getActiveLoadout(character);
  const loadoutIssues = validateEquipmentLoadout(character);
  const ownedArmors = getOwnedArmors(character);
  const heldEquipmentFocus = character.equipment.find((entry) => entry.id === loadout.heldFocusEquipmentId);
  const heldWeaponFocus = character.weapons.find((entry) =>
    (entry.id === loadout.mainHandWeaponId || entry.id === loadout.offHandWeaponId) && entry.spellcastingFocus === true
  );

  const commit = (next: typeof character, issues = loadoutIssues) => {
    updateCharacter(id, () => reconcileEquipmentLoadout(next));
    const errors = issues.filter((issue) => issue.severity === 'error');
    if (errors.length) Alert.alert('Loadout ajustado', errors.map((issue) => issue.message).join('\n'));
  };

  const addWeapon = () => {
    const weapon: Weapon = {
      id: createId('weapon'),
      name: weaponName.trim() || 'Arma sem nome',
      weaponType: 'manual',
      attackAbility: formula.toUpperCase().includes('DEX') ? 'DEX' : 'STR',
      damageAbility: formula.toUpperCase().includes('DEX') ? 'DEX' : 'STR',
      magicBonus: Number(magicBonus) || 0,
      damage: parseDamageFormula(formula, { defaultSourceType: 'weapon' }),
      quantity: 1,
      equipped: false,
      handsRequired: 1,
      source: manualSource
    };
    updateCharacter(id, (current) => ({ ...current, weapons: [...current.weapons, weapon] }));
  };

  const addEquipment = () => {
    const inferred = ammunitionType.trim() || equipmentAmmunitionType(equipmentName);
    const focus = focusMetadataFromLabel(equipmentName);
    const equipment: Equipment = {
      id: createId('equipment'),
      name: equipmentName.trim() || 'Equipamento sem nome',
      quantity: Math.max(1, Number(equipmentQuantity) || 1),
      ammunitionType: inferred || undefined,
      tags: inferred ? ['ammunition'] : undefined,
      spellcastingFocus: focus.spellcastingFocus,
      spellcastingFocusKind: focus.spellcastingFocusKind,
      focusRequiresHand: focus.focusRequiresHand,
      materialComponent: focus.materialComponent,
      source: manualSource
    };
    updateCharacter(id, (current) => ({ ...current, equipment: [...current.equipment, equipment] }));
  };

  const selectStartingOption = (option: StartingEquipmentOption) => {
    const previous = (character.buildChoices?.equipmentSelections ?? []).find((entry) => entry.sourceItemId === option.sourceItemId);
    if (previous?.optionId === option.optionId) return;
    updateCharacter(id, (current) => {
      const selections = [
        ...(current.buildChoices?.equipmentSelections ?? []).filter((entry) => entry.sourceItemId !== option.sourceItemId),
        createEquipmentSelection(option, items)
      ];
      let next = reconcileEquipmentLoadout(reconcileCharacterBuild(applyStartingEquipmentSelections(current, selections, items), items).character);
      if (pendingId) next = { ...next, pendingChoices: (next.pendingChoices ?? []).filter((choice) => choice.id !== pendingId) };
      return next;
    });
  };

  const removeEntity = (kind: 'weapon' | 'armor' | 'armorAccessory' | 'equipment' | 'magicItem', entityId: string) => updateCharacter(id, (current) => reconcileEquipmentLoadout({
    ...current,
    weapons: kind === 'weapon' ? current.weapons.filter((entry) => entry.id !== entityId) : current.weapons,
    armors: kind === 'armor' ? (current.armors ?? []).filter((entry) => entry.id !== entityId) : current.armors,
    armor: kind === 'armor' && current.armor?.id === entityId ? undefined : current.armor,
    armorAccessories: kind === 'armorAccessory' ? (current.armorAccessories ?? []).filter((entry) => entry.id !== entityId) : current.armorAccessories,
    equipment: kind === 'equipment' ? current.equipment.filter((entry) => entry.id !== entityId) : current.equipment,
    magicItems: kind === 'magicItem' ? current.magicItems.filter((entry) => entry.id !== entityId) : current.magicItems,
    compendiumLinks: (current.compendiumLinks ?? []).map((link) => link.appliedEntityId === entityId && link.status === 'active' ? { ...link, status: 'removed' as const } : link)
  }));

  const equipmentRows = [
    ...ownedArmors.map((entity) => ({ kind: 'armor' as const, id: entity.id, entity })),
    ...(character.armorAccessories ?? []).map((entity) => ({ kind: 'armorAccessory' as const, id: entity.id, entity })),
    ...character.weapons.map((entity) => ({ kind: 'weapon' as const, id: entity.id, entity })),
    ...character.equipment.map((entity) => ({ kind: 'equipment' as const, id: entity.id, entity })),
    ...character.magicItems.map((entity) => ({ kind: 'magicItem' as const, id: entity.id, entity }))
  ];

  return (
    <VirtualizedScreen
      eyebrow={getCharacterDisplayName(character)}
      title="Equipamentos, loadout e munição"
      subtitle="Inventário possuído e itens atualmente equipados são controlados separadamente."
      onBack={() => router.push(progressionSession.hasActiveTransaction ? `/characters/${character.id}/progression` : `/characters/${character.id}`)}
      data={equipmentRows}
      keyExtractor={(row) => `${row.kind}:${row.id}`}
      initialNumToRender={12}
      headerContent={(
        <>
          <PendingChoiceContextCard pendingChoice={pendingChoice} resolution={pendingResolution} />
          <Card variant="hero" title="Loadout ativo" subtitle="CA, ataques disponíveis, mãos ocupadas e munição usam esta configuração.">
            <StatRow label="CA atual" value={getArmorClass(character)} />
            <StatRow label="Mão principal" value={character.weapons.find((entry) => entry.id === loadout.mainHandWeaponId)?.name ?? 'Livre'} />
            <StatRow label="Mão secundária" value={character.weapons.find((entry) => entry.id === loadout.offHandWeaponId)?.name ?? ((character.armorAccessories ?? []).find((entry) => loadout.armorAccessoryIds.includes(entry.id) && isShieldArmor(entry))?.name ?? 'Livre')} />
            <StatRow label="Armadura" value={ownedArmors.find((entry) => entry.id === loadout.armorId)?.name ?? 'Sem armadura'} />
            <StatRow label="Foco disponível nas mãos" value={heldEquipmentFocus?.name ?? heldWeaponFocus?.name ?? 'Nenhum'} />
            {loadoutIssues.length ? <IssueList issues={loadoutIssues} /> : <Text style={styles.success}>Loadout compatível.</Text>}
          </Card>

          {character.buildChoices?.higherLevelStartingBenefits ? (
            <Card variant="filled" title={`Recursos de início no nível ${character.buildChoices.higherLevelStartingBenefits.startingLevel}`} subtitle={`${character.buildChoices.higherLevelStartingBenefits.bonusGold} GP adicionais · rolagem ${character.buildChoices.higherLevelStartingBenefits.rolledD10} no d10 · itens sugeridos: ${describeMagicItemAllowance(character.buildChoices.higherLevelStartingBenefits.magicItemAllowance)}`} />
          ) : null}

          {optionGroups.map((group) => {
            const source = group[0]!;
            const selected = (character.buildChoices?.equipmentSelections ?? []).find((entry) => entry.sourceItemId === source.sourceItemId);
            return (
              <Card key={source.sourceItemId} variant="filled" title={`Equipamento inicial · ${source.sourceName}`} subtitle="A escolha de classe e a escolha de background são independentes.">
                <View style={styles.chips}>{group.map((option) => <Chip key={option.optionId} label={`${option.optionId}: ${option.labels.join(', ')}`} selected={selected?.optionId === option.optionId} onPress={() => selectStartingOption(option)} />)}</View>
              </Card>
            );
          })}

          <Card variant="filled" title="Moedas">
            <Field label="Peças de ouro (GP)" value={gp} onChangeText={setGp} keyboardType="number-pad" />
            <Button label="Salvar ouro" variant="outlined" onPress={() => updateCharacter(id, (current) => ({ ...current, currency: { ...(current.currency ?? { cp: 0, sp: 0, ep: 0, gp: 0, pp: 0 }), gp: Math.max(0, Number(gp) || 0) } }))} />
          </Card>

          <Card title="Inventário atual" subtitle={`${equipmentRows.length} entidade(s). Use os controles de cada card para definir o loadout.`} />
        </>
      )}
      renderItem={({ item: row }) => {
        if (row.kind === 'armor') {
          const active = loadout.armorId === row.entity.id;
          return (
            <Card variant={active ? 'hero' : 'outlined'} title={row.entity.name} subtitle={`${active ? 'Equipada' : 'No inventário'} · CA base ${row.entity.baseAC}${row.entity.dexCap === undefined ? ' + DEX' : ` + DEX máximo ${row.entity.dexCap}`}`}>
              <Button label={active ? 'Desequipar' : 'Equipar armadura'} variant={active ? 'text' : 'outlined'} onPress={() => commit(equipArmor(character, active ? undefined : row.entity.id))} />
              <Button label="Remover do inventário" variant="text" onPress={() => removeEntity('armor', row.entity.id)} />
            </Card>
          );
        }
        if (row.kind === 'armorAccessory') {
          const active = loadout.armorAccessoryIds.includes(row.entity.id);
          return (
            <Card variant={active ? 'hero' : 'outlined'} title={row.entity.name} subtitle={`${active ? 'Equipado' : 'No inventário'} · bônus de CA +${row.entity.acBonus ?? row.entity.baseAC ?? 0}${isShieldArmor(row.entity) ? ' · ocupa uma mão' : ''}`}>
              <Button label={active ? 'Desequipar' : 'Equipar'} variant={active ? 'text' : 'outlined'} onPress={() => { const result = toggleArmorAccessory(character, row.entity.id); commit(result.character, result.issues); }} />
              <Button label="Remover do inventário" variant="text" onPress={() => removeEntity('armorAccessory', row.entity.id)} />
            </Card>
          );
        }
        if (row.kind === 'weapon') {
          const main = loadout.mainHandWeaponId === row.entity.id;
          const off = loadout.offHandWeaponId === row.entity.id;
          return (
            <Card variant={main || off ? 'hero' : 'outlined'} title={row.entity.name} subtitle={`${row.entity.damage.raw} · ${weaponHandsRequired(row.entity)} mão(s) · quantidade ${row.entity.quantity ?? 1}`}>
              <Text>Mastery: {row.entity.mastery ?? 'não cadastrada'} · Bônus mágico: {row.entity.magicBonus ?? 0}</Text>
              {row.entity.spellcastingFocus ? <Text>Foco de conjuração: {row.entity.spellcastingFocusKind ?? 'arma/foco'} enquanto estiver em uma mão.</Text> : null}
              {row.entity.range ? <Text>Alcance: {row.entity.range.normal}{row.entity.range.long ? `/${row.entity.range.long}` : ''} pés</Text> : null}
              {row.entity.ammunitionType ? <Text>Munição: {row.entity.ammunitionType}</Text> : null}
              <View style={styles.chips}>
                <Chip label="Mão principal" selected={main} onPress={() => { const result = equipWeapon(character, row.entity.id, 'main'); commit(result.character, result.issues); }} />
                {weaponHandsRequired(row.entity) === 1 ? <Chip label="Mão secundária" selected={off} onPress={() => { const result = equipWeapon(character, row.entity.id, 'off'); commit(result.character, result.issues); }} /> : null}
                {(main || off) ? <Chip label="Guardar" selected={false} onPress={() => commit(stowWeapon(character, row.entity.id))} /> : null}
              </View>
              <Button label="Remover" variant="text" onPress={() => removeEntity('weapon', row.entity.id)} />
            </Card>
          );
        }
        if (row.kind === 'equipment') {
          const focus = equipmentFocusMetadata(row.entity);
          const heldFocus = loadout.heldFocusEquipmentId === row.entity.id;
          return (
            <Card title={row.entity.name} subtitle={`Quantidade: ${row.entity.quantity}${row.entity.ammunitionType ? ` · munição ${row.entity.ammunitionType}` : ''}${focus.spellcastingFocus ? ` · foco ${focus.spellcastingFocusKind ?? 'mágico'}` : ''}`}>
              <View style={styles.chips}>
                <Chip label="−1" selected={false} onPress={() => updateCharacter(id, (current) => ({ ...current, equipment: current.equipment.map((entry) => entry.id === row.entity.id ? { ...entry, quantity: Math.max(0, entry.quantity - 1) } : entry) }))} />
                <Chip label="+1" selected={false} onPress={() => updateCharacter(id, (current) => ({ ...current, equipment: current.equipment.map((entry) => entry.id === row.entity.id ? { ...entry, quantity: entry.quantity + 1 } : entry) }))} />
                {focus.spellcastingFocus && focus.focusRequiresHand !== false ? <Chip label={heldFocus ? 'Guardar foco' : 'Segurar como foco'} selected={heldFocus} onPress={() => { const result = setHeldSpellcastingFocus(character, heldFocus ? undefined : row.entity.id); commit(result.character, result.issues); }} /> : null}
              </View>
              {focus.spellcastingFocus ? <Text>{focus.focusRequiresHand === false ? 'Pode ser usado sem ocupar uma mão.' : 'Ocupa a mão secundária enquanto estiver segurado.'}</Text> : null}
              <Button label="Remover" variant="text" onPress={() => removeEntity('equipment', row.entity.id)} />
            </Card>
          );
        }
        return <Card title={row.entity.name} subtitle={`Quantidade: ${row.entity.quantity}`}><Button label="Remover" variant="text" onPress={() => removeEntity('magicItem', row.entity.id)} /></Card>;
      }}
      emptyContent={<Card variant="filled" title="Nenhum item na ficha" subtitle="Adicione itens manualmente ou pelo compêndio." />}
      footerContent={(
        <>
          <Card title="Adicionar arma manual">
            <Field label="Nome" value={weaponName} onChangeText={setWeaponName} />
            <Field label="Dano" value={formula} onChangeText={setFormula} />
            <Field label="Bônus mágico" value={magicBonus} onChangeText={setMagicBonus} keyboardType="number-pad" />
            <Button label="Adicionar arma" onPress={addWeapon} />
          </Card>
          <Card title="Adicionar equipamento ou munição manual">
            <Field label="Nome" value={equipmentName} onChangeText={setEquipmentName} />
            <Field label="Quantidade" value={equipmentQuantity} onChangeText={setEquipmentQuantity} keyboardType="number-pad" />
            <Field label="Tipo de munição (opcional)" value={ammunitionType} onChangeText={setAmmunitionType} placeholder="arrow, bolt, sling-bullet..." />
            <Button label="Adicionar equipamento" onPress={addEquipment} />
          </Card>
          <Button label="Adicionar item do compêndio" variant="outlined" onPress={() => router.push(`/characters/${character.id}/compendium${pendingId ? `?pendingId=${encodeURIComponent(pendingId)}` : ''}`)} />
        </>
      )}
    />
  );
}

const styles = StyleSheet.create({
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  success: { color: '#166534', fontWeight: '700' }
});
