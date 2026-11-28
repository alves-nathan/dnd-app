'use strict';
const fs=require('node:fs'),path=require('node:path'),cp=require('node:child_process'),crypto=require('node:crypto');
const root=path.resolve(__dirname,'../..');
const modules=['catalog/catalogBundleDigest','storage/compendiumSnapshot','storage/readOnlyCompendiumObservation','storage/sqliteCompendiumMigrations','storage/indexedDbStorageAdapter'];
const expectedChecks={
 nodeSQLite:['actualSQLiteMatch','noRowMutation','hydratedMismatch','uninitializedUnavailable','mirrorCorruptionRejected','changedReadStale','invalidJsonRejected'],
 browserIndexedDb:['absentDoesNotCreate','actualIndexedDbMatch','noValueMutation','missingKeyDistinguished','racedCreationAborted','noCommittedCreation']
};
const sha=s=>crypto.createHash('sha256').update(s).digest('hex');
function expectedBinding(commit){
 if(!/^[a-f0-9]{40}$/.test(commit))throw Error('invalidExpectedCommit');
 const sources=Object.fromEntries(modules.map(id=>[id,cp.execFileSync('git',['show',commit+':src/'+id+'.ts'],{cwd:root,encoding:'utf8'})]));
 return {gitSha:commit,sourceFingerprint:sha(JSON.stringify(sources))};
}
function validateRehearsal(report,expected){
 const errors=[];
 const require=(v,code)=>{if(!v)errors.push(code);};
 require(report&&report.schemaVersion==='dnd-independent-persistence-rehearsal.v1'&&report.scope==='disposableFixture','schemaOrScopeMismatch');
 require(report?.gitSha===expected.gitSha&&report?.sourceFingerprint===expected.sourceFingerprint,'sourceBindingMismatch');
 require(report?.inventoryAcceptance==='notEstablished'&&report?.writeAuthorized===false&&report?.executable===false&&report?.nativeEvidence===false,'promotionFlagsInvalid');
 const checks=expectedChecks[report?.environment];
 require(Array.isArray(checks)&&Array.isArray(report?.checks)&&JSON.stringify(checks)===JSON.stringify(report.checks)&&report.passed===true,'requiredChecksMissingOrFailed');
 if(report?.environment==='nodeSQLite')require(typeof report.engineVersion==='string'&&/^\d+\.\d+\.\d+$/.test(report.engineVersion)&&typeof report.nodeVersion==='string'&&/^v22\./.test(report.nodeVersion),'engineMetadataInvalid');
 return {status:errors.length?'invalid':'consistentRehearsal',errors,environment:report?.environment??null,inventoryAcceptance:'notEstablished',nativeEvidence:false,writeAuthorized:false,executable:false};
}
if(require.main===module){
 try{
  if(process.argv.length!==3)throw Error('usage: node validate-persistence-rehearsal.js REPORT_JSON');
  const commit=cp.execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim();
  const report=JSON.parse(fs.readFileSync(process.argv[2],'utf8'));
  const result=validateRehearsal(report,expectedBinding(commit));console.log(JSON.stringify(result));
  if(result.status!=='consistentRehearsal')process.exitCode=1;
 }catch(e){console.error(e.message);process.exitCode=1;}
}
module.exports={validateRehearsal,expectedBinding};
