import {sha256Hex} from './catalogBundleDigest';
import {stableStringify} from './utils';
import type {CatalogSnapshot} from './types';
import type {CatalogTrustRegistry} from './catalogTrust';
import {parseAndValidateTrustedCatalogCandidate} from './catalogUpdateTransaction';
const flags={scope:'privateLocalReview',writeAuthorized:false,distributionAuthorized:false,retirementAuthorized:false,executable:false} as const;
const digest=(v:unknown)=>sha256Hex(stableStringify(v));
/** Read-only candidate probe. Use the production signature/chain/loader path,
 * not a new signature scheme. No key approval, anchor advancement or staging.
 * This is for runtime catalog envelopes, not raw canonical V3 content packs. */
export async function reviewPrivateCatalogCandidate(input:{
 rawText:string;currentSnapshot:CatalogSnapshot;trustRegistry:CatalogTrustRegistry;
 expectedEnvelopeChecksum?:string;now?:()=>Date;
}){
 try{
  if(typeof input.rawText!=='string'||!input.rawText.trim()||input.rawText.length>50_000_000)return {ok:false as const,code:'invalidCandidateSize',...flags};
  const registryFingerprint=digest(input.trustRegistry);
  const envelopeFingerprint=sha256Hex(input.rawText);
  const currentFingerprint=digest({snapshotId:input.currentSnapshot.snapshotId,catalogVersion:input.currentSnapshot.catalogVersion,bundleSha256:input.currentSnapshot.bundleSha256??null});
  const at=(input.now??(()=>new Date()))();
  const result=await parseAndValidateTrustedCatalogCandidate({...input,now:()=>at});
  if(registryFingerprint!==digest(input.trustRegistry))return {ok:false as const,code:'trustRegistryChanged',...flags};
  const v=result.verification;
  const body={schemaVersion:'dnd-private-catalog-candidate-review.v1' as const,bindings:{envelope:envelopeFingerprint,registry:registryFingerprint,current:currentFingerprint,packageChecksum:result.checksum,canonicalChecksum:v.catalogChecksum,snapshot:digest(result.snapshot.snapshotId)},checkedAt:at.toISOString(),chainStatus:v.chainStatus,sequence:v.sequence,trustStatus:v.status,
   expectedEnvelopeChecksumProvided:Boolean(input.expectedEnvelopeChecksum?.trim()),rights:'notEstablished' as const,...flags};
  return {ok:true as const,review:{...body,fingerprint:digest(body)},...flags};
 }catch{return {ok:false as const,code:'candidateTrustOrIntegrityFailed',...flags};}
}
