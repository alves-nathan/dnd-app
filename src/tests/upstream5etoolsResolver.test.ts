const {identity,makeResolver,applyMods,collect} = require('../../scripts/5etools/resolver');
const row = (kind: string, entity: Record<string, unknown>, origin = 'main') => {
  const key = identity(kind,entity);
  return {id:JSON.stringify([origin,key]),key,kind,origin,path:'fixture.json',index:0,entity};
};
describe('5etools conservative resolution', () => {
  test('copy chain preserves overrides, removes explicit null and does not inherit source metadata by default', () => {
    const a = row('background',{name:'Base',source:'A',page:1,srd:true,entries:['a'],skillProficiencies:['x']});
    const b = row('background',{name:'Child',source:'B',_copy:{name:'Base',source:'A',_preserve:{page:true},_mod:{entries:{mode:'appendArr',items:['b']}}},skillProficiencies:null});
    const c = row('background',{name:'Final',source:'C',_copy:{name:'Child',source:'B'}});
    const r = makeResolver([a,b,c]);
    expect(r.resolve(b).entity).toEqual({name:'Child',source:'B',page:1,entries:['a','b']});
    expect(r.resolve(c).entity).toEqual({name:'Final',source:'C',entries:['a','b']});
    expect(r.resolve(c).lineage).toEqual([b.id,a.id]);
    expect(a.entity.entries).toEqual(['a']);
  });
  test('subclass owner distinguishes same name and source across parent editions', () => {
    const a = row('subclass',{name:'Example',shortName:'Example',source:'A',className:'Wizard',classSource:'Old',entries:['x']});
    const b = row('subclass',{name:'Example',shortName:'Example',source:'A',className:'Wizard',classSource:'New',_copy:{name:'Example',shortName:'Example',source:'A',className:'Wizard',classSource:'Old'}});
    expect(makeResolver([a,b]).resolve(b).entity.entries).toEqual(['x']);
    expect(a.id).not.toBe(b.id);
  });
  test('homebrew can inherit main but main never inherits homebrew', () => {
    const a = row('spell',{name:'Base',source:'A',level:1});
    const b = row('spell',{name:'Child',source:'B',_copy:{name:'Base',source:'A'}},'homebrew');
    expect(makeResolver([a,b]).resolve(b).entity.level).toBe(1);
    const c = row('spell',{name:'Other',source:'C',_copy:{name:'Child',source:'B'}});
    expect(() => makeResolver([a,b,c]).resolve(c)).toThrow();
  });
  test('missing, duplicate, cycle and unsupported modifiers fail closed', () => {
    const a = row('spell',{name:'A',source:'A',_copy:{name:'B',source:'A'}});
    const b = row('spell',{name:'B',source:'A',_copy:{name:'A',source:'A'}});
    expect(() => makeResolver([a]).resolve(a)).toThrow();
    expect(() => makeResolver([a,b]).resolve(a)).toThrow();
    expect(() => makeResolver([a,a]).resolve(a)).toThrow();
    expect(() => applyMods({entries:[]},{entries:{mode:'replaceTxt',replace:'x',with:'y'}})).toThrow();
    expect(() => applyMods({entries:[]},{'__proto__.x':{mode:'appendArr',items:[]}})).toThrow();
  });
  test('array operations retain order and reject missing replacement', () => {
    const e = {entries:['a',{name:'b'}]};
    expect(applyMods(e,{entries:[{mode:'insertArr',index:1,items:['x']},{mode:'replaceArr',replace:'b',items:['y']},{mode:'prependArr',items:['z']}]}).entries).toEqual(['z','a','x','y']);
    expect(() => applyMods(e,{entries:{mode:'replaceArr',replace:'missing',items:['q']}})).toThrow();
  });
  test('class feature UIDs preserve levels and explicit sources', () => {
    const c = row('class',{name:'Wizard',source:'New',classFeatures:[{classFeature:'Feature|Wizard|New|3|Extra',gainSubclassFeature:true}]});
    const f = row('classFeature',{name:'Feature',source:'Extra',className:'Wizard',classSource:'New',level:3});
    const r = makeResolver([c,f]);
    expect(r.references(c,r.resolve(c).entity)).toEqual([{relation:'classFeature',target:f.id}]);
    expect(() => makeResolver([c]).references(c,c.entity)).toThrow();
  });
  test('shared files discover new entity sources, including unindexed books', () => {
    const files = {'data/feats.json':{feat:[{name:'Example',source:'Future'}]}};
    const main = {files:new Map(Object.keys(files).map(p => [p,'hash'])),readJson:(p: keyof typeof files)=>files[p]};
    const brew = {files:new Map(),readJson:()=>({})};
    expect(collect(main,brew).records[0].entity.source).toBe('Future');
  });
});
export {};
