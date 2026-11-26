import { useMemo, useState } from 'react';
import { Text } from 'react-native';
import { File } from 'expo-file-system';
import { Button } from './Button';
import { Card } from './Card';
import { useAppTheme } from '../theme';
import { capturePortableRestoreCheckpoint } from '../backup/portableRestoreSessionExecutor';
import { MAX_LOCAL_PRESERVATION_BACKUP_CHARS, verifyLocalV3Preservation, type LocalV3PreservationEvidence } from '../compendium/importV3LocalPreservation';
import { useCompendiumStore } from '../store/compendiumStore';
import { useCatalogStore } from '../store/catalogStore';
import { useCharacterStore } from '../store/characterStore';
import { useCombatScenarioStore } from '../store/combatScenarioStore';
import { useBuildPresetStore } from '../store/buildPresetStore';
import { useBuildHistoryStore } from '../store/buildHistoryStore';
import { useCatalogUpdateSessionStore } from '../store/catalogUpdateSessionStore';
import { usePortableRestoreSessionStore } from '../store/portableRestoreSessionStore';

type BackupKind = 'compendium' | 'characters';
interface SelectedBackup { name: string; text: string }

const isBusySession = (status?: string) => !!status && ['prepared','committing','rollingBack','interrupted','failed'].includes(status);
const hydrated = () => [
  useCharacterStore.persist.hasHydrated(),useCombatScenarioStore.persist.hasHydrated(),
  useBuildPresetStore.persist.hasHydrated(),useBuildHistoryStore.persist.hasHydrated(),
  useCatalogUpdateSessionStore.persist.hasHydrated(),usePortableRestoreSessionStore.persist.hasHydrated()
].every(Boolean);

export function LocalV3PreservationPanel({rawText,stageFingerprint}: {rawText:string; stageFingerprint:string}) {
  const {colors} = useAppTheme();
  // Deliberately conservative invalidation: any observed store replacement
  // expires the evidence, even if the changed field is not in the backup.
  const compendium = useCompendiumStore(s=>s);
  const catalog = useCatalogStore(s=>s);
  const characters = useCharacterStore(s=>s);
  const scenarios = useCombatScenarioStore(s=>s);
  const presets = useBuildPresetStore(s=>s);
  const history = useBuildHistoryStore(s=>s);
  const update = useCatalogUpdateSessionStore(s=>s);
  const restore = usePortableRestoreSessionStore(s=>s);
  const observed = useMemo(()=>[compendium,catalog,characters,scenarios,presets,history,update,restore],
    [compendium,catalog,characters,scenarios,presets,history,update,restore]);
  const [compendiumFile,setCompendiumFile] = useState<SelectedBackup>();
  const [characterFile,setCharacterFile] = useState<SelectedBackup>();
  const [busy,setBusy] = useState(false);
  const [message,setMessage] = useState('');
  const [verification,setVerification] = useState<{observed:readonly unknown[]; rawText:string; stageFingerprint:string; evidence:LocalV3PreservationEvidence}>();
  const current = verification && verification.observed===observed &&
    verification.rawText===rawText && verification.stageFingerprint===stageFingerprint ? verification.evidence : undefined;

  const pick = async (kind:BackupKind) => {
    if (busy) return;
    setBusy(true); setMessage(''); setVerification(undefined);
    try {
      const result=await File.pickFileAsync({multipleFiles:false,mimeTypes:'*/*'});
      if (result.canceled || !result.result) return;
      const file=result.result;
      if (typeof file.size==='number' && file.size>50_000_000) {
        setMessage('Backup excede o limite de leitura local. Nenhum arquivo foi aplicado.');
        return;
      }
      const text=await file.text();
      if (!text.trim() || text.length>MAX_LOCAL_PRESERVATION_BACKUP_CHARS) {
        setMessage('Backup vazio ou acima do limite de caracteres. Nenhum arquivo foi aplicado.');
        return;
      }
      const selected={name:file.name || 'Backup local',text};
      if(kind==='compendium') setCompendiumFile(selected); else setCharacterFile(selected);
    } catch {
      setMessage('Não foi possível ler o backup local.');
    } finally {
      setBusy(false);
    }
  };

  const verify=()=>{
    setVerification(undefined); setMessage('');
    if (busy || !compendiumFile || !characterFile) return;
    const live=[useCompendiumStore.getState(),useCatalogStore.getState(),useCharacterStore.getState(),
      useCombatScenarioStore.getState(),useBuildPresetStore.getState(),useBuildHistoryStore.getState(),
      useCatalogUpdateSessionStore.getState(),usePortableRestoreSessionStore.getState()];
    if (!live.every((state,index)=>state===observed[index]) || !hydrated() ||
        isBusySession(update.activeSession?.status) || isBusySession(restore.activeSession?.status) ||
        catalog.pendingChange || catalog.isSaving || compendium.isSaving || compendium.isHydrating) {
      setMessage('Dados locais indisponíveis ou operação em andamento. Resolva a sessão pendente e tente novamente.');
      return;
    }
    try {
      const evidence=verifyLocalV3Preservation({
        rawText,expectedStageFingerprint:stageFingerprint,
        context:{installed:compendium.getSnapshot(),catalog:catalog.snapshot,
          compendiumReady:compendium.isHydrated && !compendium.lastStorageError,
          catalogReady:catalog.status==='ready' && !catalog.isSaving},
        portableReady:true,portableCheckpoint:capturePortableRestoreCheckpoint(),runtimeRef:catalog.runtimeRef,
        compendiumExport:compendiumFile.text,characterBackup:characterFile.text
      });
      setVerification({observed,rawText,stageFingerprint,evidence});
    } catch {
      setMessage('Não foi possível capturar o checkpoint local. Nenhuma restauração foi executada.');
    }
  };

  return (
    <Card title="Preservação — verificar backups" subtitle="Selecione os dois arquivos JSON já exportados. A verificação não restaura nem salva dados.">
      <Text style={{color:colors.onSurface}}>Use o snapshot técnico do compêndio e o backup portátil de todos os personagens, cenários, presets e históricos, com auditoria do catálogo e planos preventivos. Não selecione um backup parcial.</Text>
      <Button label="Selecionar snapshot do compêndio" testID="v3-preservation-pick-compendium" secondary disabled={busy} onPress={()=>void pick('compendium')} />
      <Text style={{color:colors.onSurface}}>{compendiumFile?.name ?? 'Nenhum snapshot selecionado'}</Text>
      <Button label="Selecionar backup portátil" testID="v3-preservation-pick-portable" secondary disabled={busy} onPress={()=>void pick('characters')} />
      <Text style={{color:colors.onSurface}}>{characterFile?.name ?? 'Nenhum backup selecionado'}</Text>
      <Button label="Verificar preservação" testID="v3-preservation-verify" disabled={busy || !compendiumFile || !characterFile} onPress={verify} />
      <Button label="Limpar backups e evidência" secondary disabled={busy} onPress={()=>{
        setCompendiumFile(undefined);setCharacterFile(undefined);setVerification(undefined);setMessage('');
      }} />
      {message ? <Text style={{color:colors.onSurface}}>{message}</Text> : null}
      {verification && !current ? <Text style={{color:colors.onSurface}}>A evidência expirou. Verifique novamente após atualizar os backups, se necessário.</Text> : null}
      {current ? <>
        <Text style={{color:colors.onSurface,fontWeight:'700'}}>{current.ok ? 'Backups compatíveis com o estado observado — migração bloqueada' : 'Preservação não comprovada'}</Text>
        {current.codes.map(code=><Text key={code} style={{color:colors.onSurface}}>{code}</Text>)}
        {current.checkpoint ? <>
          <Text style={{color:colors.onSurface}}>Fingerprint: {current.checkpoint.fingerprint}</Text>
          <Text style={{color:colors.onSurface}}>{current.checkpoint.counts.storageItems} itens · {current.checkpoint.counts.characters} personagens · {current.checkpoint.counts.runtimeEntries} entradas runtime</Text>
          <Text style={{color:colors.onSurface}}>Bloqueios restantes:</Text>
          {current.checkpoint.blockers.map(code=><Text key={code} style={{color:colors.onSurface}}>{code}</Text>)}
        </> : null}
      </> : null}
      <Text style={{color:colors.onSurface}}>A comparação não comprova backup durável, integridade do pacote runtime armazenado, paridade mecânica ou rollback em produção. Nenhuma autorização é concedida.</Text>
    </Card>
  );
}
