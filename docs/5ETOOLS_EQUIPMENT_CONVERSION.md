# V1.4a5.3 — equipamento não mágico (staging)

## Evidência a5.2

Run 45707820928: 1149 criaturas candidatas, 1099 convertidas/validadas individualmente, 50 bloqueadas, 656 ataques simples mapeados. MM 423/450, XMM 500/503, BAM 72/72, LoX 1/15, AU 19/23, WoW 84/86. Todos os checks anteriores concluídos com sucesso. Pendências de efeitos, variantes, heranças e integração ao motor mantidas. CI hosted atualizado para runtime das Actions Node 24 em commit separado; Node do app continua 22. Ver GITHUB_ACTIONS_NODE24.md.

## Escopo e contrato

Piloto PHB, XPHB, DMG, XDMG, AAG, EFA, AU, WoW. Lê data/items-base.json e data/items.json. Apenas rarity none ou mundane true sem rarity entram no piloto. Outros registros ficam contabilizados como magicOrUnclassified; não significa que todos sejam mágicos. itemGroup, magicvariant, veículo, regras de equipamentos iniciais e homebrew não estão cobertos como conversores próprios nesta fase. Referências de propriedades/masteries/tipos são indexadas a partir do items-base. Defaults de UIDs legados: PHB para tipo/propriedade comum; DMG para AF/BF/RLD; XPHB para mastery. Referências desconhecidas ficam sinalizadas. Política inicial de edição explícita, WoW unknown. A classificação precisa ser revisada antes da ativação.

Armas: categoria, tipo, dados de dano, atributo STR/DEX ou choice para finesse, fórmula compatível com o mapper atual, tipo de dano, alcance, versátil, propriedades e mastery quando resolução inequívoca. Propriedades condicionais não são promovidas como incondicionais. Armas sem dano (ex. rede legacy) ficam bloqueadas, sem fórmula fictícia. Munição, reload, burst, efeitos de mastery e exceções aguardam conversão. Armor: AC base, dexCap null/2/0, Strength e stealth; shield modelado como baseAC 0 + acBonus e stacksWithArmor. Custos CP convertidos em GP/SP/CP sem arredondamento; peso em lb. Nenhum preço inventado. Pack contents, gear grants e referências de munição preservados, não expandidos.

IDs físicos por fonte/kind/nome, com bloqueio de colisões entre arquivos. Reconciliação de IDs, precedência e mudanças de categoria (ex. Net) no benchmark. Raw resolvido conservado em mechanics.upstreamItem; proveniência Git; status needsReview. Mapeamento não certifica mecânicas nem licença de redistribuição. Não há mutação de runtime.

## Execução

```bash
node scripts/5etools/equipment-converter.js ../5etools-src dist/upstream/equipment-pilot
npx jest src/tests/upstream5etoolsEquipmentConverter.test.ts --runInBand
DND_UPSTREAM_EQUIPMENT_SNAPSHOT=../5etools-src npx jest src/tests/upstream5etoolsEquipmentConverter.test.ts --runInBand
```

CI imprime contagens e códigos agregados, valida cada entidade emitida via stageImportV3, não publica payloads. Verificar observed = eligible + excludedMagicOrUnclassified e eligible = converted + blocked. Algumas fontes piloto podem não ter itens elegíveis. A validação não prova compatibilidade de IDs e referências globais. Próximo passo: a5.4 itens mágicos, variantes e resolução de inherits.
