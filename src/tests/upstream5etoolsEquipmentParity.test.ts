import { validateCompendiumJson, buildPersistedCompendiumImport } from '../compendium/importer';
import { applyCompendiumItemToCharacter, buildWeaponFromCompendiumItem } from '../compendium/mapper';
import { createEmptyCharacter, defaultCombatState } from '../data/mockData';
import { getArmorClass } from '../rules-engine/characters/derivedStats';
import { buildWeaponAttackAction } from '../rules-engine/actions/buildActions';
import { analyzeActionDamage } from '../rules-engine/damage/calculateDamage';
import { toggleArmorAccessory } from '../characters/equipmentLoadoutRules';
import { checkRotationAmmunition, spendRotationAmmunition } from '../characters/ammunitionRules';
import type { TurnRotation } from '../types';
const {compareFields,buildEquipmentParityEvidence,publicSummary}=require('../../scripts/5etools/equipment-parity-evidence');
const {digest}=require('../../scripts/5etools/integrated-review');
const {buildPilot,physicalId}=require('../../scripts/5etools/equipment-converter');
const commits={application:'a'.repeat(40),main:'b'.repeat(40),homebrew:'c'.repeat(40)};
const src={id:'fixture',status:'active',confidence:'exact'};
const oldWeapon={weaponType:'finesse',attackAbility:'STR_OR_DEX',damageAbility:'STR_OR_DEX',damageFormula:'1d4 + STR_OR_DEX',damageType:'piercing',properties:['Light','Finesse','Thrown'],range:{normal:20,long:60,unit:'ft'},cost:{amount:2,unit:'GP'}};
const candidateWeapon={...oldWeapon,attackAbility:{kind:'choice',options:['STR','DEX']},damageAbility:{kind:'choice',options:['STR','DEX']},properties:['finesse','thrown','light'],cost:{amount:200,unit:'CP'}};
function fixture(){
  const old={id:'legacy',kind:'weapon',name:'PRIVATE_NAME',source:src,payload:oldWeapon};
  const target={id:'upstream:main:fixture',kind:'weapon',name:'PRIVATE_NAME',source:{status:'needsReview'},provenance:{origin:'5etools',commit:commits.main},payload:candidateWeapon};
  const row={id:old.id,kind:'weapon',path:'PRIVATE_PATH',index:0,sourceFingerprint:digest(old),status:'identityCandidate',
    targetId:target.id,targetFingerprint:digest(target),eraStatus:'sameKnownEra',evidenceId:'PRIVATE_EVIDENCE',
    decision:'unreviewed',preservation:'required',activation:'review-required'};
  return {reconciliation:{schemaVersion:'dnd-upstream-historical-reconciliation.v1',commits,activation:'review-required',
    summary:{approvedMappings:0,mechanicalParityEstablished:0,retirementAuthorized:false,issues:{}},historical:[row]},
    rawHistorical:[{path:row.path,index:0,item:old}],items:[target]};
}
const status=(rows:any[],field:string)=>rows.find(x=>x.field===field)?.status;
function stored(kind:'weapon'|'armor',payload:Record<string,unknown>,id='fixture',review=false){
  const source=review?{...src,status:'needsReview'}:src;
  const parsed=validateCompendiumJson(JSON.stringify({id:'fixture-pack',source,items:[{id,kind,name:id,source,payload}]}));
  if(!parsed.ok||!parsed.data)throw Error('synthetic fixture invalid');
  return buildPersistedCompendiumImport(parsed.data).items[0];
}
function pilot(){
  const data:Record<string,unknown>={
    'data/books.json':{book:[{source:'XPHB',name:'Fixture',published:'2024-09-17'}]},
    'data/items-base.json':{baseitem:[
      {name:'Fixture Weapon',source:'XPHB',edition:'one',type:'M|XPHB',rarity:'none',weaponCategory:'simple',dmg1:'1d4',dmgType:'P',property:['F|XPHB','T|XPHB','L|XPHB'],range:'20/60',value:200},
      {name:'Fixture Medium',source:'XPHB',type:'MA|XPHB',rarity:'none',ac:14},
      {name:'Fixture Heavy',source:'XPHB',type:'HA|XPHB',rarity:'none',ac:16,strength:'13'},
      {name:'Arrow',source:'XPHB',type:'A|XPHB',rarity:'none'},
      {name:'Fixture Bow',source:'XPHB',type:'R|XPHB',rarity:'none',weaponCategory:'simple',dmg1:'1d6',dmgType:'P',property:['A|XPHB','2H|XPHB'],ammoType:'arrow|xphb',range:'80/320'},
      {name:'Fixture Shield',source:'XPHB',type:'S|XPHB',rarity:'none',ac:2}],
      itemProperty:['F','T','L','A','2H'].map(abbreviation=>({abbreviation,source:'XPHB'})),itemMastery:[],itemType:[]},
    'data/items.json':{item:[]}
  };
  return buildPilot({commit:commits.main,files:new Map(Object.keys(data).map(p=>[p,'d'.repeat(40)])),readJson:(p:string)=>data[p]},['XPHB']).packs[0].items;
}
describe('a8.5.1 equipment mechanical evidence',()=>{
  test('distinguishes exact, representational, missing, added and unassessed values without inferring defaults',()=>{
    const rows=compareFields('weapon',oldWeapon,{...candidateWeapon,damageFormula:'1d6 + STR_OR_DEX',damageType:undefined,magicBonus:0});
    expect(status(rows,'properties')).toBe('representationOnlyCandidate');
    expect(status(rows,'cost')).toBe('representationOnlyCandidate');
    expect(status(rows,'damageFormula')).toBe('differentValue');
    expect(status(rows,'damageType')).toBe('missingCandidate');
    expect(status(rows,'magicBonus')).toBe('addedCandidate');
    expect(status(rows,'attackAbility')).toBe('differentValue');
    expect(status(compareFields('armor',{baseAC:14,dexCap:null},{baseAC:14}),'dexCap')).toBe('missingCandidate');
    expect(status(compareFields('armor',{},{}),'baseAC')).toBe('requiredAbsentBoth');
  });
  test('binds each historical occurrence and exact candidate, preserves review, redacts public output',()=>{
    const f=fixture(),before=digest(f),r=buildEquipmentParityEvidence(f);
    expect(r.byKind.weapon).toMatchObject({occurrences:1,identityCandidates:1,eraPending:0,byStatus:{fieldReviewRequired:1}});
    expect(r).toMatchObject({mechanicalParityEstablished:0,approvedMappings:0,executable:false,retirementAuthorized:false});
    expect(r.rows[0].writeAuthorized).toBe(false);
    expect(digest(f)).toBe(before);
    expect(JSON.stringify(publicSummary(r))).not.toContain('PRIVATE_');
    expect(()=>buildEquipmentParityEvidence({...f,items:[{...f.items[0],payload:{}}]})).toThrow('targetBindingMismatch');
    expect(()=>buildEquipmentParityEvidence({...f,rawHistorical:[{...f.rawHistorical[0],item:{...f.rawHistorical[0].item,name:'changed'}}]})).toThrow('historicalBindingMismatch');
  });
  test('isolates unmatched and uncertain-era identities; field compatibility never approves parity',()=>{
    const f=fixture();const row=f.reconciliation.historical[0];
    const pending=buildEquipmentParityEvidence({...f,reconciliation:{...f.reconciliation,historical:[{...row,status:'noQualifiedNameCandidate'}]}});
    expect(pending.byKind.weapon.identityPending).toBe(1);
    const uncertain=buildEquipmentParityEvidence({...f,reconciliation:{...f.reconciliation,historical:[{...row,eraStatus:'editionReviewRequired'}]}});
    expect(uncertain.byKind.weapon.eraPending).toBe(1);
    expect(uncertain.mechanicalParityEstablished).toBe(0);
  });
  test('synthetic converter weapon matches selected legacy runtime behavior across ability and range scenarios',()=>{
    // The pilot now includes a ranged weapon too, and orders by physical ID.
    // Bind the comparison to its intended synthetic finesse fixture.
    const item=pilot().find((i:any)=>i.id===physicalId('XPHB','weapon','Fixture Weapon'));
    expect(item).toMatchObject({kind:'weapon',name:'Fixture Weapon',payload:{
      weaponType:'finesse',damageFormula:'1d4 + STR_OR_DEX',range:{normal:20,long:60,unit:'ft'}
    }});
    const a=stored('weapon',oldWeapon),b=stored('weapon',item.payload);
    for(const [str,dex] of [[18,10],[10,18],[14,14]]){
      const base=createEmptyCharacter('Fixture');
      const char={...base,abilities:{...base.abilities,STR:str,DEX:dex}};
      const wa=buildWeaponFromCompendiumItem(char,a,'same').weapon;
      const wb=buildWeaponFromCompendiumItem(char,b,'same').weapon;
      expect(wb.attackAbility).toBe(wa.attackAbility);
      expect(wb.damageAbility).toBe(wa.damageAbility);
      expect(wb.range).toEqual(wa.range);
      for(const distance of [5,20,40,70]){
        const run=(w:typeof wa)=>{
          const character={...char,weapons:[{...w,equipped:true}]};
          const action=buildWeaponAttackAction(character,w.id)!;
          expect(action).toBeDefined();
          const result=analyzeActionDamage({action,character,combatState:{...defaultCombatState,targetAC:15,targetDistanceFeet:distance}});
          return {average:result.weightedAverage,warnings:result.warnings.map(x=>x.code)};
        };
        expect(run(wb)).toEqual(run(wa));
      }
    }
  });
  test('qualified ammo candidate feeds the existing mapper and rotation inventory rules in disposable fixtures',()=>{
    const bow=pilot().find((i:any)=>i.name==='Fixture Bow');
    expect(bow.payload.ammunitionType).toBe('arrow');
    const base=createEmptyCharacter('Fixture');
    const w=buildWeaponFromCompendiumItem(base,stored('weapon',bow.payload),'bow').weapon;
    expect(w.ammunitionType).toBe('arrow');
    const character={...base,weapons:[{...w,equipped:true}],equipment:[{id:'ammo',name:'Fixture ammunition',quantity:1,ammunitionType:'arrow',tags:[]}]};
    const action=buildWeaponAttackAction(character,w.id)!;
    expect(action.ammunitionType).toBe('arrow');
    const rotation:TurnRotation={id:'fixture',characterId:character.id,name:'Fixture',actions:[{id:'shot',name:'Fixture',actionCost:action.actionCost,action}]};
    expect(checkRotationAmmunition(rotation,character).ok).toBe(true);
    const spent=spendRotationAmmunition(character,rotation);
    expect(spent.equipment[0].quantity).toBe(0);
    expect(character.equipment[0].quantity).toBe(1);
    expect(checkRotationAmmunition(rotation,spent).ok).toBe(false);
  });
  test('records the heavy armor negative Dexterity gap without changing existing runtime',()=>{
    const item=pilot().find((i:any)=>i.name==='Fixture Heavy');
    expect(item.payload.mechanics.armorClassCandidate).toMatchObject({dexterity:'ignoreModifier',baseAC:16});
    expect(item.metadata.reviewCodes).toContain('heavyArmorNegativeDexRuntimeReview');
    const base=createEmptyCharacter('Fixture'),character={...base,abilities:{...base.abilities,DEX:8}};
    const mapped=applyCompendiumItemToCharacter(character,stored('armor',item.payload));
    expect(mapped.ok).toBe(true);
    // Character engine currently applies Math.min(-1,0). This is evidence
    // of an unresolved discrepancy, NOT an approval of the legacy result.
    expect(getArmorClass(mapped.character)).toBe(15);
    expect(getArmorClass(mapped.character)).not.toBe(item.payload.baseAC);
  });
  test('synthetic armor and shield use actual mapper and AC engine; needsReview is still blocked',()=>{
    const items=pilot(),armor=items.find((i:any)=>i.name==='Fixture Medium'),shield=items.find((i:any)=>i.name==='Fixture Shield');
    for(const dex of [8,14,18]){
      const base=createEmptyCharacter('Fixture'),character={...base,abilities:{...base.abilities,DEX:dex}};
      const old=stored('armor',{armorCategory:'medium',baseAC:14,dexCap:2,stacksWithArmor:false},'armor');
      const newer=stored('armor',armor.payload,'armor');
      const add=(item:typeof old,shieldItem:typeof old)=>{
        const result=applyCompendiumItemToCharacter(character,item);
        expect(result.ok).toBe(true);
        const next=applyCompendiumItemToCharacter(result.character,shieldItem);
        expect(next.ok).toBe(true);
        const id=next.character.armorAccessories![0].id;
        return getArmorClass(toggleArmorAccessory(next.character,id).character);
      };
      const a=add(old,stored('armor',{armorCategory:'shield',baseAC:0,acBonus:2,stacksWithArmor:true},'shield'));
      const b=add(newer,stored('armor',shield.payload,'shield'));
      expect(a).toBe(16+Math.min(Math.floor((dex-10)/2),2));
      expect(b).toBe(a);
      expect(applyCompendiumItemToCharacter(character,stored('armor',armor.payload,'review',true)).ok).toBe(false);
    }
  });
});
