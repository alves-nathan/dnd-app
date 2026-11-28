# V1.4a5.5 — Feats e optional features (staging)

Evidência a5.4: run 45711482168, 979 itens concretos + 2297 variantes validados, 298 variantes bloqueadas, 153 templates resolvidos (3 sem match), 37 registros sem classificação. Não é equivalência mecânica.

Piloto PHB/XPHB/TCE/XGE/EFA/AU/WoW. Snapshot anterior contém 317 feats e 233 optionalfeatures (218 feats dos códigos piloto e todas as 233 optionalfeatures). Lê todos os registros dos dois arquivos para resolução de _copy. Emite feat ou feature; namespace de canonicalKey diferencia optionalfeature de outros tipos de feature. IDs físicos por kind/source/name. SourceType usa famílias do upstream; mapeamento editorial e IDs de classes ainda pendentes. Não confundir optionalfeature com classFeature nativa. Categoria de talento e códigos específicos preservados; códigos de categoria/feature family não são equivalência de runtime.

PrerequisiteTree conserva OR externo e AND por grupo, OR de alternativas de atributos e AND dentro de cada alternativa, níveis de personagem distintos de nível de classe. Referências e filtros são nós tipados com raw, sem inferir operador para listas cuja semântica não foi comprovada. Condições desconhecidas são unresolved. Apenas conjunções integralmente representáveis por level/abilities são projetadas no prerequisite legado. Não usar ausência dessa projeção como elegibilidade: needsReview e activation review-required são obrigatórios. Nenhum motor de avaliação de árvore instalado.

AbilityAllocationPlan conserva alternativas ASI, fixed, choose.from/count/amount, distintos e cap (default 20, max 30 explícito). Somente escolhas unitárias ou aumento fixo unitário são projetados no formato abilities/amount/max do runtime; demais planos ficam em extensão mecânica. Repeatability explícita, additionalSpells, proficiências, expertise, consumes, featProgression e optionalfeatureProgression preservados, não executados. Repeatability ausente não implica false. Não inventar levelGained, engineKey, owner ou substituições. Regras de seleção/replacement, limites de escolhas e resolução de dependências integram a5.7/a6; benchmark necessário antes do cutover.

Execução: node scripts/5etools/feature-converter.js ../5etools-src dist/upstream/feature-pilot
Testes: npx jest src/tests/upstream5etoolsFeatureConverter.test.ts --runInBand
Auditoria real: DND_UPSTREAM_FEATURE_SNAPSHOT=../5etools-src npx jest src/tests/upstream5etoolsFeatureConverter.test.ts --runInBand

CI somente agregados; não publicar packs. Homebrew, variantes e efeitos complexos não convertidos; runtime intacto. Próxima subfase a5.6 espécies e backgrounds.

Mapeamentos conferidos em js/parser.js do upstream: DG=Dark Gift, D=Dragonmark, FS:P/FS:R=Fighting Style Replacement de Paladin/Ranger; RN=Rune Knight Rune, RP=Renown Perk. Não tratar substituição como talento Fighting Style comum.
