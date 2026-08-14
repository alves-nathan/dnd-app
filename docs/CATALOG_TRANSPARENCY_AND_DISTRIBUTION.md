# Transparência e distribuição segura do catálogo

## Objetivo

A assinatura do bundle comprova quem assinou um arquivo, mas não detecta sozinha se um servidor omitiu uma atualização, apresentou uma versão antiga ou criou históricos diferentes para dispositivos distintos. O APP-19 adiciona um registro append-only local e mecanismos para comparar esse registro com uma publicação externa assinada.

## Registro append-only

Cada bundle aceito gera uma folha com:

- publicador e chave;
- sequência;
- checksum canônico do catálogo;
- versão e snapshot;
- checksum do bundle anterior;
- data de aceitação.

As folhas formam uma árvore Merkle. O recibo da atualização guarda a raiz, o índice e a prova de inclusão. A retomada de um commit é idempotente e não duplica a mesma folha.

## Provas

- **Inclusão:** comprova que um bundle pertence a uma raiz específica.
- **Consistência:** comprova que um registro maior preserva integralmente o prefixo já observado.
- **Comparação:** classifica os registros como idênticos, remoto adiante, local adiante ou bifurcado.

`localAhead` é tratado como possível rollback do servidor. `forked` é tratado como possível omissão ou equivocation.

## Manifesto remoto assinado

O manifesto `dnd-catalog-remote-manifest.v1` anuncia:

- última sequência publicada;
- checksum, versão e snapshot;
- raiz e tamanho do registro público;
- URL opcional para download.

Importar o manifesto não baixa e não aplica o catálogo. Ele apenas informa o estado publicado e restringe os bundles que poderão entrar no preview.

Para assinar um manifesto:

```bash
npm run catalog:manifest:sign -- \
  --private-key /caminho/offline/root-private.jwk \
  --publisher-id dnd-combat-official \
  --key-id root-2026-01 \
  --sequence 1 \
  --catalog-checksum <sha256> \
  --catalog-version 4.8.1 \
  --snapshot-id <snapshot> \
  --log-id catalog-transparency-dnd-combat-official \
  --log-size 1 \
  --log-root <merkle-root> \
  --out remote-manifest-4.8.1.json
```

## Portabilidade da confiança

A exportação `dnd-catalog-trust-portable.v1` inclui o registro de publicadores, logs de transparência e políticas de recuperação.

A importação direta:

- rejeita checksums adulterados;
- rejeita logs atrás do estado local;
- rejeita bifurcações;
- permite avanço consistente de âncoras oficiais sem trocar as chaves;
- bloqueia troca de raiz, chave ou status oficial;
- preserva conflitos comunitários para revisão manual.

## Recuperação em quórum

A recuperação crítica utiliza `dnd-catalog-recovery-policy.v1` e `dnd-catalog-recovery-statement.v1`.

Regras mínimas:

- quórum de pelo menos duas aprovações independentes;
- fingerprints dos aprovadores conferidos previamente;
- assinaturas distintas sobre o mesmo documento;
- nonce único;
- substituição revoga a chave ativa anterior;
- evento permanente na auditoria.

A recuperação não apaga o registro de transparência e não remove recibos anteriores.

## Verificação operacional do log

```bash
npm run catalog:transparency:log -- verify --log public-log.json
npm run catalog:transparency:log -- compare --local local-log.json --remote public-log.json
```

## Limites de segurança

- O cliente não consulta automaticamente um servidor; o manifesto e o registro são importados explicitamente.
- A prova de consistência portátil inclui os hashes do prefixo. Ela prioriza auditabilidade e simplicidade, não tamanho mínimo.
- A segurança operacional ainda depende de armazenamento offline das chaves privadas e distribuição independente dos fingerprints.
- Uma revisão criptográfica externa continua recomendada antes de usar o sistema como fronteira de segurança crítica.
