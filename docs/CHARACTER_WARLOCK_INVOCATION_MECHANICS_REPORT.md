# Relatório técnico — mecânicas avançadas de Eldritch Invocations

## Escopo

Este bloco foi aplicado sobre a codebase da etapa **Pact of the Tome + Pact Weapon** e conclui o conjunto de invocations planejado no bloco seguinte:

- Agonizing Blast;
- Eldritch Spear;
- Repelling Blast;
- Lessons of the First Ones;
- Pact of the Chain;
- Eldritch Smite;
- Lifedrinker.

## Escolhas internas das invocations

Foi criado um editor compartilhado usado em três fluxos:

1. wizard de criação de personagem;
2. level-up de Warlock;
3. tela posterior **Ficha → Eldritch Invocations**.

Cada cópia repetível possui sua própria escolha persistida.

### Agonizing Blast

- exige escolher um cantrip de Warlock que cause dano;
- o cantrip precisa ser conhecido pelo personagem após a criação;
- cópias repetidas não podem apontar para o mesmo cantrip;
- adiciona o modificador de Carisma a cada rolagem de dano do cantrip escolhido.

### Eldritch Spear

- exige escolher um cantrip de dano de Warlock com alcance mínimo elegível;
- aumenta o alcance em 30 pés por nível de Warlock para cada cópia vinculada ao cantrip;
- a ação mostra o alcance final e uma nota auditável com o bônus aplicado.

### Repelling Blast

- exige um cantrip de Warlock que use attack roll;
- adiciona à ação o deslocamento forçado de 10 pés por cópia;
- registra o limite de tamanho Large;
- a interface e o cálculo deixam explícito que o efeito ocorre por acerto.

### Lessons of the First Ones

- exige um Origin Feat elegível por cópia;
- impede repetir o Origin Feat principal ou outro feat já escolhido por Lessons;
- aplica o feat à ficha com vínculo à invocation;
- escolhas internas do feat continuam disponíveis na tela de Feats.

### Pact of the Chain

- permite escolher uma forma comum ou especial de familiar;
- usa os creature stat blocks disponíveis nas fontes ativas;
- persiste a forma e sua categoria;
- concede Find Familiar como magia de uso gratuito vinculada à invocation.

A forma escolhida ainda não é uma entidade de companion controlável em combate; essa evolução ficou no próximo bloco.

### Lifedrinker

- exige escolher dano Necrótico, Psíquico ou Radiante;
- adiciona 1d6 condicional à Pact Weapon;
- o dano é aplicado no máximo uma vez por turno, mesmo com Thirsting Blade ou Devouring Blade;
- o gasto de Hit Die para cura permanece como lembrete manual na ação.

### Eldritch Smite

- aparece como condição ativável na ação da Pact Weapon;
- usa o nível atual do slot de Pact Magic;
- calcula `1d8 + 1d8 por nível do Pact slot`;
- aplica o dano no máximo uma vez por turno;
- consome exatamente um slot de Pact Magic somente quando a condição é ativada;
- registra a possibilidade de derrubar alvo Huge ou menor.

## Escalonamento de Eldritch Blast

O parser de scaling agora aceita:

- `level` como alias de `minCharacterLevel`;
- `beams` como alias de `attacksCount`;
- `characterLevelBeams` como scaling por nível de personagem;
- sufixos textuais como `each` ou `per beam` removidos antes da análise da fórmula, pois a multiplicidade já é representada por `attacksCount`.

A ação da magia passa a carregar a quantidade de feixes/attack rolls. Assim, Eldritch Blast no nível 5 calcula dois ataques separados, enquanto Agonizing Blast é incluído em cada rolagem de dano.

## Persistência

- store de personagens atualizada para a versão **14**;
- rascunho de criação atualizado para a versão **6**;
- novos campos persistidos nas escolhas de invocation:
  - `targetCantripItemId`;
  - `originFeatItemId`;
  - `familiarCreatureItemId`;
  - `familiarVariant`;
  - `lifedrinkerDamageType`;
- migrações anteriores permanecem idempotentes;
- escolhas órfãs ou incompatíveis geram pendências na Central de Progressão.

## Engine de combate

Foram adicionados ao modelo de ações:

- quantidade de attack rolls em SpellAction;
- alcance final da magia;
- deslocamento forçado e limite de tamanho;
- custos condicionais de spell slot em AttackAction;
- magias concedidas sem gasto de slot;
- componentes de dano `oncePerTurn` calculados apenas uma vez no total do turno.

## Testes adicionados

- `src/tests/eldritchInvocationChoicesAdvanced.test.ts`
  - elegibilidade de cantrip;
  - repetição com alvos distintos;
  - Origin Feats únicos;
  - escolha de familiar;
  - tipo de dano de Lifedrinker;
  - aplicação de Lessons e Find Familiar gratuito.

- `src/tests/warlockInvocationActions.test.ts`
  - feixes de Eldritch Blast;
  - Agonizing Blast;
  - Eldritch Spear;
  - Repelling Blast;
  - Lifedrinker uma vez por turno;
  - Eldritch Smite e consumo condicional de Pact Magic;
  - smoke test com o Eldritch Blast real do PHB V5 empacotado.

## Validação executada

- instalação limpa das dependências: aprovada;
- project shape: aprovado;
- contratos estáticos de acessibilidade: aprovados;
- compêndio empacotado: **1.284 itens e IDs únicos**;
- TypeScript: aprovado;
- Jest:
  - **75 suítes aprovadas**;
  - **253 testes aprovados**;
  - 1 suíte e 2 testes opcionais ignorados;
- release readiness: aprovado.

Não foram executados testes E2E em aparelho Android ou iOS neste ambiente.

## Limites atuais

- o familiar de Pact of the Chain ainda não possui turno, ações e recursos próprios;
- a cura de Lifedrinker ainda exige registro manual do Hit Die;
- invocations que concedem outras magias gratuitas ou usos limitados ainda precisam de modelagem individual;
- movimento forçado é exposto como dado mecânico da ação, mas o app ainda não possui mapa tático para deslocar uma criatura automaticamente.
