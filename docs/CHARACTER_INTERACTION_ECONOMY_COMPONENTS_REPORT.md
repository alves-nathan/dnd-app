# Relatório técnico — economia de interação, mãos e componentes

## Base utilizada

Este bloco foi implementado sobre a entrega **Tactical Targets + Mastery Continuity**, preservando:

- alvos e posições persistentes;
- continuidade de Sap, Slow, Topple e Vex;
- movimentação e terreno difícil;
- munição, armas arremessadas e recuperação pós-combate;
- loadout ativo, Pact Weapon e mecânicas anteriores de Warlock.

## Objetivo

A engine precisava deixar de considerar cada ataque como uma ação isolada e passar a simular a sequência real do turno, incluindo:

- quantidade de ataques permitida pela Ação de Ataque;
- armas nas mãos em cada ponto da sequência;
- sacar, guardar, soltar e recolher armas;
- propriedades que dependem de uma ou duas mãos;
- componentes somáticos e materiais;
- focos de conjuração e exceções como War Caster.

## Economia da Ação de Ataque

Foi criado `src/characters/interactionEconomyRules.ts`.

A capacidade da Ação de Ataque considera:

- Fighter 5/11/20;
- Barbarian, Monk, Paladin e Ranger a partir do nível 5;
- College of Valor Bard a partir do nível 6;
- Thirsting Blade e Devouring Blade;
- features importadas ou homebrew com `attackActionAttackCount` explícito.

Várias entradas de ataque com arma podem compartilhar a mesma Ação de Ataque. A validação soma os ataques de todas as entradas e bloqueia apenas quando o total supera a capacidade da build.

O campo `TurnAction.attackCountOverride` permite dividir Extra Attack entre armas diferentes. A análise de dano, munição, armas arremessadas e resolução tática usa essa quantidade efetiva.

## Interações com armas

Cada `TurnAction` pode registrar uma operação antes ou depois da ação:

- `draw`: sacar;
- `stow`: guardar;
- `drop`: deixar cair;
- `pickup`: recolher;
- `swap`: compatibilidade com rotações antigas.

Regras aplicadas:

- cada ataque da Ação de Ataque oferece uma interação de sacar ou guardar arma;
- deixar uma arma cair não consome essa interação;
- uma troca legada conta como duas interações;
- fora da Ação de Ataque, permanece o limite de uma interação geral de objeto;
- uma arma Thrown guardada pode ser sacada como parte do ataque quando existe uma mão livre;
- a engine acompanha a arma presente em cada mão ao longo da sequência;
- ataques com arma guardada são bloqueados até que ela seja sacada.

A tela de criação de rotações agora possui uma seção **Ordem da rotação**, com controles para mover cada ação para cima ou para baixo. A validação usa exatamente essa ordem.

## Mãos, escudos e focos

O loadout passou a persistir `heldFocusEquipmentId`.

A tela de equipamento mostra:

- mão principal;
- mão secundária;
- armadura;
- escudo/acessórios;
- foco disponível nas mãos;
- armas que também funcionam como foco.

Focos reconhecidos:

- Arcane Focus;
- Druidic Focus;
- Holy Symbol;
- Musical Instrument;
- Component Pouch;
- armas importadas como foco, como `Arcane Focus (Quarterstaff)` e `Druidic Focus (Quarterstaff)`.

Segurar um foco manual ocupa a mão secundária e remove arma secundária ou escudo daquele loadout. Símbolos sagrados vestíveis não exigem uma mão dedicada. A reconciliação remove referências a focos apagados ou com quantidade zero.

## Componentes de magia

Foi criado `src/characters/spellComponentRules.ts`.

As ações de magia agora carregam:

- componentes V, S e M;
- descrição do componente material;
- classe/lista de conjuração usada para determinar o foco compatível.

A validação da rotação bloqueia:

- componente somático sem mão disponível;
- componente material sem foco compatível ou Component Pouch acessível;
- foco incompatível com a classe da magia;
- material com custo monetário ausente no inventário.

War Caster permite executar componentes somáticos com arma e/ou escudo nas mãos. Quando a magia possui S e M, a mão usada para manipular o foco ou componente também pode realizar o gesto somático.

Materiais com custo explícito não são substituídos por foco ou Component Pouch.

## Propriedades de armas

### Versatile

A lista de ações gera duas variantes quando a arma possui dano Versatile:

- uma mão, usando o dado normal;
- duas mãos, usando o dado Versatile.

### Two-Handed

Uma arma Two-Handed pode ser carregada em uma mão. A segunda mão é exigida somente quando o ataque ocorre. Assim, a presença de escudo, arma secundária ou foco bloqueia o ataque, não a posse da arma.

### Loading

Loading limita a arma a um ataque por ação, ação bônus ou reação. A exceção atual reconhecida é Crossbow Expert.

### Light e Nick

A engine verifica:

- ataque anterior com outra arma Light;
- remoção do modificador positivo de habilidade do dano adicional;
- uso da ação bônus para o ataque Light normal;
- transferência do ataque para a Ação de Ataque com Nick;
- limite de Nick uma vez por turno;
- preservação das validações de munição, mãos e troca de arma.

## Equipamento inicial e mapeamento

O mapeamento de armas passou a preservar `versatileDamage`.

O equipamento inicial reconhece metadados de foco mesmo quando o rótulo resolve para uma arma do compêndio. Dessa forma, Quarterstaff fornecido como foco continua funcionando mecanicamente como arma e como foco.

Features importadas podem declarar `attackActionAttackCount`, permitindo que classes homebrew definam sua capacidade sem depender do nome da classe.

## Interface

### Equipamentos

- seleção de foco segurado;
- identificação de foco em equipamentos e armas;
- resumo de mãos e foco no loadout;
- conflitos de mão explicados por mensagens de validação.

### Criação de rotação

- seleção de quantidade de ataques por trecho da sequência;
- sacar, guardar, deixar cair e recolher antes/depois da ação;
- escolha da mão e da arma envolvida;
- ordenação explícita das ações;
- indicação de Versatile, Two-Handed, Loading e Thrown;
- componentes V/S/M e material exibidos no card da magia;
- notas de regra apresentadas antes de salvar.

## Persistência e compatibilidade

- Character Store atualizado para a versão **18**;
- migração retrocompatível para `heldFocusEquipmentId`;
- rotações antigas com `swap` continuam aceitas;
- fixtures de hardening receberam capacidade explícita de Extra Attack;
- backups continuam serializando os campos opcionais sem mudança de formato.

## Testes adicionados e ajustados

Cobertura específica para:

- troca de arma entre dois ataques de Fighter 5;
- bloqueio acima da capacidade da Ação de Ataque;
- capacidade explícita de Extra Attack em feature homebrew;
- variantes Versatile;
- Two-Handed com escudo;
- Loading com e sem Crossbow Expert;
- componentes somáticos com arma e escudo;
- War Caster;
- foco arcano segurado;
- Component Pouch;
- materiais com custo explícito;
- saque automático de arma Thrown;
- preservação de `attackActionAttackCount` pelo mapper.

## Validação executada

- `npm ci` concluído na codebase de trabalho;
- project shape: aprovado;
- contratos mínimos de acessibilidade: aprovados;
- compêndio empacotado: **1.284 itens e 1.284 IDs únicos**;
- TypeScript: aprovado;
- Jest: **80 suítes aprovadas** e 1 suíte opcional ignorada;
- Jest: **288 testes aprovados** e 2 testes opcionais ignorados;
- release readiness: aprovado.

## Limitações conhecidas

- testes E2E em Android/iOS não foram executados neste ambiente;
- War Caster ainda não automatiza a substituição de ataque de oportunidade por magia;
- materiais consumidos por uma magia ainda não geram uma transação automática de inventário;
- o reconhecimento de exceções a Loading está vinculado ao feat Crossbow Expert;
- a ordem usa botões de subir/descer, sem drag-and-drop;
- escudos são configurados no loadout; vestir ou remover um escudo durante a própria rotação ainda não é modelado.
