# Roadmap atualizado — Warlock, companions e recursos

## Concluído neste bloco

### Magias concedidas por invocations

- [x] Armor of Shadows: Mage Armor sem spell slot.
- [x] Ascendant Step: Levitate autocentrado sem spell slot.
- [x] Fiendish Vigor: False Life sem spell slot e nota sobre PV temporários máximos.
- [x] Gift of the Depths: Water Breathing uma vez por descanso longo.
- [x] Mask of Many Faces: Disguise Self sem spell slot.
- [x] Master of Myriad Forms: Alter Self autocentrado sem spell slot.
- [x] Misty Visions: Silent Image sem spell slot.
- [x] One with Shadows: Invisibility autocentrada com requisito ambiental documentado.
- [x] Otherworldly Leap: Jump autocentrado sem spell slot.
- [x] Visions of Distant Realms: Arcane Eye sem spell slot.
- [x] Whispers of the Grave: Speak with Dead sem spell slot.
- [x] Recurso de uso uma vez por descanso longo.
- [x] Remoção e reconciliação por invocation de origem.
- [x] Ações com concentração, duração, alvo próprio e consumo correto.

### Pact of the Chain completo

- [x] Entidade persistente de familiar/companion.
- [x] Aplicação do creature stat block escolhido.
- [x] CA, PV, deslocamentos, sentidos, idiomas, traits e ações.
- [x] Iniciativa própria.
- [x] Regra de comando do ataque.
- [x] Troca de forma preservando nome personalizado, PV e notas.
- [x] Tela Ficha → Pact Familiar.
- [x] Edição de nome, PV e notas.
- [x] Cálculo mínimo, máximo e médio dos ataques estruturados.

### Investment of the Chain Master

- [x] Escolha entre voo e natação.
- [x] Movimento mínimo de 40 pés.
- [x] Comando do ataque por ação bônus.
- [x] Indicação de uso da CD de magia do Warlock.
- [x] Indicação da reação defensiva.
- [x] Validação na criação, level-up e tela posterior.

### Lifedrinker e Hit Dice

- [x] Pools de Hit Dice derivados por classe.
- [x] Suporte a multiclasse e diferentes tipos de dado.
- [x] Acionamento da cura após acerto com Pact Weapon.
- [x] Escolha do pool a gastar.
- [x] Consumo exato de um Hit Die.
- [x] Cura igual à rolagem mais o modificador de Constituição.
- [x] Limite pelo PV máximo.
- [x] Histórico de gasto e cura.
- [x] Recuperação em descanso longo.
- [x] Edição de PV máximo, atual e temporário.

### Persistência e qualidade

- [x] Store de personagens v15.
- [x] Rascunho de criação v7.
- [x] Migração retrocompatível.
- [x] Testes de magias, recursos, familiar, ataque e cura.
- [x] TypeScript, shape, acessibilidade, compêndio, Jest e release readiness aprovados.

## Próximo bloco — sentidos, vínculos e recursos especializados

### Gaze of Two Minds

- [ ] Selecionar e persistir a criatura conectada.
- [ ] Registrar distância, estado do vínculo e encerramento.
- [ ] Permitir usar os sentidos da criatura conectada.
- [ ] Permitir que a origem de conjuração seja a posição da criatura quando a regra autorizar.
- [ ] Integrar concentração, alcance e diagnóstico de ações.

### Gift of the Protectors

- [ ] Gerenciar nomes inscritos no Book of Shadows.
- [ ] Respeitar o limite de nomes.
- [ ] Registrar uso compartilhado da proteção.
- [ ] Recuperar o recurso no descanso longo.
- [ ] Remover inscrições órfãs ao perder Pact of the Tome ou a invocation.

### Sentidos de invocations

- [ ] Devil's Sight integrado aos sentidos da ficha.
- [ ] Witch Sight integrado aos sentidos e diagnóstico.
- [ ] Exibir alcance e limitações de cada sentido.
- [ ] Evitar duplicação ao receber o mesmo sentido de outra origem.

### One with Shadows completo

- [ ] Estado ativável de invisibilidade.
- [ ] Exigir luz fraca ou escuridão.
- [ ] Encerrar ao mover, usar ação, ação bônus ou reação conforme a regra aplicável.
- [ ] Integrar o efeito ao gerenciador de condições e concentração.

### Companion avançado

- [ ] Recursos limitados do familiar.
- [ ] Condições e efeitos ativos próprios.
- [ ] Salvaguardas e CD de magia do Warlock em ações estruturadas.
- [ ] Integrar ataque do familiar como etapa opcional da rotação, respeitando ação bônus ou ataque substituído.
- [ ] Histórico de dano, cura e alterações de PV do familiar.

## Blocos posteriores

### Equipamento e combate

- [ ] Equipar e desequipar armadura e escudo explicitamente.
- [ ] Munição e alcance efetivo.
- [ ] Troca de arma durante a rotação.
- [ ] Masteries dependentes da arma na simulação.
- [ ] Mapa tático para movimento forçado e requisitos ambientais.

### Testes móveis

- [ ] E2E Android: magias concedidas por invocations.
- [ ] E2E Android: familiar, troca de forma e Investment.
- [ ] E2E Android: Lifedrinker, PV e descanso longo.
- [ ] TalkBack e fonte ampliada na tela Pact Familiar.
- [ ] Repetir os cenários em iOS/VoiceOver.
- [ ] Capturar evidência nativa v3 e promover candidata beta.
