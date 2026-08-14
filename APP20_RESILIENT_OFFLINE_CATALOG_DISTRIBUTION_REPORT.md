# APP-20 — Publicação remota resiliente e sincronização offline verificável

## Objetivo

Separar a disponibilidade remota do catálogo de sua aplicação transacional. O APP-20 permite obter um envelope assinado por múltiplos mirrors, interromper e retomar o download em blocos, verificar cada bloco antes de persistir, materializar o bundle somente após a validação integral e encaminhá-lo ao preview do APP-17 sem substituir automaticamente o catálogo ativo.

## Manifesto de distribuição assinado

Foi criado `src/catalog/catalogDistribution.ts` com o schema:

- `dnd-catalog-distribution-manifest.v1`.

O manifesto preserva:

- publicador e chave;
- sequência e checksum anterior;
- versão e snapshot;
- checksum canônico do catálogo;
- checksum do envelope completo;
- tamanho em caracteres e bytes;
- limites e SHA-256 de cada bloco;
- pelo menos dois mirrors HTTPS;
- prioridade assinada dos mirrors;
- endpoint de status e template de download por bloco;
- data de emissão, validade opcional e assinatura ECDSA P-256.

A validação é executada antes de qualquer acesso aos mirrors. São rejeitados manifestos com assinatura inválida, chave revogada, chave fora do período de validade, sequência incorreta, quebra da âncora local, divergência do manifesto remoto do APP-19, layout de blocos inválido, URLs não HTTPS ou menos de dois mirrors.

## Mirrors e proteção contra inconsistência

Cada mirror publica um documento de disponibilidade:

- `dnd-catalog-mirror-status.v1`.

O status é comparado ao manifesto assinado. O cliente classifica cada mirror como:

- `available`;
- `unavailable`;
- `stale`;
- `conflicting`.

Somente mirrors `available`, observados recentemente e com sequência, checksums, tamanho e quantidade de blocos idênticos ao manifesto entram no ranking. A prioridade assinada prevalece; a latência é usada apenas como desempate. Mirrors atrasados ou conflitantes nunca são usados como fallback.

## Download em blocos e retomada

Foi criado `src/catalog/catalogDownloadCoordinator.ts` com uma máquina de download independente de interface e store.

A sessão utiliza:

- `dnd-catalog-download-session.v1`.

Ela preserva:

- manifesto e bundle vinculados;
- blocos concluídos;
- bytes verificados;
- mirror atual e mirrors utilizados;
- quantidade de retomadas;
- tentativas;
- rede observada;
- último erro;
- estado preparado, baixando, pausado, verificado, falho ou cancelado.

Antes de retomar, todos os blocos marcados como concluídos são relidos e revalidados. Blocos ausentes ou alterados deixam de contar como concluídos e são baixados novamente.

Quando um mirror falha em um bloco, o coordenador tenta os demais mirrors consistentes. Se todos falharem, a sessão é pausada e permanece retomável. A retomada é idempotente e não duplica blocos já verificados.

## Cache offline

Foi criado `src/storage/catalogDownloadCacheRepository.ts` com o índice:

- `dnd-catalog-download-cache.v1`.

O repositório mantém separadamente:

- sessões;
- manifestos;
- blocos;
- bundles verificados;
- evidências de download.

O conteúdo parcial nunca é disponibilizado como bundle. A materialização somente ocorre quando todos os blocos estão presentes e íntegros.

Antes de entrar no cache offline, o sistema valida novamente:

1. tamanho completo;
2. checksum do envelope;
3. assinatura do envelope do APP-18;
4. publicador e chave;
5. sequência;
6. checksum canônico do catálogo;
7. versão e snapshot.

Ao abrir o cache para preparar uma atualização, o checksum completo e a evidência são validados novamente.

## Evidência de download

Cada bundle verificado gera:

- `dnd-catalog-download-evidence.v1`.

A evidência registra:

- sessão;
- sequência;
- versão e snapshot;
- checksums;
- bytes e blocos;
- mirrors utilizados;
- quantidade de retomadas;
- tipo de rede observado;
- confirmação da verificação offline;
- checksum próprio.

Alterações posteriores invalidam a evidência.

## Política de rede

Foi adicionada uma política persistida com:

- modo manual ou assistido;
- permissão para dados móveis;
- permissão para roaming;
- tratamento de rede não classificada;
- limite máximo para download assistido;
- revalidação obrigatória do cache antes do uso.

O modo manual exige ação explícita. O modo assistido continua bloqueado quando a rede não atende à política. Nenhuma configuração inicia a aplicação automática do catálogo.

## Integração com atualização transacional

A ação **Abrir preview transacional** relê o bundle do cache e chama o fluxo existente do APP-17 com o checksum do envelope.

O APP-17 continua responsável por:

- validar novamente confiança e transparência;
- calcular diff;
- calcular impacto nas fichas;
- exigir reconhecimentos;
- migrar snapshots explicitamente;
- executar commit e rollback.

Portanto, download concluído não equivale a atualização aplicada.

## Interface

Foi adicionada a rota:

- `app/catalog-distribution.tsx`.

Ela permite:

- configurar política de rede;
- importar manifesto assinado;
- verificar mirrors;
- iniciar, pausar, retomar ou cancelar download;
- consultar progresso por blocos e bytes;
- visualizar mirrors utilizados;
- consultar cache offline;
- encaminhar um cache ao preview transacional;
- remover bundles locais;
- compartilhar evidências.

A tela está acessível por Ajustes e pela tela de Transparência. A Home mostra alertas para downloads interrompidos e bundles disponíveis offline.

## Ferramentas operacionais

Foi adicionado:

- `npm run catalog:distribution:sign`;
- `npm run catalog:distribution:check`;
- `npm run catalog:distribution:harness`;
- `npm run app20:linear`.

O gerador de manifesto está em:

- `scripts/sign-catalog-distribution-manifest.js`.

O guia operacional está em:

- `docs/CATALOG_RESILIENT_DISTRIBUTION.md`.

A ferramenta foi exercitada com o envelope real do catálogo 4.8.0, produzindo 81 blocos para 10.549.386 bytes e dois mirrors assinados.

## Testes E2E

Foram adicionados quatro fluxos Maestro:

1. interrupção de download;
2. retomada de blocos;
3. mirror inconsistente;
4. uso do bundle verificado offline.

O gate reconhece agora 47 fluxos transacionais.

## Validação

Passaram:

- linha de base herdada do APP-19: 40 verificações;
- passagem linear atual: 26/26 verificações;
- parsing TS/TSX: 345/345;
- typecheck estrito isolado do núcleo;
- typecheck estrito isolado do coordenador;
- typecheck estrito isolado do repositório;
- typecheck estrito isolado da store;
- typecheck estrito isolado do teste;
- contratos APP-20;
- harness APP-20: 41/41;
- assinatura CLI do envelope real;
- integridade do layout dos 81 blocos;
- localização dos 47 fluxos Maestro.

O harness confirmou interrupção persistida, retomada após reinício, fallback real do mirror A para o mirror B, rejeição de mirror atrasado, rejeição de mirror conflitante, política de rede, revalidação de blocos, materialização offline, assinatura do envelope e rejeição de evidência adulterada.

## Limitações do ambiente

O registry interno não disponibiliza `zustand@5.0.14`. A restauração integral de `node_modules` permaneceu bloqueada sem alterar o lockfile.

Por isso:

- o typecheck integral não encontrou `expo/tsconfig.base` e os tipos de React, Node e Jest;
- a suíte Jest não iniciou porque o executável não está instalado;
- o gate Android não executou por ausência de ADB, Maestro e dispositivo ou emulador.

Nenhum bloqueio ambiental foi convertido em aprovação.

## Próximo lote sugerido

**APP-21 — canais, rollout gradual e compatibilidade do aplicativo**

O próximo lote pode adicionar canais `stable`, `beta` e `preview`, versão mínima e máxima do aplicativo, rollout percentual assinado, coortes determinísticas, notas de versão, pausa ou retirada assinada de uma publicação, escolha explícita de canal, migração entre canais e evidências de elegibilidade sem aplicação automática.
