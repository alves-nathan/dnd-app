'use strict';
// Offline structural previews. No new V3 IDs, no owner rewrites, no automatic grants.
const {identity,collect,makeResolver,applyMods}=require('./resolver');
const {buildPilot:classPilot,physicalId}=require('./class-converter');
const {matches,expand,buildPilot:magicPilot,pilot:magicSources}=require('./magic-item-converter');
const {createHash}=require('node:crypto');
const rec=x=>x!==null&&typeof x==='object'&&!Array.isArray(x);
const own=(o,k)=>Object.prototype.hasOwnProperty.call(o,k);
const clone=x=>JSON.parse(JSON.stringify(x));
const norm=x=>typeof x==='string'?x.trim().toLowerCase():'';
const dict=()=>Object.create(null);
const bump=(o,k)=>o[k]=(o[k]||0)+1;
const fail=code=>{const e=Error(code);e.code=code;throw e;};
const safe=k=>!['__proto__','prototype','constructor'].includes(k);
const coordinate=r=>({origin:r.origin,path:r.path,index:r.index,blob:r.blob,kind:r.kind,key:r.key});
const templatePath='data/bestiary/template.json';
const identFields=['name','shortName','source','className','classSource','subclassShortName','subclassSource','raceName','raceSource','level'];
function checked(value){
  if(typeof value==='string'&&(/\{\{|\<\$/.test(value)))fail('dynamicValuePending');
  if(Array.isArray(value))value.forEach(checked);
  else if(rec(value))for(const [k,v] of Object.entries(value)){if(!safe(k))fail('unsafeProperty');checked(v);}
}
function createTemplateIndex(snapshot){
  const map=new Map();
  if(!snapshot.files.has(templatePath))return map;
  const j=snapshot.readJson(templatePath);
  for(const [kind,field] of [['monster','monsterTemplate'],['legendaryGroup','legendaryGroupTemplate']]){
    if(!Array.isArray(j[field]))fail('invalidTemplateCollection');
    for(const [index,entity] of j[field].entries()){
      const key=identity(field,entity),id=JSON.stringify(['main',key]),a=map.get(id)||[];
      a.push({origin:'main',kind:field,key,path:templatePath,index,blob:snapshot.files.get(templatePath),entity});
      map.set(id,a);
    }
  }
  return map;
}
function appendMods(target,mods){
  if(mods===undefined)return;
  if(!rec(mods))fail('invalidTemplateMods');
  checked(mods);
  for(const [k,v] of Object.entries(mods)){
    if(!safe(k))fail('unsafeProperty');
    target[k]=[...(target[k]||[]),...(Array.isArray(v)?clone(v):[clone(v)])];
  }
}
// Apply the explicit template subset in original declaration order. Child root values win;
// templates then contribute root values and append mods to the child's existing operations.
function previewExternalTemplate(r,resolver,templates){
  if(r.origin!=='main'||!['monster','legendaryGroup'].includes(r.kind))fail('templateNamespaceOrKindPending');
  const raw=r.entity,meta=raw._copy;
  if(!rec(meta)||!Array.isArray(meta._templates)||!meta._templates.length)fail('invalidTemplateReference');
  if(own(raw,'_versions')||own(raw,'_templates')||own(raw,'_mod'))fail('nestedTemplateOrVersionPending');
  if(Object.keys(meta).some(k=>![...identFields,'_preserve','_mod','_templates'].includes(k)))fail('unsupportedCopyMetadata');
  if(resolver.lookup(r.origin,r.kind,raw).id!==r.id)fail('ambiguousIdentity');
  const parent=resolver.lookup(r.origin,r.kind,meta),resolved=resolver.resolve(parent);
  const entity=clone(raw),rootKeys=new Set(Object.keys(entity)),mods=dict(),lineage=[];
  delete entity._copy;
  // Reuse existing copy policy and preserve semantics, but defer modifications until roots applied.
  const base={...parent,entity:resolved.entity};
  const child={...r,entity:{...entity,_copy:Object.fromEntries(Object.entries(meta).filter(([k])=>k!=='_mod'&&k!=='_templates'))}};
  const merged=makeResolver([base,child]).resolve(child).entity;
  appendMods(mods,meta._mod);
  for(const ref of meta._templates){
    if(!rec(ref)||Object.keys(ref).some(k=>!['name','source'].includes(k)))fail('invalidTemplateReference');
    const key=identity(r.kind+'Template',ref),matches=templates.get(JSON.stringify(['main',key]))||[];
    if(matches.length!==1)fail(matches.length?'ambiguousTemplate':'missingTemplate');
    const t=matches[0],a=t.entity.apply;
    if(!rec(a)||Object.keys(a).some(k=>!['_root','_mod'].includes(k)))fail('unsupportedTemplateApply');
    if(t.entity.prerequisite!==undefined)fail('templatePrerequisitePending');
    if(a._root!==undefined){
      if(!rec(a._root))fail('invalidTemplateRoot');
      checked(a._root);
      for(const [k,v] of Object.entries(a._root)){
        if(!safe(k)||identFields.includes(k)||k.startsWith('_'))fail('unsafeTemplateRoot');
        if(!rootKeys.has(k))merged[k]=clone(v);
      }
    }
    appendMods(mods,a._mod);lineage.push(coordinate(t));
  }
  applyMods(merged,mods);
  if(identity(r.kind,merged)!==r.key)fail('identityChangedByMod');
  if(merged._copy||merged._versions||merged._templates||merged._mod)fail('nestedTemplateOrVersionPending');
  return {entity:merged,baseLineage:[parent.id,...resolved.lineage],templateLineage:lineage};
}
function substitute(value,vars){
  if(typeof value==='string')return value.replace(/\{\{([^{}]+)\}\}/g,(_,k)=>{
    if(!own(vars,k)||!['string','number','boolean'].includes(typeof vars[k])||
      typeof vars[k]==='number'&&!Number.isFinite(vars[k]))fail('versionVariablePending');
    return String(vars[k]);
  });
  if(Array.isArray(value))return value.map(v=>substitute(v,vars));
  if(rec(value)){
    const out=dict();for(const [k,v] of Object.entries(value)){if(!safe(k)||k.includes('{{'))fail('unsafeProperty');out[k]=substitute(v,vars);}return out;
  }
  return value;
}
function versionSpecs(container){
  if(!rec(container))fail('invalidVersion');
  if(own(container,'_abstract')||own(container,'_implementations')){
    if(!rec(container._abstract)||!Array.isArray(container._implementations)||!container._implementations.length||
      Object.keys(container).some(k=>!['_abstract','_implementations'].includes(k)))fail('unsupportedVersionTemplate');
    return container._implementations.map((impl,index)=>{
      try{
        if(!rec(impl)||impl._variables!==undefined&&!rec(impl._variables))fail('invalidVersionImplementation');
        if(Object.keys(impl).some(k=>k.startsWith('_')&&k!=='_variables'))fail('implementationControlMetadataPending');
        // The abstract's operations are inherited unless explicitly replaced by the implementation.
        const a=substitute(container._abstract,impl._variables||{}),b=clone(impl);
        delete b._variables;
        const spec={...a,...b};checked(spec);
        return {implementation:index,spec};
      }catch(e){return {implementation:index,status:e.code||'versionError'};}
    });
  }
  return [{implementation:null,spec:clone(container)}];
}
function previewVersion(parent,baseEntity,spec,existingKeys){
  if(!rec(spec)||Object.keys(spec).some(k=>!safe(k)||k.startsWith('_')&&!['_mod','_preserve'].includes(k)))fail('unsupportedVersionMetadata');
  checked(spec);
  if(!norm(spec.name)||!norm(spec.source))fail('versionIdentityPending');
  const base=clone(baseEntity);
  for(const k of ['_versions','hasToken','hasFluff','hasFluffImages'])delete base[k];
  for(const k of ['additionalSources','otherSources','referenceSources']){
    if(base[k]!==undefined&&!Array.isArray(base[k]))fail('invalidVersionSources');
    if(Array.isArray(base[k])){if(base[k].some(x=>!rec(x)||typeof x.source!=='string'))fail('invalidVersionSources');base[k]=base[k].filter(x=>x.source!==spec.source);}
    if(!base[k]?.length)delete base[k];
  }
  // Owner fields are inherited, never invented. A changed owner is not a simple version.
  const child=clone(spec);
  for(const k of identFields.filter(k=>!['name','source','shortName'].includes(k))){
    if(own(child,k)&&child[k]!==base[k])fail('versionOwnerChangePending');
    if(!own(child,k)&&own(base,k))child[k]=base[k];
  }
  const key=identity(parent.kind,child),id=JSON.stringify([parent.origin,key]);
  if(existingKeys.has(id)||key===parent.key)fail('versionIdentityCollision');
  const target=Object.fromEntries(identFields.filter(k=>own(base,k)).map(k=>[k,base[k]]));
  const preserve=child._preserve===undefined?{'*':true}:child._preserve;
  if(!rec(preserve)||Object.entries(preserve).some(([k,v])=>!safe(k)||typeof v!=='boolean'))fail('invalidVersionPreserve');
  const mods=child._mod;delete child._mod;delete child._preserve;
  child._copy={...target,_preserve:preserve,...(mods===undefined?{}:{_mod:mods})};
  const r={...parent,id,key,entity:child};
  const entity=makeResolver([{...parent,entity:base},r]).resolve(r).entity;
  checked(entity);
  return {key,id,entity};
}
// Cross-owner grant evidence: only exact copy ancestry and membership in the old owner list.
// Never change payload.classId/subclassId, and never bypass the V2 owner check.
function crossOwnerCandidates(records,emittedIds){
  const resolver=makeResolver(records),out=[];
  for(const r of records){
    if(r.kind!=='subclass'||r.origin!=='main'||!rec(r.entity._copy))continue;
    const raw=r.entity,meta=raw._copy;
    if(norm(raw.classSource)===norm(meta.classSource))continue;
    const row={owner:coordinate(r),ownerId:physicalId(r.kind,raw),ownerEmitted:emittedIds.has(physicalId(r.kind,raw)),grants:[],activation:'review-required'};
    try{
      const base=resolver.lookup('main','subclass',meta);
      if(norm(raw.className)!==norm(base.entity.className)||norm(raw.shortName)!==norm(base.entity.shortName)||norm(raw.source)!==norm(base.entity.source))fail('ownerAliasIdentityMismatch');
      const child=resolver.resolve(r),old=resolver.resolve(base);
      const baseOwner=base.id;
      if(!child.lineage.includes(baseOwner))fail('ownerAliasLineageMismatch');
      if(!Array.isArray(child.entity.subclassFeatures)||!Array.isArray(old.entity.subclassFeatures))fail('invalidFeatureList');
      const get=ref=>resolver.lookup('main','subclassFeature',resolver.featureTarget('subclassFeature',typeof ref==='string'?ref:ref?.subclassFeature));
      const owner=e=>resolver.lookup('main','subclass',{shortName:e.subclassShortName,source:e.subclassSource,className:e.className,classSource:e.classSource});
      const original=new Set(old.entity.subclassFeatures.map(ref=>get(ref).id));
      row.baseOwner=coordinate(base);row.baseOwnerId=physicalId(base.kind,base.entity);
      for(const [index,ref] of child.entity.subclassFeatures.entries()){
        const grant={index,raw:ref};
        try{
          const target=get(ref),resolved=resolver.resolve(target),o=owner(resolved.entity),id=physicalId(target.kind,target.entity);
          grant.targetId=id;grant.target=coordinate(target);grant.level=Number(resolved.entity.level);grant.targetEmitted=emittedIds.has(id);
          if(o.id===r.id)grant.status='sameOwner';
          else if(o.id===baseOwner&&original.has(target.id))grant.status='inheritedCrossOwnerCandidate';
          else grant.status='crossOwnerUnproven';
        }catch(e){grant.status=e.code||'grantResolutionError';}
        row.grants.push(grant);
      }
      row.status=row.grants.some(g=>g.status==='inheritedCrossOwnerCandidate')&&row.grants.every(g=>['sameOwner','inheritedCrossOwnerCandidate'].includes(g.status))?'completeAliasCandidate':'ownerOrGrantReviewPending';
    }catch(e){row.status=e.code||'ownerResolutionError';}
    out.push(row);
  }
  return out;
}
// Enumerate structurally expanded pairs from resolved bases, retaining input provenance.
function previewMagicCandidates(records,resolver,emitted){
  const rows=[],byId=new Map(),bases=[];
  for(const b of records.filter(r=>r.kind==='baseitem'&&r.path==='data/items-base.json')){
    try{bases.push({record:b,entity:resolver.resolve(b).entity});}
    catch(e){rows.push({base:coordinate(b),status:e.code||'baseResolutionPending'});}
  }
  for(const t of records.filter(r=>r.kind==='magicvariant'&&r.path==='data/magicvariants.json'&&own(magicSources,r.entity.source))){
    let rt;
    try{rt=resolver.resolve(t).entity;if(rt.inherits?.source!==t.entity.source)fail('variantSourceMismatch');}
    catch(e){rows.push({template:coordinate(t),status:e.code||'templateResolutionPending'});continue;}
    let selectorFailed=false,matched=0;
    for(const b of bases){
      let match;
      try{match=matches(b.entity,rt);}catch(e){rows.push({template:coordinate(t),status:e.code||'selectorPending'});selectorFailed=true;break;}
      if(!match)continue;
      matched++;
      const row={template:coordinate(t),base:coordinate(b.record),activation:'review-required'};
      try{
        const candidate=expand(b.entity,rt);
        const id='upstream:main:magicItem:'+createHash('sha256').update(JSON.stringify(['variant',t.key,identity('baseitem',b.entity)])).digest('hex');
        row.candidateId=id;row.status=emitted.has(id)?'matchedExistingOutput':'newStructuralCandidate';
        row.entity=candidate;
        const a=byId.get(id)||[];a.push(row);byId.set(id,a);
      }catch(e){row.status=e.code||'expansionPending';}
      rows.push(row);
    }
    if(!matched&&!selectorFailed)rows.push({template:coordinate(t),status:'templateWithoutResolvedBaseMatch'});
  }
  for(const a of byId.values())if(a.length>1)for(const row of a){row.status='duplicateCandidateIdentity';delete row.entity;delete row.candidateId;}
  return rows;
}
function buildVariantReport(main,homebrew,context){
  const {records,invalidRecords}=context?.collection??collect(main,homebrew);
  const local=records.filter(r=>r.origin==='main'),resolver=makeResolver(local);
  const templates=createTemplateIndex(main),external=[],versions=[],aliases=[],magic=[];
  const existing=new Set(local.map(r=>r.id));
  for(const r of local){
    if(r.entity._copy?._templates!==undefined){
      const row={record:coordinate(r),activation:'review-required'};
      try{const result=previewExternalTemplate(r,resolver,templates);Object.assign(row,{status:'structuralPreview',...result});}
      catch(e){row.status=e.code||'templateError';}
      external.push(row);
    }
  }
  // Resolve parents with version containers removed only for this preview, not in the normal resolver.
  const versionRecords=local.filter(r=>['race','subrace','monster','legendaryGroup'].includes(r.kind)).map(r=>{
    const entity={...r.entity};delete entity._versions;return {...r,entity};
  });
  const versionResolver=makeResolver(versionRecords),parents=new Map(versionRecords.map(r=>[r.id,r]));
  const generated=new Map();
  for(const r of local){
    if(r.entity._versions===undefined)continue;
    if(!Array.isArray(r.entity._versions)){versions.push({record:coordinate(r),status:'invalidVersionCollection'});continue;}
    for(const [index,container] of r.entity._versions.entries()){
      let specs;try{specs=versionSpecs(container);}catch(e){versions.push({record:coordinate(r),index,status:e.code||'versionError'});continue;}
      for(const v of specs){
        const row={record:coordinate(r),index,implementation:v.implementation,activation:'review-required'};
        try{
          if(v.status)fail(v.status);
          const parent=parents.get(r.id);if(!parent)fail('versionKindPending');
          const base=versionResolver.resolve(parent).entity;
          const result=previewVersion(parent,base,v.spec,existing);
          Object.assign(row,{status:'structuralPreview',...result});
          const a=generated.get(result.id)||[];a.push(row);generated.set(result.id,a);
        }catch(e){row.status=e.code||'versionError';}
        versions.push(row);
      }
    }
  }
  for(const a of generated.values())if(a.length>1)for(const row of a){row.status='duplicateGeneratedIdentity';delete row.entity;delete row.id;}
  for(const r of invalidRecords.filter(r=>r.origin==='main'&&r.kind==='subrace'&&rec(r.entity)&&!norm(r.entity.name))){
    versions.push({record:coordinate(r),status:'anonymousSubraceIdentityPending',activation:'review-required'});
  }
  const classResult=context?.runs.find(r=>r.stage==='a5.7')?.result??classPilot(main),emittedIds=new Set(classResult.packs.flatMap(p=>p.items.map(i=>i.id)));
  aliases.push(...crossOwnerCandidates(local.filter(r=>['class','subclass','classFeature','subclassFeature'].includes(r.kind)),emittedIds));
  // Independently verify existing magic variants against a resolved base, without changing output.
  const magicResult=context?.runs.find(r=>r.stage==='a5.4')?.result??magicPilot(main),byCoordinate=new Map(local.map(r=>[JSON.stringify([r.path,r.kind,r.index]),r]));
  for(const item of magicResult.packs.flatMap(p=>p.items)){
    const b=item.metadata?.variantBase;if(!b)continue;
    const p=item.provenance,row={itemId:item.id,activation:'review-required'};
    try{
      const base=byCoordinate.get(JSON.stringify([b.path,'baseitem',b.index])),t=byCoordinate.get(JSON.stringify([p.path,'magicvariant',p.index]));
      if(!base||!t||base.blob!==b.blob||t.blob!==p.blob||t.key!==p.entityKey)fail('variantProvenanceMismatch');
      const rb=resolver.resolve(base).entity,rt=resolver.resolve(t).entity;
      if(!matches(rb,rt))fail('resolvedBaseSelectorMismatch');
      const candidate=expand(rb,rt);
      if(candidate.name!==item.name||candidate.source!==p.sourceCode)fail('resolvedVariantIdentityMismatch');
      row.status='resolvedBaseStructuralMatch';
    }catch(e){row.status=e.code||'variantReviewPending';}
    magic.push(row);
  }
  const magicCandidates=previewMagicCandidates(local,resolver,new Set(magicResult.packs.flatMap(p=>p.items.map(i=>i.id))));
  const counts=list=>list.reduce((a,r)=>(bump(a,r.status),a),dict());
  return {schemaVersion:'dnd-upstream-variant-lineage-preview.v1',commits:{main:main.commit,homebrew:homebrew.commit},
    external,versions,aliases,magic,magicCandidates,summary:{templateDefinitions:[...templates.values()].reduce((n,a)=>n+a.length,0),
      external:counts(external),versions:counts(versions),aliases:counts(aliases),aliasGrants:counts(aliases.flatMap(a=>a.grants)),magic:counts(magic),magicCandidates:counts(magicCandidates)},
    activation:'review-required',scope:'main structural preview only; no V3 emission, owner changes, eligibility or mechanical equivalence'};
}
function publicSummary(r){return {schemaVersion:r.schemaVersion,commits:r.commits,summary:r.summary,activation:r.activation,scope:r.scope};}
module.exports={createTemplateIndex,previewExternalTemplate,versionSpecs,previewVersion,crossOwnerCandidates,previewMagicCandidates,buildVariantReport,publicSummary};
