# APP-01 — Auditoria disponível e implementação do CatalogLoader

## Estado da entrega

**Resultado:** núcleo do APP-01 implementado e validado como overlay independente.

A árvore-fonte mais recente do aplicativo não estava disponível no runtime desta conversa. Os arquivos localizados eram relatórios, logs e patches de etapas anteriores, não um checkout completo e atual do projeto. Por isso, esta entrega **não afirma que o código foi mesclado ao aplicativo real** e não substitui a execução de `npm run typecheck`, `npm test` e dos gates de release no repositório atual.

## Evidências disponíveis sobre o aplicativo

As evidências históricas indicam:

- React Native/Expo com TypeScript;
- Expo SDK 57;
- armazenamento e importação de compêndio já existentes;
- suíte local previamente aprovada com 86 suítes e 324 testes;
- compêndio embarcado anterior com 1.284 itens;
- projeto EAS vinculado;
- pipeline local com verificação de shape, acessibilidade, fechamento móvel, TypeScript, testes e readiness.

Essas evidências foram usadas apenas para escolher uma forma de integração compatível. Elas não foram tratadas como prova do estado atual do código.

## Lacunas arquiteturais atendidas

O APP-01 acrescenta uma camada separada do compêndio legado, preparada para o catálogo consolidado v4.8.0:

1. carregamento fail-closed;
2. verificação opcional de SHA-256 por adapter;
3. validação estrutural de versão, contagens, IDs e referências;
4. snapshot imutável em memória;
5. índices por entidade, categoria, dependência e alias;
6. pesquisa e resolução de aliases;
7. política de ativação por livro, categoria e entidade;
8. prévia de impacto e detecção de dependências obrigatórias quebradas;
9. snapshots determinísticos da configuração ativa;
10. controlador de runtime com estados `idle`, `loading`, `ready` e `failed`;
11. entrada para bundle estático compatível com Metro;
12. adapter de leitura por `expo-asset`/filesystem injetável.

## Decisões de segurança

- O loader não tenta reparar automaticamente um bundle inconsistente.
- IDs duplicados, endpoints ausentes e referências órfãs bloqueiam a inicialização.
- O checksum só é considerado validado quando um `DigestAdapter` é fornecido.
- Revisão editorial não bloqueia por padrão, mas pode ser transformada em gate com `strictEditorial: true`.
- Desativar um livro é um hard gate.
- Entidades protegidas não são desligadas por categoria ou override individual.
- O pacote não modifica automaticamente `package.json`, stores ou telas do aplicativo.

## Limite desta auditoria

Ainda é necessária uma auditoria sobre o checkout atual para decidir:

- como o novo `CatalogRuntimeController` convive com `useCompendiumStore`;
- onde persistir `CatalogFilterState` e snapshots;
- qual tela inicial executa a inicialização;
- se o bundle de 10,55 MB deve permanecer embarcado ou ser dividido;
- quais queries existentes devem migrar primeiro;
- como medir o custo real em Hermes/Android;
- quais migrações são necessárias para personagens que referenciam IDs do compêndio antigo.

Essa auditoria será concluída após o reenvio do ZIP atual do aplicativo.
