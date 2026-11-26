# V1.4a6.1 — Baseline integrado de cobertura

A5.8 aprovada: Quality push 45727613412, PR 45727621560 e structural audit 45727613495. No main upstream 2512db75eb48ef06f6190b086a82430887906dca: 8589 IDs físicos únicos em 13 kinds, 30/30 conditions válidas, 5 status e 29 diseases diferidos.

## Método

Unidade de origem: (namespace, path, kind, index) do snapshot imutável. Usa o mesmo conjunto de registros de collect/audit, incluindo linhas de identidade inválida fora do denominador a3. Fonte nula quando não atribuível; magicvariant pode usar inherits.source somente para atribuição de cobertura, sem alterar identidade a3. Inventory mantém publicações (inclusive fontes sem registros observados). O denominador é o universo de coleções top-level varridas pelo resolver, não a totalidade dos livros/texto/coleções aninhadas.

Duas dimensões independentes: identidade inválida / estrutura bloqueada / estrutura resolvida; elegível por política real do piloto / fora do piloto. Na dimensão de conversão: linha com saídas válidas, linha com alguma saída inválida, elegível sem emissão, template sem saída (não significa necessariamente bloqueio; ver contadores a5.4). Contagem de outputs V3 separada: uma linha de magicvariant pode gerar N itens; origin pode preservar _versions sem expansão; uma linha bloqueada pelo resolver geral pode emitir sob política específica do conversor. Contabilizar esses casos, não fingir equivalência. Raridade/classificação, caminhos e fontes seguem os oito pilotos; testes verificam divergências por proveniência. Staging: cada item individual, exceto classes e condições validadas conjuntamente em seus grafos. Não substitui validação global a6.7. Todos os outputs necessitam revisão semântica; reviewCodes não provam cobertura de efeitos.

## Catálogo e prioridade

Leitura do bundle v4.8.0 com checksum SHA-256, somente índice de runtime, contagens por sourceBookId/kind, defaultEnabled e manualReviewRequired. Mapeamento explícito inicial dos três IDs documentados em catalog/types.ts (phb-2024, dmg-2024, mm-2025). Demais IDs não mapeados; não inferir por nome. Bootstrap nominal PHB/XPHB/XMM/EFA/AAG/BAM/LoX/TCE e XDMG (cutover doc). Ordena estes códigos por lacunas de emissão e fora do piloto; não é ranking de equivalência, nem catálogo ativo de instalação do usuário. O inventário de packs históricos e importados pelo usuário continua gate a7.

## Execução

CI: DND_UPSTREAM_BASELINE_MAIN e DND_UPSTREAM_BASELINE_BREW apontam para snapshots Git. A auditoria usa commits resolvidos e registra asOf; para reprodução local definir DND_UPSTREAM_BASELINE_MAIN_REF, DND_UPSTREAM_BASELINE_BREW_REF e DND_UPSTREAM_BASELINE_AS_OF. 
npx jest src/tests/upstream5etoolsCoverageBaseline.test.ts --runInBand

Opcional DND_UPSTREAM_BASELINE_OUT=dist/upstream/baseline.json (criar diretório antes; não sobrescreve). O relatório detalhado é local, contém IDs de fontes/contagens e não deve ser publicado; logs CI agregam por origem e kind canônico, códigos de diagnóstico e fontes prioritárias oficiais, sem nomes de entidades, paths ou fontes homebrew. O CI valida invariantes, staging, checksum, duplicatas e proveniência; não exige que bloqueios estruturais desapareçam nesta etapa. Não há mudanças de runtime, assets ou ativação. Próximo a6.2: resolver referências entre entidades com escopo de fonte/edição e IDs exatos; a6.3 precedência; demais fases conforme 5ETOOLS_CONDITION_CONVERSION.md.
