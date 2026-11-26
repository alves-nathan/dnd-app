'use strict';
// Quarantined canonical V3 probes, separate from explicitly reviewed local export packs.
const {collect,audit,makeResolver}=require('./resolver');
const {buildInventory}=require('./inventory');
const {readBrewManifest,createPolicy,physicalCandidateId}=require('./homebrew-policy');
const {digest}=require('./integrated-review');
const {converters}=require('./pilot-coverage');
const {convertSpell}=require('./spell-converter');
const {convert:convertFeature}=require('./feature-converter');
const {convertItem,classify,definitionIndex}=require('./equipment-converter');
const {createReferenceIndex,extractReferences}=require('./reference-index');
const {inlineEdges,spellLists}=require('./tag-uid-preview');
const {compilePrerequisite}=require('./semantic-eligibility');
const {compileSpellCost}=require('./resource-spellcasting-preview');
const {compileScaling,compileDuration,formulaObservations}=require('./effect-damage-preview');
const rec=x=>x!==null&&typeof x==='object'&&!Array.isArray(x);
const text=x=>typeof x==='string'&&!!x.trim();
const norm=x=>text(x)?x.trim().toLowerCase():'';
const own=(o,k)=>Object.prototype.hasOwnProperty.call(o,k);
const dict=()=>Object.create(null);
const bump=(o,k)=>o[k]=(o[k]||0)+1;
const coord=r=>JSON.stringify([r.origin,r.path,r.kind,r.index]);
const fail=code=>{const e=Error(code);e.code=code;throw e;};
const pilotKinds=['spell','feat','equipment'];
const repo='TheGiddyLimit/homebrew';
const sourceNamespace='homebrew';
function bucket(r){return r.kind==='spell'||r.kind==='feat'?r.kind:['baseitem','item'].includes(r.kind)?'equipment':null;}
function sourceProjection(s,meta){
  // V3 requires contentType, so unclassified sources receive a TECHNICAL probe
  // value, never an editorial decision. Probes cannot enter exportPacks.
  const reviewed=s.review?.usagePolicy==='localReviewOnly'&&['homebrew','third-party'].includes(s.classification);
  return {id:s.id,book:text(meta?.full)?meta.full:s.code,status:'needsReview',confidence:'importedNeedsReview',
    rulesEra:reviewed?s.rulesEra:'unknown',contentType:reviewed?s.classification:'homebrew',
    precedenceScope:s.precedenceScope,publication:s.publication};
}
function makeExplicitIndex(records,items){
  const index=createReferenceIndex(records,items);
  // Explicit lookup only. Cross-namespace fallback permitted for exact identity
  // when local has no raw match. An existing local non-emitted identity shadows main.
  return {byId:index.byId,lookup(origin,kinds,target){
    const local=index.lookup(origin,kinds,target);
    if(origin!=='homebrew'||local.status!=='missingUpstreamIdentity')return local;
    return index.lookup('main',kinds,target);
  }};
}
function directClassAccess(e,index){
  const raw=e.classes;
  if(!rec(raw)||!Array.isArray(raw.fromClassList)||!raw.fromClassList.length||
    Object.keys(raw).some(k=>k!=='fromClassList'))fail('classAccessStructurePending');
  const direct=[],seen=new Set();
  for(const c of raw.fromClassList){
    if(!rec(c)||!text(c.name)||!text(c.source)||Object.keys(c).some(k=>!['name','source'].includes(k)))fail('classAccessQualifierPending');
    const target=index.lookup('homebrew',['class'],{name:c.name,source:c.source});
    if(target.status!=='resolvedIdentity')fail('classAccessEndpointPending');
    const item=index.byId.get(target.targetId);
    if(item?.provenance.origin!=='5etools')fail('classAccessOwnerPending');
    if(seen.has(target.targetId))fail('duplicateClassAccess');
    seen.add(target.targetId);direct.push({name:c.name,source:c.source,details:true,targetId:target.targetId});
  }
  return {classes:[...new Set(direct.map(c=>c.name))].sort(),direct:direct.map(({targetId,...c})=>c),all:raw,targetIds:[...seen].sort()};
}
function standalone(r,e){
  if(e._copy!==undefined||r.entity._copy!==undefined||e._versions!==undefined||e._templates!==undefined||e._mod!==undefined)return 'copyOrVariantPending';
  if(e.reprintedAs?.length||e.additionalSources?.length||e.otherSources?.length)return 'publicationRelationshipPending';
  if(r.kind==='feat'&&['prerequisite','additionalSpells','optionalfeatureProgression','featProgression','consumes','skillProficiencies','toolProficiencies','languageProficiencies','weaponProficiencies','armorProficiencies','expertise','savingThrowProficiencies','skillToolLanguageProficiencies'].some(k=>own(e,k)))return 'featGrantOrPrerequisitePending';
  if(bucket(r)==='equipment'){
    if(!(e.rarity==='none'||e.mundane===true&&e.rarity===undefined)||classify(e)!=='equipment')return 'equipmentKindOutsidePilot';
    if(['baseItem','attachedSpells','ammoType','packContents','additionalEntries','charges','recharge','property','mastery','weapon','armor','wondrous','bonusWeapon','bonusAc'].some(k=>own(e,k)))return 'equipmentDependencyPending';
    if(typeof e.type!=='string'||e.type.split('|').length!==2||!e.type.split('|').every(text))return 'equipmentTypeSourcePending';
  }
  return null;
}
function convertCandidate(r,resolved,s,meta,{index,defs,commit}){
  const e=resolved.entity,reason=standalone(r,e);
  if(reason)fail(reason);
  if(resolved.lineage.length)fail('copyLineagePending');
  const source=sourceProjection(s,meta),reviewed=s.review?.usagePolicy==='localReviewOnly'&&['homebrew','third-party'].includes(s.classification);
  let item,access;
  if(r.kind==='spell'){
    access=directClassAccess(e,index);
    item=convertSpell(r,resolved,{},source,{classSources:[]},commit,access);
    item.payload.classIds=access.targetIds;
  }else if(r.kind==='feat')item=convertFeature(r,resolved,source,commit);
  else{
    item=convertItem(r,resolved,source,defs,commit);
    if(item.kind!=='equipment'||item.payload.mechanics.typeReference?.resolved!==true)fail('equipmentTypeEndpointPending');
  }
  // Kind-qualified upstream key is stable even when item and baseitem share a name.
  item.id=physicalCandidateId(r);
  item.source={...item.source,...source};
  item.identity={...item.identity,precedenceScope:s.precedenceScope};
  item.precedence={relation:'unresolved',supersedes:[],reprints:[],coexistsWith:[],basis:'homebrewEditorialReviewPending'};
  item.provenance={...item.provenance,origin:sourceNamespace,repository:repo,commit,sourceCode:e.source,resolverVersion:'a6.6.2'};
  item.metadata={...item.metadata,reviewCodes:[...new Set([...(item.metadata?.reviewCodes||[]),'homebrewLocalReviewOnly','distributionBlocked',...(!reviewed?['provisionalContentType']:[])])].sort(),
    homebrewPolicy:{sourceId:s.id,sourceFingerprint:s.fingerprint,classification:s.classification,classificationProvisional:!reviewed,distribution:'blocked',activation:'review-required'}};
  return item;
}
function packFor(item){return {templateVersion:'dnd-combat-import.v3',contractRevision:'canonical-v3.1',
  id:item.source.id+':pilot:'+digest(item.id),source:item.source,metadata:{stage:'a6.6.2',activation:'review-required',distribution:'blocked',localOnly:true},items:[item]};}
function evidenceFor(item,index){
  const rows=[];
  const add=(domain,list)=>list.forEach((row,ordinal)=>{
    const fingerprint=digest({domain,ordinal,itemId:item.id,provenance:item.provenance,sourceFingerprint:item.metadata?.homebrewPolicy?.sourceFingerprint,row});
    rows.push({id:'review:'+fingerprint,fingerprint,domain,itemId:item.id,status:row.status||'structuredObservation',targetId:row.targetId,path:row.path,activation:'review-required',review:'unreviewed'});
  });
  add('reference',extractReferences(item,index));
  add('inline',inlineEdges(item,index));
  add('structuredSpell',spellLists(item,index));
  const tree=item.payload.mechanics?.prerequisiteTree;
  if(tree)add('requirement',[{tree:compilePrerequisite(tree,item,index)}]);
  if(item.kind==='spell'){
    add('spellCost',[compileSpellCost(item)]);add('scaling',compileScaling(item));add('duration',[compileDuration(item)]);
  }
  add('formula',formulaObservations(item,index));
  return rows;
}
function buildHomebrewPilot(main,homebrew,{validate,decisions=[],limitPerKind=30,attemptLimitPerKind=600,asOf=new Date().toISOString().slice(0,10)}={}){
  if(typeof validate!=='function')throw Error('stagingValidatorRequired');
  if(!Number.isSafeInteger(limitPerKind)||limitPerKind<1||limitPerKind>200||!Number.isSafeInteger(attemptLimitPerKind)||attemptLimitPerKind<limitPerKind||attemptLimitPerKind>5000)throw Error('invalidPilotLimits');
  const collection=collect(main,homebrew),structural=audit(main,homebrew,collection),inventory=buildInventory(main,homebrew,asOf),manifest=readBrewManifest(homebrew);
  const commits={main:main.commit,homebrew:homebrew.commit};
  const policy=createPolicy({manifest,collection,structural,inventory,commits,decisions});
  const mainItems=converters.flatMap(c=>require('./'+c.module).buildPilot(main).packs.flatMap(p=>p.items));
  const externalItems=mainItems.map(i=>({id:i.id,kind:i.kind,...(i.kind==='condition'?{conditionId:i.payload.conditionId}:{})}));
  const mainDigest=digest(mainItems.map(i=>[i.id,digest(i)]).sort((a,b)=>a[0].localeCompare(b[0])));
  const rawMap=new Map(collection.records.map(r=>[coord(r),r])),sourceMap=new Map(policy.sources.map(s=>[s.id,s]));
  const resolver=makeResolver(collection.records),index=makeExplicitIndex(collection.records,mainItems);
  const base=main.readJson('data/items-base.json');
  const defs={properties:definitionIndex(base.itemProperty,'abbreviation'),masteries:definitionIndex(base.itemMastery,'name'),types:definitionIndex(base.itemType,'abbreviation')};
  const byKind=Object.fromEntries(pilotKinds.map(k=>[k,{eligible:0,attempted:0,stagingValid:0,stagingInvalid:0,blocked:0,notSampled:0,exportableLocal:0,blockCodes:dict()}]));
  const observations=[],probes=[],exportPacks=[],evidence=[],ids=new Set(mainItems.map(i=>i.id)),issues=dict();
  // Stable ordering; prioritize explicitly reviewed sources without widening the pilot.
  const sorted=policy.rows.filter(x=>x.status==='structuralSourceCandidate').map(x=>({policy:x,raw:rawMap.get(x.coordinate),source:sourceMap.get(x.sourceId)})).filter(x=>x.raw&&x.source&&bucket(x.raw))
    .map(x=>({...x,preflight:!standalone(x.raw,x.raw.entity)&&(x.raw.kind!=='spell'||Array.isArray(x.raw.entity.classes?.fromClassList)&&x.raw.entity.classes.fromClassList.length>0)}))
    .sort((a,b)=>Number(!!b.source.review)-Number(!!a.source.review)||Number(!!b.preflight)-Number(!!a.preflight)||a.policy.coordinate.localeCompare(b.policy.coordinate));
  for(const x of sorted){
    const r=x.raw,s=x.source,k=bucket(r),c=byKind[k];c.eligible++;
    if(c.stagingValid>=limitPerKind||c.attempted>=attemptLimitPerKind){c.notSampled++;continue;}
    c.attempted++;
    const obs={coordinate:coord(r),sourceId:s.id,kind:k,activation:'review-required'};
    try{
      if(s.classification==='official-reproduction')fail('officialReproductionQuarantine');
      const m=manifest.files.get(s.path);
      if(!m||m.blob!==r.blob||s.blob!==r.blob)fail('sourceProvenanceMismatch');
      const meta=m.declarations.find(d=>d.index===s.declarationIndex)?.metadata;
      if(!meta)fail('sourceDeclarationMissing');
      const item=convertCandidate(r,resolver.resolve(r),s,meta,{index,defs,commit:homebrew.commit});
      if(ids.has(item.id))fail('duplicatePhysicalId');
      // Exact explicit endpoints only; no hidden dependency on a future brew output.
      const edges=[...extractReferences(item,index),...inlineEdges(item,index),...spellLists(item,index)];
      if(edges.some(e=>e.category==='reference'&&e.status!=='resolvedIdentity'||e.status==='resolvedIdentity'&&!index.byId.has(e.targetId)))fail('explicitReferenceClosurePending');
      // Structured non-identity observations are retained for review, not activated.
      if(edges.some(e=>!e.category&&!['resolvedIdentity','editionRequired','selectorPending','conditionalExpressionPending'].includes(e.status)))fail('structuredReferencePending');
      const pack=packFor(item),validation=validate(pack,{externalItems});
      if(validation.ok!==true){
        c.stagingInvalid++;obs.status='stagingInvalid';
        obs.issueCodes=[...new Set((validation.issues||[]).filter(e=>e.severity==='error').map(e=>e.code))];observations.push(obs);continue;
      }
      ids.add(item.id);c.stagingValid++;
      obs.status='stagingValid';obs.itemId=item.id;
      const reviewed=item.metadata.homebrewPolicy.classificationProvisional===false;
      obs.exportableLocal=reviewed;
      const itemEvidence=evidenceFor(item,index);
      evidence.push(...itemEvidence);
      probes.push({itemId:item.id,kind:item.kind,sourceId:s.id,coordinate:obs.coordinate,fingerprint:digest(item),evidenceIds:itemEvidence.map(e=>e.id),
        classificationProvisional:!reviewed,activation:'review-required',distribution:'blocked'});
      if(reviewed){exportPacks.push(pack);c.exportableLocal++;}
    }catch(e){c.blocked++;obs.status='blocked';obs.reason=e.code||'conversionError';bump(c.blockCodes,obs.reason);}
    observations.push(obs);
  }
  const evidenceCounts=dict();for(const e of evidence)bump(evidenceCounts[e.domain]??=dict(),e.status);
  if(new Set(evidence.map(e=>e.id)).size!==evidence.length)bump(issues,'duplicateEvidenceId');
  if(digest(mainItems.map(i=>[i.id,digest(i)]).sort((a,b)=>a[0].localeCompare(b[0])))!==mainDigest)bump(issues,'mainMutation');
  for(const c of Object.values(byKind))if(c.eligible!==c.attempted+c.notSampled||c.attempted!==c.stagingValid+c.stagingInvalid+c.blocked)bump(issues,'accountingMismatch');
  return {schemaVersion:'dnd-upstream-homebrew-pilot.v1',commits,summary:{mainItems:mainItems.length,mainDigest,byKind,probes:probes.length,exportableLocalPacks:exportPacks.length,
    evidenceOccurrences:evidence.length,evidenceCounts,issues,distributionAuthorized:0},observations,probes,evidence,exportPacks,
    activation:'review-required',scope:'bounded homebrew canonical V3 staging probes; unclassified probes never exported; no runtime activation or distribution'};
}
function publicSummary(r){return {schemaVersion:r.schemaVersion,commits:r.commits,summary:r.summary,activation:r.activation,scope:r.scope};}
module.exports={sourceProjection,makeExplicitIndex,directClassAccess,standalone,convertCandidate,packFor,evidenceFor,buildHomebrewPilot,publicSummary};
