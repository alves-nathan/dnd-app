import { router, useLocalSearchParams } from 'expo-router';
import { useMemo, useState } from 'react';
import { Alert, StyleSheet, Text, View } from 'react-native';
import { Button } from '../../../src/components/Button';
import { Card } from '../../../src/components/Card';
import { Chip } from '../../../src/components/Chip';
import { ChoiceChipSelector } from '../../../src/components/ChoiceChipSelector';
import { Field } from '../../../src/components/Field';
import { PaginatedChipList } from '../../../src/components/PaginatedChipList';
import { Screen } from '../../../src/components/Screen';
import { applyCharacterChoice } from '../../../src/catalog/characterChoiceApplication';
import { useCharacterChoiceBridge } from '../../../src/catalog/useCharacterChoiceBridge';
import { useCharacterProgressionSession } from '../../../src/characters/useCharacterProgressionSession';
import { customRuleSource } from '../../../src/characters/customRuleEffects';
import { applyCustomProficiencyModifiers, describeCustomModifier } from '../../../src/characters/customModifierRules';
import { SKILLS } from '../../../src/characters/proficiencies';
import { ALL_LANGUAGE_OPTIONS, ALL_TOOL_OPTIONS } from '../../../src/characters/choiceOptions';
import { getSelectableSpellCandidates } from '../../../src/characters/creationData';
import { parseDamageFormula } from '../../../src/rules-engine/dice/parser';
import { useAppTheme } from '../../../src/theme';
import type { AbilityScore, Character, CustomCharacterModifierRule, CustomFeatureRules, CustomModifierOperation, CustomModifierTarget, CustomProficiencyKind, Feature, ResourcePool } from '../../../src/types';
import { createId } from '../../../src/utils/id';

const getParam = (value: string | string[] | undefined) => Array.isArray(value) ? value[0] : value;
const numericValue = (value: string, fallback = 0): number => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};
const DAMAGE_TYPES = ['acid', 'bludgeoning', 'cold', 'fire', 'force', 'lightning', 'necrotic', 'piercing', 'poison', 'psychic', 'radiant', 'slashing', 'thunder'] as const;
const ABILITIES: AbilityScore[] = ['STR', 'DEX', 'CON', 'INT', 'WIS', 'CHA'];
const SPELL_SCHOOLS = ['Abjuration', 'Conjuration', 'Divination', 'Enchantment', 'Evocation', 'Illusion', 'Necromancy', 'Transmutation'];
const MODIFIER_TARGETS: Array<{ id: CustomModifierTarget; label: string }> = [
  { id: 'proficiency', label: 'Proficiência' },
  { id: 'skillCheck', label: 'Teste de perícia' },
  { id: 'toolCheck', label: 'Teste de ferramenta' },
  { id: 'abilityCheck', label: 'Teste de atributo' },
  { id: 'savingThrow', label: 'Salvaguarda' },
  { id: 'attackRoll', label: 'Jogada de ataque' },
  { id: 'spellAttackRoll', label: 'Ataque mágico' },
  { id: 'spellSaveDC', label: 'CD de magia' },
  { id: 'spellDamage', label: 'Dano de magia' },
  { id: 'damageDealt', label: 'Dano causado' },
  { id: 'damageTaken', label: 'Dano recebido' },
  { id: 'armorClass', label: 'Classe de Armadura' },
  { id: 'initiative', label: 'Iniciativa' }
];
const PROFICIENCY_KINDS: Array<{ id: CustomProficiencyKind; label: string }> = [
  { id: 'skill', label: 'Perícia' }, { id: 'tool', label: 'Ferramenta' }, { id: 'savingThrow', label: 'Salvaguarda' },
  { id: 'weapon', label: 'Arma' }, { id: 'armor', label: 'Armadura' }, { id: 'language', label: 'Idioma' }
];

export default function CustomRuleScreen() {
  const { colors } = useAppTheme();
  const params = useLocalSearchParams();
  const id = getParam(params.id);
  const kind = getParam(params.kind) === 'feat' ? 'feat' : 'feature';
  const progressionSession = useCharacterProgressionSession(id);
  const character = progressionSession.character;
  const updateCharacter = progressionSession.updateCharacter;
  const bridge = useCharacterChoiceBridge();
  const spellItems = useMemo(
    () => getSelectableSpellCandidates(bridge.items, bridge.enabledSourceIds),
    [bridge.items, bridge.enabledSourceIds]
  );

  const [name, setName] = useState('');
  const [summary, setSummary] = useState('');
  const [spellSearch, setSpellSearch] = useState('');
  const [grantedSpellItemIds, setGrantedSpellItemIds] = useState<string[]>([]);
  const [spellAccessMode, setSpellAccessMode] = useState<'grant' | 'list'>('grant');
  const [spellAccessClasses, setSpellAccessClasses] = useState<string[]>([]);

  const [damageMultiplierEnabled, setDamageMultiplierEnabled] = useState(false);
  const [damageType, setDamageType] = useState('fire');
  const [damageMultiplier, setDamageMultiplier] = useState('2');

  const [triggerEnabled, setTriggerEnabled] = useState(false);
  const [triggerDamageType, setTriggerDamageType] = useState('fire');
  const [triggerDieSides, setTriggerDieSides] = useState('8');
  const [triggerValue, setTriggerValue] = useState('1');
  const [triggerRadiusFeet, setTriggerRadiusFeet] = useState('30');
  const [triggerSaveAbility, setTriggerSaveAbility] = useState<AbilityScore>('DEX');
  const [triggerHalfOnSuccess, setTriggerHalfOnSuccess] = useState(true);

  const [spellReplacementEnabled, setSpellReplacementEnabled] = useState(false);
  const [spellReplacementCount, setSpellReplacementCount] = useState('1');
  const [spellReplacementRecharge, setSpellReplacementRecharge] = useState<'shortRest' | 'longRest' | 'manual'>('longRest');
  const [spellReplacementClasses, setSpellReplacementClasses] = useState<string[]>([]);

  const [customModifiers, setCustomModifiers] = useState<CustomCharacterModifierRule[]>([]);
  const [modifierTarget, setModifierTarget] = useState<CustomModifierTarget>('skillCheck');
  const [modifierOperation, setModifierOperation] = useState<CustomModifierOperation>('add');
  const [modifierFlat, setModifierFlat] = useState('0');
  const [modifierPbMultiplier, setModifierPbMultiplier] = useState('0');
  const [modifierAbilityMultiplier, setModifierAbilityMultiplier] = useState('0');
  const [modifierAbility, setModifierAbility] = useState<AbilityScore>('CHA');
  const [modifierMultiplier, setModifierMultiplier] = useState('1');
  const [modifierSkills, setModifierSkills] = useState<string[]>([]);
  const [modifierTools, setModifierTools] = useState<string[]>([]);
  const [modifierAbilities, setModifierAbilities] = useState<AbilityScore[]>([]);
  const [modifierDamageTypes, setModifierDamageTypes] = useState<string[]>([]);
  const [modifierSpellSchools, setModifierSpellSchools] = useState<string[]>([]);
  const [modifierSpellItemIds, setModifierSpellItemIds] = useState<string[]>([]);
  const [modifierActionTypes, setModifierActionTypes] = useState<Array<'attack' | 'spell'>>([]);
  const [modifierProficiencyKind, setModifierProficiencyKind] = useState<CustomProficiencyKind>('skill');
  const [modifierProficiencyValuesText, setModifierProficiencyValuesText] = useState('');

  if (!character || !id) return <Screen title="Personagem não encontrado"><Button label="Voltar" onPress={() => router.back()} /></Screen>;

  const availableSpellItems = spellItems.filter((item) => bridge.choiceForItemId(item.id)?.available);
  const visibleSpellItems = availableSpellItems.filter((item) => !spellSearch.trim() || item.name.toLowerCase().includes(spellSearch.trim().toLowerCase()));
  const selectedSpellNames = grantedSpellItemIds
    .map((itemId) => availableSpellItems.find((item) => item.id === itemId)?.name)
    .filter((value): value is string => Boolean(value));

  const applyFriendlyFirePreset = () => {
    setName('Friendly Fire');
    setSummary('You deal double fire damage. Every time you deal fire damage, roll a d8. On a 1, the attack explodes into flames. Each creature in a 9 m (~30 ft) circle centered on you makes a Dexterity saving throw, taking full damage on a failed save or half on a success.');
    setDamageMultiplierEnabled(true);
    setDamageType('fire');
    setDamageMultiplier('2');
    setTriggerEnabled(true);
    setTriggerDamageType('fire');
    setTriggerDieSides('8');
    setTriggerValue('1');
    setTriggerRadiusFeet('30');
    setTriggerSaveAbility('DEX');
    setTriggerHalfOnSuccess(true);
    const fireBolt = availableSpellItems.find((item) => item.name.trim().toLowerCase() === 'fire bolt');
    if (fireBolt) setGrantedSpellItemIds([fireBolt.id]);
    setSpellAccessMode('list');
    const bard = character.classes.find((entry) => entry.name.trim().toLowerCase() === 'bard');
    setSpellAccessClasses(bard ? [bard.name] : []);
  };

  const resetModifierDraft = () => {
    setModifierFlat('0');
    setModifierPbMultiplier('0');
    setModifierAbilityMultiplier('0');
    setModifierMultiplier('1');
    setModifierSkills([]);
    setModifierTools([]);
    setModifierAbilities([]);
    setModifierDamageTypes([]);
    setModifierSpellSchools([]);
    setModifierSpellItemIds([]);
    setModifierActionTypes([]);
    setModifierProficiencyValuesText('');
  };

  const addStructuredModifier = () => {
    const proficiencyValues = modifierProficiencyKind === 'skill'
      ? modifierSkills
      : modifierProficiencyKind === 'tool'
        ? modifierTools
        : modifierProficiencyKind === 'savingThrow'
          ? modifierAbilities
          : modifierProficiencyKind === 'language'
            ? modifierProficiencyValuesText.split(',').map((entry) => entry.trim()).filter(Boolean)
            : modifierProficiencyValuesText.split(',').map((entry) => entry.trim()).filter(Boolean);
    const rule: CustomCharacterModifierRule = {
      id: createId('customModifier'),
      target: modifierTarget,
      operation: modifierTarget === 'proficiency'
        ? (modifierOperation === 'removeProficiency' ? 'removeProficiency' : 'grantProficiency')
        : modifierOperation,
      selector: {
        skills: modifierSkills.length ? modifierSkills : undefined,
        tools: modifierTools.length ? modifierTools : undefined,
        abilities: modifierAbilities.length ? modifierAbilities : undefined,
        spellItemIds: modifierSpellItemIds.length ? modifierSpellItemIds : undefined,
        spellNames: modifierSpellItemIds.length ? modifierSpellItemIds.map((itemId) => availableSpellItems.find((item) => item.id === itemId)?.name).filter((value): value is string => Boolean(value)) : undefined,
        damageTypes: modifierDamageTypes.length ? modifierDamageTypes : undefined,
        spellSchools: modifierSpellSchools.length ? modifierSpellSchools : undefined,
        actionTypes: modifierActionTypes.length ? modifierActionTypes : undefined,
        proficiencyKind: modifierTarget === 'proficiency' ? modifierProficiencyKind : undefined,
        proficiencyValues: modifierTarget === 'proficiency' && proficiencyValues.length ? proficiencyValues : undefined
      },
      value: modifierTarget === 'proficiency' || modifierOperation === 'advantage' || modifierOperation === 'disadvantage'
        ? undefined
        : {
            flat: numericValue(modifierFlat),
            multiplier: modifierOperation === 'multiply' ? numericValue(modifierMultiplier, 1) : undefined,
            proficiencyBonusMultiplier: numericValue(modifierPbMultiplier),
            abilityModifierMultiplier: numericValue(modifierAbilityMultiplier),
            ability: modifierAbility
          },
      label: `${MODIFIER_TARGETS.find((entry) => entry.id === modifierTarget)?.label ?? modifierTarget} · ${modifierOperation}`
    };
    if (modifierTarget === 'proficiency' && !(rule.selector?.proficiencyValues?.length)) {
      Alert.alert('Escolha a proficiência', 'Informe ao menos uma proficiência para conceder ou remover.');
      return;
    }
    setCustomModifiers((current) => [...current, rule]);
    resetModifierDraft();
  };

  const save = () => {
    if (!name.trim()) {
      Alert.alert('Nome obrigatório', `Informe o nome ${kind === 'feat' ? 'do feat' : 'da feature'}.`);
      return;
    }

    const ownerId = createId(kind);
    const ruleFeatureId = kind === 'feature' ? ownerId : createId('featFeature');
    const source = customRuleSource(`Homebrew personalizado: ${name.trim()}`);
    const replacementCount = Math.max(1, Math.floor(Number(spellReplacementCount) || 1));
    const replacementResource: ResourcePool | undefined = spellReplacementEnabled ? {
      id: createId('spellSwap'),
      name: `${name.trim()} · troca de magia`,
      max: replacementCount,
      current: replacementCount,
      recharge: spellReplacementRecharge,
      source,
      notes: 'Controla trocas de magia concedidas por regra personalizada.'
    } : undefined;

    const selectedSpellReferences = grantedSpellItemIds.map((itemId) => {
      const item = availableSpellItems.find((candidate) => candidate.id === itemId);
      return item?.importItemId ?? item?.id ?? itemId;
    });
    const customRules: CustomFeatureRules = {
      modifiers: customModifiers.length ? customModifiers : undefined,
      grantedSpellItemIds: spellAccessMode === 'grant' && selectedSpellReferences.length ? selectedSpellReferences : undefined,
      spellListAdditions: spellAccessMode === 'list' && selectedSpellReferences.length ? [{
        id: createId('spellListAddition'),
        spellItemIds: selectedSpellReferences,
        classNames: spellAccessClasses.length ? [...spellAccessClasses] : undefined,
        label: `${name.trim()} · expansão de lista de magias`,
        notes: 'Adiciona as magias selecionadas à lista elegível da classe sem aprendê-las automaticamente.'
      }] : undefined,
      damageMultipliers: damageMultiplierEnabled ? [{
        id: createId('damageMultiplier'),
        damageType,
        multiplier: Math.max(0, Number(damageMultiplier) || 1),
        label: `${name.trim()} · ${damageType} ×${Math.max(0, Number(damageMultiplier) || 1)}`
      }] : undefined,
      triggeredDamage: triggerEnabled ? [{
        id: createId('triggerDamage'),
        triggerDamageType,
        triggerRoll: { count: 1, sides: Math.max(2, Math.floor(Number(triggerDieSides) || 8)) },
        triggerValues: [Math.max(1, Math.floor(Number(triggerValue) || 1))],
        radiusFeet: Math.max(0, Number(triggerRadiusFeet) || 0) || undefined,
        saveAbility: triggerSaveAbility,
        saveSuccessDamage: triggerHalfOnSuccess ? 'half' : 'none',
        damageMode: 'sameAsTriggeringDamage',
        notes: summary.trim() || undefined
      }] : undefined,
      spellReplacement: replacementResource ? [{
        id: createId('spellReplacement'),
        count: replacementCount,
        recharge: spellReplacementRecharge,
        resourceId: replacementResource.id,
        classNames: spellReplacementClasses.length ? [...spellReplacementClasses] : undefined,
        label: `${name.trim()} · troca de magia`,
        notes: 'Permite substituir magia fora da progressão normal enquanto houver uso disponível.'
      }] : undefined
    };

    const ruleFeature: Feature = {
      id: ruleFeatureId,
      name: name.trim(),
      sourceType: kind === 'feat' ? 'feat' : 'manual',
      source,
      summary: summary.trim() || undefined,
      custom: true,
      resource: replacementResource,
      customRules
    };

    let next: Character = kind === 'feat'
      ? {
          ...character,
          feats: [...character.feats, { id: ownerId, name: name.trim(), summary: summary.trim() || undefined, source, custom: true, features: [ruleFeature] }],
          resources: replacementResource ? [...character.resources, replacementResource] : character.resources
        }
      : {
          ...character,
          features: [...character.features, ruleFeature],
          resources: replacementResource ? [...character.resources, replacementResource] : character.resources
        };

    for (const spellItemId of spellAccessMode === 'grant' ? grantedSpellItemIds : []) {
      const choice = bridge.choiceForItemId(spellItemId);
      if (!choice?.available) continue;
      const alreadyApplied = (next.compendiumLinks ?? []).some((link) => link.status === 'active' && (
        link.choiceId === choice.choiceId || link.catalogEntityId === choice.catalogEntityId || link.itemId === spellItemId
      ));
      if (alreadyApplied) continue;
      const applied = applyCharacterChoice({ character: next, choice });
      if (!applied.ok || !applied.link) continue;
      next = {
        ...applied.character,
        spells: applied.character.spells.map((spell) => spell.id === applied.link?.appliedEntityId ? {
          ...spell,
          grantedByFeatEntityId: kind === 'feat' ? ownerId : spell.grantedByFeatEntityId,
          grantedByFeatureEntityId: kind === 'feature' ? ownerId : spell.grantedByFeatureEntityId
        } : spell)
      };
    }

    next = applyCustomProficiencyModifiers(next);
    updateCharacter(character.id, () => next);
    router.replace(kind === 'feat' ? `/characters/${character.id}/feats` : `/characters/${character.id}/features`);
  };

  return (
    <Screen
      title={kind === 'feat' ? 'Criar feat personalizado' : 'Criar feature personalizada'}
      subtitle="Homebrew fica salvo na ficha com regras estruturadas para integração com dano, magias e descansos."
    >
      <Card variant="hero" title="Definição">
        <Field label="Nome" value={name} onChangeText={setName} placeholder={kind === 'feat' ? 'Ex.: Talent of the Ashen Sea' : 'Ex.: Friendly Fire'} />
        <Field label="Descrição / regra" value={summary} onChangeText={setSummary} multiline placeholder="Descreva a regra concedida pelo DM." />
        <Button label="Preencher exemplo Friendly Fire" secondary onPress={applyFriendlyFirePreset} />
      </Card>

      <Card variant="filled" title="Magias e lista de classe" subtitle={spellAccessMode === 'grant' ? 'Conceda uma magia diretamente à ficha sem consumir o limite da classe.' : 'Expanda a lista elegível da classe; a magia ainda precisa ser escolhida normalmente e conta para o limite da classe.'}>
        <View style={styles.chips}>
          <Chip label="Conceder diretamente" selected={spellAccessMode === 'grant'} onPress={() => setSpellAccessMode('grant')} />
          <Chip label="Adicionar à lista da classe" selected={spellAccessMode === 'list'} onPress={() => setSpellAccessMode('list')} />
        </View>
        {spellAccessMode === 'list' ? (
          <ChoiceChipSelector
            title="Classes cuja lista será expandida"
            options={character.classes.map((entry) => entry.name)}
            selectedValues={spellAccessClasses}
            onChange={setSpellAccessClasses}
            supportingText="Deixe vazio para aplicar a qualquer classe conjuradora da ficha."
            testIDPrefix="custom-spell-list-class"
          />
        ) : null}
        <Field label="Buscar magia" value={spellSearch} onChangeText={setSpellSearch} placeholder="Fire Bolt..." />
        {selectedSpellNames.length ? <Text style={{ color: colors.onSurfaceVariant }}>Selecionadas: {selectedSpellNames.join(', ')}</Text> : null}
        <PaginatedChipList
          items={visibleSpellItems}
          keyExtractor={(item) => item.id}
          labelForItem={(item) => `${item.name}${Number((item.normalizedJson as Record<string, unknown>).level ?? 0) === 0 ? ' · cantrip' : ''}`}
          isSelected={(item) => grantedSpellItemIds.includes(item.id)}
          onPressItem={(item) => setGrantedSpellItemIds((current) => current.includes(item.id) ? current.filter((idValue) => idValue !== item.id) : [...current, item.id])}
          pageSize={18}
          resetKey={`custom-rule-spells:${spellSearch}:${grantedSpellItemIds.join('|')}`}
          emptyText="Nenhuma magia disponível."
        />
      </Card>

      <Card variant="filled" title="Modificador de dano" subtitle="Aplicado automaticamente quando a ação possui o tipo de dano configurado.">
        <View style={styles.chips}>
          <Chip label="Ativo" selected={damageMultiplierEnabled} onPress={() => setDamageMultiplierEnabled((current) => !current)} />
        </View>
        {damageMultiplierEnabled ? (
          <>
            <ChoiceChipSelector title="Tipo de dano" options={DAMAGE_TYPES} selectedValues={[damageType]} maximumSelections={1} onChange={(values) => setDamageType(values[0] ?? 'fire')} />
            <Field label="Multiplicador" value={damageMultiplier} onChangeText={setDamageMultiplier} keyboardType="decimal-pad" placeholder="2" />
          </>
        ) : null}
      </Card>

      <Card variant="filled" title="Gatilho após causar dano" subtitle="Estrutura o efeito para uso no cálculo/tático; efeitos de área condicionais permanecem identificados separadamente do dano base.">
        <View style={styles.chips}><Chip label="Ativo" selected={triggerEnabled} onPress={() => setTriggerEnabled((current) => !current)} /></View>
        {triggerEnabled ? (
          <>
            <ChoiceChipSelector title="Tipo que dispara" options={DAMAGE_TYPES} selectedValues={[triggerDamageType]} maximumSelections={1} onChange={(values) => setTriggerDamageType(values[0] ?? 'fire')} />
            <View style={styles.row}>
              <View style={styles.flex}><Field label="Dado (dX)" value={triggerDieSides} onChangeText={setTriggerDieSides} keyboardType="number-pad" /></View>
              <View style={styles.flex}><Field label="Dispara no resultado" value={triggerValue} onChangeText={setTriggerValue} keyboardType="number-pad" /></View>
            </View>
            <Field label="Raio em pés" value={triggerRadiusFeet} onChangeText={setTriggerRadiusFeet} keyboardType="decimal-pad" placeholder="30" />
            <Text style={{ color: colors.onSurface, fontWeight: '800' }}>Salvaguarda</Text>
            <View style={styles.chips}>{ABILITIES.map((ability) => <Chip key={ability} label={ability} selected={triggerSaveAbility === ability} onPress={() => setTriggerSaveAbility(ability)} />)}</View>
            <View style={styles.chips}>
              <Chip label="Sucesso: metade" selected={triggerHalfOnSuccess} onPress={() => setTriggerHalfOnSuccess(true)} />
              <Chip label="Sucesso: sem dano" selected={!triggerHalfOnSuccess} onPress={() => setTriggerHalfOnSuccess(false)} />
            </View>
          </>
        ) : null}
      </Card>

      <Card variant="filled" title="Modificadores estruturados" subtitle="Adicione efeitos positivos ou negativos. Filtros vazios significam 'aplica a todos' naquele contexto.">
        <Text style={{ color: colors.onSurface, fontWeight: '800' }}>Dimensão afetada</Text>
        <View style={styles.chips}>
          {MODIFIER_TARGETS.map((target) => (
            <Chip
              key={target.id}
              label={target.label}
              selected={modifierTarget === target.id}
              onPress={() => {
                setModifierTarget(target.id);
                setModifierOperation(target.id === 'proficiency' ? 'grantProficiency' : 'add');
              }}
            />
          ))}
        </View>

        <Text style={{ color: colors.onSurface, fontWeight: '800' }}>Operação</Text>
        <View style={styles.chips}>
          {modifierTarget === 'proficiency' ? (
            <>
              <Chip label="Conceder" selected={modifierOperation === 'grantProficiency'} onPress={() => setModifierOperation('grantProficiency')} />
              <Chip label="Remover" selected={modifierOperation === 'removeProficiency'} onPress={() => setModifierOperation('removeProficiency')} />
            </>
          ) : (
            <>
              <Chip label="Somar/subtrair" selected={modifierOperation === 'add'} onPress={() => setModifierOperation('add')} />
              <Chip label="Multiplicar" selected={modifierOperation === 'multiply'} onPress={() => setModifierOperation('multiply')} />
              {['abilityCheck', 'skillCheck', 'toolCheck', 'savingThrow', 'attackRoll', 'spellAttackRoll'].includes(modifierTarget) ? (
                <>
                  <Chip label="Vantagem" selected={modifierOperation === 'advantage'} onPress={() => setModifierOperation('advantage')} />
                  <Chip label="Desvantagem" selected={modifierOperation === 'disadvantage'} onPress={() => setModifierOperation('disadvantage')} />
                </>
              ) : null}
            </>
          )}
        </View>

        {modifierTarget === 'proficiency' ? (
          <>
            <Text style={{ color: colors.onSurface, fontWeight: '800' }}>Tipo de proficiência</Text>
            <View style={styles.chips}>{PROFICIENCY_KINDS.map((entry) => <Chip key={entry.id} label={entry.label} selected={modifierProficiencyKind === entry.id} onPress={() => { setModifierProficiencyKind(entry.id); setModifierProficiencyValuesText(''); setModifierSkills([]); setModifierTools([]); setModifierAbilities([]); }} />)}</View>
            {modifierProficiencyKind === 'skill' ? <ChoiceChipSelector title="Perícias" options={SKILLS} selectedValues={modifierSkills} onChange={setModifierSkills} testIDPrefix="custom-mod-prof-skill" /> : null}
            {modifierProficiencyKind === 'tool' ? <ChoiceChipSelector title="Ferramentas" options={ALL_TOOL_OPTIONS} selectedValues={modifierTools} onChange={setModifierTools} testIDPrefix="custom-mod-prof-tool" /> : null}
            {modifierProficiencyKind === 'savingThrow' ? <ChoiceChipSelector title="Salvaguardas" options={ABILITIES} selectedValues={modifierAbilities} onChange={(values) => setModifierAbilities(values as AbilityScore[])} testIDPrefix="custom-mod-prof-save" /> : null}
            {modifierProficiencyKind === 'language' ? <ChoiceChipSelector title="Idiomas" options={ALL_LANGUAGE_OPTIONS} selectedValues={modifierProficiencyValuesText.split(',').map((entry) => entry.trim()).filter(Boolean)} onChange={(values) => setModifierProficiencyValuesText(values.join(', '))} testIDPrefix="custom-mod-prof-language" /> : null}
            {modifierProficiencyKind === 'weapon' || modifierProficiencyKind === 'armor' ? <Field label={modifierProficiencyKind === 'weapon' ? 'Armas (separadas por vírgula)' : 'Armaduras (separadas por vírgula)'} value={modifierProficiencyValuesText} onChangeText={setModifierProficiencyValuesText} placeholder="Ex.: Longsword, Rapier" /> : null}
          </>
        ) : null}

        {modifierTarget === 'skillCheck' ? <ChoiceChipSelector title="Filtrar por perícia" options={SKILLS} selectedValues={modifierSkills} onChange={setModifierSkills} supportingText="Vazio = qualquer perícia." testIDPrefix="custom-mod-skill" /> : null}
        {modifierTarget === 'toolCheck' ? <ChoiceChipSelector title="Filtrar por ferramenta" options={ALL_TOOL_OPTIONS} selectedValues={modifierTools} onChange={setModifierTools} supportingText="Vazio = qualquer ferramenta." testIDPrefix="custom-mod-tool" /> : null}
        {modifierTarget === 'abilityCheck' || modifierTarget === 'savingThrow' || modifierTarget === 'attackRoll' ? <ChoiceChipSelector title="Filtrar por atributo" options={ABILITIES} selectedValues={modifierAbilities} onChange={(values) => setModifierAbilities(values as AbilityScore[])} supportingText="Vazio = qualquer atributo." testIDPrefix="custom-mod-ability" /> : null}

        {['attackRoll', 'damageDealt'].includes(modifierTarget) ? (
          <ChoiceChipSelector
            title="Escopo da ação"
            options={['attack', 'spell']}
            selectedValues={modifierActionTypes}
            onChange={(values) => setModifierActionTypes(values as Array<'attack' | 'spell'>)}
            supportingText="Vazio = ataques com arma e magias. Selecione spell para limitar a magias."
            testIDPrefix="custom-mod-action-type"
          />
        ) : null}

        {['spellAttackRoll', 'spellSaveDC', 'spellDamage', 'damageDealt'].includes(modifierTarget) ? (
          <>
            <ChoiceChipSelector title="Escolas de magia" options={SPELL_SCHOOLS} selectedValues={modifierSpellSchools} onChange={setModifierSpellSchools} supportingText="Vazio = qualquer escola." testIDPrefix="custom-mod-school" />
            <Text style={{ color: colors.onSurface, fontWeight: '800' }}>Magias específicas (opcional)</Text>
            <PaginatedChipList
              items={availableSpellItems}
              keyExtractor={(item) => item.id}
              labelForItem={(item) => item.name}
              isSelected={(item) => modifierSpellItemIds.includes(item.id)}
              onPressItem={(item) => setModifierSpellItemIds((current) => current.includes(item.id) ? current.filter((value) => value !== item.id) : [...current, item.id])}
              pageSize={18}
              resetKey={`custom-mod-spells:${modifierSpellItemIds.join('|')}`}
              emptyText="Nenhuma magia disponível."
            />
          </>
        ) : null}

        {['spellDamage', 'damageDealt', 'damageTaken'].includes(modifierTarget) ? <ChoiceChipSelector title="Tipos de dano" options={DAMAGE_TYPES} selectedValues={modifierDamageTypes} onChange={setModifierDamageTypes} supportingText="Vazio = qualquer tipo de dano." testIDPrefix="custom-mod-damage" /> : null}

        {modifierTarget !== 'proficiency' && modifierOperation === 'add' ? (
          <>
            <Field label="Bônus fixo (aceita negativo)" value={modifierFlat} onChangeText={setModifierFlat} placeholder="Ex.: -2, 1, 5" />
            <Field label="× bônus de proficiência (PB)" value={modifierPbMultiplier} onChangeText={setModifierPbMultiplier} placeholder="Ex.: 1, 2, -1" />
            <Field label="× modificador de atributo" value={modifierAbilityMultiplier} onChangeText={setModifierAbilityMultiplier} placeholder="Ex.: 1, 2, -1" />
            <Text style={{ color: colors.onSurface, fontWeight: '800' }}>Atributo usado na fórmula</Text>
            <View style={styles.chips}>{ABILITIES.map((ability) => <Chip key={`formula-${ability}`} label={ability} selected={modifierAbility === ability} onPress={() => setModifierAbility(ability)} />)}</View>
          </>
        ) : null}
        {modifierTarget !== 'proficiency' && modifierOperation === 'multiply' ? <Field label="Multiplicador" value={modifierMultiplier} onChangeText={setModifierMultiplier} placeholder="Ex.: 0.5, 2, -1" /> : null}

        <Button label="Adicionar modificador" secondary onPress={addStructuredModifier} />
        {customModifiers.map((rule) => (
          <Card key={rule.id} variant="outlined" title={rule.label ?? rule.target} subtitle={describeCustomModifier(rule)}>
            <Button label="Remover" variant="text" compact onPress={() => setCustomModifiers((current) => current.filter((entry) => entry.id !== rule.id))} />
          </Card>
        ))}
      </Card>

      <Card variant="filled" title="Troca de magia por descanso" subtitle="Cria um recurso recuperável e habilita a troca na tela de Magias, inclusive para classes que normalmente só trocam ao subir de nível.">
        <View style={styles.chips}><Chip label="Ativo" selected={spellReplacementEnabled} onPress={() => setSpellReplacementEnabled((current) => !current)} /></View>
        {spellReplacementEnabled ? (
          <>
            <Field label="Trocas por recarga" value={spellReplacementCount} onChangeText={setSpellReplacementCount} keyboardType="number-pad" />
            <View style={styles.chips}>
              <Chip label="Descanso longo" selected={spellReplacementRecharge === 'longRest'} onPress={() => setSpellReplacementRecharge('longRest')} />
              <Chip label="Descanso curto" selected={spellReplacementRecharge === 'shortRest'} onPress={() => setSpellReplacementRecharge('shortRest')} />
              <Chip label="Manual" selected={spellReplacementRecharge === 'manual'} onPress={() => setSpellReplacementRecharge('manual')} />
            </View>
            <ChoiceChipSelector
              title="Classes afetadas"
              options={character.classes.map((entry) => entry.name)}
              selectedValues={spellReplacementClasses}
              onChange={setSpellReplacementClasses}
              supportingText="Deixe vazio para permitir a troca em qualquer classe conjuradora da ficha."
            />
          </>
        ) : null}
      </Card>

      <Button label={kind === 'feat' ? 'Salvar feat personalizado' : 'Salvar feature personalizada'} onPress={save} />
      <Button label="Cancelar" secondary onPress={() => router.back()} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  row: { flexDirection: 'row', gap: 10 },
  flex: { flex: 1 }
});
