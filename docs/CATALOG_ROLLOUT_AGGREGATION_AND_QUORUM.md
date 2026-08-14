# Agregação verificável de saúde e decisão em quórum

## Objetivo

O APP-23 agrega evidências opt-in produzidas pelo APP-22 sem transportar sinais brutos, personagens ou identificadores pessoais. A saída é um relatório consolidado assinado que somente pode apoiar uma decisão quando aprovadores independentes atingem o quórum definido em política assinada.

## Fluxo

1. Cada instalação gera uma evidência de saúde opt-in no APP-22.
2. A instalação cria uma submissão APP-23 usando um token opaco derivado de um segredo local e da publicação.
3. O segredo local nunca sai do dispositivo.
4. O agregador valida checksums, descarta evidências antigas e mantém apenas a contribuição mais recente de cada token.
5. A agregação exige o número mínimo de contribuidores únicos definido na política.
6. Métricas de coortes com menos contribuidores que o limite são suprimidas.
7. O relatório consolidado é assinado por uma chave confiável.
8. Aprovadores independentes assinam votos vinculados ao checksum do relatório.
9. A decisão permanece pendente até atingir o quórum.
10. Mesmo aprovada, a decisão não executa expansão, promoção, pausa ou rollback automaticamente.

## Contratos

- `dnd-catalog-rollout-health-submission.v1`
- `dnd-catalog-rollout-aggregation-policy.v1`
- `dnd-catalog-rollout-aggregate-report.v1`
- `dnd-catalog-release-approval.v1`
- `dnd-catalog-release-quorum-decision.v1`

## Anonimato e deduplicação

O token de contribuição é SHA-256 sobre um segredo aleatório local, a publicação e a política de saúde. Ele é estável somente dentro desse contexto e não contém o identificador original da instalação. O relatório final não inclui tokens; contém apenas checksums das evidências aceitas.

O limite mínimo permitido é três contribuidores. A política pode exigir números maiores. Coortes com menos de três contribuidores também precisam ser suprimidas.

## Quórum

A política lista explicitamente os aprovadores autorizados. Cada aprovador deve possuir um `approverId` e uma chave distinta. O quórum mínimo permitido é dois. Aprovações duplicadas da mesma identidade não aumentam a contagem.

## Ferramentas

```bash
npm run catalog:rollout:aggregation:policy:sign -- \
  --input policy.json \
  --private-key publisher-private.jwk.json \
  --output policy.signed.json

npm run catalog:rollout:aggregate -- \
  --submissions submissions.json \
  --policy policy.signed.json \
  --publication publication.signed.json \
  --private-key aggregator-private.jwk.json \
  --output report.signed.json

npm run catalog:release:approval:sign -- \
  --input approval.json \
  --private-key approver-private.jwk.json \
  --output approval.signed.json
```

Chaves privadas não devem ser incluídas no repositório, APK, EAS ou backups do aplicativo.
