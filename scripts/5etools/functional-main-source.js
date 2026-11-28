'use strict';
// Main namespace establishes provenance, not edition or licensing.
const text=v=>typeof v==='string'&&v.trim()===v&&v.length>0;
const era=v=>v==='classic'||v==='2014'?'2014':v==='one'||v==='2024'?'2024':null;
const validDate=v=>typeof v==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(v)&&!Number.isNaN(Date.parse(v))&&new Date(v).toISOString().slice(0,10)===v;
function readMainPublications(snapshot){
 const result=new Map();
 for(const [file,kind] of [['data/books.json','book'],['data/adventures.json','adventure']]){
  if(!snapshot.files.has(file))continue;
  const rows=snapshot.readJson(file)[kind];
  if(!Array.isArray(rows))throw Error('functionalPublicationIndexInvalid');
  for(const row of rows){
   const code=row?.source??row?.id;
   if(!text(code))continue;
   const list=result.get(code)||[];list.push({row,file});result.set(code,list);
  }
 }
 return result;
}
function projectMainSource(code,publications,record,knownEra){
 if(!text(code))throw Error('functionalSourceCodeInvalid');
 const matches=publications.get(code)||[],dates=[...new Set(matches.map(p=>p.row.published).filter(validDate))];
 const titles=[...new Set(matches.map(p=>p.row.name).filter(text))];
 const explicit=era(record?.edition),declared=[...new Set(matches.map(p=>era(p.row.edition)).filter(Boolean))];
 const evidence=new Set([explicit,...declared,era(knownEra)].filter(Boolean));
 const rulesEra=evidence.size===1?[...evidence][0]:'unknown';
 const partner=matches.some(p=>p.row.isPartnered===true||['partnered','partner'].includes(p.row.group));
 const source={id:'upstream:main:'+code,book:titles.length===1?titles[0]:code,status:'needsReview',confidence:'importedNeedsReview',
  rulesEra,contentType:partner?'third-party':'official',precedenceScope:partner?'main-partner:'+code:'official-dnd',
  publication:dates.length===1?{precision:'day',date:dates[0],year:Number(dates[0].slice(0,4)),evidence:'5etools:publicationIndex'}:{precision:'unknown',date:null,year:null,evidence:'5etools:publicationNotEstablished'}};
 const notes=['sourceClassificationReviewPending'];
 if(!matches.length)notes.push('publicationNotEstablished');
 if(dates.length>1||titles.length>1)notes.push('publicationMetadataConflict');
 if(evidence.size>1)notes.push('sourceEditionConflict');
 if(rulesEra==='unknown')notes.push('rulesEraPending');
 return {source,notes,editionEvidence:{record:explicit,publication:declared,pilot:era(knownEra),status:evidence.size>1?'conflict':evidence.size===1?'explicit':'unknown'}};
}
module.exports={readMainPublications,projectMainSource};
