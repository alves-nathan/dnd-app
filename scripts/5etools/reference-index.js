'use strict';
// Reference identity sidecar only. No payload mutations, eligibility or runtime activation.
const {identity,collect}=require('./resolver');
const {converters}=require('./pilot-coverage');
const own=(o,k)=>Object.prototype.hasOwnProperty.call(o,k);
const rec=x=>x!==null&&typeof x==='object'&&!Array.isArray(x);
const norm=x=>typeof x==='string'?x.trim().toLowerCase():'';
const dict=()=>Object.create(null);
const bump=(o,k)=>o[k]=(o[k]||0)+1;
const key=(origin,k,e)=>JSON.stringify([origin,identity(k,e)]);
const coordinate=(origin,path,kind,index)=>JSON.stringify([origin,path,kind,index]);
const itemKinds=['baseitem','item'];
const conditionSources={'2014':'PHB','2024':'XPHB'};
function uid(raw){
  if(typeof raw!=='string'||!raw.trim())return {status:'unsupportedExpression'};
  if(raw.includes('#')||raw.includes('{@'))return {status:'unsupportedExpression'};
  const parts=raw.split('|').map(s=>s.trim());
  if(parts.length>2||!parts[0])return {status:'unsupportedExpression'};
  if(!parts[1])return {status:'sourceRequired',name:parts[0]};
  return {name:parts[0],source:parts[1]};
}
function createReferenceIndex(records,items){
  const raw=new Map(),outputs=new Map(),byId=new Map();
  const push=(map,k,v)=>{const a=map.get(k)||[];a.push(v);map.set(k,a);};
  for(const r of records)push(raw,JSON.stringify([r.origin,r.key]),r);
  for(const i of items){
    if(byId.has(i.id))throw Error('duplicatePhysicalId');
    byId.set(i.id,i);
    const p=i.provenance;
    const origin=p.origin==='5etools'?'main':p.origin==='homebrew'?'homebrew':null;
    if(!origin)continue;
    // Templates are not aliases for arbitrary generated variants.
    if(i.metadata?.variantTemplateKey)continue;
    push(outputs,JSON.stringify([origin,p.entityKey]),i);
  }
  function lookup(origin,kinds,target){
    if(!norm(target?.source)||!norm(target?.name))return {status:'sourceRequired'};
    const matches=[],emitted=[];
    for(const k of kinds){
      let id;try{id=key(origin,k,target);}catch{return {status:'unsupportedExpression'};}
      matches.push(...(raw.get(id)||[]));
      emitted.push(...(outputs.get(id)||[]));
    }
    if(matches.length>1||emitted.length>1)return {status:'ambiguousIdentity'};
    if(matches.length===0)return {status:'missingUpstreamIdentity'};
    if(!emitted.length)return {status:'targetNotEmitted'};
    const r=matches[0],i=emitted[0],p=i.provenance;
    if(coordinate(r.origin,r.path,r.kind,r.index)!==coordinate(origin,p.path,r.kind,p.index)||r.blob!==p.blob)return {status:'provenanceMismatch'};
    return {status:'resolvedIdentity',targetId:i.id,targetKind:i.kind,targetEra:i.source.rulesEra};
  }
  return {lookup,byId};
}
function extractReferences(item,index){
  const edges=[],m=item.payload?.mechanics||{},era=item.source.rulesEra;
  const origin=item.provenance.origin==='5etools'?'main':item.provenance.origin==='homebrew'?'homebrew':null;
  if(!origin)return edges;
  function emit(relation,path,raw,result,basis){
    const crossEra=result.status==='resolvedIdentity'&&era!=='unknown'&&result.targetEra!=='unknown'&&era!==result.targetEra;
    edges.push({fromId:item.id,relation,path,raw,basis,...result,...(crossEra?{crossEra:true}:{}),activation:'review-required'});
  }
  function exact(relation,path,raw,kinds,target,basis='explicitSource'){
    emit(relation,path,raw,index.lookup(origin,kinds,target),basis);
  }
  function ref(relation,path,raw,kinds){
    const u=uid(raw);if(u.status)emit(relation,path,raw,{status:u.status},'uidRequiresExplicitSource');
    else exact(relation,path,raw,kinds,u);
  }
  const pending=(relation,path,raw,status='selectorPending')=>emit(relation,path,raw,{status},'noInferredSelection');
  function conditionRefs(relation,path,values){
    if(values===undefined||values===null)return;
    if(!Array.isArray(values)){pending(relation,path,values,'unsupportedExpression');return;}
    values.forEach((v,i)=>{
      const at=path+'/'+i;
      if(typeof v!=='string'||!norm(v)){pending(relation,at,v,'conditionalExpressionPending');return;}
      if(v.includes('|')){ref(relation,at,v,['condition']);return;}
      const source=conditionSources[era];
      if(!source||origin!=='main'){pending(relation,at,v,'editionRequired');return;}
      exact(relation,at,v,['condition'],{name:v,source},'officialConditionEditionPolicy');
    });
  }
  const spell=m.upstreamSpell;
  if(spell){
    (spell.selectedClassAccess||[]).forEach((c,i)=>exact('spellClassAccess','/mechanics/upstreamSpell/selectedClassAccess/'+i,c,['class'],c));
    conditionRefs('spellConditionInflict','/mechanics/upstreamSpell/conditionInflict',spell.conditionInflict);
    conditionRefs('spellConditionImmunity','/mechanics/upstreamSpell/conditionImmune',spell.conditionImmune);
    if(spell.access&&Object.keys(spell.access).some(k=>k!=='class'))pending('additionalSpellAccess','/mechanics/upstreamSpell/access',spell.access);
  }
  const creature=m.upstreamCreature;
  if(creature)conditionRefs('creatureConditionImmunity','/mechanics/upstreamCreature/conditionImmune',creature.conditionImmune);
  const o=m.upstreamOrigin;
  if(o)conditionRefs('speciesConditionImmunity','/mechanics/upstreamOrigin/conditionImmune',o.conditionImmune);
  // Retain all feat alternatives and nonliteral selections, not only previously matched candidates.
  if(o?.feats!==undefined){
    if(Array.isArray(o.feats))o.feats.forEach((g,i)=>{
      if(!rec(g)){pending('originFeatGrant','/mechanics/upstreamOrigin/feats/'+i,g);return;}
      for(const [k,v] of Object.entries(g)){
        const at='/mechanics/upstreamOrigin/feats/'+i+'/'+k.replace(/~/g,'~0').replace(/\//g,'~1');
        if(v===true)ref('originFeatGrant',at,k,['feat']);else pending('originFeatGrant',at,{key:k,value:v});
      }
    });else pending('originFeatGrant','/mechanics/upstreamOrigin/feats',o.feats);
  }
  function equipmentGroups(groups,path){
    if(groups===undefined)return;
    if(!Array.isArray(groups)){pending('startingEquipment',path,groups);return;}
    groups.forEach((g,i)=>{
      if(!rec(g)){pending('startingEquipment',path+'/'+i,g);return;}
      for(const [option,list] of Object.entries(g)){
        const at=path+'/'+i+'/'+option.replace(/~/g,'~0').replace(/\//g,'~1');
        if(!Array.isArray(list)){pending('startingEquipment',at,list);continue;}
        list.forEach((entry,j)=>{
          const p=at+'/'+j;
          if(typeof entry==='string')ref('startingEquipment',p,entry,itemKinds);
          else if(rec(entry)&&typeof entry.item==='string')ref('startingEquipment',p+'/item',entry.item,itemKinds);
          else if(rec(entry)&&Object.keys(entry).every(k=>k==='value')&&typeof entry.value==='number')return;
          else pending('startingEquipment',p,entry);
        });
      }
    });
  }
  if(o)equipmentGroups(o.startingEquipment,'/mechanics/upstreamOrigin/startingEquipment');
  const c=m.upstreamClassRecord;
  if(c?.startingEquipment)equipmentGroups(c.startingEquipment.defaultData??c.startingEquipment,'/mechanics/upstreamClassRecord/startingEquipment'+(c.startingEquipment.defaultData!==undefined?'/defaultData':''));
  function tree(node,path){
    if(!rec(node))return;
    if(Array.isArray(node.children))node.children.forEach((child,i)=>tree(child,path+'/children/'+i));
    if(node.op==='classLevel')exact('prerequisiteClassLevel',path,node.class,['class'],node.class);
    if(node.op==='referenceRequirement'){
      const kinds={feat:['feat'],optionalfeature:['optionalfeature'],spell:['spell'],item:itemKinds,race:['race'],background:['background']}[node.referenceType];
      if(kinds&&Array.isArray(node.raw))node.raw.forEach((v,i)=>ref('prerequisite:'+node.referenceType,path+'/raw/'+i,v,kinds));
      else pending('prerequisite:'+node.referenceType,path,node.raw);
    }
  }
  if(m.prerequisiteTree)tree(m.prerequisiteTree,'/mechanics/prerequisiteTree');
  const f=m.upstreamFeature;
  for(const [raw,path] of [[c,'/mechanics/upstreamClassRecord'],[f,'/mechanics/upstreamFeature'],[o,'/mechanics/upstreamOrigin']]){
    if(!raw)continue;
    for(const field of ['optionalfeatureProgression','featProgression','itemMasteriesProgression','additionalSpells','weaponProficiencies','armorProficiencies','toolProficiencies']){
      if(raw[field]!==undefined)pending('selection:'+field,path+'/'+field,raw[field]);
    }
  }
  const eq=m.upstreamItem;
  if(eq){
    if(eq.baseItem!==undefined)ref('magicBaseItem','/mechanics/upstreamItem/baseItem',eq.baseItem,itemKinds);
    if(eq.attachedSpells!==undefined){
      if(Array.isArray(eq.attachedSpells))eq.attachedSpells.forEach((v,i)=>ref('itemAttachedSpell','/mechanics/upstreamItem/attachedSpells/'+i,v,['spell']));
      else pending('itemAttachedSpell','/mechanics/upstreamItem/attachedSpells',eq.attachedSpells);
    }
    if(eq.ammoType!==undefined)ref('ammunition','/mechanics/upstreamItem/ammoType',eq.ammoType,itemKinds);
    if(eq.packContents!==undefined)pending('packContents','/mechanics/upstreamItem/packContents',eq.packContents);
  }
  if(item.metadata?.variantBase){
    const b=item.metadata.variantBase;
    exact('variantBase','/metadata/variantBase',b,['baseitem'],b,'explicitTemplateBase');
  }
  // Already-linked class graph: verify physical endpoints, never reconstruct by name.
  for(const [relation,field,expected] of [['classOwner','classId','class'],['subclassOwner','subclassId','subclass']]){
    if(!item.payload?.[field])continue;
    const id=item.payload[field],target=index.byId.get(id);
    emit(relation,'/payload/'+field,id,target?.kind===expected?{status:'resolvedIdentity',targetId:id,targetKind:target.kind,targetEra:target.source.rulesEra}:{status:target?'wrongTargetKind':'targetNotEmitted'},'existingPhysicalId');
  }
  for(const [i,id] of (item.payload?.featureIds||[]).entries()){
    const target=index.byId.get(id);
    emit('featureGrant','/payload/featureIds/'+i,id,target?.kind==='feature'?{status:'resolvedIdentity',targetId:id,targetKind:target.kind,targetEra:target.source.rulesEra}:{status:target?'wrongTargetKind':'targetNotEmitted'},'existingPhysicalId');
  }
  return edges;
}
function buildReferenceReport(main,homebrew){
  const {records}=collect(main,homebrew);
  const items=converters.flatMap(c=>require('./'+c.module).buildPilot(main).packs.flatMap(p=>p.items));
  const index=createReferenceIndex(records,items),edges=items.flatMap(item=>extractReferences(item,index));
  const byRelation=dict(),byStatus=dict(),bySource=dict();let crossEra=0;
  for(const e of edges){
    bump(byStatus,e.status);bump(byRelation[e.relation]??=dict(),e.status);
    const item=index.byId.get(e.fromId),source=item.provenance.sourceCode;
    bump(bySource[source]??=dict(),e.status);if(e.crossEra)crossEra++;
  }
  return {schemaVersion:'dnd-upstream-reference-report.v1',commits:{main:main.commit,homebrew:homebrew.commit},items:items.length,edges,
    byRelation,byStatus,bySource,crossEra,activation:'review-required',scope:'identity-only; no eligibility, effects, precedence or runtime promotion'};
}
function publicSummary(r){const {edges,...rest}=r;return {...rest,edgeCount:edges.length};}
module.exports={uid,createReferenceIndex,extractReferences,buildReferenceReport,publicSummary};
