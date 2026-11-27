import { useMemo, useState } from 'react';
import { Text } from 'react-native';
import { Card } from './Card';
import { Button } from './Button';
import { useAppTheme } from '../theme';
import { useCompendiumStore } from '../store/compendiumStore';
import { useCatalogStore } from '../store/catalogStore';
import { previewLocalV3File } from '../compendium/importV3LocalPreview';
import { LocalV3InventoryPanel } from './LocalV3InventoryPanel';
import { LocalV3PreservationPanel } from './LocalV3PreservationPanel';

export function LocalV3StagePreview({rawText}: {rawText: string}) {
  const {colors} = useAppTheme();
  const items = useCompendiumStore(s=>s.items);
  const packs = useCompendiumStore(s=>s.packs);
  const sources = useCompendiumStore(s=>s.sources);
  const enabledSourceIds = useCompendiumStore(s=>s.enabledSourceIds);
  const compendiumReady = useCompendiumStore(s=>s.isHydrated && !s.isHydrating && !s.isSaving && !s.lastStorageError);
  const catalog = useCatalogStore(s=>s.snapshot);
  const catalogReady = useCatalogStore(s=>s.status === 'ready' && !s.isSaving);
  const context = useMemo(()=>({installed:{items,packs,sources,enabledSourceIds},catalog,compendiumReady,catalogReady}),
    [items,packs,sources,enabledSourceIds,catalog,compendiumReady,catalogReady]);
  // Run the potentially expensive staging probe only on explicit request.
  // Any changed input or observed store reference invalidates the displayed result.
  const [request,setRequest] = useState<{rawText:string; context:typeof context}>();
  const result = useMemo(()=>request?.rawText === rawText && request.context === context
    ? previewLocalV3File(rawText,context) : undefined,[request,rawText,context]);
  return (
    <Card title="Staging V3 — somente leitura" subtitle="Prévia local experimental. Nenhum item é instalado, habilitado ou compartilhado.">
      <Text style={{color:colors.onSurface}}>A verificação usa os IDs do compêndio carregado e do catálogo atual. O inventário histórico completo, os backups e a paridade mecânica ainda não foram comprovados.</Text>
      <Button label="Validar prévia V3" testID="v3-stage-preview-validate" disabled={!compendiumReady || !catalogReady}
        onPress={()=>setRequest({rawText,context})} />
      {!compendiumReady || !catalogReady ? <Text style={{color:colors.onSurface}}>Aguarde o carregamento do compêndio e catálogo ou volte à tela anterior para verificar erros.</Text> : null}
      {request && !result ? <Text style={{color:colors.onSurface}}>A prévia expirou porque o arquivo ou o estado local mudou. Valide novamente.</Text> : null}
      {result ? (
        <>
          <Text style={{color:colors.onSurface,fontWeight:'700'}}>{result.ok ? 'Prévia válida para revisão — não importável' : 'Prévia bloqueada'}</Text>
          {result.summary ? (
            <>
              <Text style={{color:colors.onSurface}}>{result.summary.items} item(ns) · {result.summary.sources} fonte(s)</Text>
              <Text style={{color:colors.onSurface}}>Pacote: {result.summary.packId}</Text>
              <Text style={{color:colors.onSurface}}>Commit declarado: {result.summary.upstreamCommit}</Text>
              <Text style={{color:colors.onSurface}}>Fingerprint: {result.summary.fingerprint}</Text>
            </>
          ) : null}
          {result.codes.slice(0,25).map(code=><Text key={code} style={{color:colors.onSurface}}>{code}</Text>)}
          {result.codes.length>25 ? <Text style={{color:colors.onSurface}}>Mais {result.codes.length-25} código(s) de revisão.</Text> : null}
        </>
      ) : null}
      {result?.ok && result.summary ? <LocalV3InventoryPanel key={'inventory-'+result.summary.fingerprint} /> : null}
      {result?.ok && result.summary ? <LocalV3PreservationPanel key={result.summary.fingerprint} rawText={rawText} stageFingerprint={result.summary.fingerprint} /> : null}
    </Card>
  );
}
