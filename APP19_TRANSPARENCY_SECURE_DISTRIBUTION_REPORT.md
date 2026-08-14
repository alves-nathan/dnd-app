# APP-19 — Registro de transparência e distribuição segura de atualizações

## Objetivo

Adicionar uma segunda camada de segurança sobre as assinaturas criptográficas do APP-18. Uma assinatura individual comprova a origem de um bundle, mas não impede que um servidor apresente versões antigas, omita publicações ou entregue históricos diferentes a dispositivos distintos. O APP-19 registra os bundles aceitos em uma estrutura append-only, compara essa estrutura com manifestos públicos assinados e exige quórum para recuperação de confiança.

## Registro append-only

Foi criado `src/catalog/catalogTransparency.ts` com o schema:

- `dnd-catalog-transparency-log.v1`.

Cada entrada preserva:

- publicador;
- sequência;
- checksum canônico do catálogo;
- versão e snapshot;
- chave usada;
- checksum do bundle anterior;
- data de aceitação;
- hash da folha.

As folhas formam uma árvore Merkle determinística. O estado vazio também possui uma raiz SHA-256 definida.

A anexação é idempotente: uma retomada de commit que encontre a mesma sequência e o mesmo checksum reutiliza a entrada já registrada em vez de duplicá-la.

## Provas criptográficas

Foram implementadas:

- prova de inclusão de uma folha;
- verificação da prova de inclusão;
- prova de consistência entre duas alturas do log;
- verificação da prova de consistência;
- comparação entre logs locais e públicos.

A comparação classifica o resultado como:

- `identical`;
- `remoteAhead`;
- `localAhead`;
- `forked`.

`localAhead` é tratado como possível rollback do servidor. `forked` é tratado como possível omissão, substituição ou bifurcação do histórico.

## Manifesto remoto assinado

Foi criado o schema:

- `dnd-catalog-remote-manifest.v1`.

O manifesto anuncia a última sequência, checksum, versão, snapshot, raiz e tamanho do log público. Sua assinatura é validada contra o registro de confiança do APP-18.

A importação do manifesto:

- não baixa o catálogo;
- não inicia preview automaticamente;
- não altera filtros;
- não altera personagens;
- não altera o runtime ativo.

Ela apenas registra o estado remoto observado e restringe os bundles que poderão ser preparados posteriormente.

O cliente rejeita:

- manifesto anterior ao estado local;
- raiz divergente na mesma altura;
- checksum diferente para a mesma sequência;
- assinatura inválida;
- manifesto expirado;
- publicador ou chave não confiável.

## Integração com a atualização transacional

`catalogUpdateSessionStore` agora:

1. valida a assinatura do APP-18;
2. consulta a política de transparência conhecida;
3. bloqueia bundles incompatíveis com o manifesto remoto;
4. inclui o estado de transparência no checkpoint;
5. anexa o bundle ao log somente durante o commit coordenado;
6. grava a prova de inclusão no recibo da atualização;
7. restaura o log anterior durante rollback.

O recibo `dnd-catalog-update-receipt.v1` permanece retrocompatível e ganhou o campo opcional `transparency`.

## Portabilidade da confiança

Foi criado:

- `dnd-catalog-trust-portable.v1`.

O documento transporta:

- registro de publicadores;
- logs de transparência;
- políticas de recuperação;
- checksum próprio.

A importação:

- rejeita adulteração;
- rejeita logs atrasados;
- rejeita bifurcações;
- permite avanço consistente de âncoras oficiais;
- não permite trocar raízes, chaves ou status oficiais;
- preserva conflitos de publicadores comunitários para revisão manual.

## Recuperação em quórum

Foram criados:

- `dnd-catalog-recovery-policy.v1`;
- `dnd-catalog-recovery-statement.v1`.

A política exige quórum mínimo de duas aprovações independentes. Cada aprovação é validada por fingerprint e assinatura P-256. Uma recuperação aceita:

- restaura o publicador;
- pode instalar uma chave substituta;
- revoga a chave ativa anterior;
- preserva o log e os recibos;
- adiciona um evento permanente à auditoria.

Importações diretas nunca substituem uma raiz oficial. Essa operação exige uma declaração de recuperação em quórum.

## Interface

Foi adicionada a rota:

- `app/catalog-transparency.tsx`.

A tela permite:

- visualizar logs locais e raízes Merkle;
- importar manifesto remoto assinado;
- comparar um log público com o log local;
- exportar ou importar o registro de confiança;
- configurar política de recuperação;
- aplicar recuperação em quórum;
- revisar eventos de transparência.

A Home mostra um alerta quando um manifesto assinado anuncia atualização. Ajustes possui acesso direto a **Transparência e distribuição**.

## Ferramentas operacionais

Foram adicionados:

- `npm run catalog:manifest:sign`;
- `npm run catalog:transparency:log`;
- `npm run catalog:transparency:check`;
- `npm run catalog:transparency:harness`;
- `npm run app19:linear`.

O guia operacional está em `docs/CATALOG_TRANSPARENCY_AND_DISTRIBUTION.md`.

## Testes E2E

Foram adicionados quatro fluxos Maestro:

1. inconsistência/bifurcação do log;
2. omissão ou rollback remoto;
3. recuperação de confiança em quórum;
4. manifesto remoto sem aplicação automática.

O gate reconhece agora 43 fluxos.

## Validação

Passaram:

- regressão linear APP-02 a APP-19: 40/40;
- parsing TS/TSX: 339/339;
- typecheck estrito isolado do núcleo;
- typecheck estrito isolado da store;
- typecheck estrito isolado do coordenador de atualização;
- harness APP-19: 32/32;
- geração de chave por CLI;
- assinatura de manifesto remoto por CLI;
- integridade dos contratos estáticos.

O harness confirmou inclusão, consistência, idempotência, rollback remoto rejeitado, omissão rejeitada, documento portátil adulterado rejeitado e recuperação com duas aprovações.

## Limitações do ambiente

O registry interno não contém `zustand@5.0.14`, impedindo a restauração integral de `node_modules` sem alterar o lockfile.

Por isso:

- o typecheck integral não encontrou a base Expo e os tipos de Jest, Node e React;
- a suíte Jest não iniciou;
- o gate Android não executou por ausência de ADB, Maestro e dispositivo.

Nenhum desses bloqueios foi convertido em aprovação.

## Próximo lote sugerido

**APP-20 — publicação remota resiliente e sincronização offline verificável**

O lote pode incluir cache de múltiplos mirrors, resolução de indisponibilidade, download em blocos com retomada, verificação de conteúdo antes de materializar o bundle, pinagem opcional de endpoints, política de atualização manual/assistida e evidências de disponibilidade sem aplicação automática.
