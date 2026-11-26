'use strict';
// Inline markup and structured UID refinement. Never execute formulas, filters or redirects.
const {collect}=require('./resolver');
const {converters}=require('./pilot-coverage');
const {createReferenceIndex,extractReferences}=require('./reference-index');
const rec=x=>x!==null&&typeof x==='object'&&!Array.isArray(x);
const own=(o,k)=>Object.prototype.hasOwnProperty.call(o,k);
const dict=()=>Object.create(null);
const bump=(o,k)=>o[k]=(o[k]||0)+1;
const ptr=k=>String(k).replace(/~/g,'~0').replace(/\//g,'~1');
// Defaults from render.js Renderer.tag and utils.js DataUtil.class, pinned upstream.
const tags=Object.freeze({
  spell:[['spell'],'PHB'],item:[['item','baseitem','itemGroup','magicvariant'],'DMG'],
  creature:[['monster'],'MM'],condition:[['condition'],'PHB'],status:[['status'],'PHB'],disease:[['disease'],'DMG'],
  feat:[['feat'],'PHB'],optfeature:[['optionalfeature'],'PHB'],race:[['race'],'PHB'],
  background:[['background'],'PHB'],class:[['class'],'PHB'],subclass:[['subclass'],'PHB'],
  classFeature:[['classFeature'],'PHB'],subclassFeature:[['subclassFeature'],'PHB'],
  action:[['action'],'PHB'],itemProperty:[['itemProperty'],'PHB'],itemMastery:[['itemMastery'],'XPHB'],
  skill:[['skill'],'PHB'],language:[['language'],'PHB'],sense:[['sense'],'PHB'],
  legroup:[['legendaryGroup'],'MM'],reward:[['reward'],'DMG'],vehicle:[['vehicle'],'GoS'],
  hazard:[['hazard'],'DMG'],trap:[['trap'],'DMG'],object:[['object'],'DMG'],
  variantrule:[['variantrule'],'DMG'],table:[['table','tableGroup'],'DMG'],facility:[['facility'],'XDMG']
});
const formatting=new Set(['b','bold','i','italic','s','strike','s2','strikeDouble','u','underline','u2','underlineDouble','sup','sub','kbd','code','style','font','color','highlight','note','tip']);
const formulas=new Set(['dice','damage','hit','dc','d20','scaledice','scaledamage','chance','recharge','h','m','atk','atkr','actSave','actSaveFail','actSaveSuccess','actSaveFailBy','actTrigger','actResponse','actResponseDmg','actResponseSuccess','actResponseFail']);
const selectors=new Set(['filter','link','book','adventure','quickref','area','cite','loader','footnote','homebrew','ref','unit','deity','card']);
function category(tag){
  return own(tags,tag)?'reference':formatting.has(tag)?'formatting':formulas.has(tag)?'formula':selectors.has(tag)?'special':'unknown';
}
// Balanced scanner: offsets refer to original string, pipes inside nested tags are not separators.
function scan(text){
  const stack=[],nodes=[];let error=null;
  for(let i=0;i<text.length;i++){
    if(text[i]==='{'&&text[i+1]==='@'){
      if(stack.length>=64){error='tagDepthExceeded';break;}
      stack.push({start:i,depth:stack.length,brace:0,pipes:[]});i++;continue;
    }
    if(!stack.length)continue;
    const top=stack.at(-1);
    if(text[i]==='{'){top.brace++;continue;}
    if(text[i]==='}'&&top.brace){top.brace--;continue;}
    if(text[i]==='|'){if(!top.brace)top.pipes.push(i);continue;}
    if(text[i]!=='}')continue;
    const f=stack.pop(),inside=text.slice(f.start+2,i);
    const match=/^([A-Za-z][A-Za-z0-9]*)(?:\s+|$)/.exec(inside);
    if(!match){error='malformedTag';break;}
    const start=f.start+2+match[0].length;
    const cuts=[start,...f.pipes.filter(p=>p>=start),i];
    const parts=cuts.slice(0,-1).map((p,j)=>text.slice(p+(j?1:0),cuts[j+1]).trim());
    nodes.push({tag:match[1],start:f.start,end:i+1,depth:f.depth,parts,raw:text.slice(f.start,i+1)});
  }
  if(stack.length&&!error)error='unclosedTag';
  return {nodes:error?[]:nodes.sort((a,b)=>a.start-b.start),error};
}
const clean=x=>typeof x==='string'&&!!x.trim()&&!/[{}#\n\r]/.test(x);
function parseUid(tag,parts,{allowDisplay=false,spellQualifier=false}={}){
  if(!own(tags,tag)||!Array.isArray(parts)||!parts.length)return {status:'unsupportedExpression'};
  let p=parts.map(x=>typeof x==='string'?x.trim():'');
  let qualifier=null;
  if(spellQualifier&&tag==='spell'){
    const ix=p.findIndex(x=>x.includes('#'));
    if(ix>=0){
      const [uid,suffix,...rest]=p[ix].split('#');
      if(rest.length||!['c'].includes(suffix)||ix!==p.length-1)return {status:'specialQualifierPending'};
      p[ix]=uid;qualifier=suffix;
    }
  }
  if(!clean(p[0]))return {status:'unsupportedExpression'};
  const [kinds,defaultSource]=tags[tag];
  const finish=(target,display,defaulted)=>({kinds,target,...(display?{display}:{}),...(qualifier?{qualifier}:{}),defaulted});
  const validSource=x=>!x||clean(x)&&/^[A-Za-z0-9][A-Za-z0-9 _.-]*$/.test(x);
  const level=x=>/^(?:[1-9]|1[0-9]|20)$/.test(x||'');
  if(tag==='subclass'){
    if(p.length<2||p.length>(allowDisplay?5:4)||!clean(p[1])||!validSource(p[2])||!validSource(p[3]))return {status:'unsupportedExpression'};
    return finish({name:p[0],shortName:p[0],className:p[1],classSource:p[2]||'PHB',source:p[3]||'PHB'},p[4],!p[2]||!p[3]);
  }
  if(tag==='classFeature'||tag==='subclassFeature'){
    const sub=tag==='subclassFeature',l=sub?5:3;
    if(p.length<l+1||p.length>l+(allowDisplay?3:2)||!clean(p[1])||!validSource(p[2])||!level(p[l])||!validSource(p[l+1])||
      sub&&(!clean(p[3])||!validSource(p[4])))return {status:'unsupportedExpression'};
    const classSource=p[2]||'PHB',subclassSource=p[4]||'PHB';
    return finish({name:p[0],className:p[1],classSource,...(sub?{subclassShortName:p[3],subclassSource}:{}),level:Number(p[l]),source:p[l+1]||(sub?subclassSource:classSource)},p[l+2],!p[2]||!p[l+1]||sub&&!p[4]);
  }
  if(p.length>(allowDisplay?3:2)||!validSource(p[1]))return {status:'unsupportedExpression'};
  return finish({name:p[0],source:p[1]||defaultSource},p[2],!p[1]);
}
function resolveUid(item,index,tag,parts,options){
  const parsed=parseUid(tag,parts,options);
  if(parsed.status)return parsed;
  const origin=item.provenance.origin==='5etools'?'main':item.provenance.origin==='homebrew'?'homebrew':null;
  if(!origin)return {status:'namespacePending'};
  // Homebrew default policies and fallback to main are intentionally not inferred.
  if(parsed.defaulted&&origin!=='main')return {status:'namespaceDefaultPending'};
  const result=index.lookup(origin,parsed.kinds,parsed.target);
  const crossEra=result.targetEra&&item.source.rulesEra!=='unknown'&&result.targetEra!=='unknown'&&item.source.rulesEra!==result.targetEra;
  // Upstream generic unpackUid permits version-dependent redirects when source is omitted.
  // Keep the documented static default as a candidate, not a resolved effective reference.
  const status=parsed.defaulted&&result.status==='resolvedIdentity'?'defaultIdentityCandidate':result.status;
  return {...result,status,target:parsed.target,basis:parsed.defaulted?'upstreamStaticDefaultNoRedirect':'explicitUid',
    ...(parsed.defaulted?{defaulted:true}:{}),...(parsed.qualifier?{qualifier:parsed.qualifier}:{}),
    ...(parsed.display?{display:parsed.display}:{}),...(crossEra?{crossEra:true}:{})};
}
function stringWalk(value,path,visit,depth=0){
  if(depth>100){visit(null,path,'valueDepthExceeded');return;}
  if(typeof value==='string'){if(value.includes('{@'))visit(value,path);return;}
  if(Array.isArray(value)){value.forEach((v,i)=>stringWalk(v,path+'/'+i,visit,depth+1));return;}
  if(rec(value))for(const [k,v] of Object.entries(value))stringWalk(v,path+'/'+ptr(k),visit,depth+1);
}
const rawFields=['upstreamSpell','upstreamCreature','upstreamOrigin','upstreamClassRecord','upstreamFeature','upstreamItem','upstreamCondition'];
function inlineEdges(item,index){
  const m=item.payload?.mechanics||{},edges=[];
  for(const field of rawFields){
    if(!own(m,field))continue;
    stringWalk(m[field],'/payload/mechanics/'+field,(value,path,err)=>{
      const emit=(result)=>edges.push({fromId:item.id,path,...result,activation:'review-required'});
      if(err){emit({category:'malformed',status:err});return;}
      const parsed=scan(value);
      if(parsed.error){emit({category:'malformed',status:parsed.error});return;}
      for(const n of parsed.nodes){
        const kind=category(n.tag);
        const result=kind==='reference'?resolveUid(item,index,n.tag,n.parts,{allowDisplay:true}):{status:kind==='unknown'?'unknownTag':kind==='special'?'specialTagPending':'nonReference'};
        emit({category:kind,tag:n.tag,start:n.start,end:n.end,depth:n.depth,raw:n.raw,...result});
      }
    });
  }
  return edges;
}
function refineEdges(item,index,oldEdges){
  const out=[];
  // Only contexts verified against upstream renderer. Do not infer item-like prose,
  // feat selectors, class-level source defaults, or unspecified class/race ownership.
  for(const e of oldEdges){
    if(!['sourceRequired','unsupportedExpression'].includes(e.status)||typeof e.raw!=='string')continue;
    const tag={'prerequisite:spell':'spell','prerequisite:feat':'feat','prerequisite:optionalfeature':'optfeature',
      itemAttachedSpell:'spell',ammunition:'item'}[e.relation];
    if(!tag)continue;
    const result=resolveUid(item,index,tag,e.raw.split('|'),{spellQualifier:tag==='spell'});
    out.push({fromId:item.id,relation:e.relation,path:e.path,raw:e.raw,previousStatus:e.status,...result,activation:'review-required'});
  }
  return out;
}
function spellLists(item,index){
  const edges=[],m=item.payload?.mechanics||{};
  function emit(relation,path,raw,result,context){
    edges.push({fromId:item.id,relation,path,raw,...result,context,activation:'review-required'});
  }
  function list(raw,path,relation,context){
    if(!Array.isArray(raw)){emit(relation,path,raw,{status:'unsupportedExpression'},context);return;}
    raw.forEach((v,i)=>{
      const at=path+'/'+i;
      if(typeof v==='string'){emit(relation,at,v,resolveUid(item,index,'spell',v.split('|'),{spellQualifier:true}),context);return;}
      if(rec(v)&&rec(v.choose)&&Array.isArray(v.choose.from)){
        emit(relation,at,v,{status:'selectorPending'},context);
        list(v.choose.from,at+'/choose/from',relation,{...context,choiceCandidate:true});return;
      }
      emit(relation,at,v,{status:rec(v)&&(own(v,'choose')||own(v,'all'))?'selectorPending':'unsupportedExpression'},context);
    });
  }
  function recharge(v,path,relation,context,attached){
    if(!rec(v)){emit(relation,path,v,{status:'unsupportedExpression'},context);return;}
    for(const [type,block] of Object.entries(v)){
      const at=path+'/'+ptr(type);
      if(attached&&['ability','resourceName'].includes(type))continue;
      if((attached?['will','ritual','other']:['will','ritual','_']).includes(type))list(block,at,relation,{...context,rechargeType:type});
      else if((attached?['rest','daily','limited','charges','resource']:['rest','daily','limited','resource']).includes(type)&&rec(block)){
        for(const [key,entries] of Object.entries(block))list(entries,at+'/'+ptr(key),relation,{...context,rechargeType:type,rechargeKey:key});
      }else emit(relation,at,block,{status:'unsupportedExpression'},context);
    }
  }
  for(const field of ['upstreamOrigin','upstreamClassRecord','upstreamFeature']){
    const raw=m[field]?.additionalSpells,path='/payload/mechanics/'+field+'/additionalSpells';
    if(raw===undefined)continue;
    if(!Array.isArray(raw)){emit('additionalSpell',path,raw,{status:'unsupportedExpression'},{});continue;}
    raw.forEach((block,i)=>{
      if(!rec(block)){emit('additionalSpell',path+'/'+i,block,{status:'unsupportedExpression'},{});return;}
      for(const [type,levels] of Object.entries(block)){
        if(['name','ability','resourceName'].includes(type))continue;
        const at=path+'/'+i+'/'+ptr(type);
        if(!['innate','known','prepared','expanded'].includes(type)||!rec(levels)){emit('additionalSpell',at,levels,{status:'unsupportedExpression'},{});continue;}
        for(const [level,v] of Object.entries(levels)){
          const p=at+'/'+ptr(level),context={block:i,additionType:type,levelKey:level};
          if(Array.isArray(v))list(v,p,'additionalSpell',context);
          else recharge(v,p,'additionalSpell',context,false);
        }
      }
    });
  }
  const attached=m.upstreamItem?.attachedSpells;
  if(rec(attached))recharge(attached,'/payload/mechanics/upstreamItem/attachedSpells','structuredAttachedSpell',{},true);
  return edges;
}
function buildTagReport(main,homebrew,context){
  const records=context?.records??collect(main,homebrew).records,items=context?.items??converters.flatMap(c=>require('./'+c.module).buildPilot(main).packs.flatMap(p=>p.items));
  const index=context?.index??createReferenceIndex(records,items),inline=[],refinements=[],structured=[];
  const previous=dict(),transitions=dict(),byCategory=dict(),byTag=dict(),byInlineStatus=dict(),byStructuredStatus=dict(),byRefinementStatus=dict();
  let crossEra=0,defaultCandidates=0,oldCount=0;
  for(const item of items){
    const old=extractReferences(item,index);oldCount+=old.length;
    for(const e of old)bump(previous,e.status);
    const a=inlineEdges(item,index),b=refineEdges(item,index,old),c=spellLists(item,index);
    inline.push(...a);refinements.push(...b);structured.push(...c);
    for(const e of a){
      bump(byCategory,e.category);bump(byTag,e.category==='unknown'?'unknown':e.tag||'malformed');bump(byInlineStatus,e.status);
    }
    for(const e of b){bump(byRefinementStatus,e.status);bump(transitions[e.previousStatus]??=dict(),e.status);}
    for(const e of c)bump(byStructuredStatus,e.status);
    for(const e of [...a,...b,...c]){if(e.crossEra)crossEra++;if(e.status==='defaultIdentityCandidate')defaultCandidates++;}
  }
  return {schemaVersion:'dnd-upstream-tag-uid-preview.v1',commits:{main:main.commit,homebrew:homebrew.commit},items:items.length,inline,refinements,structured,
    summary:{oldCount,previous,inlineCount:inline.length,refinementCount:refinements.length,structuredCount:structured.length,byCategory,byTag,byInlineStatus,byRefinementStatus,byStructuredStatus,transitions,crossEra,defaultCandidates},
    activation:'review-required',scope:'staged main identity preview; static default candidates are not effective redirect resolution; no grants or execution'};
}
function publicSummary(r){return {schemaVersion:r.schemaVersion,commits:r.commits,items:r.items,summary:r.summary,activation:r.activation,scope:r.scope};}
module.exports={scan,category,parseUid,resolveUid,inlineEdges,refineEdges,spellLists,buildTagReport,publicSummary};
