# Playbook de incidente e rollback

## Classificação

- **SEV-1:** perda ampla de dados, impossibilidade de iniciar, falha crítica de segurança ou catálogo malicioso.
- **SEV-2:** função principal indisponível, migração parcial, atualização incompatível ou regressão com impacto amplo.
- **SEV-3:** falha contornável, degradação localizada, erro visual ou de conteúdo sem risco aos dados.
- **SEV-4:** dúvida, melhoria ou inconsistência documental.

## Primeiras ações

1. Preservar evidências e horários.
2. Interromper nova promoção do rollout.
3. Não apagar banco, cache ou diário antes do backup.
4. Identificar versão, build, package, canal e checksum.
5. Determinar se o problema está no binário, dados locais ou catálogo remoto.

## Rollback do catálogo

Usar os fluxos de autorização, quórum, execução e diário já implementados. Uma recomendação ou decisão não executa rollback automaticamente.

## Rollback do aplicativo

A loja pode não permitir downgrade direto. Quando necessário, publicar uma nova build corretiva com número de build superior e migração compatível. A decisão deve preservar evidências da versão afetada e do artefato corretivo.

## Encerramento do incidente

- causa confirmada;
- impacto estimado;
- ação corretiva registrada;
- reconciliação aprovada;
- evidências arquivadas;
- prevenção adicionada ao gate ou teste;
- comunicação final emitida.
