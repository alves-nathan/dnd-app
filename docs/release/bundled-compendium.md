# Compêndio incluído no aplicativo

O aplicativo inclui um pacote de compêndio versionado para os fluxos de criação, progressão e testes da beta.

## Fonte canônica

- Arquivo: `assets/compendium/phb-2024-full-consolidated-import-pack-v2-canonical.json`
- A importação preserva IDs estáveis, fonte, status de revisão e vínculos entre classes, subclasses, features, feats, magias e equipamentos.
- O conteúdo incluído deve passar por `npm run compendium:bundled:check` antes de uma candidata de release.

## Segurança e atualização

O pacote incluído usa `dnd-combat-import.v2`. Em uma instalação vazia ele é persistido diretamente pelo caminho V2 transacional. Em instalações que já possuem o mesmo PHB bundled em V1, a hidratação executa uma reconciliação segura: somente um preview com **0 creates, 0 updates e 0 conflicts** pode promover o pack para V2 e preencher `contentHash`. Storage IDs, decisões de revisão e mapeamentos locais são preservados. Se o conteúdo raw local divergir, a migração automática é adiada e nenhum dado é sobrescrito.

O asset V1 permanece versionado para compatibilidade, regressão e importação de arquivos antigos; ele não é mais o asset de bootstrap de produção.
