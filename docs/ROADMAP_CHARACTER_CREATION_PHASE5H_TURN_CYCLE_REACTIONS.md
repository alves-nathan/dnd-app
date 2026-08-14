# Roadmap atualizado — criação, progressão e combate

## Concluído neste bloco — ciclo completo de turno e reações

### Início e fim de turno

- [x] Criar comandos explícitos de iniciar e encerrar turno.
- [x] Persistir participantes, iniciativa, turno ativo e reação disponível.
- [x] Impedir participantes de agir duas vezes no mesmo round.
- [x] Avançar o round somente depois que todos os participantes agirem.
- [x] Processar efeitos no início e no fim do turno.
- [x] Expirar Sap e Slow no início do próximo turno da fonte.
- [x] Encerrar a janela de Vex ao ser consumida ou no fim do próximo turno da fonte.
- [x] Registrar eventos de turno no histórico tático.

### Ações reais dos alvos

- [x] Registrar ataque, acerto, erro e dano.
- [x] Consumir Sap no próximo ataque real do alvo.
- [x] Aplicar dano aos PV e PV temporários do personagem.
- [x] Calcular e registrar CD de concentração.
- [x] Encerrar concentração quando a salvaguarda falhar.
- [x] Registrar salvaguardas dos alvos.
- [x] Aplicar condições textuais em falhas.
- [x] Modelar movimento real usando Speed.
- [x] Aplicar Slow e terreno difícil ao movimento.
- [x] Permitir levantar de Prone gastando metade da Speed.

### Ataques de oportunidade e War Caster

- [x] Detectar saída do alcance.
- [x] Criar reação pendente.
- [x] Filtrar ataques corpo a corpo elegíveis.
- [x] Consumir a reação após resolver.
- [x] Permitir magia de War Caster no lugar do ataque.
- [x] Validar alvo único, área, alcance e tempo de conjuração.
- [x] Validar componentes no instante da reação.
- [x] Gastar slot e recursos.
- [x] Iniciar concentração da magia reativa.

### Ready

- [x] Selecionar ação com custo de Ação.
- [x] Registrar gatilho perceptível.
- [x] Disparar o gatilho como reação.
- [x] Exigir a mesma ação inicialmente preparada.
- [x] Gastar slot e recursos de magia ao preparar.
- [x] Manter magia preparada por concentração.
- [x] Não gastar recursos novamente ao liberar.
- [x] Encerrar Ready ao liberar, cancelar ou expirar.
- [x] Não devolver recursos de Ready cancelado ou expirado.

### Interface, persistência e qualidade

- [x] Exibir ordem de turno e iniciativa.
- [x] Exibir reação e movimento gasto.
- [x] Exibir ataques, movimento e salvaguardas dos alvos.
- [x] Exibir opções de reação com descrição mecânica.
- [x] Permitir PV opcionais para alvos.
- [x] Atualizar o store de cenários para versão 3.
- [x] Manter cenários anteriores retrocompatíveis.
- [x] Aprovar shape, acessibilidade, TypeScript, Jest e release readiness.

## Próximo bloco — inventário consumível e espaço tático avançado

### Materiais e inventário de conjuração

- [ ] Distinguir material com custo de material consumido.
- [ ] Criar inventário estruturado de componentes específicos.
- [ ] Armazenar quantidade, valor unitário e unidade monetária.
- [ ] Consumir automaticamente materiais exigidos pela magia.
- [ ] Bloquear conjuração quando a quantidade for insuficiente.
- [ ] Permitir confirmação manual para componentes raros ou ambíguos.
- [ ] Tratar focos concedidos por subclasses, feats e itens mágicos.
- [ ] Registrar transações de componentes no histórico.

### Ações dos stat blocks

- [x] Importar ataques dos creature stat blocks para os alvos do cenário.
- [x] Preencher bônus de ataque, dano, alcance e salvaguardas.
- [x] Calcular acerto contra a CA do personagem.
- [x] Permitir dano médio ou rolagem real.
- [x] Importar recursos e recargas dos monstros.
- [x] Modelar reações próprias dos alvos.

Nota: ações com fórmulas dependentes do conjurador (por exemplo `casterSpellAttack`, `casterSpellSaveDC` ou multiataques sem bônus fixo) permanecem disponíveis no stat block, mas usam fallback manual até que o cenário tenha contexto explícito do conjurador.

### Áreas e múltiplos alvos

- [x] Criar templates de linha, cone, cubo, esfera e cilindro.
- [x] Selecionar múltiplos alvos por ação.
- [x] Resolver salvaguarda individual por alvo.
- [x] Aplicar dano e condições individualmente.
- [x] Integrar Cleave, áreas e alvos secundários persistentes.

Nota: enquanto o cenário estiver no modo linear, a geometria 2D da área não é inferida automaticamente. O template exibe a forma/dimensões importadas e o usuário marca explicitamente quais alvos estão dentro da área; saves, dano, condições e PV são então resolvidos individualmente. A automação geométrica fica reservada ao bloco **Mapa opcional**.

### Mapa opcional

- [x] Manter o modo linear atual.
- [x] Adicionar coordenadas X/Y opcionais.
- [x] Calcular distância diagonal configurável.
- [x] Representar terreno difícil por área.
- [x] Representar cobertura e linha de visão por alvo.

Nota: o modo 2D usa coordenadas em pés e oferece três regras de diagonal (`5 ft`, `5/10` e euclidiana). Regiões retangulares/circulares de terreno difícil entram no custo do segmento realmente atravessado. Cobertura e linha de visão continuam sendo propriedades explícitas por alvo (não são inferidas de obstáculos inexistentes). Para áreas com geometria segura, linha/cone/esfera/cilindro/emanação podem selecionar alvos automaticamente a partir do alvo de referência; formas ambíguas permanecem manuais.

## Fechamento móvel

- [ ] E2E Android: ciclo completo de iniciativa e round.
- [ ] E2E Android: ataque do alvo, Sap e concentração.
- [ ] E2E Android: oportunidade e War Caster.
- [ ] E2E Android: Ready com magia e slot comprometido.
- [ ] TalkBack e fonte ampliada na central tática.
- [ ] Repetir cenários em iOS/VoiceOver.
- [ ] Capturar evidência nativa v3 e promover candidata beta.

Preparação automatizada concluída nesta baseline:

- [x] Fixture E2E determinística da Central Tática com War Caster, Sap, concentração e slot de 1º nível.
- [x] Flows Maestro 91–94 preparados para os quatro cenários funcionais do fechamento móvel.
- [x] Audit local da engine cobre iniciativa/round, Sap+concentração, oportunidade+War Caster e Ready+slot comprometido.
- [x] Test IDs/estado persistente adicionados para assertions nativas e revisão por leitor de tela.
- [x] Checklist Android TalkBack/fonte ampliada e iOS VoiceOver/Larger Text documentado em `docs/TACTICAL_MOBILE_CLOSURE_NATIVE_CHECKLIST.md`.
- [x] Pipeline existente de evidência `dnd-combat-beta-native-evidence.v3` reutilizada sem criar um formato paralelo.
- [x] Runner Android focado executa somente os flows 91–94 via tag `tactical-mobile-closure` e grava JUnit/logcat/screenshot em diretório dedicado.
- [x] Runner de artefatos suporta `MAESTRO_HOST`/`ADB_SERVER_SOCKET` para host Android remoto e filtragem por tags sem alterar a suíte beta completa.
- [x] Resolver do Maestro procura também `~/.maestro/bin/maestro`, reduzindo falso negativo após instalação padrão da CLI.

Nota de fechamento: os itens principais acima permanecem pendentes até execução real em dispositivo/emulador. Audits locais e YAML válido comprovam preparação e regras, mas não substituem TalkBack/VoiceOver, performance nativa ou a evidência v3 assinada pela sessão.
