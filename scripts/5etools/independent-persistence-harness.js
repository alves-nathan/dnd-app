'use strict';
// Real engine rehearsal, never opens the app database. Node >=22.13.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),cp=require('node:child_process'),assert=require('node:assert/strict');
const ts=require('typescript');
const root=path.resolve(__dirname,'../..');
const modules=['catalog/catalogBundleDigest','storage/compendiumSnapshot','storage/readOnlyCompendiumObservation','storage/sqliteCompendiumMigrations','storage/indexedDbStorageAdapter'];
const sources=Object.fromEntries(modules.map(id=>[id,fs.readFileSync(path.join(root,'src',id+'.ts'),'utf8')]));
const sha=s=>crypto.createHash('sha256').update(s).digest('hex');
const compiled=Object.fromEntries(modules.map(id=>[id,ts.transpileModule(sources[id],{compilerOptions:{target:ts.ScriptTarget.ES2020,module:ts.ModuleKind.CommonJS}}).outputText]));
const gitSha=cp.execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim();
const sourceFingerprint=sha(JSON.stringify(sources));
const fixture={sources:[{id:'fixture-source',status:'active',confidence:'exact'}],packs:[{id:'fixture-pack',sourceId:'fixture-source',importedAt:'fixture'}],items:[{id:'fixture-storage',importItemId:'fixture-import',packId:'fixture-pack',sourceId:'fixture-source',type:'weapon',name:'Synthetic weapon',status:'disabled',reviewDecision:'rejected',rawJson:{id:'fixture-import'},normalizedJson:{mapping:'preserve',sequence:[2,1]}}],enabledSourceIds:[]};
const metadata={schemaVersion:'dnd-independent-persistence-rehearsal.v1',scope:'disposableFixture',gitSha,sourceFingerprint,inventoryAcceptance:'notEstablished',writeAuthorized:false,executable:false,nativeEvidence:false};
function loader(compiled){
 const cache={};
 function load(id){
  if(cache[id])return cache[id].exports;
  if(!Object.prototype.hasOwnProperty.call(compiled,id))throw Error('unknown harness module');
  const module={exports:{}};cache[id]=module;
  const requireLocal=relative=>{
   if(!relative.startsWith('.'))throw Error('external harness import');
   const parts=id.split('/').slice(0,-1);
   for(const p of relative.split('/')){if(p==='..')parts.pop();else if(p!=='.')parts.push(p);}
   return load(parts.join('/'));
  };
  new Function('require','module','exports',compiled[id])(requireLocal,module,module.exports);
  return module.exports;
 }
 return load;
}
async function sqlite(){
 const {DatabaseSync}=require('node:sqlite');
 const load=loader(compiled),{initializeSQLiteCompendiumDatabase}=load('storage/sqliteCompendiumMigrations');
 const {observeOpenSQLiteCompendium,compareIndependentCompendiumReads}=load('storage/readOnlyCompendiumObservation');
 const db=new DatabaseSync(':memory:');
 const port={getAllAsync:async q=>db.prepare(q).all()};
 const checks=[];
 const check=(id,value)=>{assert.ok(value,id);checks.push(id);};
 try{
  await initializeSQLiteCompendiumDatabase({getFirstAsync:async q=>db.prepare(q).get(),execAsync:async q=>db.exec(q)});
  const s=fixture.sources[0],p=fixture.packs[0],i=fixture.items[0];
  db.prepare('INSERT INTO compendium_sources VALUES (?,?,?,?,?)').run(s.id,JSON.stringify(s),0,'fixture','fixture');
  db.prepare('INSERT INTO compendium_packs VALUES (?,?,?,?,?)').run(p.id,p.sourceId,JSON.stringify(p),'fixture','fixture');
  db.prepare('INSERT INTO compendium_items VALUES (?,?,?,?,?,?,?,?,?,?,?)').run(i.id,i.importItemId,i.packId,i.sourceId,i.type,i.name,i.status,JSON.stringify(i),'fixture','fixture','fixture');
  const state=()=>JSON.stringify(['compendium_sources','compendium_packs','compendium_items'].map(t=>db.prepare('SELECT * FROM '+t+' ORDER BY id').all()));
  const before=state();
  // Engine-enforced query-only while invoking production observer.
  db.exec('PRAGMA query_only=ON');
  const first=await observeOpenSQLiteCompendium(port),second=await observeOpenSQLiteCompendium(port);
  check('actualSQLiteMatch',compareIndependentCompendiumReads(first,second,fixture)==='snapshotMatch');
  check('noRowMutation',before===state());
  check('hydratedMismatch',compareIndependentCompendiumReads(first,second,{...fixture,enabledSourceIds:[s.id]})==='mismatch');
  check('uninitializedUnavailable',(await observeOpenSQLiteCompendium(undefined)).status==='unavailable');
  db.exec('PRAGMA query_only=OFF');
  db.prepare('UPDATE compendium_items SET status=? WHERE id=?').run('draft',i.id);
  db.exec('PRAGMA query_only=ON');
  const corrupt=await observeOpenSQLiteCompendium(port);
  check('mirrorCorruptionRejected',corrupt.status==='invalid'&&corrupt.code==='rowMirrorMismatch');
  check('changedReadStale',compareIndependentCompendiumReads(first,corrupt,fixture)==='stale');
  db.exec('PRAGMA query_only=OFF');
  db.prepare('UPDATE compendium_items SET status=?,json=? WHERE id=?').run(i.status,'{bad',i.id);
  db.exec('PRAGMA query_only=ON');
  check('invalidJsonRejected',(await observeOpenSQLiteCompendium(port)).status==='invalid');
  console.log(JSON.stringify({...metadata,environment:'nodeSQLite',engineVersion:db.prepare('SELECT sqlite_version() AS version').get().version,nodeVersion:process.version,checks,passed:true},null,2));
 }finally{db.close();}
}
// Browser function is serialized into a self-contained HTML file. All names
// are unique synthetic fixture names; the wrapper only exposes that fixture.
async function browser(load,fixture,metadata){
 const {readExistingIndexedDbValue}=load('storage/indexedDbStorageAdapter');
 const {observeExistingKeyValueCompendium,compareIndependentCompendiumReads}=load('storage/readOnlyCompendiumObservation');
 const {COMPENDIUM_STORAGE_KEY:key,COMPENDIUM_PERSISTENCE_VERSION:version}=load('storage/compendiumSnapshot');
 const engine=globalThis.indexedDB;
 const name='dnd-audit-disposable-'+crypto.randomUUID();
 const expected='dnd-combat-math-web-storage';
 const checks=[];const check=(id,ok)=>{if(!ok)throw Error(id);checks.push(id);};
 const request=r=>new Promise((resolve,reject)=>{r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(Error('fixtureRequestFailed'));r.onblocked=()=>reject(Error('fixtureRequestBlocked'));});
 const remove=()=>request(engine.deleteDatabase(name));
 const create=()=>{const r=engine.open(name,1);r.onupgradeneeded=()=>r.result.createObjectStore('key-value');return request(r);};
 const factory={databases:async()=>(await engine.databases()).filter(d=>d.name===name).map(d=>({name:expected,version:d.version})),open:(n,v)=>{if(n!==expected||v!==1)throw Error('unexpectedFixtureOpen');return engine.open(name,v);}};
 const raw=JSON.stringify({version,state:fixture});
 let db;
 try{
  if(!engine||typeof engine.databases!=='function')throw Error('indexedDbEnumerationUnavailable');
  const absent=await readExistingIndexedDbValue(key,factory);
  check('absentDoesNotCreate',absent.status==='unavailable'&&!(await engine.databases()).some(d=>d.name===name));
  db=await create();
  await new Promise((resolve,reject)=>{const t=db.transaction('key-value','readwrite');t.oncomplete=resolve;t.onabort=()=>reject(Error('fixtureSeedAborted'));t.onerror=()=>reject(Error('fixtureSeedFailed'));t.objectStore('key-value').put(raw,key);});
  db.close();db=undefined;
  const read=()=>readExistingIndexedDbValue(key,factory);
  const observe=async()=>{const r=await read();return r.status==='read'?observeExistingKeyValueCompendium('web',{getItem:()=>r.value}):{...r,backend:'web'};};
  const first=await observe(),second=await observe();
  check('actualIndexedDbMatch',compareIndependentCompendiumReads(first,second,fixture)==='snapshotMatch');
  const after=await read();check('noValueMutation',after.status==='read'&&after.value===raw);
  const missing=await readExistingIndexedDbValue('missing-fixture-key',factory);
  check('missingKeyDistinguished',missing.status==='read'&&missing.value===null);
  await remove();
  const race={...factory,databases:async()=>[{name:expected,version:1}]};
  const aborted=await readExistingIndexedDbValue(key,race);
  check('racedCreationAborted',aborted.status==='unavailable'&&aborted.code==='indexedDbUpgradeAborted');
  // A subsequent enumeration is queued after the aborted upgrade.
  check('noCommittedCreation',!(await engine.databases()).some(d=>d.name===name));
  return {...metadata,environment:'browserIndexedDb',checks,passed:true};
 }finally{if(db)db.close();if(engine)await remove();}
}
function html(out){
 const payload=JSON.stringify({compiled,fixture,metadata}).replace(/</g,'\\u003c');
 const source='const data='+payload+';const load=('+loader.toString()+')(data.compiled);const run='+browser.toString()+';document.getElementById("run").onclick=async()=>{const b=document.getElementById("run"),o=document.getElementById("result");b.disabled=true;try{o.textContent=JSON.stringify(await run(load,data.fixture,data.metadata),null,2);}catch(e){o.textContent=JSON.stringify({...data.metadata,environment:"browserIndexedDb",passed:false,code:String(e.message)},null,2);}finally{b.disabled=false;}};';
 fs.writeFileSync(out,'<!doctype html><meta charset="utf-8"><title>Disposable IndexedDB rehearsal</title><h1>Disposable IndexedDB rehearsal</h1><p>Run only on a dedicated localhost origin. No production data is read.</p><button id="run">Run disposable fixture</button><pre id="result">Not executed</pre><script>'+source+'</script>',{flag:'wx'});
}
if(process.argv[2]==='--browser-html'&&process.argv.length===4)html(process.argv[3]);
else if(process.argv.length===2)sqlite().catch(e=>{console.error(e.message);process.exitCode=1;});
else {console.error('Usage: node scripts/5etools/independent-persistence-harness.js [--browser-html NEW_FILE]');process.exitCode=1;}
