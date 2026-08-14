# APP-26 — Verificador independente e pacote de auditoria externa

## Objetivo

Permitir que o diário operacional criado no APP-25 seja exportado, verificado e comparado fora do aplicativo sem carregar stores React Native e sem conceder ao pacote importado qualquer capacidade de execução, configuração ou rollback.

## Implementação

### Pacote agregado de auditoria

Foi criado `src/catalog/catalogOperationalAudit.ts` com o schema `dnd-catalog-operational-audit-package.v1`.

O pacote pode transportar:

- arquivos históricos do diário;
- segmento ativo;
- recibos e evidências encerradas;
- autorizações operacionais;
- confirmações dos executores;
- políticas, relatórios, aprovações e decisões de quórum;
- publicações assinadas;
- registro público de confiança.

O pacote possui checksum SHA-256 próprio e identifica a origem somente por hash opaco do dispositivo.

### Verificação independente

O verificador confirma:

- checksum do pacote;
- continuidade de todos os segmentos;
- ausência de lacunas e sobreposições;
- cadeia de hashes dos arquivos e do diário ativo;
- integridade dos recibos e evidências;
- vínculo recibo → autorização → decisão de quórum → relatório consolidado;
- vínculo recibo → confirmação do executor;
- assinatura da publicação, política, relatório, aprovações, autorização e executor quando o registro de confiança está incluído;
- unicidade dos nonces operacionais.

Os achados possuem códigos específicos, incluindo `AUDIT_SEGMENT_MISSING`, `AUDIT_SEGMENT_OVERLAP`, `AUDIT_NONCE_REPLAY` e `AUDIT_CRYPTOGRAPHIC_CHAIN_INVALID`.

### CLI sem dependência do aplicativo

Foram adicionados:

```bash
node scripts/verify-catalog-operational-audit.js --input pacote.json --output verificacao.json
node scripts/verify-catalog-operational-audit.js --input dispositivo-a.json --compare dispositivo-b.json
node scripts/sign-catalog-operational-audit-report.js --input pacote.json --private-key auditor.jwk.json --publisher-id auditor --key-id chave --output relatorio.json
```

A CLI usa somente Node.js e o núcleo TypeScript do domínio. Ela não inicializa React Native, Zustand, SQLite ou qualquer store do aplicativo.

### Comparação entre dispositivos

Dois pacotes podem ser classificados como:

- `identical`;
- `leftAhead`;
- `rightAhead`;
- `forked`;
- `unrelated`.

A comparação informa o prefixo comum e a primeira sequência divergente.

### Relatório assinado

Foi criado `dnd-catalog-operational-audit-report.v1`.

O relatório assinado fica vinculado ao checksum exato do pacote, status calculado, códigos dos achados, intervalo de sequências e head final. Alterar qualquer dado invalida a assinatura ou a comparação independente.

### Importação somente leitura

A nova store `catalogOperationalAuditStore.ts` mantém pacotes importados separadamente. O registro usa `readOnly: true` e não expõe métodos para alterar catálogo, personagens, rollout, autorizações ou sessões.

### Retenção de longo prazo

Foi criado `dnd-catalog-operational-audit-retention-policy.v1`.

A política padrão:

- mantém evidências por pelo menos 2.555 dias;
- nunca autoriza exclusão automática de evidências;
- recomenda arquivamento quando o diário ativo excede 1.000 entradas;
- mantém 800 entradas recentes depois do arquivamento;
- exige exportação verificada antes de qualquer exclusão manual futura.

### Interface

Foi adicionada `app/catalog-operational-audit.tsx`, acessível por Ajustes e pelo diário operacional.

A tela permite exportar o pacote local, importar pacotes somente para auditoria, comparar origens, validar relatórios assinados e consultar a política de retenção.

## Persistência

Foi criada uma store independente na versão 1:

- `importedAudits`;
- eventos de auditoria;
- relatórios assinados associados.

Nenhuma migração da store operacional APP-25 foi necessária.

## Validação

- regressão herdada: 194 verificações;
- verificações APP-26: 4/4;
- total acumulado: 198;
- TypeScript/TSX sintático: 369/369;
- typecheck estrito isolado do núcleo: PASS;
- typecheck estrito isolado da store: PASS;
- typecheck estrito isolado do teste: PASS;
- harness: 48/48;
- verificação CLI: PASS;
- assinatura e validação CLI do relatório: PASS;
- 71 fluxos Maestro encontrados;
- scanner de material privado: PASS.

O harness confirmou cadeia criptográfica completa, rejeição de adulteração, lacuna, sobreposição, replay e bifurcação, além de relatório assinado e retenção sem exclusão automática.

## Limitações do ambiente

O typecheck integral e Jest continuam bloqueados porque `node_modules` não está disponível e o registry interno não fornece `zustand@5.0.14`. A execução Android continua bloqueada por ausência de ADB, Maestro e dispositivo conectado.

## Roadmap fechado

Após o APP-26 restam quatro etapas planejadas:

1. APP-27 — federação de auditoria e testemunhas independentes;
2. APP-28 — fechamento do gate integral em ambiente nativo real;
3. APP-29 — hardening final e ensaio do release candidate;
4. APP-30 — release de produção e entrega operacional.
