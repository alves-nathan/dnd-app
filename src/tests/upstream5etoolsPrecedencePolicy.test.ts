import * as fs from 'node:fs';
import {compendiumImportV3Schema} from '../compendium/importV3Schemas';
import {validateV3Precedence} from '../compendium/importV3Staging';
const {identity}=require('../../scripts/5etools/resolver');
const {openSnapshot}=require('../../scripts/5etools/inventory');
const {parseReprint,chronology,compatibility,previewPrecedence,buildPrecedenceReport,publicSummary}=require('../../scripts/5etools/precedence-policy');
const sha='a'.repeat(40),blob='b'.repeat(40);
function fixture(id:string,source:string,era:string,date:string,refs:unknown[]=[],extra:Record<string,unknown>={}){
  const entity={name:'Fixture',source,reprintedAs:refs},key=identity('spell',entity);
  const record={kind:'spell',origin:'main',key,entity,path:'fixture-'+id+'.json',index:0,blob};
  const item={id,kind:'spell',name:'Fixture',source:{rulesEra:era,status:'needsReview',contentType:'official',precedenceScope:'official-dnd',publication:{precision:'day',date,year:Number(date.slice(0,4))}},
    identity:{canonicalKey:'spell:fixture',precedenceScope:'official-dnd'},provenance:{origin:'5etools',entityKey:key,path:record.path,index:0,blob,commit:sha,sourceCode:source},
    precedence:{relation:'unresolved'},payload:{},...extra};
  return {record,item};
}
const preview=(pairs:ReturnType<typeof fixture>[],decisions:unknown[]=[])=>previewPrecedence(pairs.map(p=>p.item),pairs.map(p=>p.record),decisions);
const find=(r:any,id:string)=>r.previewItems.find((i:any)=>i.id===id).precedence;
function approval(a:ReturnType<typeof fixture>,b:ReturnType<typeof fixture>){
  return {fromId:a.item.id,targetId:b.item.id,relation:'supersedes',approved:true,evidence:'synthetic editorial review',fromCommit:sha,fromBlob:blob,toCommit:sha,toBlob:blob};
}
describe('precedence and edition policy',()=>{
  test('orients explicit reprint new to old without replacing cross-era content',()=>{
    const a=fixture('a','PHB','2014','2014-08-19',['Fixture|XPHB']),b=fixture('b','XPHB','2024','2024-09-17');
    const before=JSON.stringify([a,b]),r=preview([a,b]);
    expect(find(r,'b')).toMatchObject({relation:'reprint',reprints:['a'],supersedes:[],coexistsWith:[]});
    expect(find(r,'a').supersedes).toEqual([]);
    expect(r.declarationsByStatus).toEqual({reprintProposed:1});
    expect(compatibility(a.item,b.item)).toBe('crossEraReviewRequired');
    expect(JSON.stringify([a,b])).toBe(before);
  });
  test('coexists across known eras, never elects newest same-era or assumes original',()=>{
    const a=fixture('a','PHB','2014','2014-08-19'),b=fixture('b','XPHB','2024','2024-09-17'),c=fixture('c','Other','2024','2025-01-01');
    const r=preview([a,b,c]);
    expect(find(r,'a').coexistsWith).toEqual(['b','c']);
    expect(find(r,'b').coexistsWith).toEqual(['a']);
    expect(find(r,'c').supersedes).toEqual([]);
    expect(find(preview([c]),'c').relation).toBe('unresolved');
  });
  test('requires reviewed exact same-era decision and strictly later evidence for supersedes',()=>{
    const a=fixture('a','Old','2024','2024-09-17',['Fixture|New']),b=fixture('b','New','2024','2025-01-01');
    expect(find(preview([a,b]),'b').relation).toBe('reprint');
    const r=preview([a,b],[approval(b,a)]);
    expect(find(r,'b')).toMatchObject({relation:'supersedes',supersedes:['a'],reprints:[]});
    expect(preview([a,b],[{...approval(b,a),approved:false}]).decisionsByStatus).toEqual({approvalOrEvidenceRequired:1});
    expect(preview([a,b],[approval(a,b)]).decisionsByStatus).toEqual({publicationReversed:1});
    const legacy=fixture('l','Legacy','2014','2014-01-01');
    expect(preview([legacy,b],[approval(b,legacy)]).decisionsByStatus).toEqual({crossOrUnknownEraSupersedes:1});
  });
  test('does not infer publication order from overlapping precision',()=>{
    const a=fixture('a','Old','2024','2024-01-01'),b=fixture('b','New','2024','2024-09-17');
    expect(chronology({...b.item,source:{...b.item.source,publication:{precision:'year',year:2024}}},a.item)).toBe('publicationOverlap');
    expect(chronology(b.item,{...a.item,source:{...a.item.source,publication:{precision:'unknown',year:null}}})).toBe('publicationUnknown');
  });
  test('parses explicit subclass owners, defers cross-kind and owner-dependent UIDs',()=>{
    expect(parseReprint('Fixture|Fighter|XPHB|XPHB','subclass')).toEqual({kind:'subclass',target:{name:'Fixture',shortName:'Fixture',className:'Fighter',classSource:'XPHB',source:'XPHB'}});
    expect(parseReprint({uid:'Fixture|XPHB',tag:'feat'},'optionalfeature')).toEqual({status:'crossKindDeclaration'});
    expect(parseReprint('Fixture|XPHB','subrace')).toEqual({status:'ownerOrVariantDeclarationPending'});
  });
  test('rejects unknown scope, ambiguous endpoints and reversed declaration without selecting a fallback',()=>{
    const a=fixture('a','PHB','2014','2014-08-19',['Fixture|XPHB','Fixture|Other']),b=fixture('b','XPHB','2024','2024-09-17');
    const r=preview([a,b,{...b,record:{...b.record,path:'duplicate.json'},item:{...b.item,id:'duplicate',provenance:{...b.item.provenance,path:'duplicate.json'}}}]);
    expect(r.declarationsByStatus).toMatchObject({ambiguousIdentity:1,missingUpstreamIdentity:1});
    const reverse=fixture('r','New','2024','2025-01-01',['Fixture|PHB']);
    expect(preview([a,reverse]).declarationsByStatus.publicationReversed).toBe(1);
    expect(compatibility(a.item,{...b.item,source:{...b.item.source,contentType:'third-party'}})).toBe('scopeReviewRequired');
  });
});
const mainPath=process.env.DND_UPSTREAM_PRECEDENCE_MAIN,brewPath=process.env.DND_UPSTREAM_PRECEDENCE_BREW;
(mainPath&&brewPath?test:test.skip)('real precedence preview validates the full V3 precedence graph without activation',()=>{
  if(!mainPath||!brewPath)throw Error('missing snapshots');
  const r=buildPrecedenceReport(openSnapshot(mainPath),openSnapshot(brewPath));
  console.log(JSON.stringify(publicSummary(r)));
  const pack={templateVersion:'dnd-combat-import.v3',contractRevision:'canonical-v3.1',id:'precedence-preview',source:r.packSource,items:r.previewItems};
  const parsed=compendiumImportV3Schema.safeParse(pack);
  expect(parsed.success).toBe(true);
  if(!parsed.success)throw Error('preview schema invalid');
  const issues=validateV3Precedence(parsed.data);
  expect(issues.filter(i=>i.severity==='error').map(i=>i.code)).toEqual([]);
  expect(r.issues).toEqual({});
  expect(r.edgeCounts.reprints).toBeGreaterThan(0);
  expect(r.edgeCounts.supersedes).toBe(0);
  expect(r.byCompatibility.crossEraReviewRequired).toBeGreaterThan(0);
  expect(r.previewItems.every((i:any)=>i.source.status==='needsReview')).toBe(true);
  const out=process.env.DND_UPSTREAM_PRECEDENCE_OUT;
  if(out)fs.writeFileSync(out,JSON.stringify({...publicSummary(r),precedence:r.previewItems.map((i:any)=>({id:i.id,precedence:i.precedence})),declarations:r.declarations,referenceCompatibility:r.referenceCompatibility},null,2)+'\n',{flag:'wx'});
},240000);
