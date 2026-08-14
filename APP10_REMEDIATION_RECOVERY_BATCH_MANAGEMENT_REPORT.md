# APP-10 — Recuperação e gestão em lote dos planos de remediação

## Objetivo

Concluir o ciclo iniciado no APP-09, tornando os planos de remediação persistidos seguros após reinício e oferecendo uma visão global dos personagens afetados, sem introduzir commit coletivo nem qualquer correção automática.

O lote mantém os princípios já estabelecidos:

- cada personagem é uma unidade transacional independente;
- a ficha publicada não é alterada durante diagnóstico, recuperação ou preview;
- planos conflitantes ou criados para outro snapshot são bloqueados;
- registros inválidos ou órfãos são isolados em quarentena;
- decisões continuam exigindo ação explícita do usuário.

## Auditoria do APP-09

O APP-09 já fornecia plano persistido, preview, commit atômico, descarte e rollback. A persistência, porém, ainda não classificava o estado do plano depois da hidratação. Também não existia uma visão agregada capaz de mostrar:

- quais planos foram recuperados após reinício;
- quais ficaram incompatíveis com o catálogo atual;
- quais entraram em conflito com uma ficha editada;
- quais personagens compartilham a mesma entidade ou livro problemático;
- quais planos estão prontos para commit individual.

## Implementação

### Reconciliação após hidratação

O módulo `src/characters/compatibilityRemediationRecovery.ts` classifica cada plano persistido como:

- `ready`: plano atual e reconhecido;
- `recoverable`: recuperado após reinício e aguardando confirmação;
- `conflicted`: a ficha divergiu do fingerprint-base do plano;
- `staleCatalog`: o plano foi criado para outro snapshot do catálogo;
- `orphaned`: o personagem deixou de existir;
- `invalid`: o registro persistido não corresponde ao schema esperado.

Planos recuperáveis permanecem bloqueados até que o usuário confirme a retomada. Planos conflitantes e antigos não podem ser editados nem confirmados; devem ser descartados e recriados a partir de um diagnóstico atual.

### Quarentena

Planos órfãos e registros inválidos são retirados do conjunto ativo e armazenados em `compatibilityRemediationQuarantine`.

A quarentena:

- não altera personagens;
- não bloqueia planos válidos de outros personagens;
- preserva o registro bruto para diagnóstico;
- pode ser descartada individualmente;
- remove precisamente os avisos associados ao registro descartado.

### Visão agregada

O módulo `src/characters/compatibilityRemediationBatch.ts` produz uma visão somente leitura com:

- personagens diagnosticados;
- planos ativos;
- planos recuperados;
- conflitos;
- planos criados em catálogo antigo;
- planos prontos;
- decisões, substituições, remoções e migrações de snapshot;
- bloqueios antes e depois do preview;
- ocorrências compartilhadas por entidade;
- ocorrências compartilhadas por livro/fonte.

Não existe API de commit em lote. A visão agregada apenas organiza e pré-visualiza. Cada confirmação continua chamando o commit atômico de um único personagem.

### Interface

A rota `app/character-compatibility.tsx` passou a funcionar como central de **Planos e manifestos**.

Ela permite:

- revisar o resumo global;
- reconhecer individualmente um plano recuperado;
- abrir o diagnóstico de cada personagem;
- confirmar um plano pronto, individualmente;
- descartar um plano individual;
- visualizar entidades e livros que afetam várias fichas;
- revisar e remover registros em quarentena.

A tela individual `app/characters/[id]/compatibility.tsx` agora:

- exibe o estado de recuperação;
- exige a ação “Retomar com segurança” antes de editar;
- bloqueia decisões, limpeza e commit em conflitos ou catálogo antigo;
- oferece acesso à visão global.

### Persistência

A store de personagens passou para a versão **23**.

Foram adicionados:

- `compatibilityRemediationRecovery`;
- `compatibilityRemediationQuarantine`.

A hidratação reconcilia automaticamente os planos. Ao remover personagens ou substituir o conjunto de fichas, planos órfãos são isolados sem afetar registros válidos.

### Fluxos E2E

Foram adicionados quatro fluxos Maestro:

1. criação de plano sem alteração da ficha;
2. descarte sem alteração da ficha;
3. commit individual;
4. rollback do commit de remediação.

O gate nativo passou a reconhecer oito fluxos transacionais no total: quatro do APP-06 e quatro do APP-10.

## Segurança transacional

O APP-10 não oferece commit coletivo. O harness confirmou que:

- confirmar o plano do personagem A não altera a ficha B;
- o plano do personagem B continua persistido;
- conflito em uma ficha não bloqueia a revisão das demais;
- preview agregado não modifica nenhum personagem;
- quarentena não interfere nos commits válidos.

## Validação executada

Passaram:

- shape do projeto;
- contratos mínimos de acessibilidade;
- pacote mecânico incluído com 1.284 itens;
- catálogo v4.8.0 com 5.841 entidades e 15.385 dependências;
- contratos APP-02 a APP-09;
- contratos estáticos APP-10;
- parsing sintático de 306 arquivos TS/TSX;
- typecheck estrito isolado do núcleo de recuperação e agregação;
- typecheck estrito isolado da store e migrações;
- typecheck estrito isolado do novo teste;
- harness APP-10 com 22 asserções;
- descoberta dos oito fluxos do gate nativo.

### Cenário do harness

O harness classificou:

- 1 plano recuperável;
- 1 plano criado para catálogo antigo;
- 1 plano conflitante;
- 2 registros em quarentena.

Na visão agregada, três personagens compartilhavam a mesma entidade removida. Somente um plano estava pronto para commit. Após confirmar esse plano, a ficha e o plano de outro personagem permaneceram inalterados.

## Limitações do ambiente

O typecheck integral e a suíte Jest completa foram tentados, mas a codebase não contém `node_modules`.

O typecheck integral ficou bloqueado pela ausência de:

- `expo/tsconfig.base`;
- tipos de Jest;
- tipos de Node;
- tipos de React.

A suíte Jest não iniciou porque o executável `jest` não está instalado.

O gate nativo foi executado em modo diagnóstico e encontrou corretamente os oito fluxos, mas ficou bloqueado por:

- dependências integrais ausentes;
- ADB indisponível;
- Maestro indisponível;
- nenhum dispositivo Android acessível.

Nenhum bloqueio foi convertido em aprovação.

## Próximo lote recomendado

**APP-11 — impacto preventivo das alterações de catálogo**:

- calcular personagens afetados antes de desativar livro, categoria ou entidade;
- mostrar ocorrências compartilhadas e severidade no preview do filtro;
- exigir reconhecimento explícito do impacto;
- abrir planos de remediação para as fichas afetadas;
- impedir mudança silenciosa que torne personagens incompatíveis;
- preservar commits independentes por personagem;
- adicionar cenários E2E para desativação, cancelamento e remediação preventiva.
