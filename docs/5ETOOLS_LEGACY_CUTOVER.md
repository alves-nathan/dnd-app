# V1/V2 — descontinuação condicionada à V3

Decisão: 5e.tools principal + homebrew aprovado são a referência de ingestão; V3 é o contrato-alvo a especificar. V1/V2 tornam-se legados para novas importações após o cutover; não remover leitores/migrações nem persistência transacional antes da prova de equivalência. O runtime atual aceita V2; a V3 histórica ainda não é aceita e exige contrato próprio, mapeamento e testes, não apenas troca da string de versão.

## Inventário de bootstrap
Ver `src/compendium/bundledCompendium.ts` e `artifacts/compendium/integration/runtime-integration-report.json`. Os seis packs existentes correspondem a fontes confirmadas no índice principal:
- PHB 2024 → XPHB
- MM delta (rótulo local 2024, publicado 2025) → XMM
- Forge of the Artificer → EFA
- Spelljammer → AAG, BAM, LoX
- Tasha → TCE
- PHB 2014 → PHB

XDMG também consta no upstream. A auditoria nominal não demonstra equivalência de entidades nem cobre packs importados localmente, backups ou personalizações. O bundle V4.8.0 tem 5841 entradas e 15385 dependências, conforme runtime-bundle-summary.json. A presença nominal de livros não autoriza eliminar essas relações.

## Gates de cutover
1. Inventário de todos os packs, entidades e fontes reais (incluindo importações locais e baseline V3); relatório de não correspondências, versões, equivalências e exceções.
2. V3 schema, normalização e validação semântica, preservando a capacidade de representar todos os kinds e payloads consumidos pelo V2 atual.
3. Mapeamento explícito de IDs históricos, dependências, aliases, dados derivados, mapeamentos manuais e referências de personagens. Sem substituição por nome.
4. Migração transacional e repetível, com preview, backup, rollback, testes de importação de backups V1/V2 e regressão de criação/progressão/combate.
5. Catálogo candidato com equivalência comprovada, políticas de licença, assinatura e fluxo de distribuição existente. Somente após aprovação, V3 vira caminho padrão. Compatibilidade antiga pode ficar isolada como migrador enquanto houver instalações antigas.
6. Remover código/fixtures legados redundantes apenas em PR separado com evidências de todos os gates e aprovação.

Nenhum importador ou dado ativo foi removido nesta fase. PDFs seguem adiados.

## Revisão de decisão do proprietário após entrega 19

[Roadmap de conclusão funcional](5ETOOLS_FUNCTIONAL_COMPLETION_ROADMAP.md): remover definitivamente os importadores V1/V2 ao final (20B), na branch candidata após comprovação automatizada do cutover funcional (20A). V3 é a única ingestão de conteúdo. Preservar migrador de snapshots/backup antigos isolado, contratos compartilhados, regras 2014 e todos os dados/IDs/revisões. Remoção de importadores não significa remover recuperação legada nem excluir dados. A branch permanece reversível e separada da main; merge e promoção real só após testes nativos e aprovação. Esta revisão substitui a exigência anterior de aguardar o teste manual para retirar os importadores no candidato, não autoriza exclusão de dados nem retirada irreversível na instalação real.
