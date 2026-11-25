# V1.4a5.4 — Itens mágicos e variantes (staging)

Evidência anterior: run 45709256058, 824/826 equipamentos elegíveis validados, 2 bloqueados; 92 armas, 26 armaduras e 706 equipamentos. Node24 nas Actions hosted: checks verdes, warning Node20 não observado no log da auditoria. Self-hosted e Maestro externo continuam pendentes.

Piloto DMG/XDMG/AU/EFA/FTD/EGW/WoW. Itens concretos de items.json e templates de magicvariants.json. Snapshot anterior contém 230 templates, 225 com inherits e 5 com _copy. Normalização local de inherits.source para identidade do resolvedor; não modifica upstream. Resolução de _copy via resolvedor existente. Requires OR de grupos AND, excludes OR, seletores escalares/arrays simples, filtro de edição conservador. Variantes específicas derivadas dos baseitems; exclui packs. IDs físicos derivados do template + identidade de base, referência de blob/índice de base preservada. Valor mundano não é herdado. Bloqueia transformações de expressão, multiplicadores, barding e merges de resist/imune/vulnerable até tratamento dedicado. Não interpreta interpolação de texto nem gera template genérico como objeto equipável.

Rarity, attunement (requisitos específicos pendentes), bônus de ataque/dano conjunto quando explícito, AC bonus em extensão mecânica; reutiliza projeção do conversor de equipamento em mechanics.baseEquipment, sem promover para arma/armadura ativa. Cargas/recharge, spells, efeitos, estados evolutivos de FTD/EGW/AU e relações de progressão preservados/sinalizados; não automatizados. Não inferir preço, estado evolutivo ou bônus ausente. Todos os itens permanecem needsReview. A classificação de fontes, variantes sem edição e equivalência de IDs devem ser revisadas antes do cutover. O piloto não cobre todos os templates nem homebrew, e não resolve toda a semântica do renderer upstream. Relatórios distinguem templates resolvidos, sem match, variantes bloqueadas e itens concretos; não confundir template com item concreto.

Execução local: node scripts/5etools/magic-item-converter.js ../5etools-src dist/upstream/magic-pilot
Testes: npx jest src/tests/upstream5etoolsMagicItemConverter.test.ts --runInBand
Auditoria real: DND_UPSTREAM_MAGIC_SNAPSHOT=../5etools-src npx jest src/tests/upstream5etoolsMagicItemConverter.test.ts --runInBand

Não publicar packs gerados. CI imprime apenas agregados. Nenhuma alteração de runtime. Próxima etapa a5.5: talentos e features opcionais.
