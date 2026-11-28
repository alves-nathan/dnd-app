import {stageImportV3} from '../compendium/importV3Staging';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {createHash} from 'node:crypto';
const {digest}=require('../../scripts/5etools/integrated-review');
const {assembleReviewConversion,publicConversionSummary,writePrivateReviewConversion}=require('../../scripts/5etools/functional-convert');
const main='a'.repeat(40),homebrew='b'.repeat(40),blob='c'.repeat(40);
const source={id:'upstream:main:A',status:'needsReview',confidence:'importedNeedsReview',rulesEra:'2024',contentType:'official',precedenceScope:'official-dnd',publication:{precision:'day',date:'2024-09-17',year:2024,evidence:'fixture'}};
const makeItem=(index:number,id:string,code='A')=>({id,kind:'spell',name:'Fixture spell '+id,source:{...source,id:'upstream:main:'+code},identity:{canonicalKey:'spell:'+id,precedenceScope:'official-dnd'},precedence:{relation:'unresolved',supersedes:[],reprints:[],coexistsWith:[],basis:'fixture'},provenance:{origin:'5etools',repository:'fixture/repo',commit:main,blob,path:'data/spells/spells-a.json',entityKey:JSON.stringify(['spell',id,code]),index,sourceCode:code,resolverVersion:'fixture',lineage:[]},payload:{level:0,classes:['Wizard'],castingTime:{kind:'action',actionCost:'action'},damageFormula:'1d6',damageType:'fire'}});
const pack=(id:string,items:ReturnType<typeof makeItem>[],code='A')=>({templateVersion:'dnd-combat-import.v3',contractRevision:'canonical-v3.1',id,source:{...source,id:'upstream:main:'+code},metadata:{activation:'review-required'},items});
const row=(index:number,code:string,disposition:string,origin='main',lane='resolverEntity',kind='spell')=>({origin,path:'data/spells/spells-a.json',blob,kind,index,rootArray:true,lane,sourceId:JSON.stringify([origin,code]),disposition,valueFingerprint:'d'.repeat(64)});
function fixture(){
 const body={schemaVersion:'dnd-upstream-functional-input-plan.v1',commits:{main,homebrew,application:'e'.repeat(40)},bindings:{corpus:'a',scope:'b'},scope:'privateConversionInputs',executable:false,rows:[row(0,'A','included'),row(1,'B','excluded'),row(2,'A','included'),row(3,'SECRET_BREW','included','homebrew'),row(4,'A','included','main','publicationSection','data')]};
 const plan={...body,fingerprint:digest(body)};
 const runs=[{stage:'a5.1',kinds:['spell'],result:{commit:main,activation:'review-required',diagnostics:[],packs:[pack('pack-a',[makeItem(0,'a')]),pack('pack-b',[makeItem(1,'b','B')],'B')]}}];
 return {plan,runs};
}
describe('functional conversion review packs',()=>{
 test('uses the real staging validator, filters sources and retains all selected dispositions',()=>{
  const {plan,runs}=fixture(),r=assembleReviewConversion(plan,runs,stageImportV3);
  expect(r.manifest.counts).toMatchObject({selected:4,excluded:1,convertedReview:1,conversionPending:1,homebrewPending:1,auxiliaryPending:1,emittedItems:1,exportedItems:1});
  expect(r.manifest.validation.status).toBe('stagingValid');
  expect(r.packs.map((p:any)=>p.id)).toEqual(['pack-a']);
  expect(r.manifest).toMatchObject({complete:false,runtimeEligible:false,executable:false});
  expect(JSON.stringify(publicConversionSummary(r.manifest))).not.toContain('SECRET_BREW');
  expect(assembleReviewConversion(plan,runs,stageImportV3).manifest).toEqual(r.manifest);
 });
 test('blocks all exports if selected joint staging fails and rejects coordinate/ID corruption',()=>{
  const {plan,runs}=fixture(),bad=runs[0].result.packs[0].items[0];
  const blocked=assembleReviewConversion(plan,runs,()=>({ok:false,issues:[{severity:'error',code:'fixture'}]}));
  expect(blocked.packs).toEqual([]);
  expect(blocked.manifest.counts).toMatchObject({validationBlocked:1,exportedItems:0});
  bad.provenance.blob='f'.repeat(40);
  expect(()=>assembleReviewConversion(plan,runs,stageImportV3)).toThrow('functionalConversionProvenanceMismatch');
  bad.provenance.blob=blob;runs[0].result.packs[0].items.push(bad);
  expect(()=>assembleReviewConversion(plan,runs,stageImportV3)).toThrow('functionalConversionDuplicateItem');
 });
 test('writes exact private bytes exclusively and never overwrites',()=>{
  const {plan,runs}=fixture(),r=assembleReviewConversion(plan,runs,stageImportV3);
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'dnd-functional-')),out=path.join(dir,'review');
  try{
   writePrivateReviewConversion(r,out,process.cwd());
   const f=r.manifest.files[0],raw=fs.readFileSync(path.join(out,f.file));
   expect(createHash('sha256').update(raw).digest('hex')).toBe(f.sha256);
   expect(JSON.parse(fs.readFileSync(path.join(out,'manifest.json'),'utf8'))).toEqual(r.manifest);
   expect(()=>writePrivateReviewConversion(r,out,process.cwd())).toThrow();
   expect(()=>writePrivateReviewConversion(r,path.join(process.cwd(),'fixture-should-not-write'),process.cwd())).toThrow('functionalConversionOutputMustBeOutsideRepository');
  }finally{fs.rmSync(dir,{recursive:true,force:true});}
 });
});

test('real CLI validator loader and rehearsal readback use aggregate-only evidence',()=>{
 const {loadStagingValidator}=require('../../scripts/5etools/functional-convert');
 const {summarizeRuns,summarizeLedger,verifyPrivateReadback}=require('../../scripts/5etools/functional-corpus-rehearsal');
 const {plan,runs}=fixture(),validate=loadStagingValidator(process.cwd()),r=assembleReviewConversion(plan,runs,validate);
 expect(r.manifest.validation.status).toBe('stagingValid');
 expect(summarizeRuns(runs)['a5.1']).toMatchObject({items:2,byKind:{spell:2}});
 const summary=summarizeLedger(r.manifest);
 expect(summary).toMatchObject({rows:5,byOrigin:{main:{convertedReview:1,excluded:1,conversionPending:1,auxiliaryPending:1},homebrew:{homebrewPending:1}}});
 expect(JSON.stringify(summary)).not.toContain('SECRET_BREW');
 expect(JSON.stringify(summary)).not.toContain('Fixture spell');
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'dnd-rehearsal-')),out=path.join(dir,'review');
 try{
  writePrivateReviewConversion(r,out,process.cwd());
  expect(verifyPrivateReadback(out,r.manifest)).toEqual({files:2,items:1,references:0,hashesVerified:true});
  fs.appendFileSync(path.join(out,r.manifest.files[0].file),' ');
  expect(()=>verifyPrivateReadback(out,r.manifest)).toThrow('functionalRehearsalHashMismatch');
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
