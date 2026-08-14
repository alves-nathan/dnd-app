#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const root = path.resolve(__dirname, '..');
const checkOnly = process.argv.includes('--check');
const phb2024Path = path.join(root, 'assets', 'compendium', 'phb-2024-full-consolidated-import-pack-v2-canonical.json');
const v1Relative = 'artifacts/compendium/integration/source/phb-2014-2024-compatible-delta-v1.json';
const v2Relative = 'assets/compendium/phb-2014-2024-compatible-delta-v2-canonical.json';
const validationRelative = 'artifacts/compendium/integration/phb2014-delta-validation-report.json';
const v1Path = path.join(root, v1Relative);
const v2Path = path.join(root, v2Relative);
const validationPath = path.join(root, validationRelative);
const v1ShaPath = `${v1Path}.sha256`;
const v2ShaPath = `${v2Path}.sha256`;

const pretty = (value) => `${JSON.stringify(value, null, 2)}\n`;
const sha256 = (text) => crypto.createHash('sha256').update(text).digest('hex');
const kebab = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const normalizeName = (value) => value
  .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  .replace(/[’']/g, '')
  .replace(/[^A-Za-z0-9]+/g, ' ')
  .trim().toLowerCase();

const phb2024 = JSON.parse(fs.readFileSync(phb2024Path, 'utf8'));
const phb2024ById = new Map(phb2024.items.map((item) => [item.id, item]));
const spellByName = new Map(phb2024.items.filter((item) => item.kind === 'spell').map((item) => [normalizeName(item.name), item]));
const spellId = (name) => {
  const item = spellByName.get(normalizeName(name));
  if (!item) throw new Error(`PHB 2024 spell not found for legacy compatibility reference: ${name}`);
  return item.id;
};

const PACK_ID = 'phb-2014-2024-compatible-delta-v1';
const sourceBase = {
  id: 'phb-2014',
  book: 'players-handbook',
  version: '2014+official-errata',
  status: 'needsReview',
  confidence: 'importedNeedsReview',
  rulesEra: 'legacy',
  contentType: 'official'
};
const source = (page) => ({ ...sourceBase, page: String(page) });
const compatibility = (legacyLevelGained) => ({
  rulesEra: 'legacy',
  sourcePublicationYear: 2014,
  compatibilityTarget: '2024-class-chassis',
  legacySource: true,
  ...(legacyLevelGained !== undefined ? { legacyLevelGained } : {})
});
const actionTiming = (actionCost, subtype = actionCost === 'free' ? 'passive' : 'other', trigger) => ({
  actionCost,
  subtype,
  ...(trigger ? { trigger } : {}),
  original: actionCost === 'bonusAction' ? 'bonus action' : actionCost === 'free' ? 'passive' : actionCost
});

const items = [];
const push = (item) => { items.push(item); return item.id; };
const makeFeature = ({ id, name, summary, page, classId, subclassId, speciesId, levelGained, legacyLevelGained, actionCost = 'free', mechanics = {}, resource, grantsActions = [], damageFormula = '', damageType, requiresConcentration = false, extractionNotes = [] }) => ({
  id, kind: 'feature', name, summary, source: source(page),
  payload: {
    sourceType: speciesId ? 'speciesTrait' : subclassId ? 'subclassFeature' : 'classFeature',
    ...(classId ? { classId } : {}),
    ...(subclassId ? { subclassId } : {}),
    ...(speciesId ? { speciesId } : {}),
    ...(levelGained !== undefined ? { levelGained } : {}),
    actionCost,
    actionTiming: actionTiming(actionCost, actionCost === 'free' ? 'passive' : actionCost === 'reaction' ? 'triggered' : 'other', mechanics.trigger),
    requiresConcentration,
    damageFormula,
    ...(damageType ? { damageType } : {}),
    conditionalDamage: [],
    ...(resource ? { resource } : {}),
    grantsActions,
    effectTemplates: [],
    engineKey: `phb2014.${id.replace(/^phb-2014-feature-/, '').replace(/-/g, '.')}`,
    mechanics: { ...compatibility(legacyLevelGained), ...mechanics },
    extractionNotes: [
      'Mechanical paraphrase from the attached 2014 Player’s Handbook; narrative prose and artwork omitted.',
      ...(legacyLevelGained !== undefined && legacyLevelGained !== levelGained ? [`Legacy level ${legacyLevelGained} is projected to level ${levelGained} on the 2024 class chassis.`] : []),
      ...extractionNotes
    ]
  }
});
const makeSubclass = ({ id, name, summary, page, classId, localFeatureIds, progression, originalClassId }) => ({
  id, kind: 'subclass', name, summary, source: source(page),
  payload: {
    classId,
    featureIds: localFeatureIds,
    progression,
    tags: ['phb-2014', 'official', 'legacy', '2024-compatible', 'legacy-adapted'],
    engineKey: `phb2014.${id.replace(/^phb-2014-subclass-/, 'subclass.').replace(/-/g, '.')}`,
    mechanics: {
      rulesEra: 'legacy', sourcePublicationYear: 2014, compatibilityTarget: '2024-class-chassis', legacySource: true,
      originalClassId,
      progressionPolicy: 'Legacy level-1/2 subclass features unlock at the 2024 subclass entry level (3); later legacy subclass feature levels remain unchanged. Cleric Divine Strike/Potent Spellcasting branches are replaced by PHB 2024 Blessed Strikes.'
    },
    extractionNotes: ['Legacy-only PHB 2014 subclass retained because it has no PHB 2024 replacement.']
  }
});
const makeSpecies = ({ id, name, summary, page, speed, featureIds, languages, legacyAsi }) => ({
  id, kind: 'species', name, summary, source: source(page),
  payload: {
    speed,
    size: 'Medium',
    featureIds,
    engineKey: `phb2014.species.${id.replace(/^phb-2014-species-/, '').replace(/-/g, '.')}`,
    mechanics: {
      rulesEra: 'legacy', sourcePublicationYear: 2014, compatibilityTarget: '2024-character-creation', legacySource: true,
      ignoreLegacySpeciesAbilityScoreIncrease: true,
      legacyAbilityScoreIncrease: legacyAsi,
      languageProficiencies: languages
    },
    extractionNotes: [
      'Legacy-only PHB 2014 species retained because it has no PHB 2024 replacement.',
      'The original species Ability Score Increase is preserved only as provenance and is not applied in the 2024 profile; 2024 backgrounds provide ability score increases.'
    ]
  }
});
const makeFeat = ({ id, name, summary, page, abilityScoreIncrease = [], mechanics }) => ({
  id, kind: 'feat', name, summary, source: source(page),
  payload: {
    category: 'general', prerequisite: '', abilityScoreIncrease, repeatable: false, featureIds: [],
    mechanics: { rulesEra: 'legacy', sourcePublicationYear: 2014, compatibilityTarget: '2024-character-creation', legacySource: true, ...mechanics },
    grantsActions: [], effectTemplates: [], tags: ['phb-2014', 'official', 'legacy', '2024-compatible', 'feat'],
    engineKey: `phb2014.feat.${id.replace(/^phb-2014-feat-/, '').replace(/-/g, '.')}`,
    extractionNotes: ['Mechanical paraphrase from the attached 2014 Player’s Handbook with applicable official PHB 2014 errata reconciled.']
  }
});

const CLERIC = 'phb-2024-class-cleric';
const WIZARD = 'phb-2024-class-wizard';
const BLESSED = 'phb-2024-feature-cleric-blessed-strikes';

function domainSpellsFeature({ slug, name, subclassId, page, table }) {
  const resolved = Object.fromEntries(Object.entries(table).map(([level, names]) => [level, names.map(spellId)]));
  return makeFeature({
    id: `phb-2014-feature-cleric-${slug}-domain-spells`, name: 'Domain Spells',
    summary: `Magias do ${name} ficam sempre preparadas conforme os níveis clericais da tabela legacy, usando as versões PHB 2024 das magias.`,
    page, classId: CLERIC, subclassId, levelGained: 3, legacyLevelGained: 1,
    mechanics: {
      domain: name,
      domainSpellTable: resolved,
      alwaysPrepared: true,
      countsAgainstPreparedSpells: false,
      spellVersionPolicy: 'PHB 2024 spell entity'
    }
  });
}

// Knowledge Domain
{
  const sid = 'phb-2014-subclass-cleric-knowledge-domain';
  const ids = [];
  ids.push(push(domainSpellsFeature({ slug: 'knowledge-domain', name: 'Knowledge Domain', subclassId: sid, page: '59-60', table: {
    1: ['Command','Identify'], 3: ['Augury','Suggestion'], 5: ['Nondetection','Speak with Dead'], 7: ['Arcane Eye','Confusion'], 9: ['Legend Lore','Scrying']
  }})));
  ids.push(push(makeFeature({ id:'phb-2014-feature-cleric-knowledge-domain-blessings-of-knowledge', name:'Blessings of Knowledge', summary:'Aprende dois idiomas e escolhe duas entre Arcana, History, Nature e Religion; nos checks escolhidos aplica o dobro do bônus de proficiência.', page:59, classId:CLERIC, subclassId:sid, levelGained:3, legacyLevelGained:1, mechanics:{ languageChoice:{count:2}, skillChoice:{count:2,options:['Arcana','History','Nature','Religion']}, proficiencyMultiplierForChosenSkills:2 } })));
  ids.push(push(makeFeature({ id:'phb-2014-feature-cleric-knowledge-domain-channel-divinity-knowledge-of-the-ages', name:'Channel Divinity: Knowledge of the Ages', summary:'Como Action, escolhe uma skill ou tool e ganha proficiência nela por 10 minutos.', page:59, classId:CLERIC, subclassId:sid, levelGained:3, legacyLevelGained:2, actionCost:'action', mechanics:{ usesChannelDivinity:true, choice:{count:1,from:['skills','tools']}, grantsProficiency:true, duration:'10 minutes' } })));
  ids.push(push(makeFeature({ id:'phb-2014-feature-cleric-knowledge-domain-channel-divinity-read-thoughts', name:'Channel Divinity: Read Thoughts', summary:'Lê pensamentos superficiais de uma criatura a 60 ft. após Wisdom save e pode encerrar para aplicar Suggestion sem slot, com falha automática do alvo.', page:59, classId:CLERIC, subclassId:sid, levelGained:6, legacyLevelGained:6, actionCost:'action', mechanics:{ usesChannelDivinity:true, rangeFeet:60, target:'one creature owner can see', save:{ability:'WIS',dc:'cleric spell save DC'}, onSaveSuccess:{cannotTargetAgainUntil:'longRest'}, onSaveFailure:{surfaceThoughts:true,duration:'1 minute',requiresWithinFeet:60}, followUpAction:{actionCost:'action',endsReadThoughts:true,spellId:spellId('Suggestion'),expendsSpellSlot:false,targetAutomaticallyFailsSave:true} } })));
  ids.push(push(makeFeature({ id:'phb-2014-feature-cleric-knowledge-domain-visions-of-the-past', name:'Visions of the Past', summary:'Meditação psicométrica para ler eventos passados ligados a um objeto ou a uma área, com duração máxima baseada em Wisdom.', page:60, classId:CLERIC, subclassId:sid, levelGained:17, legacyLevelGained:17, actionCost:'special', requiresConcentration:true, mechanics:{ activationMinimum:'1 minute meditation', concentrationLikeSpell:true, maximumMinutes:'WIS score', recharge:['shortRest','longRest'], modes:{ objectReading:{learnOwnerHistory:true,recentSignificantEvent:true}, areaReading:{area:'50-ft cube centered on owner',daysBack:'WIS score',significantEventPerMinute:true} } } })));
  const featureIds=[...ids,BLESSED];
  push(makeSubclass({ id:sid,name:'Knowledge Domain',summary:'Cleric Domain legacy focado em idiomas, perícias, leitura de pensamentos e psicometria.',page:'59-60',classId:CLERIC,originalClassId:'phb-2014-class-cleric',localFeatureIds:featureIds,progression:[{level:3,featureIds:ids.slice(0,3)},{level:6,featureIds:[ids[3]]},{level:8,featureIds:[BLESSED]},{level:17,featureIds:[ids[4]]}] }));
}

// Nature Domain
{
  const sid='phb-2014-subclass-cleric-nature-domain'; const ids=[];
  ids.push(push(domainSpellsFeature({slug:'nature-domain',name:'Nature Domain',subclassId:sid,page:'61-62',table:{1:['Animal Friendship','Speak with Animals'],3:['Barkskin','Spike Growth'],5:['Plant Growth','Wind Wall'],7:['Dominate Beast','Grasping Vine'],9:['Insect Plague','Tree Stride']}})));
  ids.push(push(makeFeature({id:'phb-2014-feature-cleric-nature-domain-acolyte-of-nature',name:'Acolyte of Nature',summary:'Escolhe um Druid cantrip e proficiência em Animal Handling, Nature ou Survival; pela errata, o cantrip conta como Cleric cantrip e não ocupa o limite de cantrips.',page:62,classId:CLERIC,subclassId:sid,levelGained:3,legacyLevelGained:1,mechanics:{cantripChoice:{count:1,sourceClassId:'phb-2024-class-druid',spellLevel:0},chosenCantripCountsAs:'cleric',countsAgainstClericCantrips:false,skillChoice:{count:1,options:['Animal Handling','Nature','Survival']},officialErrataApplied:true}})));
  ids.push(push(makeFeature({id:'phb-2014-feature-cleric-nature-domain-bonus-proficiency',name:'Bonus Proficiency',summary:'Ganha treinamento com Heavy Armor.',page:62,classId:CLERIC,subclassId:sid,levelGained:3,legacyLevelGained:1,mechanics:{armorTraining:['Heavy Armor']}})));
  ids.push(push(makeFeature({id:'phb-2014-feature-cleric-nature-domain-channel-divinity-charm-animals-and-plants',name:'Channel Divinity: Charm Animals and Plants',summary:'Beasts e Plants a 30 ft. que vejam o cleric fazem Wisdom save; em falha ficam Charmed por 1 minuto ou até sofrer dano.',page:62,classId:CLERIC,subclassId:sid,levelGained:3,legacyLevelGained:2,actionCost:'action',mechanics:{usesChannelDivinity:true,rangeFeet:30,targetCreatureTypes:['Beast','Plant'],targetMustSeeOwner:true,save:{ability:'WIS',dc:'cleric spell save DC'},onFail:{condition:'Charmed',duration:'1 minute',endsOnDamage:true,friendlyTo:['owner','owner-designated creatures']}}})));
  ids.push(push(makeFeature({id:'phb-2014-feature-cleric-nature-domain-dampen-elements',name:'Dampen Elements',summary:'Reaction para conceder resistência contra uma instância de acid, cold, fire, lightning ou thunder damage a si ou criatura a 30 ft.',page:62,classId:CLERIC,subclassId:sid,levelGained:6,legacyLevelGained:6,actionCost:'reaction',mechanics:{trigger:'owner or creature within 30 ft takes eligible damage',rangeFeet:30,damageTypes:['acid','cold','fire','lightning','thunder'],effect:'resistance to triggering damage instance'}})));
  ids.push(push(makeFeature({id:'phb-2014-feature-cleric-nature-domain-master-of-nature',name:'Master of Nature',summary:'Bonus Action para comandar verbalmente cada criatura atualmente Charmed por Charm Animals and Plants sobre o que fará no próximo turno.',page:62,classId:CLERIC,subclassId:sid,levelGained:17,legacyLevelGained:17,actionCost:'bonusAction',mechanics:{requiresFeatureId:'phb-2014-feature-cleric-nature-domain-channel-divinity-charm-animals-and-plants',targets:'creatures currently charmed by that feature',commandTiming:'what each target will do on its next turn'}})));
  const featureIds=[...ids,BLESSED];
  push(makeSubclass({id:sid,name:'Nature Domain',summary:'Cleric Domain legacy com Druid cantrip, Heavy Armor, controle de beasts/plants e proteção elemental.',page:'61-62',classId:CLERIC,originalClassId:'phb-2014-class-cleric',localFeatureIds:featureIds,progression:[{level:3,featureIds:ids.slice(0,4)},{level:6,featureIds:[ids[4]]},{level:8,featureIds:[BLESSED]},{level:17,featureIds:[ids[5]]}]}));
}

// Tempest Domain
{
  const sid='phb-2014-subclass-cleric-tempest-domain'; const ids=[];
  ids.push(push(domainSpellsFeature({slug:'tempest-domain',name:'Tempest Domain',subclassId:sid,page:'62-63',table:{1:['Fog Cloud','Thunderwave'],3:['Gust of Wind','Shatter'],5:['Call Lightning','Sleet Storm'],7:['Control Water','Ice Storm'],9:['Destructive Wave','Insect Plague']}})));
  ids.push(push(makeFeature({id:'phb-2014-feature-cleric-tempest-domain-bonus-proficiencies',name:'Bonus Proficiencies',summary:'Ganha treinamento com Martial Weapons e Heavy Armor.',page:62,classId:CLERIC,subclassId:sid,levelGained:3,legacyLevelGained:1,mechanics:{weaponTraining:['Martial Weapons'],armorTraining:['Heavy Armor']}})));
  ids.push(push(makeFeature({id:'phb-2014-feature-cleric-tempest-domain-wrath-of-the-storm',name:'Wrath of the Storm',summary:'Reaction quando criatura visível a 5 ft. acerta o cleric: Dexterity save contra 2d8 lightning ou thunder, metade no sucesso; usos por Long Rest baseados em Wisdom.',page:62,classId:CLERIC,subclassId:sid,levelGained:3,legacyLevelGained:1,actionCost:'reaction',resource:{id:'phb2014-tempest-wrath-of-the-storm',name:'Wrath of the Storm',max:{kind:'abilityModifier',formula:'max(1, WIS modifier)'},recharge:'longRest'},mechanics:{trigger:'visible creature within 5 ft hits owner with an attack',rangeFeet:5,damageTypeChoice:['lightning','thunder'],save:{ability:'DEX',dc:'cleric spell save DC'},damageFormula:'2d8',damageOnSaveSuccess:'half'}})));
  ids.push(push(makeFeature({id:'phb-2014-feature-cleric-tempest-domain-channel-divinity-destructive-wrath',name:'Channel Divinity: Destructive Wrath',summary:'Ao rolar lightning ou thunder damage, pode gastar Channel Divinity para causar o máximo possível em vez de rolar.',page:62,classId:CLERIC,subclassId:sid,levelGained:3,legacyLevelGained:2,actionCost:'free',mechanics:{usesChannelDivinity:true,trigger:'when owner rolls lightning or thunder damage',damageTypes:['lightning','thunder'],replaceDamageRollWithMaximum:true}})));
  ids.push(push(makeFeature({id:'phb-2014-feature-cleric-tempest-domain-thunderbolt-strike',name:'Thunderbolt Strike',summary:'Quando causa lightning damage a criatura Large ou menor, pode empurrá-la até 10 ft. para longe.',page:62,classId:CLERIC,subclassId:sid,levelGained:6,legacyLevelGained:6,mechanics:{trigger:'owner deals lightning damage',maximumTargetSize:'Large',pushFeet:10,direction:'away from owner'}})));
  ids.push(push(makeFeature({id:'phb-2014-feature-cleric-tempest-domain-stormborn',name:'Stormborn',summary:'Ganha Fly Speed igual ao Walking Speed enquanto não estiver underground nem indoors.',page:63,classId:CLERIC,subclassId:sid,levelGained:17,legacyLevelGained:17,mechanics:{flySpeed:'current walking speed',unavailableWhen:['underground','indoors']}})));
  const featureIds=[...ids,BLESSED];
  push(makeSubclass({id:sid,name:'Tempest Domain',summary:'Cleric Domain legacy de tempestade com armas marciais, Heavy Armor, retaliação elétrica/trovejante e voo.',page:'62-63',classId:CLERIC,originalClassId:'phb-2014-class-cleric',localFeatureIds:featureIds,progression:[{level:3,featureIds:ids.slice(0,4)},{level:6,featureIds:[ids[4]]},{level:8,featureIds:[BLESSED]},{level:17,featureIds:[ids[5]]}]}));
}

function wizardSubclass({slug,name,summary,page,features}) {
  const sid=`phb-2014-subclass-wizard-${slug}`;
  const ids=features.map((def)=>push(makeFeature({...def,classId:WIZARD,subclassId:sid})));
  push(makeSubclass({id:sid,name,summary,page,classId:WIZARD,originalClassId:'phb-2014-class-wizard',localFeatureIds:ids,progression:[{level:3,featureIds:ids.filter((_,i)=>features[i].levelGained===3)},{level:6,featureIds:ids.filter((_,i)=>features[i].levelGained===6)},{level:10,featureIds:ids.filter((_,i)=>features[i].levelGained===10)},{level:14,featureIds:ids.filter((_,i)=>features[i].levelGained===14)}].filter(x=>x.featureIds.length)}));
}

wizardSubclass({slug:'school-of-conjuration',name:'School of Conjuration',summary:'Arcane Tradition legacy focada em conjuração de objetos, teleporte e reforço de conjurações.',page:116,features:[
  {id:'phb-2014-feature-wizard-school-of-conjuration-conjuration-savant',name:'Conjuration Savant',summary:'Tempo e ouro para copiar Conjuration spells para o spellbook são reduzidos pela metade.',page:116,levelGained:3,legacyLevelGained:2,mechanics:{spellbookCopySchool:'Conjuration',timeMultiplier:0.5,goldCostMultiplier:0.5}},
  {id:'phb-2014-feature-wizard-school-of-conjuration-minor-conjuration',name:'Minor Conjuration',summary:'Action para conjurar temporariamente um objeto inanimado não mágico já visto, de até 3 ft. por lado e 10 lb, na mão ou espaço visível a 10 ft.',page:116,levelGained:3,legacyLevelGained:2,actionCost:'action',mechanics:{rangeFeet:10,object:{inanimate:true,nonmagical:true,mustHaveBeenSeen:true,maxDimensionFeet:3,maxWeightLb:10,visiblyMagical:true,dimLightFeet:5},duration:'1 hour',endsOn:['use feature again','object takes any damage','object deals any damage'],officialErrataApplied:true}},
  {id:'phb-2014-feature-wizard-school-of-conjuration-benign-transposition',name:'Benign Transposition',summary:'Action para teleportar até 30 ft. ou trocar de lugar com criatura willing Small/Medium; recarrega em Long Rest ou ao conjurar Conjuration spell de 1º+.',page:116,levelGained:6,legacyLevelGained:6,actionCost:'action',mechanics:{rangeFeet:30,modeChoice:['teleport to visible unoccupied space','swap with willing Small or Medium creature'],recharge:{longRest:true,alsoWhenCast:{school:'Conjuration',minimumSpellLevel:1}}}},
  {id:'phb-2014-feature-wizard-school-of-conjuration-focused-conjuration',name:'Focused Conjuration',summary:'Dano recebido não pode quebrar sua concentração em Conjuration spells.',page:116,levelGained:10,legacyLevelGained:10,mechanics:{concentrationProtection:{school:'Conjuration',cannotBeBrokenByTakingDamage:true}}},
  {id:'phb-2014-feature-wizard-school-of-conjuration-durable-summons',name:'Durable Summons',summary:'Criaturas summoned ou created por Conjuration spells ganham 30 Temporary Hit Points.',page:116,levelGained:14,legacyLevelGained:14,mechanics:{trigger:'creature summoned or created with a Conjuration spell',temporaryHitPoints:30}}
]});

wizardSubclass({slug:'school-of-enchantment',name:'School of Enchantment',summary:'Arcane Tradition legacy de charms, desvio de ataques e manipulação de memórias.',page:117,features:[
  {id:'phb-2014-feature-wizard-school-of-enchantment-enchantment-savant',name:'Enchantment Savant',summary:'Tempo e ouro para copiar Enchantment spells para o spellbook são reduzidos pela metade.',page:117,levelGained:3,legacyLevelGained:2,mechanics:{spellbookCopySchool:'Enchantment',timeMultiplier:0.5,goldCostMultiplier:0.5}},
  {id:'phb-2014-feature-wizard-school-of-enchantment-hypnotic-gaze',name:'Hypnotic Gaze',summary:'Action para tentar Charm uma criatura adjacente; em falha no Wisdom save ela fica com Speed 0 e Incapacitated enquanto o efeito for mantido.',page:117,levelGained:3,legacyLevelGained:2,actionCost:'action',mechanics:{rangeFeet:5,targetMustSeeOrHearOwner:true,save:{ability:'WIS',dc:'wizard spell save DC'},onFail:{condition:'Charmed',speed:0,conditionIds:['incapacitated'],duration:'until end of owner next turn',maintainWithActionEachTurn:true},endsIf:['owner moves more than 5 ft away','target can neither see nor hear owner','target takes damage'],perTargetLockout:'longRest after effect ends or initial save succeeds'}},
  {id:'phb-2014-feature-wizard-school-of-enchantment-instinctive-charm',name:'Instinctive Charm',summary:'Reaction antes de saber se um ataque acerta para tentar redirecioná-lo à criatura mais próxima, mediante Wisdom save do atacante.',page:117,levelGained:6,legacyLevelGained:6,actionCost:'reaction',mechanics:{trigger:'visible creature within 30 ft makes an attack roll against owner and another creature is in range',rangeFeet:30,useBeforeHitKnown:true,save:{ability:'WIS',dc:'wizard spell save DC'},onFail:{mustTargetClosestOtherCreature:true,tieChoiceByAttacker:true},onSuccess:{cannotUseOnAttackerAgainUntil:'longRest'},charmImmuneTargetsImmune:true}},
  {id:'phb-2014-feature-wizard-school-of-enchantment-split-enchantment',name:'Split Enchantment',summary:'Enchantment spell de 1º+ que teria apenas uma criatura como alvo pode atingir uma segunda criatura.',page:117,levelGained:10,legacyLevelGained:10,mechanics:{school:'Enchantment',minimumSpellLevel:1,requiresOriginalTargetCount:1,additionalTargets:1}},
  {id:'phb-2014-feature-wizard-school-of-enchantment-alter-memories',name:'Alter Memories',summary:'Pode ocultar de uma criatura o fato de ela estar Charmed por sua magia e, uma vez antes do spell terminar, tentar apagar parte desse período da memória.',page:117,levelGained:14,legacyLevelGained:14,mechanics:{trigger:'cast Enchantment spell that charms one or more creatures',chooseOneCharmedCreature:true,hideAwarenessOfCharm:true,forgetMemoryAction:{actionCost:'action',usesMaxOnceBeforeSpellExpires:true,save:{ability:'INT',dc:'wizard spell save DC'},hoursForgottenFormula:'max(1, 1 + CHA modifier)',cannotExceedSpellDuration:true}}}
]});

wizardSubclass({slug:'school-of-necromancy',name:'School of Necromancy',summary:'Arcane Tradition legacy focada em recuperar vida por mortes mágicas e fortalecer/controlar undead.',page:'118-119',features:[
  {id:'phb-2014-feature-wizard-school-of-necromancy-necromancy-savant',name:'Necromancy Savant',summary:'Tempo e ouro para copiar Necromancy spells para o spellbook são reduzidos pela metade.',page:118,levelGained:3,legacyLevelGained:2,mechanics:{spellbookCopySchool:'Necromancy',timeMultiplier:0.5,goldCostMultiplier:0.5}},
  {id:'phb-2014-feature-wizard-school-of-necromancy-grim-harvest',name:'Grim Harvest',summary:'Uma vez por turno, ao matar uma ou mais criaturas com spell de 1º+, recupera HP igual a 2×spell level, ou 3× para Necromancy; não funciona com Constructs ou Undead.',page:118,levelGained:3,legacyLevelGained:2,mechanics:{oncePerTurn:true,trigger:'kill one or more creatures with a spell of level 1+',healingFormula:'2 * spell level',necromancyHealingFormula:'3 * spell level',excludedCreatureTypes:['Construct','Undead']}},
  {id:'phb-2014-feature-wizard-school-of-necromancy-undead-thralls',name:'Undead Thralls',summary:'Adiciona Animate Dead ao spellbook e melhora undead criados com Necromancy spells; Animate Dead cria um alvo adicional.',page:118,levelGained:6,legacyLevelGained:6,mechanics:{addsSpellToSpellbook:spellId('Animate Dead'),animateDeadAdditionalTarget:1,undeadCreatedByNecromancySpell:{maxHitPointsBonus:'wizard level',weaponDamageRollBonus:'PB'}}},
  {id:'phb-2014-feature-wizard-school-of-necromancy-inured-to-undeath',name:'Inured to Undeath',summary:'Resistance a Necrotic damage e seu máximo de HP não pode ser reduzido.',page:119,levelGained:10,legacyLevelGained:10,mechanics:{damageResistance:['necrotic'],hitPointMaximumCannotBeReduced:true}},
  {id:'phb-2014-feature-wizard-school-of-necromancy-command-undead',name:'Command Undead',summary:'Action para tentar controlar um Undead a 60 ft. por Charisma save; controles mais inteligentes recebem proteções adicionais.',page:119,levelGained:14,legacyLevelGained:14,actionCost:'action',mechanics:{rangeFeet:60,targetCreatureType:'Undead',targetMustBeVisible:true,save:{ability:'CHA',dc:'wizard spell save DC'},onSaveFailure:{friendly:true,obeysCommands:true,duration:'until owner uses this feature again'},onSaveSuccess:{cannotTargetAgain:true},intelligenceRules:{minimumForSaveAdvantage:8,minimumForHourlyRepeatSave:12,repeatSaveFrequency:'1 hour until success'}}}
]});

wizardSubclass({slug:'school-of-transmutation',name:'School of Transmutation',summary:'Arcane Tradition legacy de alquimia, Transmuter’s Stone, self-Polymorph e grandes transformações.',page:119,features:[
  {id:'phb-2014-feature-wizard-school-of-transmutation-transmutation-savant',name:'Transmutation Savant',summary:'Tempo e ouro para copiar Transmutation spells para o spellbook são reduzidos pela metade.',page:119,levelGained:3,legacyLevelGained:2,mechanics:{spellbookCopySchool:'Transmutation',timeMultiplier:0.5,goldCostMultiplier:0.5}},
  {id:'phb-2014-feature-wizard-school-of-transmutation-minor-alchemy',name:'Minor Alchemy',summary:'Transforma temporariamente material não mágico entre wood, stone, iron, copper e silver, levando 10 minutos por cubic foot.',page:119,levelGained:3,legacyLevelGained:2,actionCost:'special',requiresConcentration:true,mechanics:{materials:['wood','stone (not gemstone)','iron','copper','silver'],target:'nonmagical object composed entirely of one listed material',conversionTimePerCubicFoot:'10 minutes',duration:'1 hour',endsOnConcentrationLoss:true}},
  {id:'phb-2014-feature-wizard-school-of-transmutation-transmuters-stone',name:"Transmuter's Stone",summary:'Após 8 horas cria uma pedra que concede um entre quatro benefícios ao portador; pode trocar o benefício ao conjurar Transmutation spell de 1º+.',page:119,levelGained:6,legacyLevelGained:6,actionCost:'special',mechanics:{creationTime:'8 hours',maximumActiveStones:1,benefitChoice:[{id:'darkvision',darkvisionFeet:60},{id:'speed',walkingSpeedBonusFeet:10,condition:'while unencumbered'},{id:'constitution-save-proficiency',savingThrowProficiency:'CON'},{id:'damage-resistance',chooseOne:['acid','cold','fire','lightning','thunder']}],changeBenefitTrigger:'cast Transmutation spell of level 1+ while stone is on owner person',newStoneEndsOldStone:true}},
  {id:'phb-2014-feature-wizard-school-of-transmutation-shapechanger',name:'Shapechanger',summary:'Adiciona Polymorph ao spellbook e permite 1/Short ou Long Rest cast gratuito em si mesmo, limitado a Beast CR 1 ou menor.',page:119,levelGained:10,legacyLevelGained:10,actionCost:'action',mechanics:{addsSpellToSpellbook:spellId('Polymorph'),freeCast:{spellId:spellId('Polymorph'),target:'self',expendsSpellSlot:false,restriction:{creatureType:'Beast',maximumChallengeRating:1},recharge:['shortRest','longRest']},normalSpellcastingStillAllowed:true}},
  {id:'phb-2014-feature-wizard-school-of-transmutation-master-transmuter',name:'Master Transmuter',summary:'Action consome a Transmuter’s Stone para escolher Major Transformation, Panacea, Restore Life ou Restore Youth; nova stone só após Long Rest.',page:119,levelGained:14,legacyLevelGained:14,actionCost:'action',mechanics:{requiresFeatureId:'phb-2014-feature-wizard-school-of-transmutation-transmuters-stone',consumesTransmutersStone:true,cannotCreateNewStoneUntil:'longRest',options:{majorTransformation:{target:'nonmagical object',maximumSize:'5-ft cube',duration:'10 minutes handling',result:'different nonmagical object of similar size and mass, equal or lower value'},panacea:{target:'creature touched with stone',removeAll:['curses','diseases','poisons'],restoreToFullHitPoints:true},restoreLife:{spellId:spellId('Raise Dead'),target:'creature touched with stone',expendsSpellSlot:false,spellNeedNotBeInSpellbook:true},restoreYouth:{target:'willing creature touched with stone',apparentAgeReduction:'3d10 years',minimumApparentAge:13,doesNotExtendLifespan:true}}}}
]});

// Species retained as legacy-only options. Legacy ASIs are provenance only in the 2024 profile.
{
  const sid='phb-2014-species-half-elf';
  const f1=push(makeFeature({id:'phb-2014-feature-half-elf-darkvision',name:'Darkvision',summary:'Darkvision 60 ft.',page:39,speciesId:sid,mechanics:{darkvisionFeet:60,compatibilityTarget:'2024-character-creation'}}));
  const f2=push(makeFeature({id:'phb-2014-feature-half-elf-fey-ancestry',name:'Fey Ancestry',summary:'Advantage em saves contra Charmed; magic não pode colocar o personagem para dormir.',page:39,speciesId:sid,mechanics:{savingThrowAdvantageAgainstCondition:['Charmed'],magicCannotPutToSleep:true,compatibilityTarget:'2024-character-creation'}}));
  const f3=push(makeFeature({id:'phb-2014-feature-half-elf-skill-versatility',name:'Skill Versatility',summary:'Escolhe proficiência em duas skills.',page:39,speciesId:sid,mechanics:{skillProficiencyChoice:{count:2,from:'skills'},compatibilityTarget:'2024-character-creation'}}));
  push(makeSpecies({id:sid,name:'Half-Elf',summary:'Species legacy exclusiva do PHB 2014; Medium, Speed 30 ft., Darkvision, Fey Ancestry e duas skill proficiencies.',page:'38-39',speed:30,featureIds:[f1,f2,f3],languages:['Common','Elvish',{choice:1}],legacyAsi:{CHA:2,chooseTwoOtherAbilitiesPlus1:true}}));
}
{
  const sid='phb-2014-species-half-orc';
  const f1=push(makeFeature({id:'phb-2014-feature-half-orc-darkvision',name:'Darkvision',summary:'Darkvision 60 ft.',page:41,speciesId:sid,mechanics:{darkvisionFeet:60,compatibilityTarget:'2024-character-creation'}}));
  const f2=push(makeFeature({id:'phb-2014-feature-half-orc-menacing',name:'Menacing',summary:'Proficiency em Intimidation.',page:41,speciesId:sid,mechanics:{skillProficiencies:['Intimidation'],compatibilityTarget:'2024-character-creation'}}));
  const f3=push(makeFeature({id:'phb-2014-feature-half-orc-relentless-endurance',name:'Relentless Endurance',summary:'Quando reduzido a 0 HP sem morrer instantaneamente, pode ficar com 1 HP; 1/Long Rest.',page:41,speciesId:sid,resource:{id:'phb2014-half-orc-relentless-endurance',name:'Relentless Endurance',max:1,recharge:'longRest'},mechanics:{trigger:'reduced to 0 HP but not killed outright',setHitPointsTo:1,compatibilityTarget:'2024-character-creation'}}));
  const f4=push(makeFeature({id:'phb-2014-feature-half-orc-savage-attacks',name:'Savage Attacks',summary:'Critical hit com melee weapon attack rola um dos weapon damage dice uma vez adicional e soma ao dano extra do crítico.',page:41,speciesId:sid,mechanics:{trigger:'critical hit with melee weapon attack',additionalWeaponDamageDice:1,application:'extra critical-hit damage',compatibilityTarget:'2024-character-creation'}}));
  push(makeSpecies({id:sid,name:'Half-Orc',summary:'Species legacy exclusiva do PHB 2014; Medium, Speed 30 ft., Darkvision, Intimidation, Relentless Endurance e Savage Attacks.',page:'40-41',speed:30,featureIds:[f1,f2,f3,f4],languages:['Common','Orc'],legacyAsi:{STR:2,CON:1}}));
}

// Feats retained as the three PHB 2014-only feats under the official 2024 compatibility exception.
push(makeFeat({id:'phb-2014-feat-dungeon-delver',name:'Dungeon Delver',summary:'Especialista em detectar secret doors e sobreviver a traps, incluindo resistência a dano de traps e a regra de fast travel da errata.',page:166,mechanics:{secretDoorDetection:{abilityChecks:['WIS (Perception)','INT (Investigation)'],advantage:true},trapSavingThrows:{advantage:true},trapDamageResistance:true,fastTravel:{ignorePassivePerceptionPenalty:-5},officialErrataApplied:{fastTravelBullet:true}}}));
push(makeFeat({id:'phb-2014-feat-linguist',name:'Linguist',summary:'INT +1, três idiomas adicionais e capacidade de criar ciphers com DC baseada em Intelligence score + PB.',page:167,abilityScoreIncrease:[{ability:'INT',amount:1,maximum:20}],mechanics:{languageChoice:{count:3},cipher:{creatorCanTeachCipher:true,decipherMethods:['taught by creator','successful Intelligence check','magic'],intelligenceCheckDCFormula:'INT score + PB'}}}));
push(makeFeat({id:'phb-2014-feat-martial-adept',name:'Martial Adept',summary:'Aprende duas Battle Master maneuvers e ganha um superiority die d6 adicional, recuperado em Short ou Long Rest.',page:168,mechanics:{maneuverChoice:{count:2,sourceSubclassId:'phb-2024-subclass-fighter-battle-master',catalogFeatureId:'phb-2024-feature-fighter-battle-master-combat-superiority',additionalCatalogFeatureIds:['tcoe-2020-feature-maneuver-ambush','tcoe-2020-feature-maneuver-bait-and-switch','tcoe-2020-feature-maneuver-brace','tcoe-2020-feature-maneuver-commanding-presence','tcoe-2020-feature-maneuver-grappling-strike','tcoe-2020-feature-maneuver-quick-toss','tcoe-2020-feature-maneuver-tactical-assessment'],dynamicCatalog:true,mustChooseDistinct:true},maneuverSaveDC:'8 + PB + STR or DEX modifier (chosen per maneuver use where relevant)',superiorityDie:{count:1,die:'d6',addedToOtherSuperiorityDice:true,recharge:['shortRest','longRest']},officialErrataApplied:{superiorityDieWording:true}}}));

// Root + validation
const ids=items.map((item)=>item.id);
const itemIdSet=new Set(ids);
const externalRefs=new Set();
const internalRefs=new Set();
// These identifiers preserve the original 2014 ownership for provenance only. They are
// deliberately not runtime dependencies: the delta is projected onto the PHB 2024 class chassis.
const provenanceOnlyRefs=new Set(['phb-2014-class-cleric','phb-2014-class-wizard']);
const walk=(value)=>{
  if(typeof value==='string' && /^(?:phb|tcoe)-\d{4}-/.test(value)){
    if(itemIdSet.has(value)) internalRefs.add(value);
    else if(!provenanceOnlyRefs.has(value)) externalRefs.add(value);
  } else if(Array.isArray(value)) value.forEach(walk);
  else if(value && typeof value==='object') Object.values(value).forEach(walk);
};
// Walk payloads only so top-level item IDs/source metadata do not become false references.
items.forEach((item)=>walk(item.payload));
const brokenExternal=[...externalRefs].filter((id)=>!phb2024ById.has(id) && !id.startsWith('tcoe-2020-feature-maneuver-'));
const brokenTashaManeuvers=[...externalRefs].filter((id)=>id.startsWith('tcoe-2020-feature-maneuver-'));
const tashaPath=path.join(root,'assets','compendium','tcoe-2020-2024-compatible-import-pack-v2-canonical.json');
const tasha=fs.existsSync(tashaPath)?JSON.parse(fs.readFileSync(tashaPath,'utf8')):null;
const tashaIds=new Set(tasha?.items?.map((item)=>item.id)??[]);
const missingTasha=brokenTashaManeuvers.filter((id)=>!tashaIds.has(id));
const countByKind=items.reduce((acc,item)=>{acc[item.kind]=(acc[item.kind]||0)+1;return acc;},{});
const expectedNames=['Knowledge Domain','Nature Domain','Tempest Domain','School of Conjuration','School of Enchantment','School of Necromancy','School of Transmutation','Half-Elf','Half-Orc','Dungeon Delver','Linguist','Martial Adept'];
const expectedPresent=expectedNames.every((name)=>items.some((item)=>item.name===name));
const validation={
  schemaVersion:'dnd-combat-phb2014-2024-delta-validation.v1',
  status: brokenExternal.length===0 && missingTasha.length===0 && ids.length===new Set(ids).size && ids.every((id)=>kebab.test(id)) && expectedPresent ? 'READY_FOR_RUNTIME_PREVIEW' : 'BLOCKED',
  scope:{officialCompatibilityExceptions:expectedNames,expectedOptionCount:12,materializedItemRecords:items.length,itemsByKind:countByKind},
  checks:{uniqueIds:ids.length===new Set(ids).size,kebabCaseIds:ids.every((id)=>kebab.test(id)),expectedOptionsPresent:expectedPresent,brokenExternalPhb2024Refs:brokenExternal,missingTashaManeuverRefs:missingTasha,legacySpeciesAsiIgnoredForRuntime:true,clericLegacyStrikeBranchesSuppressed:true,wizardLevel2FeaturesProjectedToLevel3:true,clericLevel1And2FeaturesProjectedToLevel3:true},
  errata:{applied:true,source:'D&D Beyond Sage Advice & Errata — Player’s Handbook (2014)',changesMaterialized:['Half-Elf Alignment removed','Half-Orc Alignment removed','Acolyte of Nature cantrip counts as cleric cantrip and not against cleric cantrips known','Minor Conjuration ends if object takes or deals damage','Dungeon Delver fast-pace passive Perception wording','Martial Adept one d6 superiority die added to other superiority dice']},
  references:{externalUnique:[...externalRefs].sort(),externalCount:externalRefs.size,internalUnique:[...internalRefs].sort(),internalCount:internalRefs.size,provenanceOnly:[...provenanceOnlyRefs].sort()}
};

const metadata={
  contentSystem:'D&D', edition:'2024+legacy', language:'en', extractionScope:'PHB 2014 delta only — official exceptions retained under PHB 2024 compatibility policy', schemaTarget:'dnd-combat-math-current',
  printedPages:'38-41, 59-63, 116-119, 166-168', itemRecords:items.length, itemsByKind:countByKind,
  compatibility:{profile:'2024-first+legacy',reusesPhb2024Classes:true,reusesPhb2024Spells:true,speciesAbilityScoresFromLegacyIgnored:true,clericBlessedStrikesId:BLESSED},
  officialErrata:validation.errata,
  validation:{status:validation.status,uniqueItemIds:new Set(ids).size,duplicateItemIds:ids.length-new Set(ids).size,brokenExternalReferences:brokenExternal.length+missingTasha.length},
  externalDependencies:{phb2024:[...externalRefs].filter((id)=>id.startsWith('phb-2024-')).sort(),tasha2020:[...externalRefs].filter((id)=>id.startsWith('tcoe-2020-')).sort()}
};
const rootSource={...sourceBase,page:'38-41, 59-63, 116-119, 166-168',notes:'Delta-only extraction from the attached 2014 Player’s Handbook, projected for PHB 2024-first character creation. Applicable official PHB 2014 errata is reconciled.'};
const v1={templateVersion:'dnd-combat-import.v1',id:PACK_ID,source:rootSource,metadata,items};
const v2={templateVersion:'dnd-combat-import.v2',id:PACK_ID,source:rootSource,metadata,items};
const v1Text=pretty(v1), v2Text=pretty(v2), validationText=pretty(validation);
const expectedFiles=[[v1Path,v1Text],[v2Path,v2Text],[validationPath,validationText],[v1ShaPath,`${sha256(v1Text)}  ${path.basename(v1Path)}\n`],[v2ShaPath,`${sha256(v2Text)}  ${path.basename(v2Path)}\n`]];
if(checkOnly){
  const drift=[];
  for(const [file,content] of expectedFiles){ if(!fs.existsSync(file)||fs.readFileSync(file,'utf8')!==content) drift.push(path.relative(root,file)); }
  if(drift.length){console.error(`PHB 2014 delta drift: ${drift.join(', ')}`);process.exit(1);} 
  if(validation.status!=='READY_FOR_RUNTIME_PREVIEW'){console.error(validationText);process.exit(1);} 
  console.log(`[compendium:legacy:phb2014:delta:check] PASS — ${items.length} items / ${expectedNames.length} official legacy options.`);
}else{
  for(const [file,content] of expectedFiles){fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,content);}
  console.log(`[compendium:legacy:phb2014:delta] wrote ${v1Relative} and ${v2Relative}: ${items.length} items.`);
}
