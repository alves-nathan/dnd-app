# Roadmap atualizado — criação, progressão e Warlock

## Concluído neste bloco

### Invocations vinculadas a cantrips

- [x] Agonizing Blast: escolher o cantrip afetado por cópia.
- [x] Exigir cantrip de Warlock conhecido que cause dano.
- [x] Aplicar Carisma a cada rolagem de dano do cantrip.
- [x] Eldritch Spear: escolher o cantrip afetado.
- [x] Aplicar alcance adicional por nível de Warlock.
- [x] Repelling Blast: escolher cantrip com attack roll.
- [x] Registrar push por acerto e limite de tamanho.
- [x] Impedir cópias repetidas vinculadas ao mesmo cantrip.
- [x] Integrar o número de feixes de Eldritch Blast ao cálculo.

### Invocations que concedem opções

- [x] Lessons of the First Ones: escolher Origin Feat diferente por cópia.
- [x] Impedir duplicação com o Origin Feat principal.
- [x] Aplicar e reconciliar o feat concedido.
- [x] Pact of the Chain: escolher familiar comum ou especial.
- [x] Conceder Find Familiar sem gasto de slot.
- [x] Persistir e editar todas as escolhas na criação, level-up e tela posterior.

### Recursos e ativações

- [x] Eldritch Smite como ativação condicional da Pact Weapon.
- [x] Consumo de um slot de Pact Magic somente quando ativado.
- [x] Dano escalado pelo nível do Pact slot.
- [x] Aplicação no máximo uma vez por turno.
- [x] Lifedrinker: tipo de dano selecionável.
- [x] Dano adicional uma vez por turno.
- [x] Lembrete de cura mediante Hit Die.

### Persistência e qualidade

- [x] Store de personagens v14.
- [x] Rascunho de criação v6.
- [x] Migração retrocompatível.
- [x] Validação de escolhas órfãs e cantrips que deixaram de ser conhecidos.
- [x] Testes de regras, aplicação e cálculo de dano.
- [x] Smoke test do Eldritch Blast real do PHB V5, incluindo `characterLevelBeams` e fórmulas `1d10 each`.
- [x] TypeScript, acessibilidade, compêndio, Jest e release readiness aprovados.

## Próximo bloco — invocations com magias, companions e recursos

### Magias concedidas por invocations

- [ ] Armor of Shadows: Mage Armor sem slot e estado de duração.
- [ ] Ascendant Step: Levitate sem slot conforme requisitos.
- [ ] Gift of the Depths: Water Breathing e recurso de uso.
- [ ] Mask of Many Faces: Disguise Self sem slot.
- [ ] Master of Myriad Forms: Alter Self sem slot.
- [ ] Misty Visions: Silent Image sem slot.
- [ ] Otherworldly Leap: Jump sem slot.
- [ ] Visions of Distant Realms: Arcane Eye sem slot.
- [ ] Whispers of the Grave: Speak with Dead sem slot.
- [ ] Integrar recarga, concentração e ações das magias concedidas.

### Pact of the Chain completo

- [ ] Criar entidade persistida de familiar/companion.
- [ ] Aplicar o creature stat block escolhido.
- [ ] Exibir CA, PV, movimento, sentidos e ações.
- [ ] Modelar initiative própria e comando do Warlock.
- [ ] Permitir ataque quando Pact of the Chain autorizar.
- [ ] Trocar forma sem perder dados não relacionados.

### Lifedrinker e recursos de Hit Dice

- [ ] Modelar Hit Dice disponíveis por classe.
- [ ] Ativar a cura de Lifedrinker após o acerto.
- [ ] Consumir exatamente um Hit Die.
- [ ] Calcular cura `Hit Die + CON`.
- [ ] Registrar a transação e recuperação em descanso longo.

### Outras escolhas internas

- [ ] Gaze of Two Minds: selecionar criatura conectada e estado de vínculo.
- [ ] Gift of the Protectors: gerenciar nomes inscritos no Book of Shadows.
- [ ] Investment of the Chain Master: aplicar melhorias ao familiar.
- [ ] One with Shadows: estado de invisibilidade e encerramento.
- [ ] Witch Sight e Devil's Sight: integrar sentidos à ficha e diagnóstico.

## Blocos posteriores

### Equipamento e combate

- [ ] Equipar/desequipar armadura e escudo explicitamente.
- [ ] Munição e alcance efetivo.
- [ ] Troca de arma durante a rotação.
- [ ] Masteries e propriedades dependentes da arma na simulação.
- [ ] Mapa tático para aplicar movimento forçado.

### Testes móveis

- [ ] E2E Android: Warlock com Agonizing Blast e Eldritch Blast.
- [ ] E2E Android: Pact of the Chain e Lessons of the First Ones.
- [ ] E2E Android: Pact Weapon com Lifedrinker e Eldritch Smite.
- [ ] E2E de level-up com substituição e reconfiguração de invocation.
- [ ] TalkBack e fonte ampliada nos editores de invocation.
- [ ] Repetir os cenários em iOS/VoiceOver.
- [ ] Capturar evidência nativa v3 e promover candidata beta.
