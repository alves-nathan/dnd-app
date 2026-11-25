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
