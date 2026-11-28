import {createEmptyCharacter} from '../data/mockData';
import {applySpellSlotRest,spendSpellSlots} from '../rules-engine/resources/spellSlotManager';
import {applyRest,spendResources} from '../rules-engine/resources/resourceManager';
import type {Character} from '../types';

describe('a8.17.2 actual resource and slot consumer boundaries',()=>{
 const fixture=():Character=>({...createEmptyCharacter('Fixture'),
  resources:[{id:'short',name:'Short',max:2,current:2,recharge:'shortRest'},{id:'manual',name:'Manual',max:3,current:1,recharge:'manual'}],
  spellSlots:[{id:'standard',level:2,max:2,current:2,recharge:'longRest',poolKind:'spellcasting'},
   {id:'pact',level:2,max:2,current:2,recharge:'shortRest',poolKind:'pactMagic',sourceClassId:'fixture-warlock'}]});
 test('explicit pact pool consumption and short rest do not spend or replenish the other pool',()=>{
  const base=fixture(),before=JSON.stringify(base);
  const used=spendSpellSlots({character:base,costs:[{slotLevel:2,amount:1,poolKind:'pactMagic',sourceClassId:'fixture-warlock'}]});
  expect(used.character.spellSlots.find(s=>s.id==='pact')?.current).toBe(1);
  expect(used.character.spellSlots.find(s=>s.id==='standard')?.current).toBe(2);
  const exhausted=spendSpellSlots({character:used.character,costs:[{slotLevel:2,amount:2,poolKind:'pactMagic',sourceClassId:'fixture-warlock'}]});
  expect(exhausted.transactions).toEqual([]);
  expect(exhausted.character).toEqual(used.character);
  const spent=spendSpellSlots({character:used.character,costs:[{slotLevel:2,amount:1,poolKind:'spellcasting'}]});
  const rested=applySpellSlotRest(spent.character,'shortRest').character;
  expect(rested.spellSlots.find(s=>s.id==='pact')?.current).toBe(2);
  expect(rested.spellSlots.find(s=>s.id==='standard')?.current).toBe(1);
  expect(applySpellSlotRest(rested,'longRest').character.spellSlots.every(s=>s.current===s.max)).toBe(true);
  expect(JSON.stringify(base)).toBe(before);
 });
 test('rejects overconsumption atomically, preserves manual resource during rest',()=>{
  const base=fixture(),before=JSON.stringify(base);
  const rejected=spendResources({character:base,costs:[{resourceId:'short',amount:3},{resourceId:'manual',amount:1}]});
  expect(rejected.transactions).toEqual([]);
  expect(rejected.character).toEqual(base);
  const spent=spendResources({character:base,costs:[{resourceId:'short',amount:1}]});
  expect(spent.character.resources.find(r=>r.id==='short')?.current).toBe(1);
  const rested=applyRest(spent.character,'shortRest').character;
  expect(rested.resources.find(r=>r.id==='short')?.current).toBe(2);
  expect(rested.resources.find(r=>r.id==='manual')?.current).toBe(1);
  expect(JSON.stringify(base)).toBe(before);
 });
});
