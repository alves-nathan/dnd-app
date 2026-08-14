# Relatório técnico — magias de invocations, Pact Familiar e Hit Dice

## Escopo

Este bloco foi aplicado sobre a codebase da etapa **mecânicas avançadas de Eldritch Invocations** e conclui o próximo conjunto planejado no roadmap:

- magias concedidas gratuitamente por invocations;
- entidade persistente de familiar para Pact of the Chain;
- melhorias de Investment of the Chain Master;
- ações e cálculo básico de dano do familiar;
- cura de Lifedrinker com consumo real de Hit Die;
- pontos de vida e histórico das transações.

## Magias concedidas por Eldritch Invocations

Foi criado um catálogo mecânico compartilhado em `src/characters/invocationSpellGrants.ts`. Ele relaciona cada invocation à magia concedida, ao modo de uso e às restrições principais.

### Invocations contempladas

- Armor of Shadows → Mage Armor;
- Ascendant Step → Levitate;
- Fiendish Vigor → False Life;
- Gift of the Depths → Water Breathing;
- Mask of Many Faces → Disguise Self;
- Master of Myriad Forms → Alter Self;
- Misty Visions → Silent Image;
- One with Shadows → Invisibility;
- Otherworldly Leap → Jump;
- Visions of Distant Realms → Arcane Eye;
- Whispers of the Grave → Speak with Dead.

### Aplicação mecânica

As magias são adicionadas à ficha com vínculo à invocation de origem e sem entrar nos limites normais de magias conhecidas ou preparadas.

- usos **at will** não consomem spell slot;
- usos **uma vez por descanso longo** recebem um recurso próprio com máximo 1 e recarga em descanso longo;
- as ações de magia carregam indicação de alvo próprio, uso livre ou recurso limitado;
- concentração, duração e ação continuam derivadas do item de magia importado;
- remover ou substituir a invocation remove somente a magia e o recurso concedidos por ela.

Notas específicas também são preservadas. Por exemplo:

- Fiendish Vigor informa o uso do valor máximo dos PV temporários;
- One with Shadows informa a exigência de luz fraca ou escuridão;
- invocations autocentradas marcam a magia como uso próprio.

## Pact of the Chain como companion persistente

Foi criada a entidade `CharacterCompanion`, persistida dentro do personagem.

O familiar mantém:

- nome original ou nome personalizado;
- creature stat block de origem;
- forma comum ou especial;
- tamanho e tipo de criatura;
- CA;
- PV máximo e atual;
- deslocamentos;
- sentidos e idiomas;
- traits;
- ações;
- iniciativa própria;
- regra usada para comandar o ataque;
- notas livres.

### Troca da forma

Ao trocar o stat block do familiar:

- o ID persistente é preservado quando possível;
- nome personalizado e notas são mantidos;
- PV atual é limitado ao novo máximo;
- traits, ações, CA, movimentos, sentidos e idiomas são reconstruídos a partir do novo stat block.

Remover Pact of the Chain ou deixar a escolha incompleta remove a entidade vinculada sem afetar outros dados do personagem.

### Tela Pact Familiar

Foi criada a rota **Ficha → Pact Familiar**.

A tela permite:

- consultar os dados derivados do stat block;
- alterar o nome do familiar;
- registrar PV atual;
- manter notas;
- visualizar traits e ações;
- consultar dano mínimo, máximo e médio de ataques estruturados;
- consultar bônus de ataque e regra de comando.

O ataque do familiar é calculado separadamente do turno do Warlock. Ele não é inserido silenciosamente na rotação do personagem, pois a economia de ação depende do comando escolhido durante o turno.

## Investment of the Chain Master

A invocation agora possui escolha interna persistida entre:

- voo de pelo menos 40 pés;
- natação de pelo menos 40 pés.

Quando ativa, o familiar recebe:

- movimento escolhido de pelo menos 40 pés;
- comando de ataque por ação bônus;
- indicação de que efeitos de salvaguarda usam a CD de magia do Warlock;
- indicação da reação defensiva concedida pela invocation.

A escolha é validada na criação, level-up e tela posterior de Eldritch Invocations.

## Hit Dice e cura de Lifedrinker

Foi criado um sistema persistente de Hit Dice por classe.

### Pools derivados

Cada classe gera um pool contendo:

- classe de origem;
- tipo de dado;
- quantidade máxima derivada do nível na classe;
- quantidade atual disponível.

A reconciliação preserva dados já gastos quando níveis são alterados e adiciona ou remove pools conforme a composição multiclasse.

### Ativação de Lifedrinker

Na tela de combate, quando Lifedrinker e uma Pact Weapon válida estão ativos, o usuário pode escolher qual pool de Hit Die deseja gastar.

A operação:

1. consome exatamente 1 Hit Die;
2. rola o dado correspondente;
3. soma o modificador de Constituição;
4. limita a cura ao PV máximo;
5. registra a transação do Hit Die;
6. registra a transação de cura.

Quando a ficha ainda não possui PV máximo definido, a rolagem e a cura calculada são registradas, mas nenhum valor de PV é alterado.

### Descanso longo

O descanso longo recupera os Hit Dice gastos e cria transações de recuperação. Esse comportamento está integrado ao `applyRest` da store.

## Pontos de vida e histórico

A tela **Recursos** agora permite informar:

- PV máximo;
- PV atual;
- PV temporários.

Ela também exibe:

- pools atuais de Hit Dice;
- histórico de cura de Lifedrinker;
- histórico de gasto e recuperação de Hit Dice;
- histórico preexistente de spell slots e recursos.

## Persistência e migrações

- store de personagens atualizada para a versão **15**;
- rascunho de criação atualizado para a versão **7**;
- novas coleções normalizadas em fichas antigas:
  - `companions`;
  - `hitPoints`;
  - `hitDice`;
  - `hitDieTransactions`;
  - `healingTransactions`;
- nova escolha interna `chainMasterMovementMode`;
- recursos de magias de invocation registram o item de invocation de origem;
- migrações anteriores permanecem retrocompatíveis e idempotentes.

## Testes

Foi criada a suíte `src/tests/warlockInvocationResources.test.ts`, cobrindo:

- magia at will sem spell slot;
- magia uma vez por descanso longo com recurso próprio;
- ação de magia sem consumo de slot;
- criação do familiar a partir do creature stat block;
- melhorias de Investment of the Chain Master;
- conversão de ataque do familiar para a engine de dano;
- cura de Lifedrinker;
- consumo de um Hit Die;
- recuperação dos Hit Dice em descanso longo.

## Validação executada

- TypeScript: aprovado;
- project shape: aprovado;
- contratos estáticos de acessibilidade: aprovados;
- compêndio empacotado: **1.284 itens e 1.284 IDs únicos**;
- release readiness: aprovado;
- Jest:
  - **76 suítes aprovadas**;
  - **257 testes aprovados**;
  - 1 suíte e 2 testes opcionais ignorados.

Também foram executados os testes direcionados das mecânicas de Warlock, com 3 suítes e 9 testes aprovados.

Não foram executados E2E Android/iOS, TalkBack ou VoiceOver em dispositivo neste ambiente.

## Limitações conhecidas

- condições ambientais como luz fraca para One with Shadows são exibidas e persistidas como regra, mas ainda não são validadas por um mapa ou estado espacial;
- o ataque do familiar é calculado, porém ainda não integra automaticamente a rotação do Warlock;
- o familiar ainda não possui uma tela própria de recursos limitados, condições e efeitos ativos;
- efeitos especiais dos ataques do familiar que não estejam estruturados no stat block permanecem textuais;
- a cura de Lifedrinker é acionada pelo usuário após o acerto; a engine não presume automaticamente que o ataque acertou;
- Devil's Sight, Witch Sight, Gaze of Two Minds e Gift of the Protectors permanecem para o próximo bloco.
