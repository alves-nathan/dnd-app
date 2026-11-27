'use strict';
// a8.12.2: explicit acceptance requirements; this report cannot accept a gate.
const {digest}=require('./integrated-review');
const {buildGlobalCheckpointReview}=require('./global-checkpoint-review');
const flags=()=>({activation:'review-required',runtimeEligible:false,writeAuthorized:false,distributionAuthorized:false,retirementAuthorized:false,executable:false});
const assert=(ok,code)=>{if(!ok)throw Error(code);};
// Order is a proposed engineering sequence, not an estimate or approval.
// Parallel independent work is possible; all gates still require explicit evidence.
const definitions=[
 {id:'inventory',blocker:'historicalAndInstalledInventoryNotVerified',dependsOn:[],mode:'readOnlyLocal',
  existing:['historicalOccurrenceAudit','bundledStoragePreview','localV3PreservationPanel'],
  required:['completeInstalledCompendiumAndPortableStateInventory','exactRuntimePackageAndConfigurationBinding','legacyVersionsManualMappingsAndExternalPacksInventory','explicitUnmatchedAndExcludedOccurrenceLedger']},
 {id:'rightsTrust',blocker:'rightsAndRuntimeTrustNotVerified',dependsOn:[],mode:'ownerAndLocalTrust',
  existing:['sourcePolicyQuarantine','existingSignedCatalogTrustChain'],
  required:['perSourceRightsAndPermittedUseDecision','homebrewConsentAndDistributionScope','candidatePackageSignatureAndTrustVerification','antiReplayRevocationAndPreviousChecksumVerification']},
 {id:'mechanicalParity',blocker:'mechanicalParityNotApproved',dependsOn:['inventory'],mode:'scopedReview',
  existing:['thirteenFamilyCheckpoints','isolatedEnginePreviews'],
  required:['explicitSupportedScopeAndEditionPolicy','perOccurrenceIdentityAndFieldDisposition','actualRuntimeConsumerRegressionEvidence','preserveAllUnapprovedAndUnsupportedLegacyContracts']},
 {id:'relationshipParity',blocker:'dependencyAliasAndRuntimeContractParityPending',dependsOn:['inventory','mechanicalParity'],mode:'scopedReview',
  existing:['globalGraphAudit','runtimeContractPreservation','isolatedFilterComparison'],
  required:['qualifiedDependencyAndAliasDisposition','runtimeOnlyContractsAndCategoryMembershipPreservation','characterLinkChoiceProviderAndSelectionRegression','noUnreviewedRequiredRelationshipReplacement']},
 {id:'durableCheckpoint',blocker:'durableFullCheckpointNotVerified',dependsOn:['inventory'],mode:'localDurability',
  existing:['localPreservationManifest','portableBackupParserAndAudit'],
  required:['coherentCompleteCheckpointOfAllStoresAndPackageBytes','durableWriteReadBackAndIntegrityVerification','restoreCompatibilityForLegacyBackups','recoveryAndQuarantineInventoryPreserved']},
 {id:'transactionRollback',blocker:'productionTransactionAndRollbackNotVerified',dependsOn:['mechanicalParity','relationshipParity','durableCheckpoint','rightsTrust'],mode:'disposableProductionAdapter',
  existing:['readOnlyMigrationPreview','memoryRollbackFixtures','existingCatalogUpdateTransaction'],
  required:['explicitIdempotentMigrationPlanWithNoImplicitDeletion','productionStorageFaultInjectionAndRestartRecovery','fullCheckpointRollbackVerification','preserveCharacterAndEncounterReferencesAndHistory']},
 {id:'nativeValidation',blocker:'nativeValidationPending',dependsOn:['transactionRollback'],mode:'nativeDevice',
  existing:['qualityAndStructuralCI','existingNativeEvidenceHarness'],
  required:['candidateBuildBoundAndroidAndIOSNativeEvidence','importPreviewAndLegacyRestoreRegression','creationProgressionCombatAndFilterRegression','accessibilityAndInterruptedOperationRecovery']},
 {id:'cutoverApproval',blocker:'explicitCutoverApprovalMissing',dependsOn:['inventory','rightsTrust','mechanicalParity','relationshipParity','durableCheckpoint','transactionRollback','nativeValidation'],mode:'explicitOwnerDecision',
  existing:['legacyCutoverPolicy'],
  required:['allPreviousGatesReviewedForSameCandidate','separateExplicitCutoverScopeAndOwnerApproval','separateLegacyRetirementDecision']},
];
function validateDefinitions(){
 const ids=new Set(),blockers=new Set(),criteria=new Set();
 for(const g of definitions){
  assert(!ids.has(g.id)&&!blockers.has(g.blocker)&&g.dependsOn.every(id=>ids.has(id))&&new Set(g.dependsOn).size===g.dependsOn.length&&g.required.length>0,'invalidAcceptanceGateGraph');
  ids.add(g.id);blockers.add(g.blocker);
  for(const criterion of g.required){assert(!criteria.has(criterion),'duplicateAcceptanceCriterion');criteria.add(criterion);}
 }
}
function buildCutoverAcceptanceMatrix(matrix,fragment,global){
 validateDefinitions();
 const actual=buildGlobalCheckpointReview(matrix,fragment);
 assert(digest(actual)===digest(global),'acceptanceGlobalBindingMismatch');
 const supplied=global.blockers;
 assert(Array.isArray(supplied)&&new Set(supplied).size===supplied.length&&supplied.length===definitions.length&&
  definitions.every(g=>supplied.includes(g.blocker)),'acceptanceBlockerCoverageMismatch');
 const rows=global.rows;
 const observed={
  inventory:{historical:global.totals.historical,bundledStorage:global.totals.storage,runtime:global.totals.runtime,installedScope:'notInspected'},
  rightsTrust:{homebrewProbes:global.totals.homebrewProbes,rightsDecisionsVerified:0,candidateTrust:'notVerified'},
  mechanicalParity:{families:rows.length,emitted:global.totals.mainItems,historicalCandidates:rows.reduce((n,r)=>n+r.historicalCandidates,0),
   historicalEraPending:rows.reduce((n,r)=>n+r.historicalEraPending,0),runtimeCandidates:rows.reduce((n,r)=>n+r.runtimeCandidates,0),
   runtimeEraPending:rows.reduce((n,r)=>n+r.runtimeEraPending,0),approvedMappings:0},
  relationshipParity:{runtimeOnly:global.outside.runtime,dependencies:global.totals.dependencies,aliases:global.totals.aliases,categories:global.totals.categories,legacyLinks:global.totals.legacyLinks,
   graphBlocked:rows.reduce((n,r)=>n+(r.graph['main:dependencyBlocked']??0),0)},
  durableCheckpoint:{durability:'notVerified'},transactionRollback:{productionRollback:'notVerified'},
  nativeValidation:{candidateNativeEvidence:'notVerified'},cutoverApproval:{explicitApproval:'missing'}
 };
 const gates=definitions.map((g,index)=>({id:g.id,blocker:g.blocker,priority:index+1,dependsOn:[...g.dependsOn],mode:g.mode,
  existingEvidence:g.existing.map(code=>({code,scope:'partialOrExistingInfrastructure'})),
  acceptanceCriteria:g.required.map(code=>({code,status:'requiredNotVerified'})),
  observed:observed[g.id],status:'blocked',nextWork:g.dependsOn.length?'afterPrerequisiteReview':'independentReadOnlyPreparation',...flags()}));
 const body={schemaVersion:'dnd-upstream-cutover-acceptance-matrix.v1',commits:global.commits,
  bindings:{global:global.fingerprint,matrix:matrix.fingerprint,familyFragment:fragment.fingerprint},
  gates,summary:{gates:gates.length,accepted:0,blocked:gates.length,criteria:gates.reduce((n,g)=>n+g.acceptanceCriteria.length,0)},
  nextEngineeringGate:'inventory',parallelReview:['rightsTrust'],scope:'planningOnlyBundledFixtureAndPilot',readiness:'blocked',
  checkpointBlockers:global.checkpointBlockers,approvedMappings:0,mechanicalParityEstablished:0,...flags()};
 return {...body,fingerprint:digest(body)};
}
module.exports={buildCutoverAcceptanceMatrix};
