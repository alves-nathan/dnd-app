# APP-04 — Fechamento de escolhas e progressão orientada por dependências

## Objetivo

Concluir a migração dos editores secundários para a ponte unificada do APP-03 e usar o grafo do catálogo para transformar cada `CharacterPendingChoice` em um conjunto contextual de candidatos, respeitando filtros, identidade canônica, proveniência e compatibilidade com personagens antigos.

## Resultado

O APP-04 foi implementado sobre a codebase do APP-03. As telas de criação e level-up já usavam o `CharacterChoiceBridge`; neste lote, classes, identidade, equipamento, feats, magias, invocations, Pact Weapon, poderes especializados de Warlock e consultas de combate deixaram de buscar opções diretamente no compêndio local.

O compêndio continua sendo a camada editável para conteúdo local, revisão e homebrew. O catálogo continua sendo a fonte de identidade, disponibilidade, aliases e dependências. Nenhuma entidade oficial foi copiada para o SQLite.

## Resolver de escolhas pendentes

`src/catalog/characterDependencyResolver.ts` introduz `resolveCharacterPendingChoice`.

A resolução executa os seguintes passos:

1. identifica a origem canônica da pendência por `sourceItemId`, `sourceEntityId`, link ativo, `choiceId`, `catalogEntityId`, import ID ou alias;
2. infere os tipos de candidato compatíveis com o tipo da pendência;
3. percorre o grafo em até dois saltos;
4. separa candidatos aplicáveis e bloqueados;
5. limita a resposta sem perder a contagem total;
6. emite issues explícitas quando a origem não pode ser resolvida, quando ocorre fallback ou quando não há candidato disponível.

### Relações consultadas

- contratos e travessia: `offersChoice`, `grantsFeature`, `usesProvider`, `dependsOnProvider`, `dependsOn` e `definedBy`;
- candidatos: `references`, `referencesSpell`, `allowsCandidate`, `grantsFeature`, `dependsOn` e relações de provider;
- propriedade: `belongsToClass`, `belongsToSubclass`, `belongsToFeat`, `belongsToSpecies`, `belongsToFeature` e `availableToClass`.

### Estratégias de resolução

- `dependency`: candidatos encontrados pelo grafo;
- `owner`: candidatos vinculados por proprietário canônico;
- `kindFallback`: compatibilidade por tipo para saves legados ou lacunas do grafo;
- `unresolved`: nenhuma opção compatível encontrada.

O fallback não é silencioso. A interface apresenta a estratégia usada e as issues correspondentes.

## Integração da ponte

`useCharacterChoiceBridge` agora fornece:

- resolução por `choiceId`;
- resolução por entity ID;
- resolução por `catalogEntityId`;
- resolução por `compendiumItemId`;
- resolução por IDs legados;
- `resolvePendingChoice(character, pendingChoice)`.

Isso corrige referências antigas e impede que editores diferentes tratem o mesmo conteúdo oficial como entidades distintas.

## Aplicação ao personagem

`CharacterChoiceApplicationResult` agora também retorna o link criado pelo mapper. A tela do compêndio usa esse link para:

- substituir corretamente subclasses da mesma classe;
- atualizar o Origin Feat;
- manter a identidade canônica e o snapshot da escolha aplicada.

O fluxo de spellbook também preserva `catalogSnapshotId` ao registrar uma magia oficial.

## Telas migradas

### Central de progressão

- encaminha `pendingId` ao editor correto;
- mostra quantos candidatos estão disponíveis e bloqueados;
- informa se a resolução veio do grafo, proprietário ou fallback.

### Compêndio do personagem

- restringe a lista aos candidatos da pendência ativa;
- bloqueia conteúdo indisponível antes de aplicar;
- usa `applyCharacterChoice` para persistir proveniência;
- mantém mutações locais somente para revisão de conteúdo local.

### Editores especializados

Foram migrados para `useCharacterChoiceBridge`:

- classes e subclasses;
- espécie e background;
- equipamento inicial e loadout;
- feats e opções internas;
- magias e spellbook;
- Eldritch Invocations;
- Pact Weapon;
- poderes especializados de Warlock;
- consultas de combate que dependem de itens da ficha.

Os editores recebem `pendingId`, exibem o contexto da pendência e preservam o parâmetro ao encaminhar para outro seletor.

## Compatibilidade

- não foi necessária nova migração do store;
- personagens do APP-03 continuam válidos;
- IDs legados são resolvidos pela mesma tabela de identidade da ponte;
- pendências antigas sem origem canônica continuam utilizáveis por fallback explícito;
- candidatos desativados permanecem visíveis como bloqueados, em vez de desaparecer silenciosamente;
- conteúdo local continua exigindo fonte ativa e status `validated`.

## Dados reais verificados

O harness executou o resolver real contra o catálogo v4.8.0 e o pacote PHB incluído:

| Cenário | Resultado |
|---|---:|
| Entidades do catálogo | 5.841 |
| Arestas do grafo | 15.385 |
| Payloads mecânicos com ID oficial direto | 598 |
| Magias relacionadas ao Wizard | 227 |
| Magias disponíveis no cenário | 226 |
| Magias bloqueadas preservadas | 1 |
| Subclasses do Wizard | 4 |
| Armas do contrato Weapon Master | 38 |
| Asserções do harness | 18/18 |

Relações do catálogo confirmadas pelo contrato estático:

| Relação | Quantidade |
|---|---:|
| `offersChoice` | 79 |
| `allowsCandidate` | 26 |
| `availableToClass` | 949 |
| `belongsToClass` | 612 |

## Validação

Passaram:

- shape do projeto;
- contratos mínimos de acessibilidade;
- integridade do compêndio incluído;
- checksum e contagens do catálogo;
- contratos de gerenciamento do APP-02;
- contratos da ponte do APP-03;
- contratos de dependências do APP-04;
- parsing sintático de 290 arquivos TS/TSX;
- typecheck estrito isolado do resolver, aplicação e teste do APP-04;
- harness real com 18 asserções.

## Limitação do ambiente

O arquivo-fonte recebido não contém `node_modules`. Por isso:

- `npm run typecheck` integral não encontrou `expo/tsconfig.base` nem os tipos de Jest, Node e React;
- a suíte Jest não iniciou porque o executável `jest` não está instalado.

Nenhuma dependência ou versão foi alterada para ocultar o bloqueio. Os logs estão em:

- `reports/app-04-full-typecheck-blocker.log`;
- `reports/app-04-jest-blocker.log`.

## Próximo lote recomendado

**APP-05 — transação de progressão e resolução atômica:** criar preview único das alterações de level-up e escolhas pendentes, confirmar tudo em uma transação, registrar auditoria de antes/depois e permitir descarte seguro antes do commit. Depois de restaurar `node_modules`, incluir a suíte integral como gate obrigatório do lote.
