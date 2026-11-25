# V1.4a5.7 — Classes, subclasses e progressões (staging)

Piloto PHB/XPHB/TCE/XGE/EFA. Lê todos os arquivos data/class/class-*.json do snapshot principal fixado pelo SHA para resolver referências; emite somente fontes piloto. Usa identity e makeResolver existentes para _copy/_mod e UIDs com defaults. IDs físicos hash da identidade completa (kind, nome/shortName, fonte, dono e nível conforme kind); classFeature/subclassFeature são kind feature, sourceType distintos. Não equiparar IDs históricos ou optionalfeatures por nome.

Grafo fechado: classId e subclassId devem corresponder ao proprietário exato; featureIds e progression por nível são emitidos apenas quando todos os vínculos estruturais são inequívocos e os destinos também emitidos. Features fora do piloto, heranças não resolvidas e aliases cruzando owners/edições bloqueiam seus consumidores por ponto fixo; ciclos válidos owner-feature são preservados. A lista original de grants, flags (gainSubclassFeature etc.), ordem e referências ficam em mechanics; projeção agrega IDs por nível sem inferir efeitos. Um grant repetido é sinalizado. Packs são por fonte; validar conjuntamente o grafo (ou com dependências externas verificadas), não isoladamente como se fossem autossuficientes.

Projeção conservadora de hitDie, saving throws, primaryAbility quando uma única conjunção, proficiências literais e um grupo simples de skill choices. Spellcasting projeta somente arrays numéricos completos de 20 níveis e tabelas rowsSpellProgression com colunas explicitamente identificadas, ou Spell Slots/Slot Level do pacto. Não converte fórmulas, regras de preparação, progressão do caster ou arredondamento multiclass; tabelas e regras originais preservadas. Não deriva recursos, efeitos, feat/optionalfeature progression, adicional de magias, equipamento inicial, escolha de subclass ou compatibilidade 2014/2024. Subclass spellcasting preservado sem execução. Todos needsReview; nenhum runtime/asset alterado.

Evidência anterior a5.6: run 45718447910, 247/252 registros de origem validados; cinco subraces PHB bloqueadas. Quality 45718456096: 923 testes aprovados, 8 ignorados.

Execução: node scripts/5etools/class-converter.js ../5etools-src dist/upstream/class-pilot [ref]
Testes: npx jest src/tests/upstream5etoolsClassConverter.test.ts --runInBand
Auditoria real: DND_UPSTREAM_CLASS_SNAPSHOT=../5etools-src npx jest src/tests/upstream5etoolsClassConverter.test.ts --runInBand
A auditoria registra contagens e códigos, não payloads; o CLI escreve packs localmente e retorna 2 se houver bloqueios. Próximo: a5.8 conditions e fechamento dos conversores; antes do cutover resolver aliases e escolhas, ampliar cobertura e reconciliar IDs e dependências.
