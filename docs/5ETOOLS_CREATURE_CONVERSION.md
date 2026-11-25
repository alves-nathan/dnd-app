# V1.4a5.2 — Criaturas (piloto em staging)

## Evidência anterior

A auditoria de magias (run 45707102175, snapshot 2512db75eb48ef06f6190b086a82430887906dca) validou 854/854 registros individualmente via stageImportV3; os 13 testes desse job passaram. Zero fórmulas de dano foram promovidas no piloto real: escalas, ações e efeitos ainda exigem interpretação mecânica. Não equivale a prontidão. Preservar o backlog de magias.

## Escopo

MM, XMM, BAM, LoX, AU e WoW. Leitura de todo o índice de bestiário para resolver referências cruzadas de _copy; emissão somente das fontes piloto. LoX é incluído para diagnosticar suas heranças problemáticas. Data de publicação por books/adventures; era explícita (WoW unknown); não inferir edição pela data. IDs físicos determinísticos por fonte/nome, reconciliação com IDs históricos pendente.

Mapeia tamanho, tipo, alinhamento simples, AC estática ou alternativas preservadas, HP, dados de vida, deslocamento, atributos, salvaguardas, perícias, CR e PB derivado de CR estático sem pbNote. Resistências, vulnerabilidades e imunidades incondicionais só são promovidas quando literais e reconhecidas. Modificadores condicionais, sentidos, iniciativa, variantes, invocações e descrições são preservados em mechanics.upstreamCreature. AC/HP especiais não recebem valores inventados. Ações, bônus e reações têm nomes e custo; ataque simples recebe attackBonus, reach/range e dano somente para padrão inequívoco de 2014/2024, sem riders e sem múltiplos danos. Legendary/Mythic/Lair, Recharge, Multiattack, saves e spellcasting são preservados e sinalizados, não automatizados. Todo registro fica needsReview; o motor atual não trata creatureStatBlock como uma entidade diretamente aplicável ao personagem.

## Execução local

```bash
node scripts/5etools/creature-converter.js ../5etools-src dist/upstream/creature-pilot
npx jest src/tests/upstream5etoolsCreatureConverter.test.ts --runInBand
DND_UPSTREAM_CREATURE_SNAPSHOT=../5etools-src npx jest src/tests/upstream5etoolsCreatureConverter.test.ts --runInBand
```

CI usa clones temporários e imprime somente métricas agregadas e códigos. Bloqueios estruturais são contabilizados; falhas de validação dos itens emitidos falham o teste. Sem persistência, publicação de payloads ou ativação automática. Saída local contém dados dos livros e não deve ser publicada sem direitos. A expansão de variantes, o resolvedor de templates/modificações, homebrew e a equivalência com o motor continuam pendentes.

Próxima subfase: a5.3 armas, armaduras e equipamentos, sem abandonar as pendências de magias e criaturas.
