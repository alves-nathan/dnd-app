import {CatalogLoader} from '../catalog/catalogLoader';
import {ContentPolicyService} from '../catalog/contentPolicyService';
import type {CatalogFilterState,RuntimeCatalogBundle} from '../catalog/types';

const flags={activation:'review-required',runtimeEligible:false,writeAuthorized:false,retirementAuthorized:false,executable:false} as const;
const own=(o:object,k:string)=>Object.prototype.hasOwnProperty.call(o,k);
const rec=(v:unknown):v is Record<string,unknown>=>v!==null&&typeof v==='object'&&!Array.isArray(v);
const same=(a:unknown,b:unknown)=>JSON.stringify(a)===JSON.stringify(b);
const safeKey=(k:string)=>k.length>0&&!['__proto__','constructor','prototype'].includes(k);
type Domain='bookStates'|'categoryStates'|'entityStates';
export type FilterReviewContext=
 {domain:'bookStates'|'categoryStates';id:string;value:boolean;snapshotContextConfirmed:boolean;otherDependenciesExcludedConfirmed:boolean}|
 {domain:'entityStates';id:string;value:'enabled'|'disabled'|'inherit';snapshotContextConfirmed:boolean;otherDependenciesExcludedConfirmed:boolean};
const domains:Domain[]=['bookStates','categoryStates','entityStates'];
function blocked(codes:string[]){
 return {...flags,status:'preservationBlocked' as const,codes,impact:undefined};
}
/** Disposable comparison of one explicit filter override, with full bundle
 * equality. No repository save, configuration revision or live controller use. */
export function reviewRuntimeFilterPreservation(
 baseline:RuntimeCatalogBundle,currentBundle:RuntimeCatalogBundle,afterBundle:RuntimeCatalogBundle,
 base:CatalogFilterState,current:CatalogFilterState,after:CatalogFilterState,context:FilterReviewContext
){
 try{
  if(!same(baseline,currentBundle)||!same(baseline,afterBundle))return blocked(['runtimeBundleChanged']);
  if(!same(base,current))return blocked(['baseFilterMismatch']);
  if(context.snapshotContextConfirmed!==true||context.otherDependenciesExcludedConfirmed!==true||
   !domains.includes(context.domain)||!safeKey(context.id))return blocked(['filterContextPending']);
  // Loader freezes portions of its argument; clone to keep the review pure.
  const snapshot=new CatalogLoader().initializeFromBundle(JSON.parse(JSON.stringify(baseline)) as RuntimeCatalogBundle);
  const known={
   bookStates:new Set(snapshot.manifest.sourceBooks),
   categoryStates:new Set(snapshot.categories.map(c=>c.id)),
   entityStates:new Set(snapshot.entries.map(e=>e.entityId))
  };
  const validValue=(domain:Domain,value:unknown)=>domain==='entityStates'?['enabled','disabled','inherit'].includes(value as string):typeof value==='boolean';
  const validState=(state:CatalogFilterState)=>rec(state)&&Object.keys(state).length===domains.length&&
   domains.every(d=>own(state,d)&&rec(state[d])&&Object.entries(state[d]).every(([k,v])=>safeKey(k)&&known[d].has(k)&&validValue(d,v)));
  if(!validState(current)||!validState(after))return blocked(['filterInventoryInvalid']);
  if(!known[context.domain].has(context.id)||!validValue(context.domain,context.value))return blocked(['filterIdentityPending']);
  if(context.domain==='categoryStates'&&snapshot.categoryById.get(context.id)?.canDisable!==true)return blocked(['protectedCategory']);
  const expected:CatalogFilterState={bookStates:{...current.bookStates},categoryStates:{...current.categoryStates},entityStates:{...current.entityStates}};
  if(context.domain==='entityStates'){
   if(context.value==='inherit')delete expected.entityStates[context.id];
   else expected.entityStates[context.id]=context.value;
  }else expected[context.domain][context.id]=context.value;
  if(same(expected,current))return blocked(['noFilterChange']);
  if(!same(expected,after))return blocked(['unexpectedFilterChanges']);
  const service=new ContentPolicyService(snapshot);
  if(context.domain==='entityStates'&&service.evaluate(context.id,current).reason==='protectedEntity')return blocked(['protectedEntity']);
  const previous=service.previewImpact(current,current),next=service.previewImpact(current,after);
  // Keep multiplicity: even repeated edges must not be silently collapsed.
  const counts=new Map<string,number>();
  for(const edge of previous.hardDependencyBreaks){const k=JSON.stringify(edge);counts.set(k,(counts.get(k)??0)+1);}
  let introduced=0;
  for(const edge of next.hardDependencyBreaks){const k=JSON.stringify(edge),n=counts.get(k)??0;if(n)counts.set(k,n-1);else introduced++;}
  const impact={beforeEnabled:next.beforeEnabled,afterEnabled:next.afterEnabled,
   enabled:next.enabledEntityIds.length,disabled:next.disabledEntityIds.length,
   existingHardDependencyBreaks:previous.hardDependencyBreaks.length,remainingHardDependencyBreaks:next.hardDependencyBreaks.length,introducedHardDependencyBreaks:introduced};
  return {...flags,status:introduced?'preservationBlocked' as const:'filterOnlyPreservationCandidate' as const,
   codes:introduced?['newHardDependencyBreaks']:[],impact};
 }catch{return blocked(['invalidRuntimeFilterReview']);}
}
