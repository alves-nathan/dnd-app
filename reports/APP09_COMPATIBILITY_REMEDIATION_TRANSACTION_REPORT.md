# APP-09 — Plano de remediação de compatibilidade e commit transacional

## Objetivo

Transformar o diagnóstico somente leitura do APP-08 em um fluxo explícito e seguro para corrigir referências incompatíveis sem aplicar qualquer alteração automática à ficha.

## Resultado

O personagem continua inalterado durante a criação e edição do plano. As decisões são aplicadas apenas depois de um preview completo e de uma confirmação final, em uma única transação auditável e reversível.

## Plano versionado

Foi criado o schema:

`dnd-character-compatibility-remediation.v1`

Cada plano registra:

- personagem e fingerprint da ficha-base;
- snapshot original e snapshot-alvo;
- horário de criação e última alteração;
- uma decisão explícita por ocorrência;
- substituição escolhida, quando aplicável.

Os planos são persistidos na store e sobrevivem ao reinício do aplicativo. A store de personagens foi migrada para a versão 22.

## Decisões suportadas

### Substituir

A referência antiga é removida apenas no personagem projetado. Em seguida, a nova entidade é aplicada pela mesma ponte canônica usada na criação e na progressão.

A substituição precisa:

- estar disponível nos filtros atuais;
- possuir o mesmo tipo mecânico da referência original;
- continuar válida no momento do preview e do commit.

A tela permite pesquisar candidatos oficiais e locais por nome. Os resultados são filtrados pelo mesmo tipo mecânico da ocorrência.

### Remover

A remoção explícita:

- marca o vínculo correspondente como `removed`;
- remove a entidade mecânica associada;
- limpa referências canônicas relacionadas em build choices, feats, spellbook, masteries, companions e pendências;
- registra a remoção como operação de reconciliação.

### Adotar snapshot atual

A divergência de snapshot pode ser resolvida por decisão explícita. O snapshot não é migrado apenas porque o diagnóstico foi aberto.

## Preview de impacto

Antes da confirmação, o motor calcula:

- substituições;
- remoções;
- migrações de snapshot;
- referências antes e depois;
- bloqueios antes e depois;
- caminhos alterados na ficha;
- resumo mecânico de classes, níveis, coleções e pendências;
- novo manifesto de compatibilidade;
- validação estrutural da ficha projetada.

O commit é bloqueado quando:

- a ficha mudou depois da criação do plano;
- o catálogo mudou;
- uma ocorrência bloqueante não possui decisão;
- a referência ou a substituição deixou de existir;
- a substituição está desativada;
- o tipo mecânico não corresponde;
- restam incompatibilidades bloqueantes;
- a ficha projetada viola uma regra estrutural.

## Commit atômico

A confirmação cria uma transação de progressão com o tipo:

`compatibilityRemediation`

A transação contém:

- snapshot integral antes da correção;
- snapshot integral depois da correção;
- operações de substituição, remoção e migração;
- resumo das alterações;
- identificadores canônicos envolvidos.

O personagem publicado só é substituído quando toda a validação passa. O plano persistido é removido apenas depois de um commit bem-sucedido.

## Descarte e rollback

O plano pode ser descartado a qualquer momento sem modificar a ficha.

Depois do commit, o mecanismo de rollback existente restaura o snapshot anterior e adiciona uma nova entrada de auditoria. A transação original não é apagada do histórico.

## Interface

A tela de manifesto agora oferece:

- criação do plano;
- decisão individual por ocorrência;
- busca de substituições;
- remoção explícita;
- adoção explícita do snapshot;
- limpeza de decisões;
- preview de impacto;
- confirmação única;
- descarte seguro.

As ações guiadas do APP-08 para filtros, catálogo e compêndio continuam disponíveis.

## Persistência e migração

- Store de personagens: versão 22.
- Nova coleção persistida: `compatibilityRemediationPlans`.
- Planos de personagens removidos não são preservados.
- Imports/restaurações retêm apenas planos pertencentes a personagens existentes.
- Rollback é bloqueado enquanto existe um plano de remediação ativo para a ficha.

## Validação executada

Passaram:

- contratos APP-02 a APP-09;
- shape do projeto;
- acessibilidade;
- pacote PHB incluído;
- catálogo v4.8.0;
- parsing de 303 arquivos TS/TSX;
- typecheck estrito isolado do motor;
- typecheck estrito isolado da store e migração;
- typecheck estrito isolado do teste APP-09;
- harness com o catálogo real, 21 asserções;
- integridade do pacote final.

O harness executou duas substituições, uma remoção e uma migração de snapshot. O preview eliminou três bloqueios, o commit gerou uma única entrada de auditoria e o rollback restaurou a magia, o feat local e o snapshot anteriores.

## Limitação do ambiente

O typecheck integral e a suíte Jest completa não puderam iniciar porque a codebase recebida não contém `node_modules`.

O typecheck integral não encontrou:

- `expo/tsconfig.base`;
- tipos de Jest;
- tipos de Node;
- tipos de React.

A suíte Jest não encontrou o executável `jest`.

Nenhuma dependência ou versão foi alterada para mascarar esses bloqueios.

## Próximo lote

**APP-10 — recuperação e gestão em lote dos planos de remediação**:

- classificação de planos recuperados após reinício;
- detecção de planos conflitantes ou referentes a catálogo antigo;
- visão global de planos ativos;
- remediação em lote de personagens afetados pelo mesmo livro ou entidade;
- preview agregado sem commits cruzados;
- E2E de criação, descarte, commit e rollback do plano;
- integração do novo fluxo ao gate nativo.
