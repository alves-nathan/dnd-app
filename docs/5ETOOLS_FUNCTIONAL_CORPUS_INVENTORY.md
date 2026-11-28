# 19A.1 — inventário operacional inicial do corpus

Base 8822867082360ff0ff937fc660e18933e3f5cdfb; Quality 46149418684 e full audit 46149415009 aprovados. Incorporado roadmap revisado e requisito de bootstrap automático. Branch feature/5etools-integration, main preservada.

Lock scripts/5etools/functional-inputs.json: Main 2512db75eb48ef06f6190b086a82430887906dca, Brew bfa899639c696b0ad38afb9a31c443c3b127a058, asOf 2026-11-28, canonical-v3.1. CI full fetch por SHA exato sem checkout/execução de código upstream; mudança de lock deve ser explícita. Baseline de entrega 19: Main 15586 linhas brutas do resolver, 6424 com saída válida, 316 elegíveis sem saída, 32 templates sem saída, 8814 fora do piloto; 8600 itens canônicos (expansões). Brew 138511 linhas, zero saídas no baseline Main (90 probes separados não são conversão). 185 grupos fonte Main/1558 Brew, 5841 entradas runtime, 170 sem mapeamento explícito de sourceBookId, 6335 ocorrências históricas e 1997 itens storage bundled fixture. Não misturar contagens de linhas e entidades. 13 kinds V3; registros aninhados/consulta excedem o denominador anterior.

Novo módulo functional-corpus: reutiliza baseline real e inventário Git, conta linhas de raiz do resolver, outras coleções de raiz, observações aninhadas name/source, _versions e edição explícita em todos os arquivos inventariados. Esses últimos são observações de estrutura (podem sobrepor-se), não equivalência mecânica. Asserção de denominadores por origem, contagem de linhas single/multiple output e excedente, fontes explícitas fora do resolver, catálogo de escopo privado com fingerprints. Main proposto para revisão, Brew exige decisão por fonte; sem aprovação tácita, sem licença/ativação. Seleção parcial vinculada ao fingerprint, sem wildcard ou descarte de fonte desconhecida. Não implementa ainda conversão muitos-para-um, atribuição completa de seções sem fonte, correspondência de todo legado ou dependências; A1 continua aberta até resolver/dispor corpus e obter seleção. CI full imprime só agregados; nenhum payload/nome de fonte Brew. Testes sintéticos e execução com snapshots reais no teste de coverage existente. Não executado localmente.

Para gerar manifesto privado (PowerShell, após npm ci e clones locais nos commits do lock; criar previamente pasta privada fora do repositório):
```powershell
$env:DND_UPSTREAM_BASELINE_MAIN = 'C:\private\5etools-main'
$env:DND_UPSTREAM_BASELINE_BREW = 'C:\private\5etools-homebrew'
$env:DND_UPSTREAM_BASELINE_MAIN_REF = '2512db75eb48ef06f6190b086a82430887906dca'
$env:DND_UPSTREAM_BASELINE_BREW_REF = 'bfa899639c696b0ad38afb9a31c443c3b127a058'
$env:DND_FUNCTIONAL_CORPUS_OUT = 'C:\private\functional-corpus.json'
npx jest src/tests/upstream5etoolsCoverageBaseline.test.ts --runInBand
```
Saída exclusiva (não sobrescreve), fora do repo, contém códigos de fonte e contagens, não payload. Não compartilhar. A escolha de fontes deverá ser local; não pedir ao usuário revisão de 1558 fontes individualmente no chat. Próximo: após Quality/full audit, concluir catálogo de escopo/disposition, mecanismo de seleção em lote explícito e comparação com fontes históricas/bundled, expandir A1 se necessário. Depois A2 CLI de conversão e geração do catálogo pré-instalado. Não ir ao emulador até 20B, não remover legado antes de cutover funcional. DRM/publicação fora do escopo.
