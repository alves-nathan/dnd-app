# APP-15 — Verificação pós-restauração e recibo de integridade

## Objetivo

Fechar a sessão transacional do APP-14 com uma etapa obrigatória de verificação do estado efetivamente persistido. A restauração deixa de poder ser simplesmente encerrada após o commit: o aplicativo compara o estado real com a projeção, diagnostica referências e planos, gera um recibo verificável e mantém o checkpoint disponível para rollback seguro.

## Contratos introduzidos

- verificação: `dnd-portable-restore-verification.v1`;
- recibo: `dnd-portable-restore-integrity-receipt.v1`;
- pacote de evidências: `dnd-portable-restore-evidence.v1`;
- store da sessão de restauração: versão `2`;
- store de personagens preservada na versão `23`.

## Verificação pós-restauração

O commit coordenado agora executa automaticamente uma verificação global. Também é possível repeti-la manualmente após uma correção.

A verificação compara:

- fingerprint efetivo dos personagens, drafts, planos, cenários, presets e snapshots;
- fingerprint projetado pela sessão;
- filtros efetivos do catálogo;
- filtros projetados;
- existência do commit de catálogo vinculado à sessão.

Também diagnostica:

- IDs duplicados de personagens;
- drafts de progressão órfãos;
- planos de remediação sem personagem correspondente;
- planos armazenados sob chave incompatível;
- estados de recuperação que apontam para fichas inexistentes;
- registros de quarentena;
- fichas bloqueadas ou em revisão pelo manifesto de compatibilidade;
- indisponibilidade do catálogo ou da ponte de escolhas durante a validação.

## Estados da verificação

- `passed`: nenhuma divergência ou aviso; o recibo é gerado imediatamente;
- `warning`: não há erro bloqueante, mas os avisos precisam ser reconhecidos explicitamente;
- `failed`: existe divergência ou referência inválida; o encerramento permanece bloqueado.

Uma verificação posterior inválida remove o recibo anterior da sessão ativa, evitando que uma evidência antiga seja reutilizada depois de uma alteração no estado.

## Bloqueio de encerramento

A ação **Encerrar e manter restauração** só é liberada quando:

1. a sessão está em `committed`;
2. a verificação permite encerramento;
3. avisos foram reconhecidos, quando existirem;
4. existe um recibo;
5. o checksum do recibo continua válido.

Em caso de erro, o usuário pode corrigir o estado e executar a verificação novamente ou restaurar integralmente o checkpoint anterior.

## Recibo portátil

O recibo registra:

- sessão e origem do backup;
- checksum de origem;
- fingerprints anterior, projetado e efetivo;
- commit correspondente do catálogo;
- status da verificação;
- reconhecimento de avisos;
- resumo das ocorrências;
- contagens verificadas;
- checksum próprio.

Qualquer alteração em um campo do recibo invalida seu checksum.

## Pacote de evidências

Além do recibo resumido, a interface exporta um JSON com:

- recibo íntegro;
- verificação completa;
- conflitos e reconhecimentos;
- eventos persistidos da sessão;
- vínculo com o catálogo;
- fingerprints;
- checksum independente do pacote.

O pacote só pode ser criado quando o recibo interno também é válido.

## Arquivamento e rollback reaberto

Sessões encerradas são preservadas em uma lista limitada de cinco sessões completas. O checkpoint não é descartado imediatamente.

Uma sessão arquivada pode ser reaberta para rollback apenas quando:

- não existe outra sessão ativa;
- a sessão arquivada foi confirmada;
- o recibo está presente;
- o checksum do recibo continua válido.

A reabertura é registrada nos eventos da sessão. O rollback continua restaurando todos os dados e a configuração exata do catálogo.

## Interface

A tela de restauração passou a exibir:

- status da verificação;
- fingerprints esperado e efetivo;
- erros e avisos;
- contagem de fichas bloqueadas;
- ação para repetir a verificação;
- reconhecimento de avisos;
- checksum do recibo;
- compartilhamento do recibo;
- compartilhamento das evidências completas;
- sessões encerradas disponíveis para rollback seguro.

## Fluxos E2E

Foram adicionados:

- `31-portable-restore-verification-divergence.yaml`;
- `32-portable-restore-verification-correction.yaml`;
- `33-portable-restore-verification-accept.yaml`;
- `34-portable-restore-receipt-reopen-rollback.yaml`.

O gate nativo agora reconhece 27 fluxos transacionais.

## Validação executada

- regressão linear APP-02 a APP-14: passou;
- contratos estáticos APP-15: passaram;
- parsing de 320 arquivos TS/TSX: passou;
- typecheck estrito isolado do núcleo: passou;
- typecheck estrito isolado da store: passou;
- typecheck estrito isolado dos testes: passou;
- harness com catálogo real: 21/21 asserções;
- detecção de divergência: passou;
- detecção de drafts órfãos: passou;
- reconhecimento de avisos: passou;
- checksum do recibo: passou;
- checksum do pacote de evidências: passou;
- localização de 27 fluxos Maestro: passou.

## Limitações do ambiente

O typecheck integral não pôde ser concluído porque a codebase não contém `node_modules`, `expo/tsconfig.base` e os tipos de React, Node e Jest. A suíte Jest não iniciou porque o executável `jest` está ausente.

O gate Android ficou em `BLOCKED` por ausência da árvore de dependências, ADB, Maestro e dispositivo ou emulador acessível. Todos os 27 fluxos foram localizados. Nenhum bloqueio foi promovido a sucesso.
