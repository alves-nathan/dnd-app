import * as fs from 'node:fs';
import { createDefaultCharacter, defaultCombatState } from '../data/mockData';
import { calculateFormulaRange } from '../rules-engine/damage/calculateDamage';
import { resolveSpellDamageFormula } from '../rules-engine/actions/spellScaling';
import { addActiveEffectToCharacter, advanceActiveEffectsAtTurnBoundary, getActiveConcentrationEffect } from '../rules-engine/effects/activeEffects';
import type { ActiveEffect, Spell } from '../types';
const {openSnapshot}=require('../../scripts/5etools/inventory');
const {parseFormula,toDamageFormula,compileScaling,bindScaling,compileDuration,compileDefenses,applyTypedDamage,resolveSaveDamage,effectTemplate,buildEffectReport,publicSummary}=require('../../scripts/5etools/effect-damage-preview');
const spec={bindingId:'fixture',application:'onHit',criticalPolicy:'attack',sourceType:'spell'};
describe('a6.5.3 effect and damage semantics',()=>{
  test('strict lexical parser rejects ambiguous expressions and negative dice',()=>{
    expect(parseFormula('2d6 + 3 - 1').terms).toEqual([{kind:'dice',count:2,sides:6},{kind:'flat',value:3},{kind:'flat',value:-1}]);
    for(const s of ['1d6+PB','1d6*2','1d6-1d4','1d6++2','0d6','1d7','1001d6','1 2','1d6|display','1d6+'])expect(parseFormula(s).status).toBe('indeterminate');
    expect(toDamageFormula(parseFormula('2d6'),{...spec,application:'conditional'}).status).toBe('indeterminate');
    expect(toDamageFormula(parseFormula('2d6'),{...spec,application:'onSaveFail'}).status).toBe('indeterminate');
  });
  test('existing damage engine doubles dice, not signed flats, only for attack context',()=>{
    const p=parseFormula('2d6+3-1'),f=toDamageFormula(p,spec);
    const context={character:createDefaultCharacter('Fixture'),combatState:defaultCombatState};
    expect(calculateFormulaRange(f.formula,context,false).total).toEqual({min:4,max:14,average:9});
    expect(calculateFormulaRange(f.formula,context,true).total).toEqual({min:6,max:26,average:16});
    const save=toDamageFormula(p,{...spec,criticalPolicy:'nonAttack',application:'onSaveFail'});
    expect(calculateFormulaRange(save.formula,context,true).total.average).toBe(9);
    expect(toDamageFormula({...p,terms:[]},spec).status).toBe('indeterminate');
  });
  test('cantrip scaling table needs explicit application and works with existing resolver',()=>{
    const item={id:'spell',kind:'spell',payload:{level:0,mechanics:{upstreamSpell:{scalingLevelDice:{label:'fixture',scaling:{1:'1d6',5:'2d6',11:'3d6',17:'4d6'}},entriesHigherLevel:[]}}}};
    const row=compileScaling(item)[0];
    expect(row.status).toBe('scalingTableCandidate');
    expect(bindScaling(row,spec).status).toBe('indeterminate');
    const binding=bindScaling(row,{...spec,sameSingleDamageApplicationConfirmed:true});
    const spell={id:'spell',name:'Fixture',level:0,scaling:binding.scaling} as Spell;
    const character={...createDefaultCharacter('Fixture'),level:11};
    expect(resolveSpellDamageFormula(spell,character).formula?.components[0].dice?.count).toBe(3);
    expect(binding.scaling.requiresReview).toBe(true);
  });
  test('duration preserves maximum and concentration, refuses implicit conversion of time units',()=>{
    const spell=(duration:unknown)=>({payload:{mechanics:{upstreamSpell:{duration}}}});
    expect(compileDuration(spell([{type:'timed',duration:{type:'minute',amount:10},concentration:true}]))).toMatchObject({status:'durationCandidate',unit:'minute',maximum:10,concentration:true,upTo:true});
    expect(compileDuration(spell([{type:'instant'}])).status).toBe('instantaneous');
    expect(compileDuration(spell([{type:'instant'},{type:'special'}])).status).toBe('indeterminate');
  });
  test('typed damage respects immunity and integer rounding, conditional defenses stay pending',()=>{
    const creature=(raw:unknown)=>({payload:{mechanics:{upstreamCreature:raw}}});
    const d=compileDefenses(creature({resist:['fire'],vulnerable:['fire'],immune:['cold']}));
    expect(applyTypedDamage(9,'fire',d).amount).toBe(8);
    expect(applyTypedDamage(9,'cold',d).amount).toBe(0);
    expect(applyTypedDamage(9,'acid',d).amount).toBe(9);
    const conditional=compileDefenses(creature({resist:[{resist:['fire'],note:'fixture'}]}));
    expect(applyTypedDamage(9,'fire',conditional).status).toBe('indeterminate');
    expect(resolveSaveDamage(9,'success','half').amount).toBe(4);
    expect(resolveSaveDamage(9,'failure','half').amount).toBe(9);
    expect(resolveSaveDamage(9,'unknown','half').status).toBe('indeterminate');
  });
  test('explicit effect bridge uses actual concentration and turn-boundary engine',()=>{
    const input={id:'fixture',name:'Fixture',kind:'spell',sourceType:'spell',concentration:true,conditionIds:['fixture-condition'],
      conditionAliasesConfirmed:true,endsOnShortRest:false,endsOnLongRest:false,stackPolicy:'independentConfirmed',
      duration:{unit:'round',remaining:1,expiresOn:'turnEnd'},clockConfirmed:true};
    expect(effectTemplate({...input,stackPolicy:undefined}).status).toBe('indeterminate');
    expect(effectTemplate({...input,duration:{unit:'minute',remaining:1,expiresOn:'turnEnd'}}).status).toBe('indeterminate');
    const t=effectTemplate(input);
    expect(t.status).toBe('effectTemplateCandidate');
    const effect={...t.template,status:'active',createdAt:'2026-01-01T00:00:00.000Z'} as ActiveEffect;
    const character=createDefaultCharacter('Fixture');
    const first=addActiveEffectToCharacter(character,effect);
    const second=addActiveEffectToCharacter(first,{...effect,id:'second'});
    expect(getActiveConcentrationEffect(second)?.id).toBe('second');
    expect(second.activeEffects.filter(e=>e.concentration)).toHaveLength(1);
    expect(getActiveConcentrationEffect(advanceActiveEffectsAtTurnBoundary(second,'turnStart'))?.id).toBe('second');
    expect(getActiveConcentrationEffect(advanceActiveEffectsAtTurnBoundary(second,'turnEnd'))).toBeUndefined();
    expect(getActiveConcentrationEffect(character)).toBeUndefined();
  });
});
const mainPath=process.env.DND_UPSTREAM_EFFECT_MAIN,brewPath=process.env.DND_UPSTREAM_EFFECT_BREW;
(mainPath&&brewPath?test:test.skip)('real damage and effect observations remain review-required',()=>{
  if(!mainPath||!brewPath)throw Error('missing snapshots');
  const r=buildEffectReport(openSnapshot(mainPath),openSnapshot(brewPath));
  console.log(JSON.stringify(publicSummary(r)));
  expect(r.summary.formulas.numericFormulaCandidate||0).toBeGreaterThan(0);
  expect(r.summary.damage.damageFormulaCandidate||0).toBeGreaterThan(0);
  expect(r.summary.scaling.scalingTableCandidate||0).toBeGreaterThan(0);
  expect(r.summary.durations.durationCandidate||0).toBeGreaterThan(0);
  expect(r.summary.defenses.plainDefenseCandidate||0).toBeGreaterThan(0);
  expect(r.summary.conditionDefinitions.stackEditionPolicyPending||0).toBe(2);
  for(const list of [r.formulas,r.damage,r.scaling,r.durations,r.conditions,r.defenses,r.conditionDefinitions,r.saves])expect(list.every((x:any)=>x.activation==='review-required')).toBe(true);
  const out=process.env.DND_UPSTREAM_EFFECT_OUT;
  if(out)fs.writeFileSync(out,JSON.stringify(r,null,2)+'\n',{flag:'wx'});
},240000);
