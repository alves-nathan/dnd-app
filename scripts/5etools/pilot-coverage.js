'use strict';
// Pilot-level coverage only: not all upstream kinds/sources, not runtime readiness.
const converters=Object.freeze([
  {stage:'a5.1',module:'spell-converter',kinds:['spell']},
  {stage:'a5.2',module:'creature-converter',kinds:['creatureStatBlock']},
  {stage:'a5.3',module:'equipment-converter',kinds:['weapon','armor','equipment']},
  {stage:'a5.4',module:'magic-item-converter',kinds:['magicItem']},
  {stage:'a5.5',module:'feature-converter',kinds:['feat','feature']},
  {stage:'a5.6',module:'origin-converter',kinds:['species','background']},
  {stage:'a5.7',module:'class-converter',kinds:['class','subclass','feature']},
  {stage:'a5.8',module:'condition-converter',kinds:['condition']}
].map(e=>Object.freeze({...e,kinds:Object.freeze(e.kinds)})));
function summarizePilotCoverage(snapshot){
  const totals=Object.create(null),byConverter=Object.create(null),ids=new Set(),issues=Object.create(null);
  const bump=(o,k)=>o[k]=(o[k]||0)+1;
  let emitted=0;
  for(const c of converters){
    const result=require('./'+c.module).buildPilot(snapshot),observed=Object.create(null);
    if(result.commit!==snapshot.commit)bump(issues,'snapshotMismatch');
    if(result.activation!=='review-required')bump(issues,'activationMismatch');
    for(const pack of result.packs){
      if(pack.templateVersion!=='dnd-combat-import.v3'||pack.contractRevision!=='canonical-v3.1')bump(issues,'contractMismatch');
      if(pack.source.status!=='needsReview'||pack.metadata?.activation!=='review-required')bump(issues,'activationMismatch');
      for(const item of pack.items){
        emitted++;bump(observed,item.kind);bump(totals,item.kind);
        if(!c.kinds.includes(item.kind))bump(issues,'unexpectedKind');
        if(item.source.status!=='needsReview')bump(issues,'activationMismatch');
        if(item.provenance?.commit!==snapshot.commit)bump(issues,'snapshotMismatch');
        if(ids.has(item.id))bump(issues,'duplicatePhysicalId');else ids.add(item.id);
      }
    }
    for(const kind of c.kinds)if(!observed[kind])bump(issues,'missingPilotKind');
    byConverter[c.stage]=observed;
  }
  return {commit:snapshot.commit,byConverter,totals,emitted,uniquePhysicalIds:ids.size,issues,activation:'review-required'};
}
module.exports={converters,summarizePilotCoverage};
