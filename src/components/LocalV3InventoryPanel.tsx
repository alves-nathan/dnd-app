import {useEffect,useRef,useState} from 'react';
import {AppState,Text} from 'react-native';
import {Card} from './Card';
import {Button} from './Button';
import {useAppTheme} from '../theme';
import {observeHydratedLocalInventory,subscribeLocalInventoryChanges} from '../compendium/localInventoryStoreAdapter';
import {compareLocalInventoryRevalidation,presentLocalInventory,type LocalInventoryCaptureResult} from '../compendium/localInventoryPanelModel';

let sequence=0;
const newCaptureId=()=> 'local-inventory-'+Date.now()+'-'+(++sequence);
type Observation={id:string;result:LocalInventoryCaptureResult};
export function LocalV3InventoryPanel(){
 const {colors}=useAppTheme();
 const generation=useRef(0),inFlight=useRef(false),mounted=useRef(false);
 const [busy,setBusy]=useState(false),[observation,setObservation]=useState<Observation>();
 const [message,setMessage]=useState('');
 const current=useRef<Observation|undefined>(undefined);
 useEffect(()=>{
  mounted.current=true;
  const invalidate=()=>{
   generation.current++;
   if(!mounted.current)return;
   if(current.current||inFlight.current){
    current.current=undefined;setObservation(undefined);
    setMessage('A observação expirou. Capture novamente.');
   }
  };
  const unsubscribe=subscribeLocalInventoryChanges(invalidate);
  const appState=AppState.addEventListener('change',state=>{if(state!=='active')invalidate();});
  return ()=>{mounted.current=false;generation.current++;unsubscribe();appState.remove();};
 },[]);
 const clear=()=>{
  generation.current++;current.current=undefined;setObservation(undefined);setMessage('');
 };
 const capture=async(revalidate:boolean)=>{
  if(inFlight.current||!mounted.current)return;
  const previous=revalidate?current.current:undefined;
  if(revalidate&&!previous)return;
  const id=previous?.id??newCaptureId(),ticket=++generation.current;
  inFlight.current=true;setBusy(true);setMessage('');
  // Never show an earlier snapshot while a revalidation is in progress.
  current.current=undefined;setObservation(undefined);
  try{
   const result=await observeHydratedLocalInventory(id);
   if(!mounted.current||ticket!==generation.current)return;
   if(previous){
    const comparison=compareLocalInventoryRevalidation(previous.result,result);
    if(comparison!=='unchanged'){
     setMessage(comparison==='changed'?'O inventário mudou. Capture novamente.':'Não foi possível revalidar. Capture novamente.');
     return;
    }
    setMessage('A nova leitura corresponde à observação anterior. Nenhuma aprovação foi concedida.');
   }
   const next={id,result};current.current=next;setObservation(next);
  }catch{
   if(mounted.current&&ticket===generation.current)setMessage('Não foi possível observar o inventário local.');
  }finally{
   inFlight.current=false;
   if(mounted.current)setBusy(false);
  }
 };
 const view=observation?presentLocalInventory(observation.result):undefined;
 const style={color:colors.onSurface};
 return <Card title="Inventário local — somente leitura" subtitle="Observe o estado instalado sem salvar, restaurar ou instalar conteúdo.">
  <Text style={style}>A captura é parcial e pontual. Mudanças nos stores ou saída do aplicativo expiram a observação. Alterações externas exigem nova leitura.</Text>
  <Button label={busy?'Observando inventário…':'Capturar inventário local'} testID="v3-inventory-capture" disabled={busy} onPress={()=>void capture(false)} />
  <Button label="Revalidar observação" testID="v3-inventory-revalidate" secondary disabled={busy||observation?.result.captureStatus!=='stableObservation'} onPress={()=>void capture(true)} />
  <Button label="Limpar observação" testID="v3-inventory-clear" secondary disabled={busy||!observation} onPress={clear} />
  {message?<Text accessibilityLiveRegion="polite" style={style}>{message}</Text>:null}
  {view?<>
   <Text accessibilityLiveRegion="polite" style={{...style,fontWeight:'700'}}>{view.title}</Text>
   <Text style={style}>{view.summary.observed} de {view.summary.required} superfícies observadas. {view.summary.invalid} inválida(s), {view.summary.unavailable} indisponível(is), {view.summary.notInspected} não inspecionada(s), {view.summary.busy} ocupada(s), {view.summary.stale} desatualizada(s).</Text>
   <Text style={style}>Catálogo e pacote: {view.runtimePackage}</Text>
   <Text style={style}>Persistência ativa: {view.activePersistence}</Text>
   {view.packageCode?<Text style={style}>Revisão do pacote: {view.packageCode}</Text>:null}
   {view.surfaces.map(s=><Text key={s.surface} style={style}>{s.label}: {s.status}</Text>)}
   <Text selectable style={style}>Fingerprint: {view.fingerprint}</Text>
   <Text style={{...style,fontWeight:'700'}}>{view.readiness}</Text>
  </>:null}
  <Text style={style}>A correspondência de fingerprints não comprova inventário completo, confiança, backup durável ou rollback. Nenhuma autorização é concedida.</Text>
 </Card>;
}
