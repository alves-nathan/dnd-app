'use strict';
// Real immutable-snapshot rehearsal. Never print or upload upstream payloads,
// source names, paths, entity IDs, raw validation messages or private files.
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {execFileSync}=require('node:child_process');
const {createHash}=require('node:crypto');
const {openSnapshot}=require('./inventory');
const {buildBaseline,readRuntimeProfile}=require('./coverage-baseline');
const {buildPinnedFunctionalCorpus,verifyPinnedInputs}=require('./functional-corpus');
const {prepareFunctionalSelection}=require('./functional-scope');
const {loadStagingValidator,run,publicConversionSummary}=require('./functional-convert');
const {digest}=require('./integrated-review');
const lock=require('./functional-inputs.json');
const assert=(ok,code)=>{if(!ok)throw Error(code);};
const bump=(o,k,n=1)=>o[k]=(o[k]||0)+n;
const dict=()=>Object.create(null);
const safeCode=v=>typeof v==='string'&&/^[A-Za-z][A-Za-z0-9_:-]{0,95}$/.test(v)?v:'unclassified';
const safeKind=v=>['spell','creatureStatBlock','weapon','armor','equipment','magicItem','feat','feature','species','background','class','subclass','condition'].includes(v)?v:'other';
const sha=v=>createHash('sha256').update(v).digest('hex');
function summarizeRuns(runs){
 const result=dict();
 for(const {stage,result:r} of runs){
  const byKind=dict(),diagnostics=dict(),reviewCodes=dict();
  for(const d of r.diagnostics??[])bump(diagnostics,safeCode(d.code));
  for(const p of r.packs)for(const item of p.items){
   bump(byKind,safeKind(item.kind));
   for(const code of item.metadata?.reviewCodes??[])bump(reviewCodes,safeCode(code));
  }
  result[stage]={packs:r.packs.length,items:Object.values(byKind).reduce((a,b)=>a+b,0),byKind,diagnostics,reviewCodes};
 }
 return result;
}
function summarizeLedger(m){
 const byOrigin=dict(),byLane=dict(),diagnosticCodes=dict(),versions=dict(),validationCodes=dict();
 let rows=0,outputs=0,referenceOutputs=0;
 for(const r of m.ledger){
  const origin=JSON.parse(r.coordinate)[0];
  assert(['main','homebrew'].includes(origin),'functionalRehearsalOriginInvalid');
  bump(byOrigin[origin]??=dict(),safeCode(r.status));
  bump(byLane[safeCode(r.lane)]??=dict(),safeCode(r.status));
  for(const code of r.diagnostics)bump(diagnosticCodes,safeCode(code));
  for(const v of r.versions??[])bump(versions,safeCode(v.disposition)+(v.outputs.length?':emitted':':noOutput'));
  rows++;outputs+=r.outputs.length;if(r.referenceOutput)referenceOutputs++;
 }
 for(const [code,n] of Object.entries(m.validation.codes))bump(validationCodes,safeCode(code),n);
 assert(outputs===m.counts.emittedItems&&referenceOutputs===m.counts.referenceRecords,'functionalRehearsalLedgerMismatch');
 assert(rows===m.counts.selected+m.counts.excluded+m.counts.sourcePending+m.counts.sharedSupportPending,'functionalRehearsalDenominatorMismatch');
 return {...publicConversionSummary(m),rows,byOrigin,byLane,diagnosticCodes,versions,validationCodes};
}
function verifyPrivateReadback(dir,manifest){
 const read=p=>fs.readFileSync(path.join(dir,p));
 const actual=JSON.parse(read('manifest.json').toString('utf8')),{fingerprint,...body}=actual;
 assert(digest(body)===fingerprint&&fingerprint===manifest.fingerprint&&actual.complete===false&&actual.runtimeEligible===false&&actual.executable===false,'functionalRehearsalManifestMismatch');
 const expected=new Set(['manifest.json']);
 let items=0,references=0;
 for(const [files,kind] of [[actual.files,'mechanical'],[actual.referenceFiles??[],'reference']]){
  for(const f of files){
   assert(typeof f.file==='string'&&/^(?:pack-[a-f0-9]{64}\.v3|reference-[a-f0-9]{64})\.json$/.test(f.file)&&!expected.has(f.file),'functionalRehearsalFileNameInvalid');
   expected.add(f.file);const raw=read(f.file);
   assert(sha(raw)===f.sha256,'functionalRehearsalHashMismatch');
   const value=JSON.parse(raw.toString('utf8'));
   assert(value.id===f.packId&&value.metadata?.activation==='review-required'&&Array.isArray(value.items)&&value.items.length===f.items||kind==='reference'&&value.id===f.packId&&value.activation==='review-required'&&value.runtimeEligible===false&&Array.isArray(value.records)&&value.records.length===f.records,'functionalRehearsalPackMismatch');
   if(kind==='mechanical')items+=f.items;else references+=f.records;
  }
 }
 assert(fs.readdirSync(dir).length===expected.size&&fs.readdirSync(dir).every(f=>expected.has(f))&&items===actual.counts.exportedItems&&references===actual.counts.referenceRecords,'functionalRehearsalReadbackMismatch');
 return {files:expected.size,items,references,hashesVerified:true};
}
function main(args){
 assert(args.length===2,'functionalRehearsalArgumentsInvalid');
 const root=path.resolve(__dirname,'../..'),temp=fs.mkdtempSync(path.join(process.env.RUNNER_TEMP||os.tmpdir(),'dnd-functional-rehearsal-'));
 let phase='openSnapshots';
 const observe=(name,value)=>{
  phase=name;
  if(name==='mechanicalRuns')console.log(JSON.stringify({phase,aggregate:summarizeRuns(value)}));
  else console.log(JSON.stringify({phase}));
 };
 try{
  const [mainDir,brewDir]=args,main=openSnapshot(mainDir,lock.main.commit),brew=openSnapshot(brewDir,lock.homebrew.commit);
  verifyPinnedInputs(main,brew);
  const application=execFileSync('git',['-C',root,'rev-parse','HEAD'],{encoding:'utf8'}).trim();
  observe('historicalBaseline');
  const baseline=buildBaseline(main,brew,{asOf:lock.asOf,runtime:readRuntimeProfile(path.join(root,'assets/catalog-v4.8.0/runtime-bundle-v4.8.0.json')),validate:loadStagingValidator(root)});
  observe('corpusDraft');
  const draft=buildPinnedFunctionalCorpus(main,brew,baseline,application);
  // Synthetic review scope, not an owner approval. No Brew activation.
  const selection=prepareFunctionalSelection(draft,{mainPolicy:'allObservedMain',reason:'disposable full Main conversion rehearsal'}).selection;
  const draftPath=path.join(temp,'draft.json'),selectionPath=path.join(temp,'selection.json'),out=path.join(temp,'review');
  fs.writeFileSync(draftPath,JSON.stringify(draft),{flag:'wx',mode:0o600});
  fs.writeFileSync(selectionPath,JSON.stringify(selection),{flag:'wx',mode:0o600});
  observe('cli');
  const manifest=run([mainDir,brewDir,draftPath,selectionPath,out],{observe,print:()=>{}});
  observe('readback');
  const readback=verifyPrivateReadback(out,manifest),summary=summarizeLedger(manifest);
  console.log(JSON.stringify({phase:'completed',scope:'disposableMainReviewOnly',summary,readback,complete:false,runtimeEligible:false}));
  // Staging failures must be visible to CI, but known coverage gaps are
  // reported rather than asserting a false completion gate.
  assert(manifest.validation.status==='stagingValid'&&readback.items>0&&readback.references>0,'functionalRehearsalStagingBlocked');
 }catch(e){
  console.error(JSON.stringify({phase,error:typeof e?.message==='string'&&/^functional[A-Za-z]+$/.test(e.message)?e.message:'functionalRehearsalUnexpectedError',complete:false,runtimeEligible:false}));
  process.exitCode=1;
 }finally{fs.rmSync(temp,{recursive:true,force:true});}
}
module.exports={summarizeRuns,summarizeLedger,verifyPrivateReadback};
if(require.main===module)main(process.argv.slice(2));
