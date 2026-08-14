# Roadmap atualizado — criação, progressão e combate

## Concluído neste bloco

### Equipamento ativo

- [x] Separar inventário possuído de equipamento atualmente usado.
- [x] Equipar e desequipar armadura explicitamente.
- [x] Equipar e desequipar escudo e acessórios defensivos.
- [x] Registrar mão principal e mão secundária.
- [x] Impedir combinações incompatíveis de mãos.
- [x] Recalcular CA e ações ao trocar o loadout.
- [x] Aplicar mecanicamente as escolhas de equipamento da classe e do background.
- [x] Montar um loadout inicial utilizável.

### Armas e munição

- [x] Persistir alcance, propriedades, quantidade e mãos exigidas.
- [x] Controlar munição por tipo e quantidade.
- [x] Somar custo de munição por ataque e repetição.
- [x] Bloquear gasto com munição insuficiente.
- [x] Consumir munição ao registrar a rotação.
- [x] Validar alcance normal e alcance longo.
- [x] Aplicar desvantagem no alcance longo.
- [x] Bloquear ataques fora do alcance máximo.
- [x] Permitir sacar, guardar e trocar arma dentro da rotação.

### Weapon Mastery

- [x] Aplicar somente masteries selecionadas pela ficha.
- [x] Integrar Cleave ao dano condicionado.
- [x] Integrar Graze ao valor esperado dos erros.
- [x] Integrar Nick à economia de ação da rotação.
- [x] Estruturar Push com distância e tamanho máximo.
- [x] Estruturar Sap, Slow, Topple e Vex nos resultados.
- [x] Calcular a CD de Topple.
- [x] Respeitar frequência uma vez por turno de Cleave e Nick.
- [x] Exibir masteries na tela de combate, análise e relatórios de ação.

### Combate posicional básico

- [x] Distância do alvo.
- [x] Tamanho do alvo.
- [x] Cobertura meia, três quartos e total.
- [x] Linha de visão.
- [x] Segundo alvo adjacente para Cleave.
- [x] Cenários salvos com posição e cobertura.
- [x] Comparação de rotações considerando alcance e cobertura.

### Persistência e qualidade

- [x] Store de personagens v17.
- [x] Migração retrocompatível.
- [x] Fixtures atualizadas para o novo contrato de loadout.
- [x] Testes de equipamento, alcance, munição e mastery.
- [x] TypeScript, shape, acessibilidade, compêndio, Jest e release readiness aprovados.

## Próximo bloco — alvos persistentes e resolução tática

### Estado individual dos alvos

- [ ] Criar entidade leve de alvo por cenário/combate.
- [ ] Registrar tamanho, posição, Speed, condições e cobertura por alvo.
- [ ] Permitir que uma rotação escolha o alvo de cada ação.
- [ ] Persistir resultados temporários até o início/fim do turno apropriado.

### Masteries com continuidade

- [ ] Aplicar Sap ao próximo ataque do alvo.
- [ ] Aplicar Slow à Speed do alvo e respeitar limites de acúmulo.
- [ ] Resolver Topple com salvaguarda e condição Prone.
- [ ] Aplicar Vex somente ao próximo ataque contra o mesmo alvo.
- [ ] Registrar Push e Repelling Blast na posição do alvo.
- [ ] Exibir histórico dos efeitos produzidos pela rotação.

### Movimento e terreno

- [ ] Modelar deslocamento disponível e gasto no turno.
- [ ] Integrar terreno difícil.
- [ ] Validar alcance antes e depois do movimento.
- [ ] Permitir aproximação, afastamento e reposicionamento na rotação.
- [ ] Criar base de mapa tático opcional sem torná-lo obrigatório.

### Munição e armas arremessadas

- [ ] Separar munição consumível de arma arremessada possuída.
- [ ] Registrar armas arremessadas no campo de batalha.
- [ ] Criar fluxo pós-combate para recuperar projéteis e armas.
- [ ] Configurar recuperação automática/manual por tipo.

### Economia de interação e mãos

- [ ] Revisar o limite de sacar/guardar armas por Ação de Ataque no PHB 2024.
- [ ] Validar foco, componentes somáticos, escudo e mãos livres.
- [ ] Integrar troca de arma a ataques múltiplos.
- [ ] Tratar propriedades Versatile, Two-Handed e Loading por contexto.

## Fechamento móvel

- [ ] E2E Android: trocar armadura, escudo e armas.
- [ ] E2E Android: consumir munição em uma rotação.
- [ ] E2E Android: alcance longo, cobertura e linha de visão.
- [ ] E2E Android: Cleave, Graze e Nick.
- [ ] TalkBack e fonte ampliada nas telas de equipamento e combate.
- [ ] Repetir cenários em iOS/VoiceOver.
- [ ] Capturar evidência nativa v3 e promover candidata beta.
