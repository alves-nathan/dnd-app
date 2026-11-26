# Integração 5e.tools / Homebrew — fase 1 (inventário)

## Decisão arquitetural

O repositório atual usa `dnd-combat-import.v2` (V1 compatível), não V3. Ver `src/compendium/importVersions.ts`, `importV2Schemas.ts`, `importPreview.ts` e `importSemanticValidation.ts`. O V3 histórico é baseline de comparação, não um formato aceito pelo runtime. Não renomear o envelope V3 para V2 sem mapear payloads, fontes, referências e enums.

O catálogo ativo é um `dnd-combat-runtime-bundle.v1` (bundle atual V4.8.0); ver `src/catalog/types.ts`, `catalogLoader.ts`, `catalogUpdateTransaction.ts` e `docs/CATALOG_RESILIENT_DISTRIBUTION.md`. Já existem preview, impacto, confiança, assinatura, rollback e distribuição. Reutilizar essas fronteiras em vez de criar uma segunda atualização automática.

### Fluxo alvo

1. Snapshots Git locais dos upstreams 5e.tools e homebrew, fixados por commit. Inventário/diff sem payloads publicados (esta fase).
2. Resolução de referências, _copy/_mod, variantes, edição e IDs; proveniência preservada.
3. Normalização V2, validação semântica e benchmark V3. IDs existentes e vínculos de personagens preservados; matriz de cobertura e decisões revisáveis. Nunca adivinhar efeitos ausentes.
4. Geração de candidato de catálogo e validação de dependências, aliases e compatibilidade de personagens.
5. Assinatura, distribuição e preview/commit pelo fluxo atual do aplicativo. Rollback existente. Sem ativação silenciosa.
6. Parse residual de PDFs somente depois da integração dos dados estruturados.

## Executar localmente

Requisitos: Node 22 e Git. Não requer Ollama, dependências npm ou acesso do app ao GitHub. Não inclua os checkouts de upstream dentro do repositório público.

```bash
git clone https://github.com/5etools-mirror-3/5etools-src.git ../5etools-src
git clone https://github.com/TheGiddyLimit/homebrew.git ../5etools-homebrew
node scripts/5etools/inventory.js --main ../5etools-src --homebrew ../5etools-homebrew --out dist/upstream/initial.json
```

Para atualizar, execute `git -C ../5etools-src pull --ff-only` e `git -C ../5etools-homebrew pull --ff-only`, ou obtenha refs específicas para revisão. Em seguida:

```bash
node scripts/5etools/inventory.js --main ../5etools-src --homebrew ../5etools-homebrew --previous dist/upstream/initial.json --out dist/upstream/next.json
```

Opções `--main-ref`, `--homebrew-ref` aceitam commits/refs locais; `--as-of YYYY-MM-DD` torna reproduzível a classificação de datas. Sem esta opção utiliza a data UTC. O inventário lê objetos Git imutáveis, ignorando modificações do working tree. Arquivos existentes não são sobrescritos. Código de saída 2 indica inventário escrito com referências de índice ausentes; 1 indica falha. Diagnósticos exigem inspeção.

O relatório registra fontes em namespaces independentes (`main:AU`, `homebrew:AU`), múltiplas publicações, hashes Git dos JSONs, diferenças de fontes e arquivos, transições de data. AU e WoW são exemplos, não allowlist. A data do catálogo é um indício editorial, não prova de lançamento, licença ou validação: estados `unknown`, `upcoming`, `catalog-date-reached` e `mixed` não ativam conteúdo. Toda fonte é `review-required`.

### Limites e segurança

- Fase 1 enumera books/adventures, índices de spells/bestiary e aliases do homebrew. Entidades que só aparecem em arquivos compartilhados não são ainda atribuídas a fontes; mudanças nesses arquivos são detectadas globalmente. Nenhum JSON de entidades é convertido ainda.
- Remoção upstream é um alerta, não exclusão de registros do app. Alterações em arquivos compartilhados exigem análise posterior por entidade.
- Não publicar conteúdo de livros no repositório público. A disponibilidade no upstream não implica licença de redistribuição; avaliar cada fonte e a licença antes de empacotar.
- Não altera runtime, assets, armazenamento, políticas de confiança ou CI de publicação. Não usa chaves privadas.
- Testes: `npx jest src/tests/upstream5etoolsInventory.test.ts --runInBand` (inclui fixture Git local).
- O baseline V3 consolidado atualizado não foi incorporado a esta fase. Solicitar ou localizar antes do benchmark.

## Fase 2 — resolução conservadora e descoberta por entidade

`scripts/5etools/resolver.js` lê snapshots Git e identifica entidades nos arquivos compartilhados, classes, magias, bestiário e coleções indexadas de homebrew. Registra identidades com discriminadores de classe/subclasse/nível e namespace. Resolve cadeias simples de _copy, _preserve e operações appendArr, prependArr, insertArr, replaceArr e replaceOrAppendArr. Referências estruturadas de classFeatures/subclassFeatures e owner de subclasses são verificadas. Ausência, ambiguidade, ciclo ou modo não implementado bloqueiam a entidade; não há payload parcialmente convertido. O relatório é apenas staging/diagnóstico; não representa cobertura mecânica integral nem resolução de todas as referências transitivas.

```bash
node scripts/5etools/resolver.js ../5etools-src ../5etools-homebrew dist/upstream/resolution.json
# Opcional: acrescentar os dois SHAs do inventário ao comando.
npx jest src/tests/upstream5etoolsResolver.test.ts --runInBand
```

Código 2: relatório produzido com bloqueios para investigação. Ainda faltam templates, variantes, replaceTxt, outros modos _mod, tags inline, dependências de _meta, redirecionamentos, defaults e normalização de UIDs adicionais. A resolução de heranças não equivale a conversão para V3. O relatório pode conter nomes e IDs derivados do upstream; mantenha-o em dist/ local.

Diretriz de descontinuação dos importadores V1/V2 e gates: [5ETOOLS_LEGACY_CUTOVER.md](5ETOOLS_LEGACY_CUTOVER.md). Esta decisão atualiza o alvo V2 descrito na fase 1: V3 será o novo contrato, com migração deliberada do runtime atual.

## Fase 3 — cobertura estrutural (a3)

O resolvedor usa a identidade curta de subclasses, corrige defaults de UID e aceita display text sem confundi-lo com identidade. Suporta paths aninhados seguros e setProp, remove, removeArr e appendIfNotExistsArr. Mutações de identidade, paths perigosos, regex, texto dinâmico, templates e versões não expandidas continuam bloqueados. Uma dependência estrutural bloqueada propaga o bloqueio para consumidores.

O relatório `dnd-upstream-resolution-audit.v2` inclui totais por origem/fonte/kind, edição declarada (ou unspecified), quantidade de variantes e reprints observadas, tags inline e chaves _meta ainda não resolvidas, e diagnósticos agrupados. Não interpreta tags nem reprints como vínculos validados. Não expande variantes e não prova paridade mecânica. Registros sem identidade válida aparecem em diagnósticos, não nos denominadores das entidades indexadas.

Execução completa local: comando resolver.js da fase 2. Para CI ou logs compartilháveis:
```bash
node scripts/5etools/audit-summary.js ../5etools-src ../5etools-homebrew
npx jest src/tests/upstream5etoolsInventory.test.ts src/tests/upstream5etoolsResolver.test.ts src/tests/upstream5etoolsCoverage.test.ts --runInBand
```
A saída resumida contém somente commits, contagens agregadas, códigos de diagnóstico e fontes piloto conhecidas. Não imprime nomes, IDs de entidades, payloads ou detalhes de erro. Não publicar o relatório detalhado. A cobertura integral deve ser medida em clones reais; amostra de arquivos via GitHub não substitui essa execução. Os gates V1/V2 continuam válidos.

## Fase 4 — contrato canônico V3 (a4)

Ver [5ETOOLS_V3_CONTRACT.md](5ETOOLS_V3_CONTRACT.md). Schema discriminado V3 e validação em staging com projeção V2, sem alterar o runtime. O importador V3 histórico exige migração explícita. A auditoria real a3 foi concluída; as lacunas de identidade e resolução continuam no backlog antes do cutover.

## Fase 5.1 — conversão piloto de magias

Ver [5ETOOLS_SPELL_CONVERSION.md](5ETOOLS_SPELL_CONVERSION.md). Conversão em staging dos quatro códigos piloto com acesso de classes via lookup gerado, campos mecânicos básicos, preservação das estruturas de origem e auditoria agregada via CI. Corrigidas fixtures a4 que declaravam classes vazias. Nenhuma alteração de runtime ou assets.

## Fase 5.2 — conversão piloto de criaturas

Ver [5ETOOLS_CREATURE_CONVERSION.md](5ETOOLS_CREATURE_CONVERSION.md). Conversor conservador, métricas de ações e bloqueios, validação real em CI. Magias: 854/854 registros validados em staging no piloto a5.1, zero dano promovido. O runtime e os assets seguem inalterados.

## Fase 5.3 — equipamentos não mágicos

Ver [5ETOOLS_EQUIPMENT_CONVERSION.md](5ETOOLS_EQUIPMENT_CONVERSION.md). Piloto de weapon/armor/equipment, propriedades, masteries, custos e referências preservadas. Auditoria a5.2: 1099/1149 criaturas validadas em staging, 50 bloqueadas, 656 ataques simples. Manutenção de CI hosted Node24 separada; ver [GITHUB_ACTIONS_NODE24.md](GITHUB_ACTIONS_NODE24.md). Próximo: itens mágicos/variantes. Sem alterações no runtime.

## Fase 5.4 — itens mágicos e variantes

Ver [5ETOOLS_MAGIC_ITEM_CONVERSION.md](5ETOOLS_MAGIC_ITEM_CONVERSION.md). Piloto de itens concretos e expansão conservadora de templates com fonte aninhada, _copy e seletores. Reutilização de normalização de equipamento. Efeitos, progressões, expressões e referências pendentes. Equipamentos a5.3: 824/826 validados em staging. Próximo: talentos e features opcionais.

## Fase 5.5 — feats e optional features

Ver [5ETOOLS_FEATURE_CONVERSION.md](5ETOOLS_FEATURE_CONVERSION.md). Pré-requisitos em árvore lógica, projeção simples conservadora, alternativas ASI e famílias de escolha. a5.4 validou 3276 itens em staging e bloqueou 298 variantes. Efeitos, referências, elegibilidade composta e replacement pendentes. Próximo: espécies e backgrounds.

## Fase 5.6 — espécies e backgrounds

Ver [5ETOOLS_ORIGIN_CONVERSION.md](5ETOOLS_ORIGIN_CONVERSION.md). Herança conservadora de subraces, templates de linhagem preservados, ASI de background 2024, proficiências simples, referências candidatas de talentos e grupos de equipamento. a5.5 validou 450/451 em staging. Próximo: classes, subclasses e progressões. Nenhuma alteração de runtime.

## Fase 5.7 — classes, subclasses e progressões

Ver [5ETOOLS_CLASS_CONVERSION.md](5ETOOLS_CLASS_CONVERSION.md). Grafo piloto fechado por owner e nível, projeção conservadora de proficiências e tabelas de magia/pacto, flags e escolhas preservadas. Aliases cross-owner e dependências fora do piloto são bloqueados; não há ativação nem mudança no runtime. Próximo: conditions e fechamento dos conversores.

## Fase 5.8 — conditions e fechamento dos pilotos

Ver [5ETOOLS_CONDITION_CONVERSION.md](5ETOOLS_CONDITION_CONVERSION.md). PHB/XPHB: condições descritivas com IDs de staging distintos por edição, status/disease diferidos e contabilizados. Registry de cobertura verifica os 13 kinds emitidos pelos oito pilotos no mesmo snapshot, IDs únicos e review-required. CI também dispara em alterações de testes/contrato. A5.7: 1809/2078 validados; Quality fix01 aprovado. Próxima fase a6: expansão e resolução semântica, sem ativação de runtime.

## Fase a6.1 — baseline integrado

Ver [5ETOOLS_COVERAGE_BASELINE.md](5ETOOLS_COVERAGE_BASELINE.md). Cruza inventário, estrutura, elegibilidade, saídas e validação V3 por coordenada de origem, separando expansão de templates e revisão semântica. Bundle v4.8.0 somente leitura para priorização nominal; sem equivalência histórica. A5.8 aprovada: 8589 IDs únicos, 13 kinds, 30 conditions válidas. Próxima a6.2: referências entre entidades.

## Fase a6.2 — referências entre entidades

Ver [5ETOOLS_REFERENCE_INDEX.md](5ETOOLS_REFERENCE_INDEX.md). Sidecar de referências por identidade/namespace/proveniência, sem mutação de packs, elegibilidade ou runtime. Seletores e fontes ausentes permanecem pendentes; cross-era sinalizado. a6.1 validou 8589 saídas, zero erros de conciliação. Próxima a6.3: precedência e compatibilidade entre edições.

## Fase a6.3 — precedência e compatibilidade

Ver [5ETOOLS_PRECEDENCE_POLICY.md](5ETOOLS_PRECEDENCE_POLICY.md). Preview V3 global de reprints explícitos e preservação cross-era, supersedes somente com decisão editorial vinculada a snapshot; sem redirecionamento ou ativação. a6.2 aprovada: 13052/15571 referências resolvidas, 748 cross-era. Próxima a6.4: heranças, variantes, templates e tags.

## Fase a6.4.1 — identidades e cópias

Ver [5ETOOLS_RESOLVER_EXTENSIONS.md](5ETOOLS_RESOLVER_EXTENSIONS.md). Normalização exclusiva de source aninhado em magicvariant, operações root/literal wildcard e escalares conservadoras, sem regex arbitrária ou alteração de IDs anteriores. a6.3 aprovada: 1562 vínculos reprint, zero supersedes/erros. Próxima a6.4.2: templates, variantes e aliases.

## Fase a6.4.2 — templates, versões e proprietários

Ver [5ETOOLS_VARIANT_LINEAGE.md](5ETOOLS_VARIANT_LINEAGE.md). Preview de templates externos, versões simples/abstratas, evidência de aliases cross-owner e revalidação de variantes mágicas por base resolvida. Sem emissão adicional ou alteração de ownership. a6.4.1 aprovada: 8600 saídas válidas, 2658 resoluções estruturais adicionais. Próxima a6.4.3: tags e UID defaults.

## Fase a6.4.3 — tags e UIDs

Ver [5ETOOLS_TAG_UID_PREVIEW.md](5ETOOLS_TAG_UID_PREVIEW.md). Scanner balanceado, defaults por tipo como candidatos sem redirect, UIDs contextuais, qualificadores e additional/attached spells, transições sobre ledger a6.2 sem alteração de concessões. a6.4.2 aprovada: 167 versões, 126 aliases completos, 2297 variantes conferidas. Próxima a6.5: semântica e mecânicas executáveis.

## Fase a6.5.1 — elegibilidade e concessões contextuais

Ver [5ETOOLS_SEMANTIC_ELIGIBILITY.md](5ETOOLS_SEMANTIC_ELIGIBILITY.md). IR de requisitos com avaliação trivalente, schedules e alocações, concessões contextuais preservando ownership; sem integração runtime. a6.4.3 aprovada: 5694 referências inline explícitas, 5162 candidatos de default. Próxima a6.5.2: recursos e spellcasting.

## Fase a6.5.2 — recursos e spellcasting

Ver [5ETOOLS_RESOURCE_SPELLCASTING.md](5ETOOLS_RESOURCE_SPELLCASTING.md). Perfis e pools candidatos, política explícita de multiclass, custos de magia e recursos, testes de compatibilidade com managers existentes e orçamento de ações simples. Sem ativação. a6.5.1 aprovada: 123 requisitos integralmente avaliáveis, 1097 grants diretos. Próxima a6.5.3: efeitos e fórmulas.

## Fase a6.5.3 — dano e efeitos

Ver [5ETOOLS_EFFECT_DAMAGE.md](5ETOOLS_EFFECT_DAMAGE.md). Fórmulas léxicas, adaptação de dano e scaling explícitos, eventos por tipo, saves, duração e referências a condições, bridge manual de efeitos e testes contra runtime existente. Sem ativação. a6.5.2 aprovada: 21 perfis de tabela e 735 candidatos de custo. Próxima a6.5.4: integração de candidatos e lacunas.
