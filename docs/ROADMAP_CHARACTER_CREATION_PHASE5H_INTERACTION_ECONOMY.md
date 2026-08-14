# Roadmap atualizado — criação, progressão e combate

## Concluído neste bloco — economia de interação, mãos e componentes

### Interação com armas no PHB 2024

- [x] Modelar a quantidade de ataques permitida pela Ação de Ataque.
- [x] Considerar Extra Attack das classes oficiais.
- [x] Considerar Thirsting Blade e Devouring Blade.
- [x] Permitir capacidade explícita em feature importada/homebrew.
- [x] Permitir troca de armas entre ataques de Extra Attack.
- [x] Limitar sacar/guardar conforme a quantidade de ataques.
- [x] Diferenciar sacar, guardar, deixar cair e recolher.
- [x] Manter compatibilidade com a operação legada de troca.
- [x] Sacar arma Thrown como parte do ataque.
- [x] Ordenar explicitamente a sequência da rotação.

### Mãos, escudos e componentes

- [x] Simular mão principal e mão secundária ao longo da rotação.
- [x] Validar componentes somáticos.
- [x] Validar componentes materiais.
- [x] Reconhecer Arcane Focus, Druidic Focus, Holy Symbol e Musical Instrument.
- [x] Reconhecer Component Pouch.
- [x] Reconhecer arma fornecida como foco.
- [x] Integrar War Caster à disponibilidade de componente somático.
- [x] Bloquear materiais com custo ausentes no inventário.
- [x] Explicar o conflito de mãos na validação.

### Propriedades de armas por contexto

- [x] Gerar variantes de uma e duas mãos para Versatile.
- [x] Aplicar o dado Versatile apenas com duas mãos.
- [x] Validar Two-Handed somente no momento do ataque.
- [x] Aplicar Loading por ação, bônus ou reação.
- [x] Integrar a exceção de Crossbow Expert.
- [x] Validar ataque Light com outra arma.
- [x] Integrar Nick à Ação de Ataque e ao limite uma vez por turno.
- [x] Integrar Thrown, Ammunition e Loading na mesma sequência.

### Interface, persistência e qualidade

- [x] Exibir foco e ocupação das mãos na tela de equipamento.
- [x] Permitir segurar ou guardar foco.
- [x] Exibir componentes V/S/M na criação da rotação.
- [x] Configurar interação antes/depois de cada ação.
- [x] Permitir reorganizar a sequência.
- [x] Atualizar Character Store para versão 18.
- [x] Manter migração e backup retrocompatíveis.
- [x] Aprovar shape, acessibilidade, TypeScript, Jest e release readiness.

## Próximo bloco — ciclo completo do turno e reações

### Início e fim de turno

- [ ] Criar comandos explícitos de iniciar e encerrar turno.
- [ ] Processar automaticamente expirações no início/fim do turno.
- [ ] Consumir Sap quando o alvo registrar o próximo ataque.
- [ ] Encerrar corretamente as janelas de Vex.
- [ ] Registrar concentração, dano e testes de concentração no histórico.
- [ ] Avançar round somente depois que todos os participantes agirem.

### Ações e reações dos alvos

- [ ] Registrar ataque, salvaguarda, movimento e condições dos alvos.
- [ ] Aplicar desvantagem de Sap ao ataque real do alvo.
- [ ] Permitir que o alvo se levante de Prone gastando movimento.
- [ ] Aplicar Slow ao movimento real do alvo.
- [ ] Integrar ataques de oportunidade.
- [ ] Integrar Ready e gatilhos de reação.

### War Caster e conjuração reativa

- [ ] Permitir magia no lugar de ataque de oportunidade.
- [ ] Validar alvo, alcance e tempo de conjuração da magia reativa.
- [ ] Resolver componentes no instante da reação.
- [ ] Registrar gasto de slot e concentração da reação.

### Componentes e inventário avançado

- [ ] Distinguir materiais com custo dos materiais consumidos.
- [ ] Registrar materiais específicos por quantidade/valor.
- [ ] Consumir automaticamente materiais quando a magia exigir.
- [ ] Permitir confirmar manualmente componentes raros.
- [ ] Tratar focos concedidos por subclasses e itens mágicos.

### Espaço tático avançado

- [x] Modelar movimento do alvo com Speed e terreno difícil.
- [x] Adicionar áreas de efeito e múltiplos alvos por template.
- [x] Adicionar mapa bidimensional opcional.
- [x] Manter o modo linear como alternativa simples.

## Fechamento móvel

- [ ] E2E Android: trocar armas entre ataques.
- [ ] E2E Android: Versatile e Two-Handed com escudo.
- [ ] E2E Android: conjuração bloqueada por componentes.
- [ ] E2E Android: War Caster e foco de conjuração.
- [ ] E2E Android: Loading, Light, Nick e Thrown.
- [ ] TalkBack e fonte ampliada nas telas de equipamento e rotação.
- [ ] Repetir cenários em iOS/VoiceOver.
- [ ] Capturar evidência nativa v3 e promover candidata beta.
