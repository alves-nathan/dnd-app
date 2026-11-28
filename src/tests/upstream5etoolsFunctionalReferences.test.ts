import {stageImportV3} from '../compendium/importV3Staging';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {createHash} from 'node:crypto';
const {digest}=require('../../scripts/5etools/integrated-review');
const {buildReferencePacks,validateReferencePacks,createReferenceIndex}=require('../../scripts/5etools/functional-reference-pack');
const {assembleReviewConversion,writePrivateReviewConversion,publicConversionSummary}=require('../../scripts/5etools/functional-convert');
const commits={main:'a'.repeat(40),homebrew:'b'.repeat(40),application:'c'.repeat(40)};
function fixture(){
 const row=(kind:string,lane:string,value:unknown,extra:Record<string,unknown>={})=>{
  const descriptor={origin:'main',path:'data/reference-fixture.json',blob:'d'.repeat(40),kind,index:0,rootArray:true,lane,sourceId:JSON.stringify(['main','FIX']),attribution:'explicitRecord',disposition:'included',valueFingerprint:digest(value),...extra};
  return {descriptor,value};
 };
 const rows=[
  row('data','publicationSection',{name:'Fixture chapter',entries:[{name:'Fixture section',entries:['Private fixture narrative']}]},{path:'data/book/book-fix.json',attribution:'publicationPath'}),
  row('table','resolverEntity',{name:'Fixture table',rows:[[1,'Fixture']]}),
  row('itemProperty','resolverEntity',{abbreviation:'FIX',entries:['Fixture definition']}),
  row('disease','resolverEntity',{name:'Fixture disease',entries:['Fixture']}),
  row('spell','resolverEntity',{name:'Fixture spell'}),
  row('unfamiliar','otherCollection',{name:'Unknown collection'}),
  row('data','publicationSection',{name:'Excluded chapter'},{path:'data/book/book-excluded.json',disposition:'excluded',sourceId:JSON.stringify(['main','EXCLUDED'])}),
  row('status','resolverEntity',{name:'Brew status'},{origin:'homebrew',sourceId:JSON.stringify(['homebrew','BREW'])}),
  row('_meta','supportMetadata',{sources:['Fixture']},{rootArray:false,index:null,disposition:'sharedSupportPending',sourceId:JSON.stringify(['main',null])})
 ];
 const body={schemaVersion:'dnd-upstream-functional-input-plan.v1',scope:'privateConversionInputs',executable:false,commits,bindings:{corpus:'fixture',scope:'fixture'},rows:rows.map(r=>r.descriptor)};
 return {plan:{...body,fingerprint:digest(body)},inputs:rows.filter(r=>r.descriptor.disposition==='included')};
}
describe('private functional reference conversion',()=>{
 test('creates source scoped consultation and definition packs, keeps mechanical reference gaps explicit',()=>{
  const {plan,inputs}=fixture(),packs=buildReferencePacks(plan,inputs);
  expect(packs).toHaveLength(3);
  expect(validateReferencePacks(plan,packs).size).toBe(4);
  const index=createReferenceIndex(plan,packs),found=index.search({query:'fixture chapter',sourceId:JSON.stringify(['main','FIX'])});
  expect(found.total).toBe(1);
  expect(index.get(found.results[0].id).content.entries[0].entries).toEqual(['Private fixture narrative']);
  expect(index.search({usage:'mechanicalReferencePending'}).results.map((r:any)=>r.kind)).toEqual(['disease']);
  expect(index.search({query:'Excluded'}).total).toBe(0);
  expect(index.search({query:'Brew'}).total).toBe(0);
  expect(index.search({limit:1,offset:1}).results).toHaveLength(1);
  const result=assembleReviewConversion(plan,[],stageImportV3,packs);
  expect(result.manifest.counts).toMatchObject({selected:7,consultationReview:2,definitionSupportReview:1,mechanicalReferencePending:1,conversionPending:1,auxiliaryPending:1,homebrewPending:1,excluded:1,sharedSupportPending:1,referenceRecords:4,exportedItems:0});
  expect(result.manifest.referenceFiles).toHaveLength(3);
  expect(result.manifest.referenceValidation).toBe('inputBound');
  expect(result.manifest.runtimeEligible).toBe(false);
  expect(JSON.stringify(publicConversionSummary(result.manifest))).not.toContain('Private fixture narrative');
  expect(buildReferencePacks(plan,[...inputs].reverse())).toEqual(packs);
 });
 test('rejects missing records, tampering and attempts to export unselected content',()=>{
  const {plan,inputs}=fixture(),packs=buildReferencePacks(plan,inputs);
  expect(()=>buildReferencePacks(plan,inputs.slice(1))).toThrow('functionalReferenceSelectionIncomplete');
  expect(()=>validateReferencePacks(plan,packs.slice(1))).toThrow('functionalReferenceCoverageMismatch');
  const altered=JSON.parse(JSON.stringify(packs)),first=altered[0];first.records[0].content={name:'Changed'};
  const {fingerprint,...body}=first;first.fingerprint=digest(body);
  expect(()=>validateReferencePacks(plan,altered)).toThrow('functionalReferenceInputMismatch');
  expect(()=>buildReferencePacks(plan,[...inputs,{descriptor:plan.rows.find(r=>r.disposition==='excluded'),value:{name:'Excluded chapter'}}])).toThrow('functionalReferenceInputMismatch');
 });
 test('writes reference artifacts even without mechanical outputs, and verifies byte hashes',()=>{
  const {plan,inputs}=fixture(),r=assembleReviewConversion(plan,[],stageImportV3,buildReferencePacks(plan,inputs)),dir=fs.mkdtempSync(path.join(os.tmpdir(),'dnd-reference-')),out=path.join(dir,'review');
  try{
   writePrivateReviewConversion(r,out,process.cwd());
   for(const f of r.manifest.referenceFiles)expect(createHash('sha256').update(fs.readFileSync(path.join(out,f.file))).digest('hex')).toBe(f.sha256);
   expect(JSON.parse(fs.readFileSync(path.join(out,'manifest.json'),'utf8')).referenceFiles).toEqual(r.manifest.referenceFiles);
   const changed=JSON.parse(JSON.stringify(r));changed.referencePacks[0].records[0].title='Changed';
   const bad=path.join(dir,'bad');
   expect(()=>writePrivateReviewConversion(changed,bad,process.cwd())).toThrow('functionalConversionReferenceFileMismatch');
   expect(fs.existsSync(bad)).toBe(false);
  }finally{fs.rmSync(dir,{recursive:true,force:true});}
 });
});
