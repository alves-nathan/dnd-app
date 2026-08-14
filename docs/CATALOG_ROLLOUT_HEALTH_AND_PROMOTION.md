# Saúde do rollout e promoção entre canais

## Princípios

- As métricas são coletadas e armazenadas localmente.
- A exportação de evidências exige opt-in explícito.
- Evidências não incluem nome, e-mail, personagens ou o identificador completo da instalação.
- Recomendações não executam pausa, expansão, promoção ou rollback.
- Toda mudança de rollout efetivo exige uma diretriz assinada pelo publicador confiável.
- Promoções só podem seguir `preview → beta → stable` e precisam referenciar uma publicação assinada no canal-alvo.

## Fluxo operacional

1. Publique e valide o documento `dnd-catalog-publication.v1`.
2. Gere uma política assinada:

```bash
npm run catalog:rollout-health:policy:sign -- \
  --publication catalog-publication.json \
  --private-key catalog-private-key.json \
  --minimum-samples 50 \
  --minimum-success-rate 0.98 \
  --maximum-failure-rate 0.02 \
  --maximum-rollback-rate 0.01 \
  --maximum-integrity-failure-rate 0 \
  --maximum-p95-duration-ms 120000 \
  --out rollout-health-policy.json
```

3. Importe a política na tela **Saúde e promoção do rollout**.
4. Ative o opt-in somente quando desejar gerar uma evidência compartilhável.
5. Gere a evidência agregada e revise o status e a recomendação.
6. O publicador pode emitir uma diretriz assinada:

```bash
npm run catalog:rollout:directive:sign -- \
  --publication catalog-publication.json \
  --policy rollout-health-policy.json \
  --evidence rollout-health-evidence.json \
  --private-key catalog-private-key.json \
  --action expand \
  --from-rollout 25 \
  --to-rollout 50 \
  --reason "Limites de saúde atendidos" \
  --out rollout-directive.json
```

Para promoção, informe também `--target-publication` e mantenha o mesmo catálogo, bundle e snapshot no canal seguinte.

## Recomendações

- `hold`: manter o rollout atual.
- `expand`: aumentar gradualmente o percentual.
- `promote`: emitir uma nova publicação no canal seguinte.
- `pause`: reduzir o rollout efetivo a zero, sem apagar dados locais.
- `rollback`: bloquear novas adoções e iniciar um rollback operacional separado e explícito.

## Privacidade

A evidência exportada contém apenas contagens, taxas, duração p95 e faixas amplas de coorte. O identificador da instalação e os eventos brutos não fazem parte do documento compartilhável.

## Rollback operacional

Uma diretriz `rollback` não troca o catálogo ativo. Ela zera a elegibilidade futura e mantém a decisão na auditoria. A reversão do catálogo continua usando a sessão transacional e o checkpoint do APP-17.
