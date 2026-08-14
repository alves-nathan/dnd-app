# APP-22 — Saúde do rollout e promoção assinada entre canais

## Objetivo

Adicionar uma camada local e auditável de saúde operacional às publicações do catálogo, permitindo medir adoção e falhas, produzir evidências agregadas mediante opt-in e validar mudanças de rollout assinadas sem executar ações automaticamente.

## Implementação

### Métricas locais

A aplicação registra sinais nos pontos reais de execução:

- avaliação de elegibilidade;
- início, sucesso e falha de download;
- falha de integridade;
- abertura do preview;
- sucesso e falha do commit;
- rollback concluído.

Os sinais permanecem locais e são limitados aos 1.000 registros mais recentes. A evidência compartilhável contém somente contagens, taxas, duração p95 e faixas amplas de coorte.

### Opt-in e privacidade

A geração da evidência exige opt-in explícito. O documento não contém nomes, e-mails, personagens, conteúdo das fichas ou o identificador completo da instalação. Eventos brutos e mensagens de erro não são exportados.

### Limites assinados

O schema `dnd-catalog-rollout-health-policy.v1` define:

- amostra mínima;
- sucesso mínimo;
- falha máxima;
- rollback máximo;
- falha de integridade máxima;
- duração p95 máxima.

A política é vinculada à publicação e ao canal e utiliza revisão monotônica.

### Avaliação e recomendação

O motor classifica a publicação como `insufficient`, `healthy`, `watch` ou `unhealthy`. As recomendações possíveis são `hold`, `expand`, `promote`, `pause` e `rollback`.

A recomendação nunca executa a ação. Ela apenas produz uma evidência verificável para decisão operacional posterior.

### Diretrizes assinadas

O schema `dnd-catalog-rollout-directive.v1` permite:

- expandir o percentual;
- reduzir o percentual;
- promover entre canais;
- pausar novas elegibilidades;
- bloquear novas adoções durante rollback operacional.

Toda diretriz referencia uma política e uma evidência de saúde íntegras. Revisões são sequenciais. A promoção somente aceita `preview → beta → stable` e exige que origem e destino preservem catálogo, bundle e snapshot.

### Integração com elegibilidade

A store de publicação usa o rollout efetivo da última diretriz válida. Pausa e rollback reduzem a elegibilidade futura a 0%, mas não removem cache, não trocam o catálogo ativo e não alteram fichas.

### Interface

A rota `app/catalog-rollout-health.tsx` oferece:

- controle de opt-in;
- importação de política;
- importação de diretriz;
- métricas e comparação entre coortes;
- geração e compartilhamento de evidências;
- auditoria local;
- limpeza controlada dos sinais.

A tela está acessível por Ajustes, Canais de publicação e alertas da Home.

## Ferramentas operacionais

- `npm run catalog:rollout-health:policy:sign`;
- `npm run catalog:rollout:directive:sign`;
- `npm run catalog:rollout-health:check`;
- `npm run catalog:rollout-health:harness`;
- `npm run app22:linear`.

O guia operacional está em `docs/CATALOG_ROLLOUT_HEALTH_AND_PROMOTION.md`.

## Validação

- regressão linear atual: 30/30;
- baseline herdada: 94 verificações aprovadas;
- parsing: 354 arquivos TS/TSX;
- typechecks isolados: núcleo, store de saúde, store de publicação, distribuição, atualização e teste aprovados;
- harness: 42 asserções;
- CLI de política e diretriz: aprovada;
- fluxos Maestro encontrados: 55;
- nenhuma chave privada encontrada.

## Limitação do ambiente

O registry interno não contém `zustand@5.0.14`; por isso `node_modules`, typecheck integral, Jest e execução Android permanecem bloqueados. A ausência de ADB, Maestro e dispositivo também impede o gate nativo real.

## Próximo lote

**APP-23 — agregação verificável de saúde e decisão de release em quórum**:

- importação de evidências agregadas de múltiplas instalações;
- limites mínimos de anonimato e tamanho de grupo;
- deduplicação sem identificadores pessoais;
- relatório consolidado assinado;
- decisão em quórum para expansão, promoção, pausa ou rollback;
- trilha de aprovação independente;
- nenhuma execução automática;
- cenários E2E de evidência insuficiente, divergência, quórum e rejeição.
