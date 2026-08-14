# APP-08 — Manifesto de compatibilidade de regras e diagnóstico de personagens

## Objetivo

Registrar, por personagem, quais snapshots, livros, fontes e entidades sustentam a ficha e comparar essas referências com o catálogo, o compêndio e os filtros atualmente ativos. O diagnóstico não modifica automaticamente conteúdo mecânico nem referências do personagem.

## Implementação

### Manifesto de regras

`src/characters/characterCompatibility.ts` gera o manifesto versionado `dnd-character-rules-manifest.v1` com:

- snapshot registrado na ficha;
- snapshot e versão do catálogo atual;
- snapshots encontrados nos vínculos aplicados;
- livros oficiais utilizados;
- fontes locais utilizadas;
- IDs de entidades oficiais;
- IDs de itens locais;
- função de cada referência na ficha;
- origem da descoberta da referência;
- situação atual: disponível, revisão, desativada ou ausente.

O manifesto é gerado em memória de forma determinística e somente leitura. A criação do relatório não altera o personagem.

### Diagnósticos

O APP-08 identifica:

- divergência entre o snapshot da ficha e o snapshot atual;
- entidade oficial removida ou inexistente;
- livro, categoria ou entidade oficial desativada;
- payload mecânico oficial indisponível;
- revisão editorial pendente;
- item local ausente;
- fonte local desativada;
- item local ainda não validado;
- vínculo aplicado marcado como `needsReview`.

Cada ocorrência contém ações guiadas. Essas ações apenas abrem o gerenciamento de conteúdo, o compêndio ou o editor do personagem. Substituições e remoções continuam exigindo uma decisão manual em fluxo próprio.

### Gate antes da ficha

`app/characters/[id]/index.tsx` consulta a compatibilidade antes de apresentar a ficha:

- ficha compatível: abre normalmente;
- avisos ou bloqueios: encaminha ao manifesto;
- diagnóstico ainda carregando: apresenta estado de espera seguro;
- diagnóstico indisponível: não abre silenciosamente a ficha.

Na tela do manifesto, o usuário pode revisar as ocorrências ou escolher explicitamente **Abrir ficha mesmo assim**. Essa confirmação vale apenas para a navegação atual e não altera filtros ou referências.

### Interfaces

Foram adicionadas:

- `app/characters/[id]/compatibility.tsx`: diagnóstico completo de uma ficha;
- `app/character-compatibility.tsx`: visão global dos manifestos;
- acesso em Ajustes;
- acesso direto dentro da ficha;
- rota registrada no Expo Router.

## Segurança e compatibilidade

- Nenhuma migração de store foi necessária; a versão permanece 21.
- Nenhum personagem é atualizado durante a geração do manifesto.
- Entidades removidas permanecem registradas para resolução manual.
- Filtros desativados não apagam conteúdo já aplicado.
- O usuário mantém a possibilidade explícita de abrir a ficha após reconhecer o diagnóstico.
- O APP-07 e seu gate obrigatório de build candidate permanecem intactos.

## Validação

Passaram:

- todos os contratos e harnesses APP-02 a APP-07;
- shape do projeto;
- contratos mínimos de acessibilidade;
- pacote mecânico com 1.284 itens;
- catálogo v4.8.0 com 5.841 entidades e 15.385 dependências;
- auditoria determinística do lockfile;
- contratos estáticos APP-08;
- parsing sintático de 301 arquivos TS/TSX;
- typecheck estrito isolado do núcleo do manifesto;
- harness APP-08 com catálogo real: 18/18 asserções.

O harness simulou:

- snapshot antigo;
- classe oficial disponível;
- magia oficial desativada;
- entidade oficial removida;
- feat local ainda não validado.

O relatório resultante ficou bloqueado, registrou os quatro tipos de ocorrência esperados e confirmou que o objeto do personagem permaneceu byte a byte inalterado.

## Limitação do ambiente

O typecheck integral e a suíte Jest completa continuam bloqueados porque a codebase não contém `node_modules` e o registry disponível não fornece todas as versões fixadas. Os comandos foram executados e falharam exclusivamente por ausência de:

- `expo/tsconfig.base`;
- tipos de Jest, Node e React;
- executável `jest`.

Nenhuma versão foi flexibilizada e nenhum bloqueio foi convertido em sucesso.

## Próximo lote

**APP-09 — plano de remediação de compatibilidade e commit transacional:** permitir selecionar substituições ou remoções para referências incompatíveis, apresentar diff completo, validar dependências e aplicar todas as decisões em uma única transação auditável, sem correções automáticas.
