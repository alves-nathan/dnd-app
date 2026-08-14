import {
  router,
  useLocalSearchParams
} from 'expo-router';
import {
  useEffect,
  useMemo,
  useState
} from 'react';
import {
  Alert,
  StyleSheet,
  Text,
  View
} from 'react-native';
import { Button } from '../../../src/components/Button';
import {
  getFeatCategory,
  getProgressionFeatChoiceRequirements,
  validateFeatPrerequisites,
  validateMulticlassPrerequisites,
  type ProgressionFeatChoiceCategory
} from '../../../src/characters/characterBuildRules';
import { reconcileCharacterProgression } from '../../../src/characters/progressionReconciliation';
import { reconcileCharacterBuild } from '../../../src/characters/buildReconciliation';
import { applyAutomaticSpeciesProgression } from '../../../src/characters/speciesChoiceRules';
import { progressionOperation } from '../../../src/characters/progressionTransaction';
import { getClassSpellcastingProfile, getSpellLevelUpChangePlan } from '../../../src/characters/spellcastingRules';
import { createId } from '../../../src/utils/id';
import { Card } from '../../../src/components/Card';
import { EldritchInvocationChoiceEditor } from '../../../src/components/EldritchInvocationChoiceEditor';
import { IssueList } from '../../../src/components/IssueList';
import { PaginatedOptionCardList } from '../../../src/components/PaginatedOptionCardList';
import { Chip } from '../../../src/components/Chip';
import { Field } from '../../../src/components/Field';
import { ProgressBar } from '../../../src/components/ProgressBar';
import { Screen } from '../../../src/components/Screen';
import {
  getCompendiumClassReference,
  getSubclassUnlockLevel
} from '../../../src/compendium/classProgression';
import { applyCompendiumItemToCharacter } from '../../../src/compendium/mapper';
import type { StoredCompendiumItem } from '../../../src/compendium/types';
import { manualSource } from '../../../src/data/mockData';
import { getTotalLevel } from '../../../src/rules-engine/characters/derivedStats';
import { useCharacterStore } from '../../../src/store/characterStore';
import { useCompendiumStore } from '../../../src/store/compendiumStore';
import { useCharacterChoiceBridge } from '../../../src/catalog/useCharacterChoiceBridge';
import { useAppTheme } from '../../../src/theme';
import { getCharacterDisplayName } from '../../../src/ui/characterIdentity';
import { getCompendiumChoiceDescription } from '../../../src/characters/creationData';
import { isPlayerCharacterClassItem } from '../../../src/characters/classSelectionRules';
import {
  findEldritchInvocationById,
  getEldritchInvocationLimit,
  getEldritchInvocationMinimumLevel,
  getEldritchInvocationPrerequisiteIssues,
  getLevelAvailableEldritchInvocations,
  getSelectedWarlockLevel,
  isEldritchInvocationRepeatable,
  isWarlockClassItem,
  validateEldritchInvocationSelection
} from '../../../src/characters/eldritchInvocationRules';
import { getEldritchInvocationCardAction, isEldritchInvocationCardDisabled } from '../../../src/characters/eldritchInvocationInteraction';
import { applyEldritchInvocationSelection } from '../../../src/characters/eldritchInvocationSelection';
import {
  applyEldritchInvocationChoices,
  validateEldritchInvocationChoices
} from '../../../src/characters/eldritchInvocationChoiceRules';
import type {
  Character,
  CharacterClass,
  CharacterEldritchInvocationChoice
} from '../../../src/types';

const getId = (
  value: string | string[] | undefined
) => Array.isArray(value) ? value[0] : value;

const stepNames = [
  'Escolher classe',
  'Novas opções',
  'Confirmar'
];

type ClassMode =
  | 'existing'
  | 'import'
  | 'manual';

const typeLabels: Record<string, string> = {
  subclass: 'Subclasse',
  feat: 'Talento',
  spell: 'Magia',
  feature: 'Feature'
};

const normalizeDisplayName = (
  value: string
): string =>
  value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase();

const deduplicateVisibleItems = (
  items: StoredCompendiumItem[]
): StoredCompendiumItem[] => {
  const seen = new Set<string>();

  return items.filter((item) => {
    const key =
      `${item.type}:${normalizeDisplayName(item.name)}`;

    if (seen.has(key)) return false;

    seen.add(key);
    return true;
  });
};

export default function LevelUpScreen() {
  const { colors } = useAppTheme();
  const id = getId(
    useLocalSearchParams().id
  );

  const character = useCharacterStore(
    (state) =>
      state.characters.find(
        (item) => item.id === id
      )
  );

  const beginProgressionTransaction = useCharacterStore(
    (state) => state.beginProgressionTransaction
  );

  const activeProgressionTransaction = useCharacterStore(
    (state) => id ? state.progressionDrafts[id] : undefined
  );

  const choiceBridge = useCharacterChoiceBridge();
  const { items, enabledSourceIds, searchItems, catalogSnapshotId } = choiceBridge;

  const hydrate = useCompendiumStore(
    (state) => state.hydrate
  );

  const isHydrated = useCompendiumStore(
    (state) => state.isHydrated
  );

  const isHydrating = useCompendiumStore(
    (state) => state.isHydrating
  );

  const [step, setStep] = useState(0);

  const [classMode, setClassMode] =
    useState<ClassMode>(
      character?.classes.length
        ? 'existing'
        : 'import'
    );

  const [
    selectedExistingClassId,
    setSelectedExistingClassId
  ] = useState(
    character?.classes[0]?.id
  );

  const [
    selectedClassItemId,
    setSelectedClassItemId
  ] = useState<string>();

  const [
    selectedSubclassItemId,
    setSelectedSubclassItemId
  ] = useState<string>();

  const [manualClass, setManualClass] =
    useState('');

  const [search, setSearch] =
    useState('');

  const [snapshotMigrationApproved, setSnapshotMigrationApproved] =
    useState(false);

  const [
    selectedAdvancementIds,
    setSelectedAdvancementIds
  ] = useState<string[]>([]);

  const [
    selectedInvocationCounts,
    setSelectedInvocationCounts
  ] = useState<Record<string, number>>(
    character?.buildChoices?.eldritchInvocationCounts ?? {}
  );
  const [
    eldritchInvocationChoices,
    setEldritchInvocationChoices
  ] = useState<CharacterEldritchInvocationChoice[]>(
    character?.buildChoices?.eldritchInvocationChoices ?? []
  );

  useEffect(() => {
    setSelectedInvocationCounts(character?.buildChoices?.eldritchInvocationCounts ?? {});
    setEldritchInvocationChoices(character?.buildChoices?.eldritchInvocationChoices ?? []);
  }, [character?.id]);

  useEffect(() => {
    if (!isHydrated && !isHydrating) {
      void hydrate();
    }
  }, [
    hydrate,
    isHydrated,
    isHydrating
  ]);

  const classItems = useMemo(
    () =>
      searchItems('', {
        types: ['class'],
        statuses: ['validated'],
        onlyEnabled: true
      })
        .filter(isPlayerCharacterClassItem)
        .filter(
          (item) =>
            !(character?.compendiumLinks ?? [])
              .some(
                (link) =>
                  link.itemId === item.id &&
                  link.status === 'active'
              )
        )
        .slice(0, 20),
    [
      character,
      enabledSourceIds,
      items,
      searchItems
    ]
  );

  if (!character || !id) {
    return (
      <Screen
        title="Personagem não encontrado"
        onBack={() => router.back()}
      />
    );
  }

  const currentLevel =
    getTotalLevel(character);

  const selectedExisting =
    character.classes.find(
      (entry) =>
        entry.id ===
        selectedExistingClassId
    );

  const selectedClassItem = items.find(
    (item) =>
      item.id === selectedClassItemId
  );

  const selectedExistingClassLink =
    (character.compendiumLinks ?? []).find(
      (link) =>
        link.appliedAs === 'class' &&
        link.status === 'active' &&
        link.appliedEntityId ===
          selectedExistingClassId
    );

  const selectedExistingClassItem =
    items.find(
      (item) =>
        item.id ===
        selectedExistingClassLink?.itemId
    );


  const snapshotMismatch = Boolean(
    character.catalogSnapshotId &&
    catalogSnapshotId &&
    character.catalogSnapshotId !== catalogSnapshotId
  );
  const existingClassUnavailable = Boolean(
    selectedExistingClassLink &&
    (!selectedExistingClassItem || selectedExistingClassItem.status !== 'validated')
  );

  const targetClassItem =
    classMode === 'existing'
      ? selectedExistingClassItem
      : classMode === 'import'
        ? selectedClassItem
        : undefined;

  const targetClassLevel =
    classMode === 'existing'
      ? (selectedExisting?.level ?? 0) + 1
      : classMode === 'import'
        ? 1
        : 1;

  const targetClassReference =
    targetClassItem?.importItemId;

  const existingSubclassForTarget =
    (character.compendiumLinks ?? [])
      .filter(
        (link) =>
          link.appliedAs === 'subclass' &&
          link.status === 'active'
      )
      .map((link) =>
        items.find(
          (item) => item.id === link.itemId
        )
      )
      .filter(
        (
          item
        ): item is StoredCompendiumItem =>
          Boolean(item)
      )
      .some(
        (item) =>
          getCompendiumClassReference(item) ===
          targetClassReference
      );

  const subclassItems =
    targetClassItem &&
    !existingSubclassForTarget
      ? searchItems('', {
          types: ['subclass'],
          statuses: ['validated'],
          onlyEnabled: true
        })
          .filter(
            (item) =>
              getCompendiumClassReference(item) ===
                targetClassReference &&
              getSubclassUnlockLevel(item) <=
                targetClassLevel
          )
          .slice(0, 20)
      : [];

  const selectedSubclassItem =
    items.find(
      (item) =>
        item.id === selectedSubclassItemId
    );

  const currentClassEntries = character.classes.flatMap((classEntity) => {
    const link = (character.compendiumLinks ?? []).find(
      (entry) => entry.appliedAs === 'class' && entry.appliedEntityId === classEntity.id && entry.status === 'active'
    );
    const classItem = items.find((candidate) => candidate.id === link?.itemId);
    return classItem ? [{ item: classItem, level: classEntity.level }] : [];
  });

  const projectedClassEntries = currentClassEntries.map((entry) =>
    classMode === 'existing' && entry.item.id === selectedExistingClassItem?.id
      ? { ...entry, level: entry.level + 1 }
      : entry
  );
  if (
    classMode === 'import' &&
    selectedClassItem &&
    !projectedClassEntries.some((entry) => entry.item.id === selectedClassItem.id)
  ) {
    projectedClassEntries.push({ item: selectedClassItem, level: 1 });
  }

  const currentFeatRequirements = getProgressionFeatChoiceRequirements(currentClassEntries, items);
  const projectedFeatRequirements = getProgressionFeatChoiceRequirements(projectedClassEntries, items);
  const newlyUnlockedFeatRequirements: Record<ProgressionFeatChoiceCategory, number> = {
    general: Math.max(0, projectedFeatRequirements.general - currentFeatRequirements.general),
    fightingStyle: Math.max(0, projectedFeatRequirements.fightingStyle - currentFeatRequirements.fightingStyle),
    epicBoon: Math.max(0, projectedFeatRequirements.epicBoon - currentFeatRequirements.epicBoon)
  };

  const selectedAdvancements = selectedAdvancementIds
    .map((itemId) => items.find((item) => item.id === itemId))
    .filter((item): item is StoredCompendiumItem => Boolean(item));

  const unavailableProgressionReferences = Array.from(new Set([
    ...(classMode === 'import' && selectedClassItemId ? [selectedClassItemId] : []),
    ...(selectedSubclassItemId ? [selectedSubclassItemId] : []),
    ...selectedAdvancementIds,
    ...Object.keys(selectedInvocationCounts),
    ...eldritchInvocationChoices.flatMap((choice) => [
      choice.invocationItemId,
      choice.targetCantripItemId,
      choice.originFeatItemId,
      choice.familiarCreatureItemId,
      ...(choice.cantripItemIds ?? []),
      ...(choice.ritualSpellItemIds ?? [])
    ]).filter((reference): reference is string => Boolean(reference))
  ])).filter((reference) => {
    const item = items.find((candidate) => candidate.id === reference);
    return !item || item.status !== 'validated';
  });

  const selectedFeatCountByCategory = (category: ProgressionFeatChoiceCategory): number =>
    selectedAdvancements.filter((item) => getFeatCategory(item) === category).length;

  const enabledSources = new Set(enabledSourceIds);
  const advancementItems = deduplicateVisibleItems(
    items
      .filter((item) => item.type === 'feat')
      .filter((item) => item.status !== 'disabled' && enabledSources.has(item.sourceId))
      .filter((item) => {
        const category = getFeatCategory(item);
        return category !== 'origin' && category !== 'other' && newlyUnlockedFeatRequirements[category] > 0;
      })
      .filter((item) => !search.trim() || item.name.toLowerCase().includes(search.trim().toLowerCase()))
      .filter((item) => {
        const currentCopies = (character.compendiumLinks ?? []).filter(
          (link) => link.itemId === item.id && link.appliedAs === 'feat' && link.status === 'active'
        ).length;
        return validateFeatPrerequisites({
          featItem: item,
          totalLevel: currentLevel + 1,
          abilities: character.abilities,
          proficiencies: character.proficiencies,
          classEntries: projectedClassEntries,
          allItems: items,
          character,
          currentCopies
        }).length === 0;
      })
  );

  const featSelectionIssues = (['general', 'fightingStyle', 'epicBoon'] as ProgressionFeatChoiceCategory[])
    .flatMap((category) => {
      const required = newlyUnlockedFeatRequirements[category];
      const current = selectedFeatCountByCategory(category);
      if (current === required) return [];
      const labels: Record<ProgressionFeatChoiceCategory, string> = {
        general: 'General Feat',
        fightingStyle: 'Fighting Style',
        epicBoon: 'Epic Boon'
      };
      return [{
        severity: 'error' as const,
        code: 'LEVEL_UP_FEAT_CHOICE_COUNT',
        message: `Escolha exatamente ${required} opção(ões) de ${labels[category]}. Selecionadas: ${current}.`
      }];
    });

  const currentWarlockLevel = getSelectedWarlockLevel(currentClassEntries);
  const projectedWarlockLevel = getSelectedWarlockLevel(projectedClassEntries);
  const targetIsWarlock = Boolean(targetClassItem && isWarlockClassItem(targetClassItem));
  const currentInvocationLimit = getEldritchInvocationLimit(currentWarlockLevel, currentClassEntries, items);
  const projectedInvocationLimit = getEldritchInvocationLimit(projectedWarlockLevel, projectedClassEntries, items);
  const selectedInvocationTotal = Object.values(selectedInvocationCounts).reduce(
    (sum, count) => sum + Math.max(0, Math.floor(count)),
    0
  );
  const invocationCandidates = getLevelAvailableEldritchInvocations(items, enabledSourceIds, projectedWarlockLevel);
  const currentInvocationCounts = character.buildChoices?.eldritchInvocationCounts ?? {};
  const warlockClassEntityIds = new Set(
    character.classes.filter((entry) => normalizeDisplayName(entry.name) === 'warlock').map((entry) => entry.id)
  );
  const knownWarlockCantripItemIds = (character.compendiumLinks ?? [])
    .filter((link) => link.appliedAs === 'spell' && link.status === 'active')
    .filter((link) => {
      const spellEntity = character.spells.find((spell) => spell.id === link.appliedEntityId);
      const spellItem = items.find((item) => item.id === link.itemId && item.type === 'spell');
      return Boolean(spellEntity && spellItem && Number(spellItem.normalizedJson.level ?? 0) === 0 && spellEntity.spellcastingClassId && warlockClassEntityIds.has(spellEntity.spellcastingClassId));
    })
    .map((link) => link.itemId);
  const mainOriginFeatItemId = (character.compendiumLinks ?? []).find(
    (link) => link.appliedAs === 'feat' && link.status === 'active' && link.appliedEntityId === character.originFeatId
  )?.itemId;
  const removedInvocationCount = Object.entries(currentInvocationCounts).reduce(
    (sum, [itemId, count]) => sum + Math.max(0, Math.floor(count) - Math.floor(selectedInvocationCounts[itemId] ?? 0)),
    0
  );
  const invocationIssues = targetIsWarlock
    ? [
        ...validateEldritchInvocationSelection(projectedClassEntries, items, enabledSourceIds, selectedInvocationCounts),
        ...(removedInvocationCount > 1 ? [{ severity: 'error' as const, code: 'WARLOCK_INVOCATION_REPLACEMENT_LIMIT', message: 'Ao ganhar um nível de Warlock, apenas uma invocation já conhecida pode ser substituída.' }] : [])
      ]
    : [];
  const invocationChoiceIssues = targetIsWarlock
    ? validateEldritchInvocationChoices(selectedInvocationCounts, eldritchInvocationChoices, items, enabledSourceIds, {
        knownWarlockCantripItemIds,
        requireKnownWarlockCantrip: true,
        selectedOriginFeatItemIds: mainOriginFeatItemId ? [mainOriginFeatItemId] : []
      })
    : [];
  const allInvocationIssues = [...invocationIssues, ...invocationChoiceIssues];

  const subclassChoiceRequired = Boolean(
    targetClassItem &&
    !existingSubclassForTarget &&
    subclassItems.length > 0
  );
  const subclassChoiceValid =
    !subclassChoiceRequired || Boolean(selectedSubclassItem && selectedSubclassItem.status === 'validated');
  const levelUpChoiceValid =
    unavailableProgressionReferences.length === 0 &&
    subclassChoiceValid &&
    featSelectionIssues.length === 0 &&
    allInvocationIssues.length === 0;


  const classChoiceValid =
    (
      classMode === 'existing' &&
      Boolean(selectedExisting) &&
      !existingClassUnavailable
    ) ||
    (
      classMode === 'import' &&
      Boolean(selectedClassItem && selectedClassItem.status === 'validated')
    ) ||
    (
      classMode === 'manual' &&
      Boolean(manualClass.trim())
    );

  const handleBack = () => {
    if (step > 0) {
      setStep((current) => current - 1);
    } else {
      router.back();
    }
  };

  const confirm = () => {
    if (existingClassUnavailable) {
      Alert.alert(
        'Conteúdo indisponível',
        'A classe vinculada ao personagem está desativada ou não possui payload disponível no catálogo atual. Reative a entidade em Gerenciar conteúdo antes de continuar.'
      );
      return;
    }
    if (unavailableProgressionReferences.length) {
      Alert.alert(
        'Escolha indisponível',
        'Uma classe, subclasse, feat, invocation ou escolha vinculada foi desativada no catálogo ou no compêndio local. Remova a escolha ou reative sua fonte antes de continuar.'
      );
      return;
    }
    if (!subclassChoiceValid) {
      Alert.alert(
        'Subclasse obrigatória',
        `Escolha uma subclasse compatível com ${targetClassItem?.name ?? 'a classe selecionada'} antes de continuar.`
      );
      return;
    }
    if (snapshotMismatch && !snapshotMigrationApproved) {
      Alert.alert(
        'Snapshot de regras diferente',
        'Este personagem foi criado com outro snapshot do catálogo. A migração precisa ser confirmada explicitamente antes do level up.',
        [
          { text: 'Cancelar', style: 'cancel' },
          { text: 'Autorizar migração', onPress: () => setSnapshotMigrationApproved(true) }
        ]
      );
      return;
    }
    let next: Character = character;

    const prerequisiteIssues = [
      ...validateMulticlassPrerequisites(projectedClassEntries.map((entry) => entry.item), character.abilities),
      ...selectedAdvancements
        .filter((item) => item.type === 'feat')
        .flatMap((featItem) => validateFeatPrerequisites({
          featItem,
          totalLevel: currentLevel + 1,
          abilities: character.abilities,
          proficiencies: character.proficiencies,
          classEntries: projectedClassEntries,
          allItems: items,
          character,
          currentCopies: (character.compendiumLinks ?? []).filter(
            (link) => link.itemId === featItem.id && link.appliedAs === 'feat' && link.status === 'active'
          ).length
        }))
    ];
    const choiceIssues = [...featSelectionIssues, ...allInvocationIssues];
    if (choiceIssues.length) {
      Alert.alert('Escolhas obrigatórias pendentes', choiceIssues.map((entry) => entry.message).join('\n'));
      return;
    }
    if (prerequisiteIssues.length) {
      Alert.alert('Pré-requisitos não atendidos', prerequisiteIssues.map((issue) => issue.message).join('\n'));
      return;
    }

    if (
      classMode === 'existing' &&
      selectedExisting
    ) {
      const classes = next.classes.map(
        (entry) =>
          entry.id === selectedExisting.id
            ? {
                ...entry,
                level: entry.level + 1
              }
            : entry
      );

      next = {
        ...next,
        classes,
        level: classes.reduce(
          (sum, entry) =>
            sum + entry.level,
          0
        )
      };
    } else if (
      classMode === 'import' &&
      selectedClassItem
    ) {
      const result =
        applyCompendiumItemToCharacter(
          next,
          selectedClassItem
        );

      if (result.ok) {
        next = result.character;
      }
    } else if (
      classMode === 'manual' &&
      manualClass.trim()
    ) {
      const newClass: CharacterClass = {
        id: createId('class'),
        name: manualClass.trim(),
        level: 1,
        source: manualSource
      };

      const classes = [
        ...next.classes,
        newClass
      ];

      next = {
        ...next,
        classes,
        level: classes.reduce(
          (sum, entry) =>
            sum + entry.level,
          0
        )
      };
    }

    if (selectedSubclassItem) {
      const result =
        applyCompendiumItemToCharacter(
          next,
          selectedSubclassItem
        );

      if (result.ok) {
        next = result.character;
      }
    }

    for (const item of selectedAdvancements) {
      const explicitlyApproved: StoredCompendiumItem = item.status === 'validated'
        ? item
        : {
            ...item,
            status: 'validated',
            reviewDecision: 'approved',
            reviewedBy: 'Escolha explícita durante o level up',
            reviewedAt: new Date().toISOString()
          };
      const result = applyCompendiumItemToCharacter(next, explicitlyApproved);
      if (result.ok) next = result.character;
    }

    if (targetIsWarlock) {
      next = applyEldritchInvocationSelection(next, selectedInvocationCounts, items).character;
      next = applyEldritchInvocationChoices(next, eldritchInvocationChoices, items).character;
    }

    const reconciliation = reconcileCharacterProgression(next, items);
    next = reconciliation.character;
    next = applyAutomaticSpeciesProgression(next, items).character;
    const buildReconciliation = reconcileCharacterBuild(next, items);
    next = buildReconciliation.character;

    const beforeProfile = selectedExistingClassItem && selectedExisting
      ? getClassSpellcastingProfile(selectedExistingClassItem, selectedExisting.level)
      : undefined;
    const afterProfile = targetClassItem
      ? getClassSpellcastingProfile(targetClassItem, targetClassLevel)
      : undefined;
    const spellPlan = getSpellLevelUpChangePlan(beforeProfile, afterProfile);
    if (spellPlan && spellPlan.replacementsAllowed > 0) {
      next = {
        ...next,
        pendingChoices: [
          ...(next.pendingChoices ?? []),
          {
            id: createId('pendingChoice'),
            kind: 'spellReplacement' as const,
            title: `Troca opcional de magia de ${spellPlan.className}`,
            description: `Você pode trocar até ${spellPlan.replacementsAllowed} magia conhecida ao concluir este nível.`,
            sourceItemId: spellPlan.classItemId,
            sourceEntityId: selectedExisting?.id,
            requiredCount: spellPlan.replacementsAllowed,
            currentCount: 0,
            status: 'pending' as const,
            createdAt: new Date().toISOString()
          }
        ]
      };
    }

    next = {
      ...next,
      catalogSnapshotId: catalogSnapshotId ?? next.catalogSnapshotId
    };

    const operations = [
      progressionOperation('levelUp', `${getCharacterDisplayName(character)}: nível ${currentLevel} → ${getTotalLevel(next)}`, {
        metadata: {
          classMode,
          beforeLevel: currentLevel,
          afterLevel: getTotalLevel(next),
          selectedClass: targetClassItem?.name ?? selectedExisting?.name ?? manualClass.trim()
        }
      }),
      progressionOperation('reconciliation', 'Reconciliação automática de features, recursos e escolhas', {
        metadata: {
          appliedFeatures: reconciliation.appliedFeatureCount,
          removedFeatures: reconciliation.removedFeatureCount,
          pendingChoices: (next.pendingChoices ?? []).length
        }
      }),
      ...(snapshotMismatch ? [progressionOperation('snapshotMigration', 'Migração explícita do snapshot de regras', {
        metadata: {
          previousSnapshot: character.catalogSnapshotId ?? '',
          nextSnapshot: catalogSnapshotId ?? ''
        }
      })] : [])
    ];

    const transaction = beginProgressionTransaction(character.id, next, {
      replaceExisting: false,
      kind: 'levelUp',
      targetCatalogSnapshotId: catalogSnapshotId,
      migrationApproved: !snapshotMismatch || snapshotMigrationApproved,
      operations
    });
    if (!transaction) {
      Alert.alert('Não foi possível preparar a transação', 'O personagem não está disponível no store.');
      return;
    }
    if (activeProgressionTransaction && transaction.id === activeProgressionTransaction.id) {
      Alert.alert(
        'Transação já em andamento',
        'Já existe um preview de progressão para este personagem. Revise, conclua ou descarte a transação atual antes de criar outra.',
        [{ text: 'Abrir transação', onPress: () => router.replace(`/characters/${character.id}/progression`) }]
      );
      return;
    }

    const details = [
      `${getCharacterDisplayName(character)} ficará no nível ${getTotalLevel(next)} após o commit.`,
      reconciliation.appliedFeatureCount
        ? `${reconciliation.appliedFeatureCount} feature(s) adicionada(s) automaticamente.`
        : undefined,
      reconciliation.removedFeatureCount
        ? `${reconciliation.removedFeatureCount} feature(s) removida(s) pela reconciliação.`
        : undefined,
      (next.pendingChoices ?? []).length ? `${next.pendingChoices?.length} escolha(s) pendente(s) registrada(s) para conclusão posterior.` : undefined,
      projectedClassEntries.some(({ item }) => {
        const spellcasting = item.normalizedJson.spellcasting;
        return Boolean(spellcasting && typeof spellcasting === 'object' && !Array.isArray(spellcasting) && Object.keys(spellcasting).length);
      })
        ? 'Revise as magias na tela de Magias; os limites podem ter mudado.'
        : undefined
    ]
      .filter(Boolean)
      .join('\n');

    Alert.alert(
      'Transação de progressão preparada',
      details,
      [
        {
          text: 'Revisar transação',
          onPress: () => router.replace(`/characters/${character.id}/progression`)
        }
      ]
    );
  };

  const toggleAdvancement = (item: StoredCompendiumItem) => {
    const selected = selectedAdvancementIds.includes(item.id);
    if (selected) {
      setSelectedAdvancementIds((current) => current.filter((itemId) => itemId !== item.id));
      return;
    }
    const category = getFeatCategory(item);
    if (category === 'origin' || category === 'other') return;
    if (selectedFeatCountByCategory(category) >= newlyUnlockedFeatRequirements[category]) return;
    setSelectedAdvancementIds((current) => [...current, item.id]);
  };

  const visibleInvocationItems = [
    ...Object.keys(selectedInvocationCounts)
      .map((itemId) => findEldritchInvocationById(items, itemId))
      .filter((item): item is StoredCompendiumItem => Boolean(item)),
    ...invocationCandidates.filter(
      (item) => !Object.prototype.hasOwnProperty.call(selectedInvocationCounts, item.id)
    )
  ];

  const addInvocation = (item: StoredCompendiumItem) => {
    const current = selectedInvocationCounts[item.id] ?? 0;
    if (selectedInvocationTotal >= projectedInvocationLimit) return;
    if (getEldritchInvocationPrerequisiteIssues(item, projectedWarlockLevel, selectedInvocationCounts, invocationCandidates).length) return;
    if (current > 0 && !isEldritchInvocationRepeatable(item)) return;
    setSelectedInvocationCounts((counts) => ({ ...counts, [item.id]: (counts[item.id] ?? 0) + 1 }));
  };

  const removeInvocation = (itemId: string) => {
    const currentCount = selectedInvocationCounts[itemId] ?? 0;
    setSelectedInvocationCounts((counts) => {
      const current = counts[itemId] ?? 0;
      if (current <= 1) return Object.fromEntries(Object.entries(counts).filter(([idValue]) => idValue !== itemId));
      return { ...counts, [itemId]: current - 1 };
    });
    setEldritchInvocationChoices((choices) => choices.filter(
      (choice) => choice.invocationItemId !== itemId || choice.instanceIndex < Math.max(0, currentCount - 1)
    ));
  };

  const toggleInvocation = (item: StoredCompendiumItem) => {
    if (getEldritchInvocationCardAction(selectedInvocationCounts[item.id] ?? 0) === 'remove') {
      removeInvocation(item.id);
      return;
    }
    addInvocation(item);
  };

  const renderFeatCategory = (
    category: ProgressionFeatChoiceCategory,
    title: string
  ) => {
    const required = newlyUnlockedFeatRequirements[category];
    if (required <= 0) return null;
    const candidates = advancementItems.filter((item) => getFeatCategory(item) === category);
    const selectedCount = selectedFeatCountByCategory(category);
    return (
      <Card
        variant="outlined"
        title={`${title} (${selectedCount}/${required})`}
        subtitle="Somente opções para as quais o personagem atende aos requisitos são exibidas."
      >
        <PaginatedOptionCardList
          items={candidates}
          keyExtractor={(item) => item.id}
          titleForItem={(item) => item.name}
          descriptionForItem={getCompendiumChoiceDescription}
          metaForItem={(item) => {
            const prerequisite = String(item.normalizedJson.prerequisite ?? item.normalizedJson.prerequisites ?? '').trim();
            if (selectedAdvancementIds.includes(item.id)) return `Selecionado${prerequisite ? ` · Requisitos: ${prerequisite}` : ''}`;
            return prerequisite ? `Requisitos: ${prerequisite}` : 'Elegível para esta progressão';
          }}
          isSelected={(item) => selectedAdvancementIds.includes(item.id)}
          isDisabled={(item) => !selectedAdvancementIds.includes(item.id) && selectedCount >= required}
          onPressItem={toggleAdvancement}
          pageSize={8}
          resetKey={`${category}:${selectedCount}:${search}`}
          emptyText={`Nenhuma opção elegível de ${title} foi encontrada.`}
        />
      </Card>
    );
  };

  const footer = (
    <View style={styles.footerRow}>
      <View style={styles.flex}>
        <Button
          label={
            step === 0
              ? 'Cancelar'
              : 'Voltar'
          }
          icon="arrow-back"
          variant="text"
          onPress={handleBack}
        />
      </View>

      <View style={styles.flex}>
        <Button
          label={
            step === 2
              ? 'Preparar transação'
              : step === 1
                ? 'Revisar'
                : 'Continuar'
          }
          icon={
            step === 2
              ? 'checkmark'
              : 'arrow-forward'
          }
          disabled={
            (step === 0 && !classChoiceValid) ||
            (step === 1 && !levelUpChoiceValid)
          }
          onPress={
            step === 2
              ? confirm
              : () =>
                  setStep(
                    (current) =>
                      current + 1
                  )
          }
        />
      </View>
    </View>
  );

  if (choiceBridge.status !== 'ready') {
    return (
      <Screen
        title={choiceBridge.status === 'failed' ? 'Catálogo indisponível' : 'Preparando progressão'}
        subtitle={choiceBridge.status === 'failed'
          ? 'O level up foi bloqueado para evitar alterações sem o snapshot de regras.'
          : 'Carregando catálogo e compêndio local...'}
        onBack={handleBack}
      >
        <Card
          variant="outlined"
          title={choiceBridge.status === 'failed' ? 'Não foi possível carregar as regras' : 'Sincronizando progressão'}
          subtitle={choiceBridge.status === 'failed'
            ? 'Verifique o catálogo em Ajustes > Gerenciar conteúdo e tente novamente.'
            : 'As classes e opções de progressão serão liberadas quando as duas fontes estiverem prontas.'}
        />
      </Screen>
    );
  }

  return (
    <Screen
      eyebrow={`Nível ${currentLevel} → ${currentLevel + 1}`}
      title={stepNames[step]}
      subtitle="Nada será publicado até a revisão final e o commit atômico da transação."
      onBack={handleBack}
      footer={footer}
    >
      <ProgressBar
        value={(step + 1) / 3}
        label={`Etapa ${step + 1} de 3`}
      />

      {activeProgressionTransaction ? (
        <Card
          variant="hero"
          title="Transação de progressão em andamento"
          subtitle="O personagem publicado permanece intacto. Abra a central para resolver pendências, revisar o diff ou descartar o rascunho."
        >
          <Button
            label="Abrir transação atual"
            icon="git-compare-outline"
            onPress={() => router.replace(`/characters/${character.id}/progression`)}
          />
        </Card>
      ) : null}

      {snapshotMismatch ? (
        <Card
          variant="outlined"
          title="Migração de snapshot necessária"
          subtitle={snapshotMigrationApproved
            ? 'Migração autorizada. O novo snapshot será gravado somente ao confirmar o level up.'
            : 'O personagem usa outro snapshot do catálogo. Autorize explicitamente a migração para o snapshot atual.'}
        >
          <Button
            label={snapshotMigrationApproved ? 'Migração autorizada' : 'Autorizar migração'}
            icon="git-compare-outline"
            variant={snapshotMigrationApproved ? 'text' : 'outlined'}
            onPress={() => setSnapshotMigrationApproved(true)}
          />
        </Card>
      ) : null}

      {existingClassUnavailable ? (
        <Card
          variant="outlined"
          title="Classe indisponível no catálogo atual"
          subtitle="A progressão foi bloqueada para evitar alteração silenciosa. Reative a classe ou sua fonte em Gerenciar conteúdo."
        />
      ) : null}

      {step === 0 ? (
        <>
          {character.classes.length ? (
            <Card
              variant={
                classMode === 'existing'
                  ? 'hero'
                  : 'outlined'
              }
              title="Continuar em uma classe"
              subtitle="Aumenta em 1 o nível da classe escolhida."
            >
              <View style={styles.chips}>
                {character.classes.map(
                  (entry) => (
                    <Chip
                      key={entry.id}
                      label={`${entry.name} ${entry.level} → ${entry.level + 1}`}
                      selected={
                        classMode ===
                          'existing' &&
                        selectedExistingClassId ===
                          entry.id
                      }
                      onPress={() => {
                        setClassMode(
                          'existing'
                        );
                        setSelectedExistingClassId(
                          entry.id
                        );
                        setSelectedSubclassItemId(
                          undefined
                        );
                      }}
                    />
                  )
                )}
              </View>
            </Card>
          ) : null}

          <Card
            variant={
              classMode === 'import'
                ? 'hero'
                : 'outlined'
            }
            title="Adicionar multiclasse do compêndio"
            subtitle="Começa a nova classe no nível 1 usando uma entrada validada."
          >
            <View style={styles.chips}>
              {classItems.map((item) => (
                <Chip
                  key={item.id}
                  label={item.name}
                  selected={
                    classMode === 'import' &&
                    selectedClassItemId ===
                      item.id
                  }
                  onPress={() => {
                    setClassMode('import');
                    setSelectedClassItemId(
                      item.id
                    );
                    setSelectedSubclassItemId(
                      undefined
                    );
                  }}
                />
              ))}
            </View>

            {classItems.length === 0 ? (
              <Text
                style={[
                  styles.muted,
                  {
                    color:
                      colors.onSurfaceVariant
                  }
                ]}
              >
                Nenhuma nova classe validada disponível.
              </Text>
            ) : null}

            <Button
              label="Abrir compêndio"
              icon="library-outline"
              variant="outlined"
              onPress={() =>
                router.push('/compendium')
              }
            />
          </Card>

          <Button
            label={
              classMode === 'manual'
                ? 'Entrada manual selecionada'
                : 'Usar classe manual'
            }
            icon="create-outline"
            variant="text"
            onPress={() => {
              setClassMode('manual');
              setSelectedSubclassItemId(
                undefined
              );
            }}
          />

          {classMode === 'manual' ? (
            <Field
              label="Nome da nova classe"
              value={manualClass}
              onChangeText={setManualClass}
              placeholder="Classe não encontrada no compêndio"
            />
          ) : null}
        </>
      ) : null}

      {step === 1 ? (
        <>
          {unavailableProgressionReferences.length ? (
            <Card
              variant="outlined"
              title="Escolha de progressão indisponível"
              subtitle="Uma seleção anterior foi desativada no catálogo ou no compêndio local. Remova-a ou reative sua fonte antes de confirmar o nível."
            />
          ) : null}

          {targetClassItem &&
          targetClassLevel >= 3 &&
          !existingSubclassForTarget ? (
            <Card
              variant="hero"
              title="Escolha de subclasse"
              subtitle={`Subclasses compatíveis com ${targetClassItem.name} no nível ${targetClassLevel}.`}
            >
              <PaginatedOptionCardList
                items={subclassItems}
                keyExtractor={(item) => item.id}
                titleForItem={(item) => item.name}
                descriptionForItem={getCompendiumChoiceDescription}
                metaForItem={(item) => `Disponível a partir do nível ${getSubclassUnlockLevel(item)} da classe`}
                isSelected={(item) => selectedSubclassItemId === item.id}
                onPressItem={(item) => setSelectedSubclassItemId((current) => current === item.id ? undefined : item.id)}
                pageSize={8}
                resetKey={`subclasses:${targetClassItem.id}:${targetClassLevel}`}
                emptyText="Nenhuma subclasse validada compatível foi encontrada."
              />
            </Card>
          ) : null}

          <Card
            variant="filled"
            title="Escolhas liberadas neste nível"
            subtitle="Features determinísticas são aplicadas automaticamente. Opções bloqueadas continuam visíveis para mostrar nível e pré-requisitos."
          >
            <Field
              label="Buscar opções elegíveis"
              value={search}
              onChangeText={setSearch}
              placeholder="Ex.: Defense, Ability Score Improvement"
            />
          </Card>

          {renderFeatCategory('fightingStyle', 'Fighting Style')}
          {renderFeatCategory('general', 'General Feat')}
          {renderFeatCategory('epicBoon', 'Epic Boon')}

          {targetIsWarlock ? (
            <Card
              variant="outlined"
              title={`Eldritch Invocations (${selectedInvocationTotal}/${projectedInvocationLimit})`}
              subtitle={`Warlock ${currentWarlockLevel} → ${projectedWarlockLevel}. Você pode substituir no máximo uma invocation conhecida ao ganhar este nível.`}
            >
              <PaginatedOptionCardList
                items={visibleInvocationItems}
                keyExtractor={(item) => item.id}
                titleForItem={(item) => `${item.name}${(selectedInvocationCounts[item.id] ?? 0) > 0 ? ` ×${selectedInvocationCounts[item.id]}` : ''}`}
                descriptionForItem={getCompendiumChoiceDescription}
                metaForItem={(item) => {
                  const prerequisite = String(item.normalizedJson.prerequisite ?? '').trim();
                  const selected = (selectedInvocationCounts[item.id] ?? 0) > 0;
                  return `Nível mínimo ${getEldritchInvocationMinimumLevel(item)}${selected ? ' · toque para remover uma' : ''}${prerequisite ? ` · ${prerequisite}` : ''}`;
                }}
                isSelected={(item) => (selectedInvocationCounts[item.id] ?? 0) > 0}
                isDisabled={(item) => isEldritchInvocationCardDisabled({
                  selectedCount: selectedInvocationCounts[item.id] ?? 0,
                  selectedTotal: selectedInvocationTotal,
                  limit: projectedInvocationLimit,
                  hasPrerequisiteIssues: getEldritchInvocationPrerequisiteIssues(item, projectedWarlockLevel, selectedInvocationCounts, invocationCandidates).length > 0
                })}
                onPressItem={toggleInvocation}
                selectedAccessibilityHint="Toque para remover uma seleção."
                pageSize={8}
                resetKey={`level-up-invocations:${projectedWarlockLevel}:${selectedInvocationTotal}`}
                emptyText="Nenhuma Eldritch Invocation foi encontrada nas fontes ativas."
              />
              {Object.entries(selectedInvocationCounts).map(([itemId, count]) => {
                const item = findEldritchInvocationById(items, itemId);
                if (!item || count <= 0) return null;
                return (
                  <View key={`level-up-selected-${itemId}`} style={styles.selectionRow}>
                    <Text style={[styles.selectionText, { color: colors.onSurface }]}>{item.name} ×{count}</Text>
                    {isEldritchInvocationRepeatable(item) && selectedInvocationTotal < projectedInvocationLimit ? (
                      <Button label="Adicionar outra" variant="text" compact onPress={() => addInvocation(item)} />
                    ) : null}
                    <Button label="Remover uma" variant="text" compact onPress={() => removeInvocation(itemId)} />
                  </View>
                );
              })}
              <EldritchInvocationChoiceEditor
                items={items}
                enabledSourceIds={enabledSourceIds}
                selectedCounts={selectedInvocationCounts}
                choices={eldritchInvocationChoices}
                onChange={setEldritchInvocationChoices}
                knownWarlockCantripItemIds={knownWarlockCantripItemIds}
                selectedOriginFeatItemIds={mainOriginFeatItemId ? [mainOriginFeatItemId] : []}
              />
              {allInvocationIssues.length ? <IssueList issues={allInvocationIssues} /> : null}
            </Card>
          ) : null}

          {featSelectionIssues.length ? <IssueList issues={featSelectionIssues} /> : null}

          {Object.values(newlyUnlockedFeatRequirements).every((count) => count === 0) && !targetIsWarlock ? (
            <Card
              title="Nenhuma escolha adicional"
              subtitle="As features fixas deste nível serão aplicadas automaticamente ao confirmar."
            />
          ) : null}
        </>
      ) : null}

      {step === 2 ? (
        <>
          <Card
            variant="hero"
            title={`${getCharacterDisplayName(character)} · nível ${currentLevel + 1}`}
            subtitle="A progressão será resolvida usando os vínculos do compêndio."
          >
            <Text
              style={[
                styles.reviewTitle,
                {
                  color:
                    colors.onPrimaryContainer
                }
              ]}
            >
              Progressão de classe
            </Text>

            <Text
              style={[
                styles.reviewText,
                {
                  color:
                    colors.onPrimaryContainer
                }
              ]}
            >
              {classMode === 'existing'
                ? `${selectedExisting?.name} ${selectedExisting?.level} → ${(selectedExisting?.level ?? 0) + 1}`
                : classMode === 'import'
                  ? `${selectedClassItem?.name} 1 (multiclasse)`
                  : `${manualClass} 1 (manual)`}
            </Text>

            {selectedSubclassItem ? (
              <Text
                style={[
                  styles.reviewText,
                  {
                    color:
                      colors.onPrimaryContainer
                  }
                ]}
              >
                Subclasse: {selectedSubclassItem.name}
              </Text>
            ) : null}
          </Card>

          <Card
            variant="filled"
            title={`Escolhas adicionais (${selectedAdvancements.length})`}
          >
            {selectedAdvancements.length ? (
              selectedAdvancements.map(
                (item) => (
                  <Text
                    key={item.id}
                    style={[
                      styles.reviewText,
                      {
                        color:
                          colors.onSurface
                      }
                    ]}
                  >
                    • {item.name} ·{' '}
                    {typeLabels[item.type] ??
                      item.type}
                  </Text>
                )
              )
            ) : (
              <Text
                style={[
                  styles.muted,
                  {
                    color:
                      colors.onSurfaceVariant
                  }
                ]}
              >
                Nenhuma escolha adicional selecionada.
              </Text>
            )}
          </Card>

          <Text
            style={[
              styles.muted,
              {
                color:
                  colors.onSurfaceVariant
              }
            ]}
          >
            Features determinísticas já obtidas pela classe e subclasse serão adicionadas automaticamente sem duplicação.
          </Text>
        </>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  footerRow: {
    width: '100%',
    maxWidth: 760,
    alignSelf: 'center',
    flexDirection: 'row',
    gap: 10
  },
  flex: {
    flex: 1,
    minWidth: 130
  },
  chips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8
  },
  muted: {
    fontSize: 13,
    lineHeight: 19
  },
  reviewTitle: {
    fontSize: 12,
    lineHeight: 17,
    fontWeight: '800'
  },
  reviewText: {
    fontSize: 15,
    lineHeight: 22,
    fontWeight: '700'
  },
  selectionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8
  },
  selectionText: {
    flex: 1,
    fontSize: 13,
    lineHeight: 19,
    fontWeight: '700'
  }
});
