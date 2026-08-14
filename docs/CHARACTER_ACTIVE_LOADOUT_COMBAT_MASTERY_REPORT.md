# Relatório técnico — loadout ativo, munição, alcance e Weapon Mastery

## Escopo

Este bloco foi aplicado sobre a codebase da etapa **Warlock Specialized Invocations** e conclui a primeira camada de simulação de equipamento ativo prevista no roadmap:

- inventário separado do loadout atualmente usado;
- armadura, escudo, mãos ocupadas e armas ativas;
- equipamento inicial de classe e background aplicado aos cálculos;
- munição por tipo e gasto por rotação;
- alcance normal, alcance longo, cobertura e linha de visão;
- saque/troca de arma dentro da rotação;
- integração das oito propriedades de Weapon Mastery ao cálculo e ao relatório.

## Loadout ativo

Foi criado um estado persistente `CharacterEquipmentLoadout` dentro de `CharacterBuildChoices`.

O estado registra:

- arma na mão principal;
- arma na mão secundária;
- armadura vestida;
- escudo e demais acessórios defensivos ativos;
- confirmação de que a configuração foi feita explicitamente pelo usuário.

A nova engine de loadout impede ou corrige combinações incompatíveis:

- arma de duas mãos com outra arma;
- arma de duas mãos com escudo;
- arma de duas mãos apenas na mão secundária;
- arma secundária e escudo ocupando a mesma mão;
- múltiplos escudos concedendo CA simultaneamente.

A CA usa somente a armadura e os acessórios ativos. As ações de ataque comuns usam apenas as armas atualmente empunhadas. Armas guardadas permanecem no inventário e podem ser escolhidas na criação de rotações com uma operação explícita de saque ou troca.

## Equipamento inicial

As escolhas de equipamento de classe e background agora produzem entidades mecânicas persistidas:

- armas;
- armaduras;
- escudos;
- munição;
- equipamentos narrativos;
- ouro.

O primeiro loadout utilizável é montado automaticamente. Quando a opção inicial concede um escudo e a arma principal permite uma mão livre, o escudo é equipado. Trocar posteriormente a opção de classe ou background remove somente os itens originados pela seleção anterior.

Itens manuais com o mesmo nome permanecem preservados.

## Armas e munição

As armas importadas agora transportam:

- alcance normal e longo;
- quantidade;
- número de mãos;
- propriedades;
- tipo e custo de munição;
- propriedade de Weapon Mastery.

A munição é rastreada como equipamento por tipo. A análise de uma rotação:

- soma o custo de todos os ataques e repetições;
- informa munição exigida;
- bloqueia o registro do gasto quando a quantidade é insuficiente;
- reduz o inventário quando o gasto da rotação é confirmado;
- inclui munição na comparação de recursos entre rotações.

## Alcance e combate posicional básico

O estado de combate e os cenários salvos agora aceitam:

- distância do alvo;
- tamanho do alvo;
- cobertura nenhuma, meia, três quartos ou total;
- linha de visão;
- existência de um segundo alvo adjacente para Cleave.

A engine aplica:

- desvantagem em ataques no alcance longo;
- bloqueio fora do alcance máximo;
- `+2 CA` por meia cobertura;
- `+5 CA` por cobertura de três quartos;
- bloqueio por cobertura total ou ausência de linha de visão;
- validação de tamanho para Push.

Esses parâmetros estão disponíveis nas telas **Combate**, **Dano por turno** e **Comparador de rotações**.

## Troca de armas em rotações

A criação de rotações pode listar armas guardadas. Para usá-las, a ação registra uma operação de:

- sacar;
- guardar;
- trocar.

A validação simula o estado das mãos na ordem das ações. Uma rotação que usa uma arma guardada sem operação anterior é bloqueada.

## Weapon Mastery

A propriedade só é aplicada quando a ficha possui uma escolha de mastery correspondente à arma.

### Efeitos calculados diretamente

- **Cleave:** inclui o dano secundário sem modificador positivo quando há alvo adjacente, respeitando uso uma vez por turno.
- **Graze:** acrescenta ao valor esperado o dano do modificador de habilidade nos ataques que erram.
- **Nick:** cria o ataque Light adicional sem consumir ação bônus, uma vez por turno, quando duas armas Light estão equipadas.

### Efeitos estruturados e validados

- **Push:** registra 10 pés de movimento forçado e impede aplicação contra alvos maiores que Large.
- **Sap:** informa desvantagem no próximo ataque do alvo.
- **Slow:** informa redução de 10 pés na Speed.
- **Topple:** calcula e exibe a CD da salvaguarda de Constituição.
- **Vex:** informa vantagem no próximo ataque contra o mesmo alvo.

Os últimos quatro efeitos aparecem no resultado e no relatório, mas ainda não são persistidos em uma entidade de alvo entre turnos. Essa persistência foi mantida para o próximo bloco tático, pois a aplicação correta exige alvos identificáveis.

## Interface

A tela **Equipamentos** foi reorganizada para mostrar:

- resumo do loadout ativo e CA;
- armaduras possuídas e armadura vestida;
- escudos e acessórios defensivos;
- armas guardadas, mão principal e mão secundária;
- quantidade de cada munição;
- escolhas independentes de equipamento da classe e do background.

A tela **Combate** mostra:

- loadout e munição atuais;
- distância, tamanho, cobertura e linha de visão;
- dano ponderado pelas condições do alvo;
- custo de munição;
- efeitos de mastery por ação.

A tela **Dano por turno** agora inclui munição na prontidão e no registro de gastos.

## Persistência e compatibilidade

- store de personagens atualizada para a versão **17**;
- migração retrocompatível para fichas sem loadout explícito;
- armaduras possuídas separadas da armadura ativa;
- equipamentos antigos continuam utilizáveis por fallback;
- fixtures e biblioteca de compatibilidade atualizadas para operações explícitas de troca de arma.

## Validação executada

- project shape: aprovado;
- contratos estáticos de acessibilidade: aprovados;
- compêndio empacotado: **1.284 itens e IDs únicos**;
- TypeScript: aprovado;
- **78 suítes Jest aprovadas**;
- **271 testes aprovados**;
- 1 suíte e 2 testes opcionais ignorados;
- release readiness: aprovado;
- `package-lock.json` sem URLs privadas.

Foram adicionados testes específicos para:

- armadura, escudo e conflito de mãos;
- filtro de armas ativas;
- gasto e insuficiência de munição;
- alcance longo e alcance máximo;
- Graze, Nick e Push;
- compatibilidade da biblioteca de exemplos.

## Limitações mantidas

Não foram executados neste ambiente:

- E2E Android/iOS;
- auditoria TalkBack/VoiceOver;
- profiling Hermes em dispositivo;
- validação gestual em telas pequenas.

Também permanecem para o próximo bloco:

- entidades persistentes de alvo para Sap, Slow, Topple e Vex;
- recuperação pós-combate de munição e armas arremessadas;
- terreno difícil e deslocamento real em mapa;
- regras mais profundas de interação, saque e troca com a economia de ações do D&D 2024.
