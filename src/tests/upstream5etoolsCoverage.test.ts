const {identity,makeResolver,applyMods,audit} = require('../../scripts/5etools/resolver');
const {summarize} = require('../../scripts/5etools/audit-summary');
const row = (kind: string, entity: Record<string, unknown>) => {
  const key = identity(kind,entity);
  return {id:JSON.stringify(['main',key]),key,kind,origin:'main',path:'fixture.json',index:0,entity};
};
const fixture = (data: Record<string, unknown>) => ({
  commit:'fixture', files:new Map(Object.keys(data).map(p=>[p,'blob'])),
  readJson:(p: string)=> { if (!(p in data)) throw new Error('missing'); return data[p]; }
});
describe('upstream structural coverage', () => {
  test('supports nested item mods and deep deduplication without mutating input operations', () => {
    const e = {inherits:{entries:['a'], propertyAdd:['F'], basicRules2024:true}};
    const mods = {'inherits.entries':{mode:'appendArr',items:['b']},
      'inherits.propertyAdd':{mode:'appendIfNotExistsArr',items:['F','V']},
      'inherits.namePrefix':{mode:'setProp',value:'Example '},'inherits.basicRules2024':'remove'};
    expect(applyMods(e,mods)).toEqual({inherits:{entries:['a','b'],propertyAdd:['F','V'],namePrefix:'Example '}});
    expect(() => applyMods(e,{'inherits.__proto__.x':{mode:'setProp',value:1}})).toThrow();
    expect(() => applyMods(e,{'inherits.entries':{mode:'setProp',prop:'constructor.x',value:1}})).toThrow();
  });
  test('subclass UID default is PHB and display text is not identity', () => {
    const c = row('subclass',{name:'Example Long Name',shortName:'Example',source:'PHB',className:'Wizard',classSource:'XPHB',subclassFeatures:['Feature|Wizard|XPHB|Example||3||Display']});
    const owner = row('class',{name:'Wizard',source:'XPHB'});
    const f = row('subclassFeature',{name:'Feature',source:'PHB',className:'Wizard',classSource:'XPHB',subclassShortName:'Example',subclassSource:'PHB',level:3});
    const r = makeResolver([c,owner,f]);
    expect(r.references(c,c.entity)).toEqual([{relation:'classOwner',target:owner.id},{relation:'subclassFeature',target:f.id}]);
    expect(r.lookup('main','subclass',{name:'Example',shortName:'Example',source:'PHB',className:'Wizard',classSource:'XPHB'}).id).toBe(c.id);
  });
  test('propagates blocked structural dependencies and counts variants and reprints', () => {
    const main = fixture({'data/class/class-wizard.json':{class:[{name:'Wizard',source:'A',classFeatures:['Feature|Wizard|A|1']}],
      classFeature:[{name:'Feature',source:'A',className:'Wizard',classSource:'A',level:1,_versions:[{}]}]},
      'data/feats.json':{feat:[{name:'Feat',source:'AU',reprintedAs:['Feat|B'],entries:['{@spell Example|A}']}]}});
    const brew = fixture({'_generated/index-sources.json':{}});
    const report = audit(main,brew);
    expect(report.bySource['main:A'].blocked).toBe(2);
    expect(report.bySource['main:A'].variants).toBe(1);
    expect(report.issueCounts.blockedDependency).toBe(1);
    expect(report.bySource['main:AU'].reprints).toBe(1);
    expect(report.bySource['main:AU'].inlineTags.spell).toBe(1);
    const safe = summarize(report);
    expect(safe.totals).toEqual({total:3,resolvedSubset:1,blocked:2});
    expect(JSON.stringify(safe)).not.toContain('Feature|Wizard');
    expect(safe).not.toHaveProperty('entities');
  });
  test('blocks identity-changing modifications', () => {
    const a = row('spell',{name:'Base',source:'A'});
    const b = row('spell',{name:'Child',source:'B',_copy:{name:'Base',source:'A',_mod:{source:{mode:'setProp',value:'C'}}}});
    expect(() => makeResolver([a,b]).resolve(b)).toThrow();
  });
});
export {};
