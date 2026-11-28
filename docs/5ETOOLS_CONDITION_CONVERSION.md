# V1.4a5.8 — Conditions e fechamento dos pilotos V3

Fonte piloto PHB/XPHB, arquivo data/conditionsdiseases.json. Snapshot de referência observado 2512db75eb48ef06f6190b086a82430887906dca: 30 condition (15 por edição), 5 status e 29 disease. Estas contagens são observações do upstream, não resultado de CI do novo conversor. Status/disease são contabilizados integralmente por fonte e diferidos; não são condições oficiais nem se inventa um novo kind. Outros sources de condition ficam fora do piloto.

Identidade física baseada no kind, source e name via resolver. Canonical key comum por nome; conditionId exclusivo de staging (upstream:main:condition:<source>:<name>), pois o V2 proíbe slugs duplicados num pack. Candidato de alias de runtime separado em mechanics.runtimeConditionCandidate; não é um vínculo resolvido. PHB e XPHB coexistem em staging sem precedência automática, preservam entradas/reprints e proveniência. officialCondition indica classificação documental apenas. Sem efeitos, durações, endConditions, imunidades, vantagem/desvantagem ou Exhaustion stacks inferidos. Exhaustion exige política explícita por edição. Nome fora da lista oficial, entrada inválida, cópia/variante não resolvida e identidade duplicada bloqueiam a emissão. Todos needsReview.

CLI: node scripts/5etools/condition-converter.js ../5etools-src dist/upstream/condition-pilot [ref]
Testes: npx jest src/tests/upstream5etoolsConditionConverter.test.ts --runInBand
Auditoria real: DND_UPSTREAM_CONDITION_SNAPSHOT=../5etools-src npx jest src/tests/upstream5etoolsConditionConverter.test.ts --runInBand
O CLI grava apenas localmente; exit 2 se bloqueios, 1 erro. CI agrega contagens/códigos; sem payloads. Coverage registry executa os oito pilotos no mesmo snapshot, verifica kinds realmente emitidos, IDs físicos únicos entre conversores, contrato e review-required. Os validadores de cada piloto continuam responsáveis pela validade semântica de suas projeções; não é validação semântica de um catálogo global.

## Matriz de cobertura

| Etapa | Kinds V3 | Evidência anterior |
|---|---|---|
| a5.1 | spell | 854/854 |
| a5.2 | creatureStatBlock | 1099/1149 |
| a5.3 | weapon, armor, equipment | 824/826 |
| a5.4 | magicItem | 3276/3574 |
| a5.5 | feat, feature (optionalfeature) | 450/451 |
| a5.6 | species, background | 247/252 |
| a5.7 | class, subclass, feature (classFeature/subclassFeature) | 1809/2078 |
| a5.8 | condition | novo piloto, CI pendente |

13 kinds distintos de 13 do contrato. Os denominadores representam pilotos distintos, não todo o upstream, nem paridade mecânica; não somar como cobertura global de livros. Fase 5 encerra implementação somente após checks verdes. Nenhum runtime ou asset alterado. Homebrew continua inventário/resolução estrutural; não é convertido por estes pilotos.

## Fase a6 — backlog prioritário e gates

1. Baseline de cobertura por origem, fonte e kind; distinguir fora de escopo, identidade inválida, resolução bloqueada, conversão bloqueada, staging válido e semântica validada. Congelar snapshots por SHA e registrar diferenças sem dados de livro.
2. Resolver namespaces e referências entre packs (condition aliases por edição, classes/magias, feats/origins/equipamentos, optionalfeature choices); manter IDs físicos e mapear referências por fonte/proveniência, não nome. Definir precedência/reprints e compatibilidade 2014/2024 sem promover automaticamente.
3. Tratar heranças, aliases cross-owner, variantes, _meta, tags inline e UIDs faltantes, com testes de regressão para os bloqueios de a3/a5. Priorizar PHB/XPHB e os livros já ativos. A5.7: 101 crossOwnerFeatureReference, 168 dependencyNotEmitted.
4. Traduzir efeitos comprováveis, recursos, progressões, escolhas, requisitos e end conditions; conservar regras ainda não interpretadas como review-required. Definir modelagem de status/disease antes de convertê-los.
5. Estender pipeline a homebrew com namespace próprio, classificação de licença e fontes, sem reutilizar IDs oficiais; medir equivalência e exceções.
6. Validar grafo global e dependências, métricas por tipo e edição, regressão mecânica e ausência de ativação. Só então avançar ao benchmark histórico a7, runtime a8 e cutover a9 (ver 5ETOOLS_LEGACY_CUTOVER.md). PDF residual após base estruturada e app praticamente pronto.

A5.7 fix01: Quality push 45720845907 e PR 45720854101 aprovados; auditoria 45719944011 aprovada (8/8). 
