# Relatório técnico — ciclo completo de turno e reações

## Base utilizada

Este bloco foi desenvolvido sobre a entrega **Phase 5H — Interaction Economy + Components**, preservando:

- equipamento ativo e simulação das mãos;
- troca de armas entre ataques;
- componentes V/S/M e focos;
- Weapon Mastery persistente;
- alvos táticos, posições e recuperação pós-combate;
- mecânicas avançadas de Warlock.

## Objetivo

Transformar o cenário tático de uma análise isolada de rotação em um ciclo persistente de combate, com:

- turnos explícitos;
- round controlado pela ordem de iniciativa;
- ataques e movimento reais dos alvos;
- expiração correta de efeitos;
- concentração após dano;
- ataques de oportunidade;
- Ready;
- War Caster como reação.

## Implementação

### Participantes, iniciativa e round

`CombatScenario` agora persiste participantes táticos contendo:

- personagem ou alvo;
- iniciativa;
- estado de turno;
- reação disponível;
- movimento gasto;
- round em que iniciou e encerrou o turno.

Foram criados comandos explícitos para:

- iniciar turno;
- encerrar turno;
- impedir dois turnos ativos simultaneamente;
- impedir que o mesmo participante aja duas vezes no round;
- atualizar o round somente quando todos os participantes encerraram seus turnos.

A reação volta a ficar disponível no início do turno do participante.

### Expiração de efeitos

Foi adicionada a fronteira de expiração `endOfSourceTurn`.

O fluxo processa:

- Sap e Slow no início do próximo turno da fonte;
- Vex quando consumido por um ataque elegível ou no fim do próximo turno da fonte;
- efeitos ativos da ficha no início ou fim de turno conforme `duration.expiresOn`;
- Ready expirado ao chegar novamente ao turno de quem o preparou.

### Ataques dos alvos

Durante o turno de um alvo é possível registrar:

- nome do ataque;
- acerto ou erro;
- dano real;
- resultado do teste de concentração.

Quando Sap está ativo:

- o ataque é registrado com desvantagem;
- Sap é consumido automaticamente após esse ataque, acertando ou errando.

O dano aplicado:

- consome primeiro PV temporários;
- reduz PV atuais;
- registra valores anteriores e posteriores no histórico tático.

### Concentração

Quando o personagem sofre dano enquanto concentra:

- a CD é calculada como `max(10, floor(dano / 2))`;
- o usuário registra sucesso, falha ou resultado pendente;
- em falha, o efeito de concentração é encerrado;
- a transação do efeito e o evento tático são preservados nos respectivos históricos.

### Movimento e condições dos alvos

O turno do alvo agora permite:

- aproximar-se;
- afastar-se;
- respeitar Speed efetiva;
- aplicar custo dobrado em terreno difícil;
- considerar a redução de Slow;
- controlar movimento já gasto;
- levantar de Prone gastando metade da Speed efetiva;
- registrar salvaguardas;
- aplicar condição textual em uma falha de salvaguarda.

### Ataques de oportunidade

Quando um alvo sai do alcance do personagem:

- o deslocamento cria uma reação pendente;
- a reação só aparece se ainda estiver disponível;
- são listados somente ataques corpo a corpo elegíveis;
- o usuário registra acerto e dano real;
- PV do alvo são atualizados quando cadastrados;
- a reação é consumida após a resolução.

### War Caster

Quando o personagem possui War Caster, a reação de oportunidade também oferece magias que:

- possuem tempo de conjuração de uma Ação;
- afetam somente uma criatura;
- não possuem área;
- alcançam a criatura no instante do gatilho;
- não são restritas ao próprio conjurador.

A resolução valida:

- componentes somáticos e materiais;
- foco ou mão livre;
- slot selecionado;
- recursos adicionais;
- concentração iniciada pela magia.

### Ready

O personagem pode preparar uma ação durante o próprio turno:

- seleciona uma ação com custo de Ação;
- descreve um gatilho perceptível;
- dispara o gatilho manualmente;
- usa a reação para liberar a ação.

Para magias preparadas:

- componentes são validados ao preparar;
- slot e recursos são gastos imediatamente;
- a magia fica mantida por concentração;
- ao disparar, os recursos não são gastos novamente;
- ao cancelar ou deixar expirar, os recursos não retornam;
- a concentração de Ready é encerrada ao liberar, cancelar ou expirar;
- se a magia liberada também exigir concentração, o efeito de concentração da magia é iniciado.

## Interface

A tela **Combate tático** passou a incluir:

- ordem de iniciativa;
- estado de cada participante;
- botão de iniciar turno;
- botão de encerrar turno;
- reação e movimento restante;
- painel de ataque do alvo;
- painel de movimento do alvo;
- painel de salvaguarda;
- painel de reação pendente;
- seleção de ataque de oportunidade;
- seleção de magia de War Caster;
- preparação, disparo e cancelamento de Ready;
- PV opcionais para cada alvo;
- histórico ampliado de ataques, dano, concentração e reações.

## Persistência

O store de cenários foi atualizado para a versão **3**.

Novos dados persistidos:

- participantes e iniciativa;
- turno ativo;
- reação disponível;
- movimento gasto;
- ações preparadas;
- reação pendente;
- PV opcionais dos alvos;
- novos tipos de evento do histórico.

Cenários antigos continuam sendo normalizados automaticamente.

## Testes

Foi criado `src/tests/turnCycle.test.ts`, cobrindo:

- round avançando somente após todos agirem;
- Sap consumido pelo ataque real;
- dano e falha de concentração;
- saída do alcance e reação pendente;
- War Caster com consumo de slot;
- Ready com o mesmo action ID;
- gasto imediato do slot ao preparar uma magia;
- concentração mantida enquanto a magia aguarda o gatilho;
- liberação sem gasto duplicado.

## Validação executada

- `npm ci`: aprovado;
- project shape: aprovado;
- contratos mínimos de acessibilidade: aprovados;
- compêndio empacotado: **1.284 itens e 1.284 IDs únicos**;
- TypeScript: aprovado;
- Jest: **81 suítes aprovadas** e 1 suíte opcional ignorada;
- Jest: **293 testes aprovados** e 2 testes opcionais ignorados;
- release readiness: aprovado.

## Limitações conhecidas

- o acerto e o dano real de ataques e reações são informados manualmente;
- os ataques dos alvos ainda não são preenchidos automaticamente a partir do stat block;
- gatilhos de Ready são disparados manualmente, exceto pela detecção automática de saída do alcance;
- o app não rola automaticamente o teste de concentração;
- reações próprias dos inimigos ainda não são modeladas;
- áreas de efeito e mapa bidimensional permanecem fora deste bloco;
- testes E2E Android/iOS e auditorias TalkBack/VoiceOver não foram executados neste ambiente.
