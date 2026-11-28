const {identity,normalizeIdentity,collect,makeResolver,applyMods,audit}=require('../../scripts/5etools/resolver');
const {openSnapshot}=require('../../scripts/5etools/inventory');
const row=(kind:string,entity:Record<string,unknown>,index=0)=>{
  const key=identity(kind,entity);
  return {kind,entity,key,id:JSON.stringify(['main',key]),origin:'main',path:'fixture.json',index,blob:'b'.repeat(40)};
};
describe('a6.4.1 conservative resolver extensions',()=>{
  test('nested magicvariant source matches the existing converter ID without mutating raw input',()=>{
    const raw={name:'Fixture',inherits:{source:'XDMG',entries:['synthetic']}};
    expect(normalizeIdentity('magicvariant',raw)).toEqual({...raw,source:'XDMG'});
    expect(raw).not.toHaveProperty('source');
    expect(identity('magicvariant',raw)).toBe(identity('magicvariant',{...raw,source:'XDMG'}));
    expect(identity('spell',{name:'Fixture',source:'PHB'})).toBe(JSON.stringify(['spell','fixture','phb']));
    expect(()=>identity('spell',raw)).toThrow();
    expect(()=>identity('magicvariant',{...raw,source:''})).toThrow();
    const r=row('magicvariant',raw);
    expect(makeResolver([r]).resolve(r).entity.source).toBe('XDMG');
  });
  test('copy from nested-source template and reject contradictory effective sources',()=>{
    const a=row('magicvariant',{name:'Base',inherits:{source:'XDMG',entries:['synthetic']}});
    const b=row('magicvariant',{name:'Child',source:'AU',_copy:{name:'Base',source:'XDMG',_mod:{'inherits.source':{mode:'setProp',value:'AU'}}}},1);
    const c=row('magicvariant',{name:'Bad',source:'AU',_copy:{name:'Base',source:'XDMG'}},2);
    const r=makeResolver([a,b,c]);
    expect(r.resolve(b)).toMatchObject({entity:{source:'AU',inherits:{source:'AU'}},lineage:[a.id]});
    expect(()=>r.resolve(c)).toThrow();
  });
  test('literal wildcard replaces text only, preserves tags and names, applies named operations first',()=>{
    const e={name:'Fixture',action:[{name:'wolf',entries:['A wolf and {@spell wolf|PHB} then WOLF.']}],trait:[],description:'wolf'};
    const mods={'*':{mode:'replaceTxt',replace:'wolf',with:'fox',flags:'i'},trait:{mode:'appendArr',items:[{name:'wolf',entries:['wolf']}]}};
    expect(applyMods(e,mods)).toEqual({name:'Fixture',action:[{name:'wolf',entries:['A fox and {@spell wolf|PHB} then fox.']}],trait:[{name:'wolf',entries:['fox']}],description:'wolf'});
  });
  test('rejects arbitrary regex, tag mutation, nested ambiguous walker structures and unsafe paths',()=>{
    const base=()=>({trait:[{entries:['wolf']}]});
    for(const m of [{replace:'w.*',with:'fox'},{replace:'wolf',with:'$&'},{replace:'wolf',with:'fox',tagInsensitive:true},{replace:'wolf',with:'fox',flags:'m'}])
      expect(()=>applyMods(base(),{'*':{mode:'replaceTxt',...m}})).toThrow();
    expect(()=>applyMods({trait:[{entries:[{type:'list',items:['wolf']}]}]},{'*':{mode:'replaceTxt',replace:'wolf',with:'fox'}})).toThrow();
    expect(()=>applyMods(base(),{'_':{mode:'setProp',prop:'__proto__.polluted',value:true}})).toThrow();
    expect(()=>applyMods(base(),{'*':{mode:'setProp',prop:'name',value:'other'}})).toThrow();
  });
  test('root setProp, appendStr and integer scalar operations are deterministic and typed',()=>{
    const e={save:{str:'+2',dex:-1},note:'first'};
    expect(applyMods(e,{'_':{mode:'setProp',prop:'nested.value',value:2},note:{mode:'appendStr',str:'second',joiner:', '},save:[{mode:'scalarAddProp',prop:'*',scalar:2},{mode:'scalarMultProp',prop:'str',scalar:2}]})).toEqual({save:{str:'+8',dex:1},note:'first, second',nested:{value:2}});
    expect(()=>applyMods({save:{str:'1d4'}},{save:{mode:'scalarAddProp',prop:'*',scalar:2}})).toThrow();
    const a=row('spell',{name:'Base',source:'PHB'}),b=row('spell',{name:'Child',source:'PHB',_copy:{name:'Base',source:'PHB',_mod:{'_':{mode:'setProp',prop:'name',value:'Other'}}}});
    expect(()=>makeResolver([a,b]).resolve(b)).toThrow();
  });
  test('collection counts normalized rows without changing existing source identities',()=>{
    const raw={name:'Fixture',inherits:{source:'XDMG'}},data={'data/magicvariants.json':{magicvariant:[raw,{name:'Broken'}]}};
    const main={commit:'main',files:new Map([['data/magicvariants.json','blob']]),readJson:()=>data['data/magicvariants.json']};
    const brew={commit:'brew',files:new Map(),readJson:()=>({})};
    const c=collect(main,brew),r=audit(main,brew,c);
    expect(c.records).toHaveLength(1);expect(c.invalidRecords).toHaveLength(1);
    expect(r.bySource['main:XDMG'].total).toBe(1);expect(raw).not.toHaveProperty('source');
  });
});
const mainPath=process.env.DND_UPSTREAM_RESOLVER_MAIN,brewPath=process.env.DND_UPSTREAM_RESOLVER_BREW;
(mainPath&&brewPath?test:test.skip)('real snapshots recover nested source identities and preserve existing template keys',()=>{
  if(!mainPath||!brewPath)throw Error('missing snapshots');
  const main=openSnapshot(mainPath),brew=openSnapshot(brewPath),c=collect(main,brew);
  const raw=main.readJson('data/magicvariants.json').magicvariant;
  const expected=raw.filter((e:any)=>!Object.prototype.hasOwnProperty.call(e,'source')&&typeof e.inherits?.source==='string'&&e.inherits.source.trim());
  const found=c.records.filter((r:any)=>r.origin==='main'&&r.kind==='magicvariant'&&r.path==='data/magicvariants.json');
  for(const [index,e] of raw.entries()){
    if(!expected.includes(e))continue;
    const match=found.find((r:any)=>r.index===index);
    expect(match?.key).toBe(identity('magicvariant',{...e,source:e.inherits.source}));
  }
  const report=audit(main,brew,c),byOrigin:Record<string,{indexed:number,resolved:number,blocked:number}>={};
  for(const [key,count] of Object.entries(report.counts) as [string,{total:number,resolvedSubset:number,blocked:number}][]){
    const origin=key.split(':')[0],t=byOrigin[origin]??={indexed:0,resolved:0,blocked:0};
    t.indexed+=count.total;t.resolved+=count.resolvedSubset;t.blocked+=count.blocked;
  }
  console.log(JSON.stringify({commits:report.commits,normalizedMainTemplates:expected.length,mainTemplateRows:found.length,byOrigin,issueCounts:report.issueCounts,activation:'review-required'}));
  expect(found.length).toBeGreaterThanOrEqual(expected.length);expect(report.issueCounts.unreadableFile||0).toBe(0);
  for(const t of Object.values(byOrigin))expect(t.indexed).toBe(t.resolved+t.blocked);
},240000);
export {};
