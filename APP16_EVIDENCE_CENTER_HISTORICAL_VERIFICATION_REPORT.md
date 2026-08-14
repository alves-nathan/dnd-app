# APP-16 — Central de evidências e verificação histórica

## Objetivo

Criar uma central persistida para recibos e pacotes de evidências de restaurações portáteis, permitindo validar arquivos externos, comparar restaurações anteriores com o estado atual, detectar alterações posteriores e controlar separadamente a retenção de checkpoints completos.

## Implementação

### Registro histórico

Foi criado `src/backup/portableRestoreEvidenceCenter.ts` com dois contratos novos:

- `dnd-portable-restore-evidence-record.v1`;
- `dnd-portable-restore-evidence-archive.v1`.

Cada registro preserva o recibo, o pacote de evidências quando disponível, origem local ou importada, resultado de validação, comparação mais recente e disponibilidade de checkpoint local.

### Arquivamento automático

Ao encerrar uma sessão confirmada e verificada, a store cria automaticamente um registro histórico. O checkpoint completo e a evidência passam a ter ciclos de retenção independentes:

- remover o checkpoint não remove o recibo;
- remover a evidência não altera personagens, catálogo ou planos;
- evidências importadas nunca recebem autorização de rollback local.

### Importação validada

A central aceita:

- recibo individual;
- pacote completo de evidências;
- arquivo agregado de evidências.

Checksums inválidos, IDs incoerentes ou arquivos agregados adulterados são rejeitados. Duplicatas são ignoradas pelo identificador canônico do recibo.

### Comparação histórica

Cada recibo pode ser comparado ao estado efetivo atual. A comparação verifica:

- fingerprint completo dos dados restaurados;
- existência do commit vinculado no histórico do catálogo;
- diferença na quantidade de personagens;
- diferença na quantidade de planos;
- diferença na quantidade de drafts de progressão.

O resultado é classificado como `current`, `changed`, `invalid` ou `unavailable`.

### Revalidação periódica

Foi adicionado `usePortableRestoreEvidenceRevalidation`. A aplicação revalida os registros após a inicialização do catálogo, em alterações de revisão e periodicamente enquanto permanece aberta.

A Home destaca recibos inválidos ou estados alterados após uma restauração verificada.

### Retenção controlada

A política recomenda manter os cinco checkpoints completos mais recentes. A remoção dos excedentes exige confirmação explícita e preserva todos os recibos históricos.

Registros inválidos também podem ser limpos separadamente.

### Interface

Foi criada a rota `app/evidence-center.tsx`, acessível por Ajustes. A tela oferece:

- resumo de evidências e checkpoints;
- comparação manual com o estado atual;
- importação por arquivo ou JSON;
- exportação agregada;
- histórico navegável;
- compartilhamento individual;
- reabertura de rollback somente para checkpoints locais;
- limpeza controlada.

## Persistência

A store de sessões portáteis passou para a versão 3 e recebeu `evidenceRecords`.

A migração cria registros históricos para sessões arquivadas antigas que possuam recibo e evidência válidos.

## Testes

Foram adicionados:

- `src/tests/portableRestoreEvidenceCenter.test.ts`;
- `scripts/check-portable-restore-evidence-center.js`;
- `scripts/run-app16-runtime-harness.js`;
- regressão linear de 34 comandos;
- quatro fluxos Maestro.

O harness confirmou criação local, exportação agregada, importação sem rollback, rejeição de adulteração, comparação posterior, revalidação e retenção independente.

## Gate nativo

O gate reconhece 31 fluxos Maestro. A execução Android permanece bloqueada no ambiente de geração pela ausência de dependências integrais, ADB, Maestro e dispositivo conectado.

## Próximo lote

APP-17 — atualização transacional do catálogo e migração de snapshot.
