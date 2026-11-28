'use strict';
// Offline Node-only archive port. Never use a repo or shared directory.
// POSIX file and directory sync; Windows/native durability remains unverified.
const fs=require('node:fs/promises'),path=require('node:path'),crypto=require('node:crypto');
const valid=id=>typeof id==='string'&&/^[a-f0-9]{64}$/.test(id);
async function createPrivateCheckpointFilePort(directory){
 if(process.platform==='win32')throw Error('privateCheckpointPosixRequired');
 const root=await fs.realpath(directory),stat=await fs.lstat(root);
 if(!stat.isDirectory()||(stat.mode&0o077)!==0||(typeof process.getuid==='function'&&stat.uid!==process.getuid()))throw Error('privateCheckpointDirectoryRequired');
 const file=id=>{if(!valid(id))throw Error('invalidCheckpointArchiveId');return path.join(root,id+'.json');};
 const syncDirectory=async()=>{const d=await fs.open(root,'r');try{await d.sync();}finally{await d.close();}};
 return {
  async createExclusive(id,text){
   const dest=file(id),tmp=path.join(root,'.pending-'+crypto.randomUUID());
   let created=false;
   try{
    const handle=await fs.open(tmp,'wx',0o600);created=true;
    try{await handle.writeFile(text,'utf8');await handle.sync();}finally{await handle.close();}
    // Hard link publishes atomically without replacement on the same filesystem.
    await fs.link(tmp,dest);await syncDirectory();
   }finally{if(created){await fs.unlink(tmp);await syncDirectory();}}
  },
  async read(id){
   const target=file(id);
   try{
    const s=await fs.lstat(target);
    if(!s.isFile()||(s.mode&0o077)!==0||s.size>800_000_000)throw Error('invalidPrivateCheckpointFile');
    return await fs.readFile(target,'utf8');
   }catch(e){if(e?.code==='ENOENT')return null;throw e;}
  }
 };
}
module.exports={createPrivateCheckpointFilePort};
