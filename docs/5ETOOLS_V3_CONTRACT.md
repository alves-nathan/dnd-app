# Contrato canônico V3 — a4 (staging)

O novo envelope usa `templateVersion: dnd-combat-import.v3` e `contractRevision: canonical-v3.1`. A revisão explícita distingue o novo contrato dos packs históricos V3, que não são automaticamente aceitos. O schema canônico em TypeScript/Zod usa os 13 schemas mecânicos V2, sem duplicar seu domínio. A documentação antiga V2 continua válida para compatibilidade durante a migração.

## Entidades e fontes

- `id`: identidade física estável, usada por dependências e personagens. Não regenerar IDs já existentes sem migração.
- `identity.canonicalKey` + `identity.precedenceScope`: identidade lógica independente de publicação. Chaves de classes/features devem incluir contexto de proprietário; escopos de terceiros não substituem o oficial.
- `source.rulesEra`: 2014, 2024 ou unknown. Data de publicação não define edição.
- `source.contentType`: official, third-party ou homebrew; a origem de ingestão não prova licença ou classificação editorial.
- `source.publication`: precisão day/month/year/unknown; somente day contém data completa. Não inventar dias/meses. Evidência obrigatória.
- `precedence`: relation, supersedes, reprints, coexistsWith e basis. IDs físicos nos arrays; nenhuma seleção automática por data nesta fase.
- `provenance`: Git repository, commit e blob, path, sourceCode, entityKey, index, resolverVersion e lineage para fontes estruturadas; referências explícitas para material manual/legado.
- `payload`: união discriminada dos kinds V2. Extensões mecânicas existentes permanecem no payload; metadados editoriais ficam fora dele.

## Validação e projeção

`stageImportV3` valida o envelope, escopo, IDs, relações locais, ciclos supersedes, edições, datas inequivocamente invertidas e domínio mecânico usando o validador semântico V2. Relações externas são warnings até resolução global. O resultado sempre tem activation review-required. A projeção V2 usa metadata.v3 (reservado) para conservar identidade, precedência, fonte e proveniência; traduz 2014 para legacy; não torna conteúdo ativo. É um probe transitório, não um importador de produção, nem prova de roundtrip/persistência.

V1/V2 permanecem no runtime; detectCompendiumImportVersion ainda rejeita V3 deliberadamente. Packs históricos precisam de adaptador explícito para resolver confidence/sourceVerified, rulesEra, publication, payloads e IDs; não renomear versão. O cutover depende de equivalência, migração e rollback, conforme 5ETOOLS_LEGACY_CUTOVER.md.

## Resultado a3 (evidência)

GitHub Actions run 45704916690, snapshots main 2512db75eb48ef06f6190b086a82430887906dca e homebrew bfa899639c696b0ad38afb9a31c443c3b127a058: 152194 indexados, 149524 resolvedSubset, 2670 bloqueados, 1622 fontes, 1904 invalidIdentity fora do denominador. Não é cobertura mecânica. LoX 2/16 resolvidos, magicvariant apenas 5 indexados; há lacunas de identificação (inclusive fonte aninhada em inherits), templates e tags. Devem ser tratadas antes de certificar cobertura. O resumo não comprova disponibilidade integral de livros ou direitos de distribuição.

## Testes

`npx jest src/tests/compendiumImportV3Staging.test.ts --runInBand`

Próxima fase: conversores por kind, primeiro spell e creatureStatBlock; políticas de IDs e fontes, tags, resolução de variantes, classes e progressões, inventário de lacunas e benchmark. Não alterar assets ou persistência até os gates de cutover.
