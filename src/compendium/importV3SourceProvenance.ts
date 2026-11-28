import {sha256Hex} from '../catalog/catalogBundleDigest';
import type {CompendiumImportV3Input} from './importV3Schemas';

type Source=CompendiumImportV3Input['source'];
const canonical=(v:unknown):unknown=>{
 if(v===null||typeof v==='string'||typeof v==='boolean'||typeof v==='number'&&Number.isFinite(v))return v;
 if(Array.isArray(v))return v.map(canonical);
 if(v&&typeof v==='object'&&(Object.getPrototypeOf(v)===Object.prototype||Object.getPrototypeOf(v)===null)){
  const r=v as Record<string,unknown>;
  return Object.fromEntries(Object.keys(r).sort().filter(k=>r[k]!==undefined).map(k=>[k,canonical(r[k])]));
 }
 throw Error('invalidProvenanceData');
};
const digest=(v:unknown)=>sha256Hex(JSON.stringify(canonical(v)));
const bump=(m:Map<string,number>,k:string)=>m.set(k,(m.get(k)??0)+1);
const append=(m:Map<string,Set<string>>,k:string,v:string)=>{
 const set=m.get(k)??new Set<string>();set.add(v);m.set(k,set);
};
const variants=(m:Map<string,Set<string>>)=>[...m.values()].filter(s=>s.size>1).length;
const repeated=(m:Map<string,number>)=>[...m.values()].reduce((n,v)=>n+Math.max(0,v-1),0);
// Item-level page, notes, confidence and status do not define publication
// identity. Publication evidence wording is tracked separately from date.
const definition=(s:Source)=>({
 id:s.id,book:s.book??null,publisher:s.publisher??null,version:s.version??null,
 rulesEra:s.rulesEra,contentType:s.contentType,precedenceScope:s.precedenceScope,
 publication:{precision:s.publication.precision,year:s.publication.year,date:s.publication.date,
  month:s.publication.precision==='month'?s.publication.month:null}
});
/** Deterministic provenance inventory of parsed canonical V3 claims only.
 * No filesystem/network access, no licensing inference, no activation.
 * An asserted Git coordinate is not proof that a blob or entity exists. */
export function buildV3SourceProvenanceReview(pack:CompendiumImportV3Input){
 const definitions=new Map<string,Set<string>>(),publicationEvidence=new Map<string,Set<string>>();
 const sources=new Map<string,number>(),fileBlobs=new Map<string,Set<string>>();
 const codeOwners=new Map<string,Set<string>>(),sourceCodes=new Map<string,Set<string>>();
 const coordinates=new Map<string,number>(),physicalKeys=new Map<string,number>(),commits=new Set<string>();
 const observations:Array<{coordinate:readonly (string|number)[];fingerprint:string}>=[];
 const originCounts={fiveTools:0,homebrew:0,manual:0,legacy:0};
 const eras={legacy2014:0,revised2024:0,unknown:0};
 const precision={day:0,month:0,year:0,unknown:0};
 const contentTypes={official:0,'third-party':0,homebrew:0};
 let missingBook=0,missingVersion=0,namespaceMismatch=0;
 const addSource=(s:Source)=>{append(definitions,s.id,digest(definition(s)));append(publicationEvidence,s.id,digest(s.publication.evidence));};
 addSource(pack.source);
 for(const [i,item] of pack.items.entries()){
  const s=item.source,p=item.provenance;addSource(s);bump(sources,s.id);
  eras[s.rulesEra==='2014'?'legacy2014':s.rulesEra==='2024'?'revised2024':'unknown']++;
  precision[s.publication.precision]++;contentTypes[s.contentType]++;
  if(!s.book?.trim())missingBook++;
  if(!s.version?.trim())missingVersion++;
  if(p.origin==='5etools'||p.origin==='homebrew'){
   originCounts[p.origin==='5etools'?'fiveTools':'homebrew']++;
   const namespace=[p.origin,p.repository],file=[...namespace,p.commit,p.path];
   commits.add(JSON.stringify([...namespace,p.commit]));
   append(fileBlobs,JSON.stringify(file),p.blob);
   append(codeOwners,JSON.stringify([...namespace,p.sourceCode.toLowerCase()]),s.id);
   append(sourceCodes,s.id,JSON.stringify([...namespace,p.sourceCode]));
   bump(coordinates,JSON.stringify([...file,item.kind,p.index,p.entityKey]));
   bump(physicalKeys,JSON.stringify([...namespace,p.commit,item.kind,p.entityKey]));
   if(p.origin==='5etools'&&(p.repository!=='5etools-mirror-3/5etools-src'||s.id!=='upstream:main:'+p.sourceCode))namespaceMismatch++;
  }else if(p.origin==='manual')originCounts.manual++;
  else originCounts.legacy++;
  observations.push({coordinate:['items',i],fingerprint:digest({id:item.id,kind:item.kind,source:s,identity:item.identity,provenance:p})});
 }
 const body={
  schemaVersion:'dnd-v3-source-provenance-review.v1' as const,
  summary:{itemOccurrences:pack.items.length,sourceDefinitions:definitions.size,itemSources:sources.size,packOnlySource:sources.has(pack.source.id)?0:1,
   origins:originCounts,eras,publicationPrecision:precision,contentTypes,unknownBookOccurrences:missingBook,unknownVersionOccurrences:missingVersion,
   sourceDefinitionVariants:variants(definitions),publicationEvidenceVariants:variants(publicationEvidence),sourceCodeOwnerVariants:variants(codeOwners),sourceOriginVariants:variants(sourceCodes),
   fileCoordinates:fileBlobs.size,fileBlobConflicts:variants(fileBlobs),repeatedCoordinates:repeated(coordinates),repeatedPhysicalKeys:repeated(physicalKeys),upstreamSnapshots:commits.size,namespaceMismatch},
  provenanceFingerprint:digest({packId:pack.id,source:pack.source,observations}),
  scope:'privateLocalReview' as const,upstreamBytes:'notVerified' as const,
  rights:'notEstablished' as const,distributionAuthorized:false as const,writeAuthorized:false as const,executable:false as const
 };
 return {...body,fingerprint:digest(body)};
}
export type V3SourceProvenanceReview=ReturnType<typeof buildV3SourceProvenanceReview>;
