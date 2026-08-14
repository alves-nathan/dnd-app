# APP-29 — Hardening final e ensaio do release candidate

## Resultado

O APP-29 foi implementado sobre a codebase do APP-28. Os controles locais de desempenho, acessibilidade, segurança, migração, instalação limpa, upgrade e configuração de release foram aprovados. O resultado composto permanece `BLOCKED` porque o APP-28 ainda não foi aprovado na mesma fingerprint da codebase com dependências completas, Jest, typecheck e dispositivo Android.

## Alterações principais

### Migrações persistidas

Foram adicionadas migrações explícitas para:

- presets de builds, agora versionados em v1;
- distribuição do catálogo v1 → v2;
- sessão de atualização do catálogo v1 → v2.

Presets, manifestos, downloads, cache, evidências e recibos históricos compatíveis são preservados. Uma sessão de atualização v1 em andamento é descartada deliberadamente porque não possui os checkpoints de confiança e transparência introduzidos posteriormente.

### Desempenho

O benchmark usa o bundle real `runtime-bundle-v4.8.0.json`:

- 10.548.880 bytes;
- 5.841 entidades;
- 15.385 dependências;
- parse p95: 46,89 ms no Node deste ambiente;
- SHA-256 p95: 15,50 ms;
- código runtime TS/TSX/JS: 3.250.796 bytes.

Todos os orçamentos sentinela foram aprovados.

### Acessibilidade

Foram reforçados rótulos, dicas e foco explícito em:

- navegação inferior;
- cartões clicáveis;
- criação de personagem;
- expansor de ferramentas e dados.

Os alvos permanecem com altura mínima entre 48 e 58 px.

### Segurança

O scanner confirmou:

- nenhuma chave privada no pacote;
- nenhuma URL HTTP no runtime;
- nenhuma execução dinâmica por `eval` ou `new Function`;
- nenhuma permissão Android adicional;
- nenhuma operação de release com `automaticExecution: true`;
- seed E2E desabilitado por padrão;
- runtimeVersion vinculado à versão do aplicativo.

### Release candidate

O novo contrato `dnd-combat-app29-release-candidate.v1` vincula:

- fingerprint da codebase;
- SHA-256 do lockfile;
- controles APP-29;
- evidência APP-28;
- artefatos de desempenho, segurança, migração e ensaio.

O APP-29 exige 83 fluxos transacionais Android. O projeto contém 86 arquivos Maestro no total.

## Validação

- regressão herdada: 206 verificações;
- verificações APP-29: 10/10;
- acumulado: 216;
- TypeScript/TSX sintático: 377/377;
- harness: 20/20;
- ensaio de instalação/upgrade: 12/12;
- stores e migrações auditadas: 8/8;
- fluxos transacionais localizados: 79/79;
- material criptográfico privado: nenhum.

## Bloqueio restante

A evidência final APP-29 possui status `BLOCKED`. O ambiente não possui a árvore completa de dependências, ADB, Maestro ou dispositivo Android. O APP-28 também precisa ser repetido porque a fingerprint mudou com as correções do APP-29.

Ordem para concluir no ambiente proprietário:

```bash
npm run app28:dependencies:install
npm run app28:gate
npm run app28:gate:verify
npm run app29:linear
npm run app29:gate
npm run app29:gate:verify
```

Nenhum bloqueio foi convertido em aprovação.
