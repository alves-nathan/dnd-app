import { useMemo, useState } from 'react';
import { Alert, Share, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import * as DocumentPicker from 'expo-document-picker';
import { File } from 'expo-file-system';
import { Screen } from '../src/components/Screen';
import { Card } from '../src/components/Card';
import { Field } from '../src/components/Field';
import { Button } from '../src/components/Button';
import { IssueList } from '../src/components/IssueList';
import { useCharacterStore } from '../src/store/characterStore';
import { usePortableRestoreSessionStore } from '../src/store/portableRestoreSessionStore';
import { useCombatScenarioStore } from '../src/store/combatScenarioStore';
import { useBuildPresetStore } from '../src/store/buildPresetStore';
import { useBuildHistoryStore } from '../src/store/buildHistoryStore';
import { useCatalogStore } from '../src/store/catalogStore';
import {
  backupToJson,
  buildCharacterBackupFileName,
  createCharacterDataBackup,
  parseCharacterDataBackup,
  restoreCharacterDataBackup,
  summarizeCharacterBackup
} from '../src/backup/characterBackup';
import {
  comparePortableCatalogAudit,
  createPortableCatalogAuditSection,
  summarizePortableCatalogAudit,
  validatePortableCatalogAuditSection
} from '../src/backup/portableCatalogBackup';
import { getCharacterDisplayName } from '../src/ui/characterIdentity';
import { preparePortableRestoreSession } from '../src/backup/portableRestoreSession';
import { capturePortableRestoreCheckpoint } from '../src/backup/portableRestoreSessionExecutor';
import { buildCatalogChangeCharacterImpact } from '../src/characters/catalogChangeImpact';
import { useCharacterChoiceBridge } from '../src/catalog/useCharacterChoiceBridge';
import { ContentPolicyService } from '../src/catalog/contentPolicyService';

const parseIds = (input: string): string[] | undefined => {
  const ids = input.split(',').map((entry) => entry.trim()).filter(Boolean);
  return ids.length ? ids : undefined;
};

const comparisonLabel: Record<string, string> = {
  identical: 'O catálogo local e o backup possuem a mesma auditoria.',
  incomingAhead: 'O backup possui commits posteriores aos disponíveis localmente.',
  localAhead: 'O histórico local está à frente do backup.',
  diverged: 'Os históricos divergiram e serão preservados separadamente.',
  catalogMismatch: 'O backup foi criado com outra versão do catálogo; apenas IDs compatíveis serão usados.'
};

export default function BackupScreen() {
  const characters = useCharacterStore((state) => state.characters);
  const remediationPlans = useCharacterStore((state) => state.compatibilityRemediationPlans);
  const scenarios = useCombatScenarioStore((state) => state.scenarios);
  const presets = useBuildPresetStore((state) => state.presets);
  const snapshots = useBuildHistoryStore((state) => state.snapshots);
  const catalogSnapshot = useCatalogStore((state) => state.snapshot);
  const catalogFilterState = useCatalogStore((state) => state.filterState);
  const catalogHistory = useCatalogStore((state) => state.history);
  const catalogRevision = useCatalogStore((state) => state.revision);
  const setPreparedRestoreSession = usePortableRestoreSessionStore((state) => state.setPreparedSession);
  const activeRestoreSession = usePortableRestoreSessionStore((state) => state.activeSession);
  const bridge = useCharacterChoiceBridge();

  const [backupName, setBackupName] = useState('Backup portátil D&D Combat');
  const [notes, setNotes] = useState('');
  const [selectedCharacterIds, setSelectedCharacterIds] = useState('');
  const [includeCharacters, setIncludeCharacters] = useState(true);
  const [includeScenarios, setIncludeScenarios] = useState(true);
  const [includePresets, setIncludePresets] = useState(true);
  const [includeHistory, setIncludeHistory] = useState(true);
  const [includeCatalogAudit, setIncludeCatalogAudit] = useState(true);
  const [includeRemediationPlans, setIncludeRemediationPlans] = useState(true);
  const [restoreJson, setRestoreJson] = useState('');
  const [restoreMode, setRestoreMode] = useState<'merge' | 'replaceAll'>('merge');
  const [lastMessage, setLastMessage] = useState('');

  const selectedIds = useMemo(() => parseIds(selectedCharacterIds), [selectedCharacterIds]);
  const portableCatalogAudit = useMemo(() => {
    if (!includeCatalogAudit || !catalogSnapshot || !catalogFilterState) return undefined;
    return createPortableCatalogAuditSection({
      snapshot: catalogSnapshot,
      filterState: catalogFilterState,
      revision: catalogRevision,
      history: catalogHistory,
      remediationPlans: includeRemediationPlans ? remediationPlans : {},
      selectedCharacterIds: selectedIds
    });
  }, [catalogFilterState, catalogHistory, catalogRevision, catalogSnapshot, includeCatalogAudit, includeRemediationPlans, remediationPlans, selectedIds]);

  const backup = useMemo(() => createCharacterDataBackup(
    { characters, scenarios, buildPresets: presets, buildHistorySnapshots: snapshots },
    {
      metadata: { name: backupName, notes }, selectedCharacterIds: selectedIds,
      includeCharacters, includeScenarios, includeBuildPresets: includePresets, includeBuildHistory: includeHistory,
      catalogAudit: portableCatalogAudit
    }
  ), [backupName, characters, includeCharacters, includeHistory, includePresets, includeScenarios, notes, portableCatalogAudit, presets, scenarios, selectedIds, snapshots]);
  const backupJson = useMemo(() => backupToJson(backup), [backup]);
  const fileName = buildCharacterBackupFileName(backup);
  const parsedRestore = useMemo(() => (restoreJson.trim() ? parseCharacterDataBackup(restoreJson) : undefined), [restoreJson]);

  const catalogValidation = useMemo(() => {
    if (!parsedRestore?.backup?.catalogAudit || !catalogSnapshot || !catalogFilterState) return undefined;
    return validatePortableCatalogAuditSection({
      candidate: parsedRestore.backup.catalogAudit,
      snapshot: catalogSnapshot,
      fallback: catalogFilterState,
      knownCharacterIds: parsedRestore.backup.summary.characterIds
    });
  }, [catalogFilterState, catalogSnapshot, parsedRestore?.backup]);

  const catalogComparison = useMemo(() => {
    if (!catalogValidation?.ok || !catalogValidation.section || !catalogSnapshot || !catalogFilterState) return undefined;
    return comparePortableCatalogAudit({
      snapshot: catalogSnapshot,
      localFilterState: catalogFilterState,
      localRevision: catalogRevision,
      localHistory: catalogHistory,
      localPlans: remediationPlans,
      incoming: catalogValidation.section
    });
  }, [catalogFilterState, catalogHistory, catalogRevision, catalogSnapshot, catalogValidation, remediationPlans]);

  const handleShareBackup = async () => Share.share({ title: fileName, message: backupJson });

  const handlePickRestoreFile = async () => {
    try {
      const result = await DocumentPicker.getDocumentAsync({ copyToCacheDirectory: true, multiple: false, type: ['application/json', 'text/plain', 'application/octet-stream', '*/*'] });
      if (result.canceled || !result.assets?.[0]) return;
      setRestoreJson(await new File(result.assets[0].uri).text());
      setLastMessage(`Arquivo selecionado: ${result.assets[0].name}`);
    } catch {
      Alert.alert('Arquivo não lido', 'Não foi possível selecionar ou ler o backup.');
    }
  };

  const applyRestore = () => {
    const incomingBackup = parsedRestore?.backup;
    if (!incomingBackup || !parsedRestore.ok) return;
    if (!catalogSnapshot || !catalogFilterState) {
      Alert.alert('Catálogo indisponível', 'Aguarde a inicialização do catálogo antes de preparar a restauração.');
      return;
    }
    if (incomingBackup.catalogAudit && (!catalogValidation?.ok || !catalogValidation.section || !catalogComparison)) {
      Alert.alert('Auditoria inválida', catalogValidation?.issues.map((entry) => entry.message).join('\n') || 'Não foi possível validar a seção do catálogo.');
      return;
    }
    if (incomingBackup.catalogAudit && bridge.status !== 'ready') {
      Alert.alert('Escolhas ainda carregando', 'Aguarde a ponte do catálogo antes de calcular o impacto agregado.');
      return;
    }

    const restoreOptions = {
      mode: restoreMode,
      includeCharacters,
      includeScenarios,
      includeBuildPresets: includePresets,
      includeBuildHistory: includeHistory
    } as const;
    const projectedRestore = restoreCharacterDataBackup(
      { characters, scenarios, buildPresets: presets, buildHistorySnapshots: snapshots },
      incomingBackup,
      restoreOptions
    );
    if (!projectedRestore.ok) {
      Alert.alert('Restauração bloqueada', projectedRestore.issues.map((entry) => entry.message).join('\n'));
      return;
    }
    const catalogImpact = catalogValidation?.section && catalogComparison
      ? buildCatalogChangeCharacterImpact({
          label: `Restaurar backup portátil ${incomingBackup.metadata?.name ?? ''}`.trim(),
          characters: projectedRestore.characters,
          snapshot: catalogSnapshot,
          beforeFilterState: catalogFilterState,
          afterFilterState: catalogValidation.section.filterState,
          choices: bridge.choices,
          impact: new ContentPolicyService(catalogSnapshot).previewImpact(
            catalogFilterState,
            catalogValidation.section.filterState
          )
        })
      : undefined;
    const prepared = preparePortableRestoreSession({
      backup: incomingBackup,
      options: restoreOptions,
      current: capturePortableRestoreCheckpoint(),
      catalogAudit: catalogValidation?.section,
      catalogComparison,
      catalogImpact
    });
    if (!prepared.ok || !prepared.session) {
      Alert.alert('Sessão não preparada', prepared.issues.map((entry) => entry.message).join('\n') || 'Não foi possível criar o checkpoint da restauração.');
      return;
    }
    if (!setPreparedRestoreSession(prepared.session)) {
      Alert.alert('Sessão ativa', 'Finalize ou reverta a sessão portátil atual antes de preparar outra restauração.');
      return;
    }
    setLastMessage('A configuração do catálogo foi preparada como nova transação dentro da sessão. Nenhum dado do backup foi gravado.');
    router.push('/restore-session');
  };

  const handleApplyRestore = () => {
    if (!parsedRestore?.ok || !parsedRestore.backup) {
      Alert.alert('Backup inválido', parsedRestore?.issues.map((entry) => entry.message).join('\n') || 'Cole ou selecione um backup válido.');
      return;
    }
    const action = () => applyRestore();
    if (restoreMode === 'replaceAll') {
      Alert.alert('Substituir dados?', 'Este modo projetará a substituição dos dados selecionados. O commit só será liberado após o preview agregado e o reconhecimento dos conflitos.', [
        { text: 'Cancelar', style: 'cancel' }, { text: 'Substituir', style: 'destructive', onPress: action }
      ]);
    } else action();
  };

  return (
    <Screen title="Backup portátil e restauração" subtitle="Exporte fichas, builds, filtros do catálogo, auditoria e planos preventivos em um único arquivo verificável.">
      <Card title="Resumo atual">
        <Text style={styles.muted}>{characters.length} personagem(ns) · {scenarios.length} cenário(s) · {presets.length} preset(s) · {snapshots.length} snapshot(s)</Text>
        <Text style={styles.muted}>Catálogo: revisão {catalogRevision} · {catalogHistory.length} commit(s) · {Object.keys(remediationPlans).length} plano(s)</Text>
        {lastMessage ? <Text style={styles.success}>{lastMessage}</Text> : null}
        {activeRestoreSession ? <Text style={styles.warning}>Sessão portátil {activeRestoreSession.status}: {activeRestoreSession.source.name ?? activeRestoreSession.id}</Text> : null}
      </Card>

      <Card title="Escopo do backup/restauração" subtitle="Backups v1 e v2 continuam aceitos; apenas o contrato v3 transporta catálogo e auditoria.">
        <Field label="Nome do backup" value={backupName} onChangeText={setBackupName} />
        <Field label="IDs de personagens" value={selectedCharacterIds} onChangeText={setSelectedCharacterIds} placeholder="vazio = todos; ou char-a, char-b" autoCapitalize="none" />
        <Field label="Notas" value={notes} onChangeText={setNotes} multiline style={styles.textareaSmall} />
        <Button label={includeCharacters ? 'Inclui personagens/rotações' : 'Não inclui personagens/rotações'} secondary onPress={() => setIncludeCharacters((value) => !value)} />
        <Button label={includeScenarios ? 'Inclui cenários' : 'Não inclui cenários'} secondary onPress={() => setIncludeScenarios((value) => !value)} />
        <Button label={includePresets ? 'Inclui presets' : 'Não inclui presets'} secondary onPress={() => setIncludePresets((value) => !value)} />
        <Button label={includeHistory ? 'Inclui histórico de builds' : 'Não inclui histórico de builds'} secondary onPress={() => setIncludeHistory((value) => !value)} />
        <Button testID="backup-toggle-catalog-audit" label={includeCatalogAudit ? 'Inclui filtros e auditoria do catálogo' : 'Não inclui catálogo'} secondary onPress={() => setIncludeCatalogAudit((value) => !value)} />
        <Button label={includeRemediationPlans ? 'Inclui planos preventivos' : 'Não inclui planos preventivos'} secondary onPress={() => setIncludeRemediationPlans((value) => !value)} disabled={!includeCatalogAudit} />
      </Card>

      <Card title="Exportar" subtitle={summarizeCharacterBackup(backup)}>
        <Text style={styles.muted}>Arquivo sugerido: {fileName}</Text>
        <Text style={styles.muted}>Contrato {backup.schemaVersion} · integridade {backup.integrity?.algorithm}:{backup.integrity?.checksum}</Text>
        {backup.catalogAudit ? <Text style={styles.muted}>{summarizePortableCatalogAudit(backup.catalogAudit)} · auditoria {backup.catalogAudit.historyIntegrity.checksum}</Text> : null}
        <Button testID="backup-share-portable" label="Compartilhar backup JSON" onPress={handleShareBackup} />
        <Field label="Preview JSON" value={backupJson} onChangeText={() => undefined} multiline style={styles.jsonBox} autoCapitalize="none" />
      </Card>

      <Card title="Restaurar" subtitle="O backup será preparado em uma sessão com checkpoint integral. Nenhuma gravação ocorre antes do preview e das confirmações.">
        <Button label="Selecionar arquivo de backup" secondary onPress={handlePickRestoreFile} />
        <Button label={restoreMode === 'merge' ? 'Modo: mesclar sem sobrescrever' : 'Modo: substituir dados selecionados'} secondary onPress={() => setRestoreMode((value) => value === 'merge' ? 'replaceAll' : 'merge')} />
        <Text style={styles.warning}>{restoreMode === 'merge' ? 'Conflitos de IDs recebem novos IDs. Planos locais conflitantes são preservados.' : 'Personagens e builds selecionados serão substituídos, mas catálogo e auditoria ainda exigirão preview.'}</Text>
        <Field testID="backup-restore-json" label="JSON de restauração" value={restoreJson} onChangeText={setRestoreJson} multiline style={styles.jsonBox} autoCapitalize="none" />
        {parsedRestore ? <View style={styles.restoreBox}>
          <Text style={parsedRestore.ok ? styles.success : styles.error}>{parsedRestore.ok && parsedRestore.backup ? summarizeCharacterBackup(parsedRestore.backup) : 'Backup com erro bloqueante.'}</Text>
          <IssueList issues={[...parsedRestore.issues, ...(catalogValidation?.issues ?? [])]} />
          {catalogComparison ? <View testID="portable-backup-comparison">
            <Text style={styles.warning}>{comparisonLabel[catalogComparison.relation]}</Text>
            <Text style={styles.muted}>Local r{catalogComparison.localRevision} × backup r{catalogComparison.incomingRevision} · {catalogComparison.incomingOnlyCommitIds.length} commit(s) só no backup · {catalogComparison.localOnlyCommitIds.length} só local(is)</Text>
            <Text style={styles.muted}>{catalogComparison.changedBookIds.length} livro(s), {catalogComparison.changedCategoryIds.length} categoria(s) e {catalogComparison.changedEntityIds.length} entidade(s) diferem.</Text>
            {catalogComparison.conflictingCommitIds.length ? <Text style={styles.error}>{catalogComparison.conflictingCommitIds.length} commit(s) com mesmo ID e conteúdo divergente serão preservados como auditoria importada, sem substituir o local.</Text> : null}
          </View> : null}
        </View> : null}
        <Button testID="backup-apply-restore" label="Preparar sessão de restauração" onPress={handleApplyRestore} disabled={!parsedRestore?.ok || Boolean(parsedRestore?.backup?.catalogAudit && !catalogValidation?.ok)} />
      </Card>

      <Card title="IDs disponíveis" subtitle="Útil para exportar apenas um ou alguns personagens.">
        {characters.length ? characters.map((character) => <Text key={character.id} style={styles.muted}>{character.id} · {getCharacterDisplayName(character)}</Text>) : <Text style={styles.muted}>Nenhum personagem criado.</Text>}
      </Card>
      <Button label="Voltar" secondary onPress={() => router.back()} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  muted: { color: '#64748b', lineHeight: 19 },
  success: { color: '#047857', fontWeight: '800', lineHeight: 20 },
  error: { color: '#b91c1c', fontWeight: '800', lineHeight: 20 },
  warning: { color: '#92400e', lineHeight: 19 },
  restoreBox: { borderWidth: 1, borderColor: '#e2e8f0', borderRadius: 12, padding: 10, gap: 8 },
  textareaSmall: { minHeight: 88, textAlignVertical: 'top' },
  jsonBox: { minHeight: 260, textAlignVertical: 'top', fontSize: 12, lineHeight: 17 }
});
