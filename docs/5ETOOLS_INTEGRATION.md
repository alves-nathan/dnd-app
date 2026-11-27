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

## Fase a6.5.4 — integrated review ledger

Ver [5ETOOLS_INTEGRATED_REVIEW.md](5ETOOLS_INTEGRATED_REVIEW.md). Consolidação de evidências por coordenada/ID físico, distinção de gaps e candidatos, decisões vinculadas a snapshots e fingerprint. Sem promoção de conteúdo. a6.5.3 aprovada: 661 candidatos de dano e 27 tabelas de scaling. Próxima a6.6: Homebrew.

## Fase a6.6.1 — política Homebrew

Ver [5ETOOLS_HOMEBREW_POLICY.md](5ETOOLS_HOMEBREW_POLICY.md). Inventário por fonte/arquivo, classificação e licença separadas da procedência, colisões, dependências e candidatos estruturais isolados; distribuição bloqueada, nenhuma emissão. a6.5.4 aprovada: 102474 evidências, 103 lacunas com candidatos, issues vazio. Próxima a6.6.2: conversão piloto isolada.

## Fase a6.6.2 — conversão piloto Homebrew

Ver [5ETOOLS_HOMEBREW_PILOT.md](5ETOOLS_HOMEBREW_PILOT.md). Probes Canonical V3 isolados, amostra limitada de spells/feats/equipment, ledger por entidade, classificação provisória não exportável. Main preservado. a6.6.1 aprovada: 117522 candidatos estruturais de 138511 registros. Próxima a6.7: validação global do grafo.

## Fase a6.7 — validação global do grafo

Ver [5ETOOLS_GLOBAL_GRAPH.md](5ETOOLS_GLOBAL_GRAPH.md). Registro Main e probes Homebrew isolados, fechamento físico, proveniência, precedência, evidências e staging global sem ativação. a6.6.2 aprovada: 90 probes válidos, zero exportações. Próxima a7: benchmark histórico e reconciliação Legacy.

## Fase a7.1 — inventário histórico

Ver [5ETOOLS_HISTORICAL_BASELINE.md](5ETOOLS_HISTORICAL_BASELINE.md). Inventário imutável de packs V1/V2/históricos, bootstrap e runtime V4.8.0, hashes, identidade e cobertura nominal de fontes. Sem equivalência ou retirada de dados. a6.7 FIX01 aprovada: 8690 nós, 102735 evidências, issues vazio. Próxima a7.2: mapeamento e lacunas de migração.

## Fase a7.2 — reconciliação histórica

Ver [5ETOOLS_HISTORICAL_RECONCILIATION.md](5ETOOLS_HISTORICAL_RECONCILIATION.md). Candidatos de identidade por fonte/tipo/nome, owner/nível, fingerprints, obrigações de preservação de entidades e grafo runtime. Sem migração. a7.1 FIX01 aprovada: 6335 ocorrências/2199 IDs, bootstrap1997, runtime5841. CI: concurrency por workflow/evento/ref e cache npm upstream; cobertura intacta.

## Fase a8.1 — migration preview

Ver [5ETOOLS_MIGRATION_PREVIEW.md](5ETOOLS_MIGRATION_PREVIEW.md). Plano read-only com IDs de storage/canônicos, preservação integral, checkpoint e bloqueios. Bootstrap real em memória. a7.2 aprovada: 1162/1997 candidatos bootstrap, todos 3573 payloads comparados divergentes, 3665 contratos runtime fora V3. Nenhuma migração executável. Próxima a8.2: integração guardada e rollback.

## Fase a8.2.1 — staging aditivo guardado

Ver [5ETOOLS_ADDITIVE_STAGE.md](5ETOOLS_ADDITIVE_STAGE.md). Sessão local V3 sem projeção gravável, reservas de IDs e vínculo com snapshot, sem modificar runtime ou dados legados. a8.1 aprovada: 1997 storage items, 5841 runtime, zero escritas. Próxima a8.2.2: preservação transacional e testes de rollback.

## Fase a8.2.2 — checkpoint de preservação

Ver [5ETOOLS_PRESERVATION_CHECKPOINT.md](5ETOOLS_PRESERVATION_CHECKPOINT.md). Evidência local dos backups e grafo runtime vinculada ao staging V3; testes de rollback isolado e gates existentes. a8.2.1 aprovada: 30 condições staged, zero escritas. Sem executor V3 ou cutover.

## Fase a8.3.1 — prévia V3 na importação local

Ver [5ETOOLS_LOCAL_V3_PREVIEW.md](5ETOOLS_LOCAL_V3_PREVIEW.md). UI read-only e barreiras contra fallback V1 de envelopes V3 explícitos. FIX01 de a8.2.2 aprovado nos três checks. Próxima a8.3.2: evidência de preservação na interface, sem ativação.

## Fase a8.3.2 — evidência local de preservação

Ver [5ETOOLS_LOCAL_PRESERVATION_UI.md](5ETOOLS_LOCAL_PRESERVATION_UI.md). Verificação read-only de dois backups selecionados contra o estado carregado e a prévia V3. a8.3.1 aprovada. Sem persistência, restauração ou autorização. Próxima a8.4: matriz consolidada de evidências e lacunas.

## Fase a8.4 — matriz de evidências e lacunas

Ver [5ETOOLS_CUTOVER_EVIDENCE.md](5ETOOLS_CUTOVER_EVIDENCE.md). Reutiliza cobertura, grafo e preview de migração no mesmo CI, agregados por 13 kinds, sem novos parses ou jobs. a8.3.2 aprovada. Próxima a8.5: revisão de paridade e evidências mecânicas priorizadas.

## Fase a8.5.1 — evidência mecânica de armas e armaduras

Ver [5ETOOLS_EQUIPMENT_PARITY.md](5ETOOLS_EQUIPMENT_PARITY.md). Comparação de campos históricos com candidatos de identidade e regressões sintéticas do motor; sem aprovação de paridade. a8.4 aprovada. Próxima a8.5.2: tratar lacunas específicas de equipamento/condições.

## Fase a8.5.2 — munição qualificada e candidatos de revisão de armaduras/condições

Ver [5ETOOLS_EQUIPMENT_MECHANICS.md](5ETOOLS_EQUIPMENT_MECHANICS.md). Referências explícitas de munição no staging, modelo de AC e revisão de condições por edição. a8.5.1 aprovada. Próxima a8.5.3: lacunas de AC/versatile e regressões isoladas, sem cutover.

## Fase a8.5.3 — correções isoladas do motor de equipamentos

Ver [5ETOOLS_EQUIPMENT_RUNTIME_FIXES.md](5ETOOLS_EQUIPMENT_RUNTIME_FIXES.md). FIX01 da a8.5.2 aprovado. AC heavy padrão e placeholder STR_OR_DEX em Versatile corrigidos; configurações customizadas preservadas. Sem ativação V3. Próxima a8.5.4: revisão de condições por edição.

## Fase a8.5.4 — preview mecânico de Exhaustion por edição

Ver [5ETOOLS_CONDITION_MECHANICS.md](5ETOOLS_CONDITION_MECHANICS.md). Modelo isolado vinculado às definições PHB/XPHB, transições explícitas e auditoria das 30 ocorrências. Sem ativação, efeitos automáticos ou alteração de fichas. a8.5.3 aprovada. Próxima a8.5.5: matriz de capacidades de condições.

## Fase a8.5.5 — matriz de capacidades de condições

Ver [5ETOOLS_CONDITION_CAPABILITIES.md](5ETOOLS_CONDITION_CAPABILITIES.md). 28 definições vinculadas por edição, obrigações e hooks observados, sem ativação. a8.5.4 aprovada. Próxima a8.5.6: modelo explícito de estado e contexto de condições e semântica de crítico condicionado ao acerto.

## Fase a8.5.6 — estado hipotético de condições e preview de ataque

Ver [5ETOOLS_CONDITION_ATTACK_PREVIEW.md](5ETOOLS_CONDITION_ATTACK_PREVIEW.md). Contexto explícito por instância/edição, modificadores de ataque e crítico apenas no acerto; sem ligação ao runtime ativo ou autorização de migração. Próxima a8.5.7: ciclo de vida, movimento, saves e implicações.

## Fase a8.5.7 — implicações, ciclo de vida, movimento e saving throws

Ver [5ETOOLS_CONDITION_STATE_PREVIEW.md](5ETOOLS_CONDITION_STATE_PREVIEW.md). Preview isolado, estados explícitos e derivados, transições hipotéticas, sem ativação. a8.5.6 aprovada. Próxima a8.6.1: identidade e progressão de classe/subclasse/feature.

## Fase a8.6.1 — evidências de ownership e progressão

Ver [5ETOOLS_CLASS_PROGRESSION_EVIDENCE.md](5ETOOLS_CLASS_PROGRESSION_EVIDENCE.md). a8.5.7 aprovada. Auditoria por ocorrência, proprietário, nível e grants, optional features separadas; sem aprovação de paridade. Próxima a8.6.2: campos mecânicos de classe e tabelas de spellcasting.

## Fase a8.6.2 — chassis e tabelas de spellcasting

Ver [5ETOOLS_CLASS_MECHANICS_EVIDENCE.md](5ETOOLS_CLASS_MECHANICS_EVIDENCE.md). FIX01 a8.6.1 aprovado. Comparação granular por ocorrência e tabela completa, provas sintéticas de contrato do runtime, sem ativação. Próxima a8.6.3: preview de projeção mecânica qualificada.

## Fase a8.6.3 — projeção qualificada de classes e spellcasting

Ver [5ETOOLS_CLASS_PROJECTION_PREVIEW.md](5ETOOLS_CLASS_PROJECTION_PREVIEW.md). a8.6.2 aprovada. Preview de chassis e slots com ownership, edição e políticas explícitas; sem instalação. Próxima a8.6.4: recursos, grants e escolhas de features.

## Fase a8.6.4 — recursos, grants e escolhas de features

Ver [5ETOOLS_FEATURE_RESOURCE_EVIDENCE.md](5ETOOLS_FEATURE_RESOURCE_EVIDENCE.md). a8.6.3 aprovada. Evidência por coluna e ocorrência, custos explícitos, checkpoints de escolhas, sem inferência de recuperação ou grant. Próxima a8.6.5: candidatos qualificados de recursos, recuperação e substituições.

## Fase a8.6.5 — projeção de recursos e substituição de escolhas

Ver [5ETOOLS_FEATURE_RESOURCE_PROJECTION.md](5ETOOLS_FEATURE_RESOURCE_PROJECTION.md). a8.6.4 aprovada. Cinco políticas base vinculadas ao snapshot, eventos hipotéticos e seleção explícita, sem ativação. Próxima a8.6.6: consolidação e limites de transações de level-up.

## Fase a8.6.6 — consolidação e limites do level-up

Ver [5ETOOLS_CLASS_CLOSURE_REVIEW.md](5ETOOLS_CLASS_CLOSURE_REVIEW.md). FIX01 a8.6.5 aprovado. Consolidação vinculada e preview isolado de preservação, sem aprovação de paridade. Próxima a8.7.1: auditoria mecânica de magias.

## Fase a8.7.1 — auditoria de paridade mecânica de magias

Ver [5ETOOLS_SPELL_PARITY_EVIDENCE.md](5ETOOLS_SPELL_PARITY_EVIDENCE.md). a8.6.6 aprovada. Evidência histórica por ocorrência e lacunas de contrato, sem ativação. Próxima a8.7.2: tempo de conjuração, alcance, alvos, área e componentes.

## Fase a8.7.2 — projeção de requisitos de conjuração

Ver [5ETOOLS_SPELL_CASTING_PROJECTION.md](5ETOOLS_SPELL_CASTING_PROJECTION.md). a8.7.1 aprovada. Tempo, alcance, âncora, alvos e VSM explícitos; sem conjuração ou consumo real. Próxima a8.7.3: dano, cura, scaling e saves.

## Fase a8.7.3 — dano, cura, escalonamento e saves

Ver [5ETOOLS_SPELL_EFFECT_PROJECTION.md](5ETOOLS_SPELL_EFFECT_PROJECTION.md). a8.7.2 aprovada. Doze definições qualificadas e resultados hipotéticos de dados, sem conjuração ou mutação de HP. Próxima a8.7.4: concentração, duração e ciclo de vida de efeitos.

## Fase a8.7.4 — duração, concentração e ciclo de vida

Ver [5ETOOLS_SPELL_LIFECYCLE_PROJECTION.md](5ETOOLS_SPELL_LIFECYCLE_PROJECTION.md). a8.7.3 aprovada. Duração finita e grupos de conjuração qualificados, salvaguardas de concentração por edição, sem alterações em efeitos ativos. Próxima a8.7.5: acesso, preparação e transações de Spell Slots.

## Fase a8.7.5 — acesso, preparação e transações de slots

Ver [5ETOOLS_SPELL_ACCESS_PROJECTION.md](5ETOOLS_SPELL_ACCESS_PROJECTION.md). a8.7.4 aprovada. Vínculos qualificados de classe, limites separados, seleção explícita de pool e preservação de assignments. Próxima a8.7.6: consolidação de magias e limites de transações.

## Fase a8.7.6 — consolidação de magias e preservação de slots

Ver [5ETOOLS_SPELL_CLOSURE_REVIEW.md](5ETOOLS_SPELL_CLOSURE_REVIEW.md). a8.7.5 aprovada. Relatórios vinculados, fronteira isolada de slot e preservação estrita da ficha, sem aprovação de paridade. Próxima a8.8.1: espécies e backgrounds.

## Fase a8.8.1 — paridade mecânica de espécies e backgrounds

Ver [5ETOOLS_ORIGIN_PARITY_EVIDENCE.md](5ETOOLS_ORIGIN_PARITY_EVIDENCE.md). a8.7.6 aprovada. Comparação por ocorrência e lacunas dos contratos de criação, sem ativação. Próxima a8.8.2: chassis, atributos e seleções de proficiências.

## Fase a8.8.2 — chassis, atributos e proficiências das origens

Ver [5ETOOLS_ORIGIN_CHASSIS_PROJECTION.md](5ETOOLS_ORIGIN_CHASSIS_PROJECTION.md). a8.8.1 aprovada. Projeções isoladas de atributos, tamanho, movimento, sentidos e proficiências, sem concessão automática. Próxima a8.8.3: traits, variantes e grants.

## Fase a8.8.3 — traits, variantes e grants das origens

Ver [5ETOOLS_ORIGIN_GRANT_EVIDENCE.md](5ETOOLS_ORIGIN_GRANT_EVIDENCE.md). a8.8.2 aprovada. Evidência de traits, herança, grupos de feats, magias e equipamentos, sem concessão automática. Próxima a8.8.4: consolidação e preservação da criação.

## Fase a8.8.4 — consolidação das origens e preservação

Ver [5ETOOLS_ORIGIN_CLOSURE_REVIEW.md](5ETOOLS_ORIGIN_CLOSURE_REVIEW.md). a8.8.3 aprovada. Relatórios vinculados e fronteira isolada de escolha de tamanho, sem aplicação de grants. Próxima a8.9.1: auditoria mecânica de feats.

## Fase a8.9.1 — paridade mecânica de feats

Ver [5ETOOLS_FEAT_PARITY_EVIDENCE.md](5ETOOLS_FEAT_PARITY_EVIDENCE.md). a8.8.4 aprovada. Evidência por ocorrência, fonte e edição, requisitos, ASI, repetibilidade, escolhas e grants; sem ativação. Próxima a8.9.2: requisitos qualificados e categorias.

## Fase a8.9.2 — requisitos e categorias de feats

Ver [5ETOOLS_FEAT_REQUIREMENT_PROJECTION.md](5ETOOLS_FEAT_REQUIREMENT_PROJECTION.md). a8.9.1 aprovada. Requisitos qualificados e categorias sob contexto explícito, sem autorização de aquisição. Próxima a8.9.3: ASI e repetibilidade por instância.

## Fase a8.9.3 — ASI e repetibilidade por instância

Ver [5ETOOLS_FEAT_ALLOCATION_PROJECTION.md](5ETOOLS_FEAT_ALLOCATION_PROJECTION.md). a8.9.2 aprovada. Alternativas de atributos e fronteiras de instância isoladas, sem aquisição. Próxima a8.9.4: escolhas, grants e recursos.

## Fase a8.9.4 — escolhas, grants e recursos de feats

Ver [5ETOOLS_FEAT_GRANT_EVIDENCE.md](5ETOOLS_FEAT_GRANT_EVIDENCE.md). a8.9.3 aprovada. Seleções, endpoints e declarações de recursos isolados, sem concessão. Próxima a8.9.5: consolidação e preservação.

## Fase a8.9.5 — consolidação e preservação de feats

Ver [5ETOOLS_FEAT_CLOSURE_REVIEW.md](5ETOOLS_FEAT_CLOSURE_REVIEW.md). a8.9.4 aprovada. Relatórios vinculados e fronteira isolada de ASI existente, sem aquisição ou migração. Próxima a8.10.1: inventário e paridade das famílias restantes.

## Fase a8.10.1 — inventário das famílias restantes

Ver [5ETOOLS_REMAINING_FAMILY_EVIDENCE.md](5ETOOLS_REMAINING_FAMILY_EVIDENCE.md). a8.9.5 aprovada. Cobertura integral por ocorrência e evidência selecionada de equipamentos, itens mágicos e criaturas. Próxima a8.10.2: chassis e contratos de criaturas.

## Fase a8.10.2 — chassis e combate de criaturas

Ver [5ETOOLS_CREATURE_COMBAT_PROJECTION.md](5ETOOLS_CREATURE_COMBAT_PROJECTION.md). a8.10.1 aprovada. Projeções isoladas de chassis, ações e defesas explícitas, sem execução de encontro. Próxima a8.10.3: equipamentos gerais e itens mágicos.

## Fase a8.10.3 — equipamentos gerais e itens mágicos

Ver [5ETOOLS_ITEM_MECHANICS_PROJECTION.md](5ETOOLS_ITEM_MECHANICS_PROJECTION.md). a8.10.2 aprovada. Valores, variantes, attunement, bônus e charges isolados; sem escrita. Próxima a8.10.4: consolidação e preservação de inventário e encontros.

## Fase a8.10.4 — consolidação das famílias restantes

Ver [5ETOOLS_REMAINING_CLOSURE_REVIEW.md](5ETOOLS_REMAINING_CLOSURE_REVIEW.md). a8.10.3.1 aprovada. Auditorias vinculadas e comparação isolada de quantidade e HP, sem escrita. Próxima a8.11.1: preservação dos contratos exclusivos do runtime.

## Fase a8.11.1 — contratos exclusivos do runtime

Ver [5ETOOLS_RUNTIME_CONTRACT_EVIDENCE.md](5ETOOLS_RUNTIME_CONTRACT_EVIDENCE.md). a8.10.4 aprovada. Auditoria de registro, políticas, dependências, aliases e categorias do bundle original. Próxima a8.11.2: comparação isolada de preservação dos contratos.

## Fase a8.11.2 — comparação de preservação runtime

Ver [5ETOOLS_RUNTIME_CONTRACT_PRESERVATION.md](5ETOOLS_RUNTIME_CONTRACT_PRESERVATION.md). a8.11.1 aprovada. Comparação integral do bundle e fronteira isolada de filtros, sem escrita. Próxima a8.11.3: consolidação dos contratos runtime.

## Fase a8.11.3 — consolidação dos contratos runtime

Ver [5ETOOLS_RUNTIME_CLOSURE_REVIEW.md](5ETOOLS_RUNTIME_CLOSURE_REVIEW.md). a8.11.2 aprovada. Evidência e preservação vinculadas; readiness bloqueado. Próxima a8.12.1: consolidação global dos checkpoints e bloqueios de cutover.

## Fase a8.12.1 — consolidação global dos checkpoints

Ver [5ETOOLS_GLOBAL_CHECKPOINT_REVIEW.md](5ETOOLS_GLOBAL_CHECKPOINT_REVIEW.md). a8.11.3 aprovada. Cruzamento por família com a matriz global a8.4 e bloqueios preservados. Próxima a8.12.2: matriz de aceitação e priorização dos gates pendentes.

## Fase a8.12.2 — matriz de aceitação e priorização

Ver [5ETOOLS_CUTOVER_ACCEPTANCE_MATRIX.md](5ETOOLS_CUTOVER_ACCEPTANCE_MATRIX.md). a8.12.1 aprovada. Oito gates vinculados aos bloqueios globais; nenhuma aprovação implícita. Próxima a8.13.1: inventário local somente leitura.

## Fase a8.13.1 — contrato de inventário local

Ver [5ETOOLS_LOCAL_INVENTORY_EVIDENCE.md](5ETOOLS_LOCAL_INVENTORY_EVIDENCE.md). a8.12.2 aprovada. Contrato de observações locais, provenance, estados indisponíveis e fingerprints sem autorização. Próxima a8.13.2: adaptadores de observação somente leitura.

## Fase a8.13.2 — adaptadores de observação local

Ver [5ETOOLS_LOCAL_INVENTORY_CAPTURE.md](5ETOOLS_LOCAL_INVENTORY_CAPTURE.md). a8.13.1.2 aprovada. Captura explícita dos stores hidratados, leitura bruta dupla e invalidação por divergência, sem escrita. Próxima a8.13.3: ampliar inventário e evidências de coerência.

## Fase a8.13.3 — inventário auxiliar e coerência

Ver [5ETOOLS_LOCAL_INVENTORY_COHERENCE.md](5ETOOLS_LOCAL_INVENTORY_COHERENCE.md). a8.13.2 aprovada. Observações de stores auxiliares, leitura limitada de chunks e comparação de coerência local. Próxima a8.13.4: painel de inventário somente leitura e revalidação explícita.

## Fase a8.13.4 — painel de inventário local

Ver [5ETOOLS_LOCAL_INVENTORY_PANEL.md](5ETOOLS_LOCAL_INVENTORY_PANEL.md). a8.13.3 aprovada. Painel somente leitura, revalidação e expiração de evidências. Próxima a8.13.5: ledger de disposições de inventário.
