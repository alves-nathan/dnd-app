import type { Character } from '../types';
import { characterProgressionFingerprint, progressionSnapshot, validateProgressionDraft, type CharacterProgressionDraft } from '../characters/progressionTransaction';

/** Review-only check for a deliberately narrow level-only draft. This is
 * not a replacement for character progression, a commit gate in the live
 * engine, or proof that the resulting character has its required grants. */
export function reviewLevelOnlyPreservation(current:Character,draft:CharacterProgressionDraft,classInstanceId:string){
  const flags={activation:'review-required',runtimeEligible:false,writeAuthorized:false,retirementAuthorized:false,executable:false} as const;
  const codes:string[]=[];
  try{
    const before=progressionSnapshot(current),after=draft.workingCharacter;
    const same=(a:unknown,b:unknown)=>JSON.stringify(a)===JSON.stringify(b);
    if(!same(before,draft.baseCharacter)||draft.baseFingerprint!==characterProgressionFingerprint(current))codes.push('baseSnapshotMismatch');
    const selected=before.classes.filter(c=>c.id===classInstanceId);
    if(selected.length!==1||!Number.isInteger(selected[0]?.level)||selected[0]!.level<1||before.level<1||before.level>=20||
      before.classes.reduce((n,c)=>n+c.level,0)!==before.level)codes.push('oneLevelContextRequired');
    if(draft.kind!=='levelUp')codes.push('levelUpDraftRequired');
    const expected={...before,level:before.level+1,classes:before.classes.map(c=>c.id===classInstanceId?{...c,level:c.level+1}:c)};
    const keys=new Set([...Object.keys(expected),...Object.keys(after)]);
    const unexpectedPaths=[...keys].filter(k=>!same((expected as unknown as Record<string,unknown>)[k],(after as unknown as Record<string,unknown>)[k])).sort();
    if(unexpectedPaths.length)codes.push('unexpectedSnapshotChanges');
    const engine=validateProgressionDraft(draft,current);
    if(!engine.ok)codes.push('existingTransactionValidationBlocked');
    return {...flags,status:codes.length?'preservationBlocked' as const:'levelOnlyPreservationCandidate' as const,codes,unexpectedPaths,
      engineBlockingCodes:engine.blockingIssues.map(i=>i.code),
      blockers:['mechanicalGrantsAndChoicesNotApproved','resourceAndSpellSlotTransitionsNotApproved','noV3CommitAuthorization']};
  }catch{return {...flags,status:'preservationBlocked' as const,codes:['invalidDraftContext'],unexpectedPaths:[],engineBlockingCodes:[]};}
}
