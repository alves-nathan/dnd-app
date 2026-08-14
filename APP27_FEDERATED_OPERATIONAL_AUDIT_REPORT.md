# APP-27 — Federação de auditoria e testemunhas independentes

## Objetivo

Permitir que pacotes de auditoria operacional produzidos por dispositivos diferentes sejam testemunhados por identidades criptográficas independentes e reunidos em um consenso verificável sobre o head do diário, sem conceder ao pacote federado capacidade de execução, configuração ou rollback.

## Implementação

### Política de testemunhas

Foi criado o schema `dnd-catalog-operational-witness-policy.v1`.

A política é assinada por uma autoridade confiável e define:

- quantidade mínima de dispositivos;
- quantidade mínima de testemunhas por pacote;
- idade máxima dos testemunhos;
- lista exata de testemunhas e chaves autorizadas;
- validade temporal da política.

As regras mínimas são conservadoras:

- pelo menos dois dispositivos;
- pelo menos duas testemunhas independentes por pacote;
- nenhuma testemunha pode compartilhar chave ou identidade;
- a autoridade da política não pode atuar como testemunha da mesma federação.

### Testemunho independente

Foi criado o schema `dnd-catalog-operational-witness-statement.v1`.

Cada testemunho fica vinculado ao:

- ID e checksum do pacote auditado;
- hash opaco do dispositivo de origem;
- resultado calculado pelo verificador independente;
- primeira e última sequência;
- head do diário;
- identidade e chave da testemunha;
- hash opaco do dispositivo da testemunha;
- janela temporal da declaração.

Uma testemunha não pode atestar o próprio dispositivo de origem.

### Pacote federado

Foi criado `dnd-catalog-operational-federation-package.v1`.

O pacote reúne:

- política assinada;
- pacotes de auditoria do APP-26;
- testemunhos assinados;
- checksum SHA-256 próprio.

Pacotes duplicados, dispositivos duplicados e testemunhos duplicados são rejeitados.

### Consenso verificável

Foi criado `dnd-catalog-operational-federation-consensus.v1`.

O consenso registra:

- dispositivos participantes;
- testemunhas únicas;
- quorum por pacote;
- comparações entre todos os pares de dispositivos;
- prefixo comum;
- pacote e head canônicos;
- achados e checksum próprio.

Os estados possíveis são:

- `approved`;
- `warning`;
- `rejected`.

Bifurcação, cadeias não relacionadas, quorum insuficiente, testemunho expirado, testemunha não independente ou adulteração produzem rejeição.

### Importação somente leitura

Foi criada a store `catalogOperationalFederationStore.ts`, versão 1.

Registros importados usam `readOnly: true` e não expõem ações para:

- alterar catálogo;
- alterar personagens;
- mudar rollout ou canal;
- executar autorizações;
- iniciar rollback.

### Interface

Foi adicionada a rota:

```text
app/catalog-operational-federation.tsx
```

Ela permite:

- importar e validar uma federação;
- consultar dispositivos, testemunhas e head;
- comparar consensos importados;
- compartilhar o consenso;
- acessar as ferramentas independentes.

A tela está disponível por Ajustes e pela auditoria operacional externa.

## Ferramentas operacionais

Foram adicionados:

```bash
npm run catalog:operation:witness:policy:sign
npm run catalog:operation:witness:sign
npm run catalog:operation:federation:create
npm run catalog:operation:federation:verify
npm run catalog:operation:federation:check
npm run catalog:operation:federation:harness
npm run app27:linear
```

O guia operacional está em `docs/CATALOG_OPERATIONAL_FEDERATION.md`.

## Validação

- regressão herdada: 198 verificações;
- verificações do APP-27: 4/4;
- total acumulado: 202 verificações;
- parsing sintático TypeScript/TSX: 373/373;
- typecheck estrito isolado do núcleo: PASS;
- typecheck estrito isolado da store: PASS;
- typecheck estrito isolado do teste: PASS;
- harness: 28/28 asserções;
- assinatura e verificação pelas CLIs: PASS;
- definições Maestro encontradas pelo gate: 75/75;
- scanner de material criptográfico privado: PASS.

O harness confirmou:

- consenso aprovado com dois dispositivos e duas testemunhas;
- mesmo head observado por dispositivos diferentes;
- quorum independente por pacote;
- rejeição de testemunho adulterado;
- rejeição de quorum insuficiente;
- rejeição de testemunha não independente;
- rejeição de autotestemunho;
- rejeição de bifurcação;
- rejeição de testemunho antigo;
- rejeição de dispositivo duplicado;
- rejeição de pacote federado adulterado.

## Limitações do ambiente

A instalação determinística permanece bloqueada porque o registry interno retorna 404 para `zustand@5.0.14`.

Por isso:

- o typecheck integral não encontrou `expo/tsconfig.base` e os tipos de React, Node e Jest;
- Jest não iniciou por ausência do executável;
- o gate Android não executou por ausência de ADB, Maestro e dispositivo ou emulador.

Nenhum bloqueio ambiental foi convertido em aprovação.

## Roadmap restante

Depois do APP-27 restam três etapas planejadas:

1. APP-28 — fechamento do gate integral em ambiente nativo real;
2. APP-29 — hardening final e ensaio do release candidate;
3. APP-30 — release de produção e entrega operacional.
