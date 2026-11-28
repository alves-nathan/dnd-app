'use strict';
// POSIX offline adapter using the existing exclusive sync-and-link file port.
// A separate owner-only directory is required; never an active storage path.
const {createPrivateCheckpointFilePort}=require('./private-checkpoint-file-port');
const {createHash}=require('node:crypto');
const keyPattern=/^dnd-v3-isolated-candidate\/v1\/[a-f0-9]{64}\/(?:rawPack|reviewIndex|completionMarker|journal\/(?:start|end|[0-2]-(?:intent|confirmed)))$/;
async function createPrivateCandidateFilePort(directory){
 const files=await createPrivateCheckpointFilePort(directory);
 const id=key=>{if(typeof key!=='string'||!keyPattern.test(key))throw Error('invalidIsolatedCandidateKey');return createHash('sha256').update(key).digest('hex');};
 return {read:key=>files.read(id(key)),createExclusive:(key,value)=>files.createExclusive(id(key),value)};
}
module.exports={createPrivateCandidateFilePort};
