# APP-14 — Sessão transacional de restauração portátil

## Objetivo

Transformar a restauração do backup portátil do APP-13 em uma operação durável e coordenada. Nenhum personagem, cenário, preset, snapshot, plano ou filtro do catálogo é gravado durante o preview. Antes do primeiro write, a aplicação persiste um checkpoint completo que pode ser retomado ou restaurado após encerramento inesperado.

## Contratos introduzidos

- sessão: `dnd-portable-restore-session.v1`;
- auditoria: `dnd-portable-restore-session-audit.v1`;
- persistência independente: `dnd-combat-math-portable-restore-session`;
- versão da store da sessão: `1`;
- store de personagens preservada na versão `23`.

## Checkpoint completo

O checkpoint anterior e o estado projetado incluem:

- personagens;
- drafts de progressão e seus estados de recuperação;
- planos de remediação, recuperação e quarentena;
- cenários de combate;
- presets de build;
- snapshots do histórico de builds;
- filtros, revisão e histórico linear do catálogo.

Cada checkpoint recebe um fingerprint canônico. Ao iniciar um commit ainda no estado `prepared`, o fingerprint local é comparado com o checkpoint original. Qualquer alteração concorrente bloqueia o commit.

## Preview agregado

A preparação usa o motor de restauração já existente apenas para calcular o estado projetado. Ela não chama setters das stores. O preview apresenta:

- totais anteriores e posteriores;
- itens importados;
- IDs remapeados;
- planos aceitos, ignorados ou preservados por conflito;
- planos preventivos projetados;
- impacto do catálogo nas fichas;
- bloqueios e avisos novos.

## Confirmações explícitas

Conflitos são registrados individualmente e precisam ser reconhecidos antes do commit. O schema contempla:

- substituição integral de dados;
- impacto do catálogo;
- divergência do histórico;
- incompatibilidade de versão;
- direção do histórico local/externo;
- conflito entre planos;
- planos ignorados.

O descarte é permitido apenas antes de qualquer gravação e mantém o estado local intacto.

## Commit coordenado

O commit segue fases persistidas:

1. `committing/data`: registra que a sessão iniciou antes de escrever dados;
2. aplica personagens, cenários, presets, snapshots e planos de forma idempotente;
3. `committing/catalog`: confirma a configuração como nova transação local;
4. vincula o commit do catálogo ao `portableRestoreSessionId`;
5. `committed/complete`: grava o recibo de auditoria da sessão.

Se o processo for retomado depois que o commit do catálogo já foi persistido, o executor localiza o vínculo da sessão e não cria uma segunda entrada.

## Recuperação após interrupção

Na reidratação, sessões encontradas em `committing` ou `rollingBack` são convertidas para `interrupted`. A tela permite:

- retomar o commit idempotente;
- restaurar o checkpoint anterior;
- inspecionar eventos persistidos antes de decidir.

Uma sessão incompleta impede a criação de outra sessão, evitando duas restaurações concorrentes.

## Rollback integral

O rollback restaura:

- todas as coleções de dados pelo checkpoint anterior;
- filtros do catálogo;
- revisão exata do catálogo;
- histórico exato do catálogo.

Para isso, o repositório de preferências ganhou `replace`, e a store do catálogo ganhou `replaceConfigurationCheckpoint`. O rollback não cria uma falsa restauração linear; ele recompõe precisamente o checkpoint capturado antes da sessão.

## Interface

Foi adicionada a rota `app/restore-session.tsx`, acessível por:

- tela de backup;
- Home quando existe sessão ativa;
- Ajustes.

A interface mostra status, fase, origem, preview agregado, impacto, conflitos, eventos e ações compatíveis com o estado atual.

## Fluxos E2E

Foram adicionados:

- `27-portable-restore-session-preview-discard.yaml`;
- `28-portable-restore-session-resume.yaml`;
- `29-portable-restore-session-commit.yaml`;
- `30-portable-restore-session-rollback.yaml`.

O gate nativo agora conhece 23 fluxos transacionais.

## Validação executada

- regressão APP-02 a APP-13: passou;
- contratos estáticos APP-14: passaram;
- parsing de 318 arquivos TS/TSX: passou;
- typecheck estrito isolado do núcleo: passou;
- typecheck estrito isolado da store da sessão: passou;
- harness com catálogo real: 31/31 asserções;
- commit coordenado: passou;
- retomada idempotente sem duplicação do histórico: passou;
- rollback coordenado: passou;
- localização dos 23 fluxos Maestro: passou.

## Limitações do ambiente

O typecheck integral ficou bloqueado porque a codebase não contém `node_modules`, `expo/tsconfig.base` e os tipos de React, Node e Jest. A suíte Jest não iniciou porque o executável `jest` está ausente.

O gate Android ficou em `BLOCKED` por ausência da árvore de dependências, ADB, Maestro e dispositivo/emulador acessível. Nenhum desses bloqueios foi promovido a sucesso.
