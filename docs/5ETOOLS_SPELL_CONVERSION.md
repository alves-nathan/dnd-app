# V1.4a5.1 — Magias (piloto em staging)

## Gate anterior

CI a4 falhou em duas expectativas de fixtures: o domínio V2 exige pelo menos uma classe em spell.payload.classes. Corrigidas as fixtures para declarar Wizard e acrescentado teste que mantém a rejeição de lista vazia. Não alterado o validador de produção.

## Piloto e evidência

PHB, XPHB, AU e WoW são a seleção inicial, não a cobertura global. O índice gerado data/generated/gendata-spell-source-lookup.json fornece acesso por classe/fonte e acessos adicionais (subclasses, talentos etc.); os arquivos de magias não fornecem classes diretamente. No snapshot 2512db75eb48ef06f6190b086a82430887906dca foram observados 361/391/33/69 registros e entradas de lookup para todos os registros. A política piloto escolhe PHB/TCE para PHB, XPHB/EFA para XPHB/AU, WoW/XPHB para WoW; preserva integralmente o lookup e a origem de cada acesso. WoW fica com era unknown até classificação editorial. Os demais códigos usam política explícita a revisar; data não infere edição.

## Conversão

Mapeia level, school, classes, castingTime (incluindo reação/ritual), range, área de origem própria quando explícita, duration, concentration, componentes, tags de ataque/salvaguarda quando únicas. Preserva material com custo/consumo no campo mecânico de origem. Identidade física derivada de namespace/fonte/nome (hash estável); IDs históricos serão reconciliados no benchmark. Canonical key conserva nome normalizado, precedência unresolved e reprintedAs preservado. Proveniência fixa commit/blob/path/index/linhagem.

O dano só é promovido para damageFormula/damageType em um padrão estrito de ataque único, instantâneo e explícito. Outros danos, projéteis, escalas, cura, condições, efeitos, acesso adicional, referências e regras especiais são conservados em mechanics.upstreamSpell e sinalizados para revisão. Nenhuma inferência de dano total, alvo, sucesso de save, custo de slot ou acesso por classe é feita por heurística solta. O conjunto inteiro fica needsReview; aprovação estrutural ou semântica não equivale a prontidão mecânica. Não há conversor homebrew nem conversão automática de outras fontes nesta subfase.

## Execução local

```bash
node scripts/5etools/spell-converter.js ../5etools-src dist/upstream/spell-pilot
npx jest src/tests/upstream5etoolsSpellConverter.test.ts src/tests/compendiumImportV3Staging.test.ts --runInBand
DND_UPSTREAM_SPELL_SNAPSHOT=../5etools-src npx jest src/tests/upstream5etoolsSpellConverter.test.ts --runInBand
```

O comando Node gera packs locais e auditoria; NÃO ativa ou persiste conteúdo no app. O teste opcional valida entidades convertidas individualmente via stageImportV3 e imprime apenas contagens e códigos. Referências globais/IDs antigos não validados. Código 2 no conversor indica registros bloqueados; saída não é sobrescrita. Não publique packs, textos ou dados protegidos. CI executa só auditoria agregada, sem artefatos de conteúdo.

Próxima etapa: a5.2 criaturas. Complementos de magias (conversão de múltiplos efeitos, escalas, acesso, condições, healing e benchmark) permanecem pendentes e serão consolidados antes do cutover.
