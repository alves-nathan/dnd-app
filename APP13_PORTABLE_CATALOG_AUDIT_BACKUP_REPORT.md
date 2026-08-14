# APP-13 — Backup portátil do catálogo e da auditoria

## Objetivo

Ampliar o backup existente para transportar, em um único arquivo verificável, os dados de personagens e builds, a configuração do catálogo, sua auditoria transacional e os planos de remediação preventiva, sem sobrescrever silenciosamente o estado local durante a importação.

## Contratos

### Backup principal

- Schema atual: `dnd-combat-character-backup.v3`.
- Backups `v1` e `v2` continuam aceitos.
- O contrato v3 usa `backupKind: portable-user-data` quando contém a seção do catálogo.
- A integridade FNV-1a do backup cobre também a seção `catalogAudit`.

### Auditoria portátil

- Schema: `dnd-portable-catalog-audit.v1`.
- Registra versão e snapshot do catálogo, revisão, filtros, até 50 commits preservados e planos de remediação relacionados.
- O histórico possui checksum próprio, independente do checksum do arquivo completo.

## Exportação

A tela de backup agora pode incluir:

- personagens e rotações;
- cenários;
- presets;
- histórico de builds;
- filtros do catálogo;
- revisão e histórico de configuração;
- planos preventivos e diagnósticos em andamento.

Quando IDs de personagens são informados, somente planos relacionados às fichas selecionadas são incluídos.

## Validação da importação

Antes da restauração, o APP-13 valida:

- schema do arquivo e da seção do catálogo;
- checksum do backup completo;
- checksum do histórico do catálogo;
- commits estruturalmente válidos;
- IDs e revisões duplicados;
- monotonicidade das revisões;
- continuidade entre `afterState` e `beforeState` de revisões consecutivas;
- coerência entre revisão declarada e último commit;
- planos duplicados ou inválidos;
- personagens referenciados pelos planos;
- migração segura de IDs removidos entre versões do catálogo.

## Comparação local × backup

A auditoria é classificada como:

- `identical`;
- `incomingAhead`;
- `localAhead`;
- `diverged`;
- `catalogMismatch`.

O preview informa commits compartilhados, exclusivos e conflitantes, além de diferenças por livro, categoria, entidade e plano de remediação.

## Importação como nova transação

Os filtros do backup nunca são aplicados diretamente.

1. A restauração prepara uma alteração pendente no `catalogStore`.
2. O usuário é encaminhado ao preview preventivo do gerenciamento de conteúdo.
3. Impacto em personagens e dependências é recalculado no catálogo atual.
4. O reconhecimento continua obrigatório quando houver novos bloqueios.
5. A confirmação cria um novo commit local com origem `import`.

O histórico do backup é preservado dentro de `portableImport.sourceHistory`, com checksum, revisão e snapshot de origem. Ele não substitui nem reordena a linha histórica local.

## Planos preventivos

- Planos acompanham o remapeamento de IDs dos personagens importados.
- O fingerprint-base é recalculado para a ficha restaurada.
- Planos locais com o mesmo personagem são preservados.
- Conflitos são relatados e o plano do backup não sobrescreve o plano local.
- O contexto preventivo, incluindo entidades, livros e categorias afetados, permanece intacto.

## Interface

Foram atualizadas:

- `app/backup.tsx` — exportação v3, validação, comparação e restauração;
- `app/content-management.tsx` — preview da auditoria importada;
- `app/catalog-history.tsx` — exibição da auditoria de origem dentro do commit local;
- `app/e2e-seed.tsx` — fixtures determinísticas de importação e conflito.

## E2E e gate nativo

Novos fluxos Maestro:

1. exportar backup portátil;
2. visualizar o preview da importação;
3. cancelar a importação;
4. preservar conflitos de auditoria.

O gate nativo reconhece agora 19 fluxos.

## Validação executada

- smoke suite APP-02 a APP-13: PASS;
- parsing TypeScript: 313/313;
- typecheck estrito isolado do núcleo: PASS;
- typecheck estrito isolado do teste: PASS;
- harness APP-13: 27/27 asserções;
- catálogo real: 5.841 entidades e 15.385 dependências;
- quatro arquivos Maestro APP-13 encontrados;
- gate nativo: BLOCKED por pré-requisitos ambientais ausentes.

## Limitação do ambiente

O typecheck integral e Jest foram solicitados, mas `node_modules` não está disponível. O ambiente não possui `expo/tsconfig.base`, tipos de React/Node/Jest nem o executável `jest`. ADB, Maestro e dispositivo Android também não estão disponíveis. Nenhum bloqueio foi convertido em aprovação.
