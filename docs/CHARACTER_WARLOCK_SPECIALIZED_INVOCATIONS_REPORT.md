# Relatório técnico — sentidos, vínculos e recursos especializados de Warlock

## Escopo

Este bloco foi aplicado sobre a codebase da etapa **magias de invocations, Pact Familiar e Hit Dice** e conclui o próximo conjunto previsto no roadmap:

- Gaze of Two Minds;
- Gift of the Protectors;
- Devil's Sight e Witch Sight;
- One with Shadows;
- recursos, condições, salvaguardas e histórico avançado do Pact Familiar;
- integração dessas mecânicas às ações, rotações, descansos e persistência.

## Gaze of Two Minds

Foi criado um estado persistente para o vínculo contendo:

- criatura voluntária conectada;
- vínculo opcional com um companion persistido;
- sentidos especiais emprestados;
- distância atual;
- confirmação de mesmo plano de existência;
- origem preferida para conjuração;
- janela de duração e manutenção;
- notas e timestamps.

A nova tela permite iniciar, atualizar, manter e encerrar o vínculo. Quando a criatura está no mesmo plano e a até 60 pés, magias disponíveis passam a oferecer duas origens na criação da rotação:

- espaço do Warlock;
- espaço da criatura conectada.

A validação da rotação bloqueia a origem alternativa quando o vínculo está inativo, em outro plano ou acima de 60 pés. Os sentidos da criatura conectada aparecem entre os sentidos efetivos do personagem enquanto o vínculo estiver ativo.

## Gift of the Protectors

A página do Book of Shadows agora possui estado persistente com:

- limite igual ao modificador de Carisma, mínimo 1;
- nomes únicos inscritos;
- inclusão e remoção de nomes;
- recurso compartilhado de uma ativação;
- registro do nome que disparou a proteção;
- histórico de inscrição, remoção, disparo e recuperação.

O recurso compartilhado é consumido quando uma criatura inscrita usa a proteção e retorna em descanso longo. A recuperação também cria transações auditáveis de recurso e de proteção.

Perder Gift of the Protectors ou Pact of the Tome remove o estado e o recurso órfão durante a reconciliação.

## Sentidos de invocations

Os sentidos agora fazem parte da ficha persistida e são reconciliados automaticamente:

- **Devil's Sight:** visão normal em luz fraca e escuridão, mágicas ou não, até 120 pés;
- **Witch Sight:** Truesight de 30 pés;
- **Gaze of Two Minds:** sentidos emprestados da criatura conectada.

A reconciliação é idempotente e não duplica entradas equivalentes concedidas pela mesma invocation.

## One with Shadows

Foi criado um estado ativável para One with Shadows:

- exige luz fraca ou escuridão;
- aplica uma instância persistida de Invisibility;
- mantém concentração e duração do efeito;
- aparece no gerenciador de efeitos ativos;
- encerra automaticamente quando uma rotação com ataque ou conjuração é executada;
- pode ser encerrado ou reiniciado manualmente.

Movimento isolado não encerra o efeito, pois a implementação segue a conjuração de Invisibility concedida pela invocation.

## Pact Familiar avançado

A entidade persistida de familiar agora contempla:

- recursos limitados derivados de usos do stat block;
- consumo desses recursos diretamente por ações de rotação;
- recuperação em descanso longo;
- transações próprias de gasto e recuperação;
- condições e efeitos ativos independentes do Warlock;
- salvaguardas estruturadas;
- CD de magia do Warlock aplicada por Investment of the Chain Master;
- escolha persistida de dano Necrótico ou Radiante para a simulação atual;
- histórico de dano, cura, recursos e condições;
- ataques incluídos entre as ações disponíveis do personagem.

Sem Investment of the Chain Master, o ataque do familiar substitui automaticamente um dos ataques próprios do Warlock na análise. Com Investment, o comando usa ação bônus.

O gerenciador global de recursos agora reconhece recursos pertencentes a companions para:

- disponibilidade da rotação;
- gasto;
- transações;
- ajustes manuais;
- descanso longo.

## Interface

Foi criada a rota:

`Ficha → Poderes de Warlock`

Ela centraliza:

- sentidos efetivos;
- Gaze of Two Minds;
- Gift of the Protectors;
- One with Shadows.

A tela **Pact Familiar** também foi ampliada com:

- recursos;
- condições;
- CD e conversão de dano de Investment;
- detalhes das ações;
- cálculo de dano;
- histórico recente.

Foram adicionados atalhos na ficha, na tela de Eldritch Invocations e na Central de Progressão.

## Persistência

- store de personagens atualizada para a versão **16**;
- migração retrocompatível e idempotente;
- novos campos normalizados em fichas antigas;
- backups continuam transportando o estado completo do personagem.

## Validação executada

- `npm ci`: aprovado;
- project shape: aprovado;
- contratos estáticos de acessibilidade: aprovados;
- compêndio empacotado: 1.284 itens e IDs únicos;
- TypeScript: aprovado;
- **77 suítes Jest aprovadas**;
- **265 testes aprovados**;
- 1 suíte e 2 testes opcionais ignorados;
- release readiness: aprovado;
- package-lock sem URLs privadas.

## Limitações mantidas

Não foram executados neste ambiente:

- E2E Android/iOS em runtime móvel;
- auditoria TalkBack/VoiceOver;
- profiling Hermes em dispositivo;
- validação visual de todos os creature stat blocks de familiar.

O modelo de dano alternativo de Investment é registrado na ação e na simulação. Stat blocks que condensam dano físico e elemental em uma única fórmula textual ainda dependem de payloads mais granulares para separar perfeitamente cada parcela do dano.
