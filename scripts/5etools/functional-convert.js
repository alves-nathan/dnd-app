'use strict';
// Private review packs, never an active runtime bundle. Real converters are
// reused until their scope is expanded; every input receives a disposition.
const fs=require('node:fs'),path=require('node:path');
const {createHash}=require('node:crypto');
const {execFileSync}=require('node:child_process');
const {digest}=require('./integrated-review');
const {openSnapshot,buildInventory}=require('./inventory');
const {verifyPinnedInputs}=require('./functional-corpus');
const {buildFunctionalInputPlan,readSelectedFunctionalInputs}=require('./functional-input-plan');
const {converters}=require('./pilot-coverage');
const assert=(ok,code)=>{if(!ok)throw Error(code);};
const cmp=(a,b)=>a<b?-1:a>b?1:0;
const sha=x=>createHash('sha256').update(x).digest('hex');
const coord=(origin,p,k,i)=>JSON.stringify([origin,p,k,i]);
const bytes=v=>JSON.stringify(v,null,2)+'\n';
const seal=b=>({...b,fingerprint:digest(b)});
const bump=(o,k)=>o[k]=(o[k]||0)+1;
const sorted=a=>[...a].sort(cmp);
const originFor=p=>p.origin==='5etools'?'main':p.origin==='homebrew'?'homebrew':null;
function collectMainRuns(main,plan){
 const {buildFunctionalIndexed}=require('./functional-indexed-converter');
 const selected=kind=>[...new Set(plan.rows.filter(r=>r.origin==='main'&&r.disposition==='included'&&r.lane==='resolverEntity'&&r.kind===kind).map(r=>JSON.parse(r.sourceId)[1]))].sort(cmp);
 return converters.map(c=>({stage:c.stage,kinds:c.kinds,result:plan&&['a5.1','a5.2'].includes(c.stage)?buildFunctionalIndexed(main,c.stage==='a5.1'?'spell':'monster',selected(c.stage==='a5.1'?'spell':'monster')):require('./'+c.module).buildPilot(main)}));
}
// Results from real converters are not trusted until their exact provenance
// is joined to the input plan. Filtering never mutates the original packs.
function assembleReviewConversion(plan,runs,validate){
 assert(plan?.schemaVersion==='dnd-upstream-functional-input-plan.v1'&&plan.scope==='privateConversionInputs'&&plan.executable===false&&typeof validate==='function','functionalConversionInputsInvalid');
 const {fingerprint,...body}=plan;
 assert(digest(body)===fingerprint,'functionalConversionPlanInvalid');
 const rows=new Map(),outputs=new Map(),diags=new Map(),packs=[],ids=new Set(),packIds=new Set(),stages=new Set();
 for(const r of plan.rows){
  const k=coord(r.origin,r.path,r.kind,r.index);
  assert(!rows.has(k),'functionalConversionDuplicateInput');
  rows.set(k,r);
 }
 const byFileIndex=new Map();
 for(const [key,r] of rows)if(r.rootArray){
  const k=JSON.stringify([r.origin,r.path,r.index]),list=byFileIndex.get(k)||[];
  list.push(key);byFileIndex.set(k,list);
 }
 for(const run of runs){
  const {stage,kinds,result}=run;
  assert(!stages.has(stage)&&Array.isArray(kinds)&&result.commit===plan.commits.main&&result.activation==='review-required','functionalConversionRunMismatch');stages.add(stage);
  for(const d of result.diagnostics??[]){
   if(typeof d.code!=='string'||typeof d.path!=='string'||!Number.isSafeInteger(d.index))continue;
   for(const k of byFileIndex.get(JSON.stringify(['main',d.path,d.index]))||[]){
    const r=rows.get(k);
    if(r.disposition!=='included'||d.kind&&d.kind!==r.kind||d.source&&JSON.stringify(['main',d.source])!==r.sourceId)continue;
    const s=diags.get(k)||new Set();s.add(d.code);diags.set(k,s);
   }
  }
  for(const pack of result.packs){
   assert(pack.templateVersion==='dnd-combat-import.v3'&&pack.contractRevision==='canonical-v3.1'&&pack.source?.status==='needsReview'&&pack.metadata?.activation==='review-required'&&typeof pack.id==='string'&&!packIds.has(pack.id),'functionalConversionPackInvalid');
   packIds.add(pack.id);
   const items=[];
   for(const item of pack.items){
    const p=item.provenance,origin=originFor(p??{});
    let kind;try{kind=JSON.parse(p.entityKey)[0];}catch{throw Error('functionalConversionProvenanceInvalid');}
    const k=coord(origin,p.path,kind,p.index),r=rows.get(k);
    assert(origin==='main'&&p.commit===plan.commits.main&&r&&r.blob===p.blob&&r.sourceId===JSON.stringify([origin,p.sourceCode])&&kinds.includes(item.kind)&&item.source?.status==='needsReview'&&item.source.id===pack.source.id,'functionalConversionProvenanceMismatch');
    assert(typeof item.id==='string'&&!ids.has(item.id),'functionalConversionDuplicateItem');
    ids.add(item.id);
    if(r.disposition!=='included')continue;
    assert(r.lane==='resolverEntity','functionalConversionUnexpectedLane');
    items.push(item);
    const list=outputs.get(k)||[];list.push({id:item.id,packId:pack.id,fingerprint:digest(item)});outputs.set(k,list);
   }
   if(items.length)packs.push({...pack,items:items.sort((a,b)=>cmp(a.id,b.id))});
  }
 }
 packs.sort((a,b)=>cmp(a.id,b.id));
 const all=packs.flatMap(p=>p.items),validationCodes={};
 let valid=false;
 if(all.length){
  // A joint validation catches dependencies between different packs. Individual
  // validation uses only selected endpoints, never the old active catalog.
  const joint={templateVersion:'dnd-combat-import.v3',contractRevision:'canonical-v3.1',id:'upstream:private:joint-review',source:packs[0].source,metadata:{activation:'review-required'},items:all};
  const validation=validate(joint);
  valid=validation.ok===true;
  for(const issue of validation.issues??[])bump(validationCodes,issue.severity+':'+issue.code);
  if(valid){
   const externalItems=all.map(i=>({id:i.id,kind:i.kind,...(i.kind==='condition'?{conditionId:i.payload.conditionId}:{})}));
   for(const pack of packs){
    const localIds=new Set(pack.items.map(i=>i.id));
    const result=validate(pack,{externalItems:externalItems.filter(i=>!localIds.has(i.id))});
    if(result.ok!==true)valid=false;
    for(const issue of result.issues??[])if(issue.severity==='error')bump(validationCodes,'pack:'+issue.code);
   }
  }
 }
 const ledger=[],counts={selected:0,excluded:0,sourcePending:0,sharedSupportPending:0,convertedReview:0,partialReview:0,conversionPending:0,homebrewPending:0,auxiliaryPending:0,validationBlocked:0,emittedItems:all.length,exportedItems:valid?all.length:0};
 for(const [key,r] of rows){
  const found=outputs.get(key)||[],diagnostics=sorted(diags.get(key)||[]);
  let status=r.disposition;
  if(status==='included'){
   counts.selected++;
   if(found.length)status=!valid?'validationBlocked':diagnostics.length?'partialReview':'convertedReview';
   else status=r.origin==='homebrew'?'homebrewPending':r.lane==='resolverEntity'?'conversionPending':'auxiliaryPending';
  }
  bump(counts,status);
  ledger.push({coordinate:key,sourceId:r.sourceId,inputFingerprint:r.valueFingerprint,lane:r.lane,status,outputs:found.sort((a,b)=>cmp(a.id,b.id)),diagnostics});
 }
 assert(counts.selected===counts.convertedReview+counts.partialReview+counts.conversionPending+counts.homebrewPending+counts.auxiliaryPending+counts.validationBlocked,'functionalConversionAccountingMismatch');
 const exported=valid?packs:[];
 const files=exported.map(pack=>({file:'pack-'+sha(pack.id)+'.v3.json',packId:pack.id,items:pack.items.length,sha256:sha(bytes(pack))}));
 const manifest=seal({schemaVersion:'dnd-upstream-functional-conversion.v1',commits:plan.commits,bindings:{inputPlan:plan.fingerprint,corpus:plan.bindings.corpus,scope:plan.bindings.scope},converterStages:sorted(stages),counts,validation:{status:all.length?(valid?'stagingValid':'stagingBlocked'):'noOutputs',codes:validationCodes},files,ledger,scope:'privateReviewPacksOnly',bootstrapRequired:true,activation:'review-required',runtimeEligible:false,complete:false,executable:false});
 return {manifest,packs:exported};
}
function convertSelectedCorpus(main,homebrew,inventory,draft,selection,validate){
 verifyPinnedInputs(main,homebrew);
 const plan=buildFunctionalInputPlan(main,homebrew,inventory,draft,selection);
 // Read the exact selected input values to verify the operational boundary.
 // The existing converters still need the immutable full Main snapshot for copy resolution.
 let n=0;
 for(const {descriptor} of readSelectedFunctionalInputs(main,homebrew,inventory,draft,selection,plan)){
  assert(descriptor.disposition==='included','functionalConversionSelectionMismatch');n++;
 }
 assert(n===plan.totals.main.included+plan.totals.homebrew.included,'functionalConversionSelectionMismatch');
 return assembleReviewConversion(plan,collectMainRuns(main,plan),validate);
}
function publicConversionSummary(m){
 return {schemaVersion:m.schemaVersion,commits:m.commits,counts:m.counts,validation:m.validation.status,packCount:m.files.length,fingerprint:m.fingerprint,complete:false,runtimeEligible:false};
}
function writePrivateReviewConversion(result,out,root){
 const parent=fs.realpathSync(path.dirname(path.resolve(out))),repo=fs.realpathSync(root),relative=path.relative(repo,parent);
 assert(relative&&(relative==='..'||relative.startsWith('..'+path.sep)||path.isAbsolute(relative)),'functionalConversionOutputMustBeOutsideRepository');
 const dir=path.join(parent,path.basename(out));
 const {manifest,packs}=result;
 assert(manifest.files.length===packs.length,'functionalConversionFileMismatch');
 const {fingerprint,...body}=manifest;
 assert(digest(body)===fingerprint&&manifest.runtimeEligible===false&&manifest.executable===false,'functionalConversionManifestInvalid');
 // Exclusive directory, manifest written last. On an ordinary write failure,
 // clean up only the directory created here; interrupted runs have no manifest.
 fs.mkdirSync(dir,{mode:0o700});
 try{
  for(const [i,p] of packs.entries()){
   const f=manifest.files[i],raw=bytes(p);
   assert(f.file==='pack-'+sha(p.id)+'.v3.json'&&f.packId===p.id&&f.sha256===sha(raw)&&f.items===p.items.length,'functionalConversionFileMismatch');
   fs.writeFileSync(path.join(dir,f.file),raw,{flag:'wx',mode:0o600});
  }
  fs.writeFileSync(path.join(dir,'manifest.json'),bytes(manifest),{flag:'wx',mode:0o600});
 }catch(e){fs.rmSync(dir,{recursive:true,force:true});throw e;}
 return dir;
}
// Use the same production staging validator, compiling only trusted local TS
// modules. No upstream JavaScript is loaded or executed.
function loadStagingValidator(root){
 const ts=require('typescript'),src=path.join(root,'src')+path.sep,prior=require.extensions['.ts'];
 require.extensions['.ts']=(mod,file)=>{
  assert(file.startsWith(src),'functionalConversionUnexpectedTsModule');
  mod._compile(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS},fileName:file}).outputText,file);
 };
 try{return require(path.join(root,'src/compendium/importV3Staging.ts')).stageImportV3;}
 finally{if(prior)require.extensions['.ts']=prior;else delete require.extensions['.ts'];}
}
function run(args){
 assert(args.length===5,'Usage: node functional-convert.js MAIN_DIR BREW_DIR CORPUS_JSON SELECTION_JSON NEW_OUTPUT_DIR');
 const [mainDir,brewDir,draftPath,selectionPath,out]=args,root=path.resolve(__dirname,'../..');
 const lock=require('./functional-inputs.json'),read=p=>JSON.parse(fs.readFileSync(p,'utf8'));
 const draft=read(draftPath),selectionDoc=read(selectionPath),selection=selectionDoc.selection??selectionDoc;
 const app=execFileSync('git',['-C',root,'rev-parse','HEAD'],{encoding:'utf8'}).trim();
 assert(app===draft.commits.application,'functionalConversionApplicationCommitMismatch');
 execFileSync('git',['-C',root,'diff','--quiet','HEAD','--'],{stdio:'ignore'});
 const main=openSnapshot(mainDir,lock.main.commit),brew=openSnapshot(brewDir,lock.homebrew.commit);
 const result=convertSelectedCorpus(main,brew,buildInventory(main,brew,lock.asOf),draft,selection,loadStagingValidator(root));
 writePrivateReviewConversion(result,out,root);
 console.log(JSON.stringify(publicConversionSummary(result.manifest)));
 // Incomplete review artifacts are useful, but cannot pass a production gate.
 process.exitCode=2;
}
module.exports={collectMainRuns,assembleReviewConversion,convertSelectedCorpus,publicConversionSummary,writePrivateReviewConversion,loadStagingValidator};
if(require.main===module){try{run(process.argv.slice(2));}catch(e){console.error(typeof e?.message==='string'&&/^functional[A-Za-z]+$/.test(e.message)?e.message:'functionalConversionFailed');process.exitCode=1;}}
