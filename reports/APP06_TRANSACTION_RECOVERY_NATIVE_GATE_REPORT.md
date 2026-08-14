# APP-06 — Recuperação transacional e gate nativo de integração

## Objetivo

Tornar as transações de progressão resistentes a encerramento inesperado, reinício do aplicativo, registros persistidos inválidos e alterações concorrentes na ficha publicada. O lote também cria um gate nativo reproduzível para validar commit, descarte, conflito e rollback no Android.

## Resultado

O APP-06 foi implementado sobre a codebase do APP-05. Rascunhos de progressão continuam persistidos pelo Zustand, mas agora passam por uma etapa explícita de reconciliação depois da hidratação. Nenhum rascunho recuperado pode voltar a editar ou confirmar a ficha sem uma ação consciente do usuário.

A implementação diferencia quatro situações:

- **recuperável:** a ficha publicada ainda possui a mesma fingerprint do início da transação;
- **conflitante:** a ficha publicada mudou depois do último checkpoint;
- **órfã:** o personagem associado ao rascunho não existe mais;
- **inválida:** o registro persistido não contém a estrutura mínima esperada.

Rascunhos órfãos ou inválidos são removidos da coleção ativa e transformados em avisos isolados. Rascunhos conflitantes são preservados apenas para inspeção e descarte; não existe mesclagem automática por nome ou por posição de coleção.

## Checkpoints e schema

`CharacterProgressionDraft` passou a possuir:

- `schemaVersion: 1`;
- `recovery.status`;
- `recovery.checkpointSequence`;
- `recovery.lastCheckpointAt`;
- `recovery.detectedAt`;
- `recovery.acknowledgedAt`;
- `recovery.reason`.

Cada mutação no rascunho incrementa o número do checkpoint e registra o mesmo instante em `updatedAt` e `lastCheckpointAt`.

## Reconciliação na hidratação

`src/characters/progressionRecovery.ts` introduz as funções puras:

- `isProgressionDraft`;
- `normalizeProgressionDraft`;
- `reconcileProgressionRecovery`;
- `acknowledgeRecoveredProgressionDraft`;
- `emptyProgressionRecoverySummary`.

A store chama `reconcileProgressionRecovery` por meio de `onRehydrateStorage`. A reconciliação compara `baseFingerprint` com a ficha publicada atual antes de permitir qualquer retomada.

## Proteção contra gravação prematura

`useCharacterProgressionSession` somente expõe `workingCharacter` como personagem editável quando `recovery.status === 'active'`.

Enquanto o rascunho estiver `recoverable` ou `conflicted`:

- os editores não recebem a ficha projetada como sessão ativa;
- chamadas de atualização não são redirecionadas para a ficha publicada;
- o commit recebe um bloqueio explícito;
- uma retomada recuperável exige `acknowledgeProgressionRecovery`.

Foram adicionados os códigos:

- `PROGRESSION_TRANSACTION_RECOVERY_ACK_REQUIRED`;
- `PROGRESSION_TRANSACTION_RECOVERY_CONFLICT`.

## Central de recuperação

A rota `app/progression-recovery.tsx` reúne:

- quantidade de rascunhos recuperáveis;
- quantidade de conflitos;
- registros órfãos ou inválidos;
- checkpoint e horário da última persistência;
- retomada segura;
- abertura de transação ativa;
- descarte sem alterar a ficha;
- remoção de avisos isolados.

A tela está acessível pela Home, pelos Ajustes e pela Central de progressão.

## Migração

A store de personagens passou para a versão **21**.

Drafts criados pelo APP-05 não precisam possuir previamente os campos de recuperação. A reconciliação aceita a estrutura antiga, adiciona `schemaVersion`, inicializa o checkpoint e classifica o estado atual.

## Cenários E2E

Foram adicionados quatro fluxos Maestro:

1. `08-progression-recovery-commit.yaml` — reiniciar, retomar e confirmar;
2. `09-progression-recovery-discard.yaml` — reiniciar e descartar sem alterar a ficha;
3. `10-progression-recovery-conflict.yaml` — detectar alteração concorrente após reinício;
4. `11-progression-rollback.yaml` — reverter o último commit auditado.

A ferramenta interna `app/e2e-seed.tsx` ganhou fixtures determinísticas para os três estados necessários aos fluxos: recuperação, conflito e rollback.

## Gate nativo

`scripts/run-app06-native-gate.js` verifica:

- existência dos quatro fluxos;
- instalação das dependências;
- disponibilidade do ADB;
- dispositivo ou emulador autorizado;
- instalação do pacote `com.nalves.dndcombatmathmvp`;
- disponibilidade do Maestro;
- execução dos quatro fluxos quando chamado com `--execute`.

O gate grava `artifacts/app06-native-gate.json` e nunca converte ausência de ambiente em sucesso. O modo `--allow-blocked` permite gerar diagnóstico sem falhar a smoke suite local.

## Arquivos principais

### Novos

- `src/characters/progressionRecovery.ts`;
- `src/tests/characterProgressionRecovery.test.ts`;
- `app/progression-recovery.tsx`;
- `scripts/check-progression-recovery.js`;
- `scripts/run-app06-runtime-harness.js`;
- `scripts/run-app06-native-gate.js`;
- quatro fluxos Maestro 08–11.

### Alterados

- `src/characters/progressionTransaction.ts`;
- `src/characters/useCharacterProgressionSession.ts`;
- `src/store/characterStore.ts`;
- `src/storage/characterMigrations.ts`;
- `app/characters/[id]/progression.tsx`;
- `app/characters/[id]/index.tsx`;
- `app/index.tsx`;
- `app/settings.tsx`;
- `app/e2e-seed.tsx`;
- `app/_layout.tsx`;
- `package.json`;
- contratos de versões anteriores ajustados para a store v21.

## Validação executada

Passaram:

- shape do projeto;
- contratos mínimos de acessibilidade;
- compêndio incluído com 1.284 itens;
- catálogo v4.8.0 com 5.841 entidades e 15.385 dependências;
- contratos APP-02 a APP-05;
- contratos de recuperação do APP-06;
- parsing sintático de 296 arquivos TS/TSX;
- typecheck estrito isolado do núcleo e teste de recuperação;
- typecheck estrito isolado da store e da sessão transacional;
- harness APP-05 com 24 asserções;
- harness APP-06 com 21 asserções.

O harness APP-06 confirmou:

- schema e checkpoint inicial;
- classificação recuperável após serialização e reinício simulado;
- bloqueio antes da confirmação de retomada;
- commit atômico depois da confirmação;
- incremento do checkpoint;
- isolamento de conflito;
- quarentena de registros órfãos e inválidos.

## Limitações do ambiente atual

A execução integral permanece bloqueada por fatores externos à codebase:

- `npm ci` falhou porque o registry interno retornou 404 para `zustand@5.0.14`;
- o typecheck integral não encontrou `expo/tsconfig.base` nem os tipos de React, Node e Jest;
- o Jest não está instalado;
- ADB não está disponível neste ambiente;
- Maestro não está disponível neste ambiente;
- nenhum dispositivo Android pode ser consultado daqui.

O gate nativo foi executado em modo diagnóstico e retornou **BLOCKED**, preservando os motivos individualmente. Nenhuma dependência foi alterada, rebaixada ou substituída para produzir um sucesso artificial.

## Próximo lote recomendado

**APP-07 — fechamento do gate nativo e estabilização de dependências:** executar `npm ci` em um registry com todas as versões, rodar typecheck e Jest integrais, instalar uma dev/beta build em Android, executar os quatro fluxos Maestro, capturar JUnit/logcat/screenshots e tornar o gate APP-06 obrigatório no build candidate.
