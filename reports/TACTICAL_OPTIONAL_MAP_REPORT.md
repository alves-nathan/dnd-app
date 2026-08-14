# TACTICAL OPTIONAL MAP REPORT

## Baseline

Esta entrega parte de `dnd-combat-math-mvp-tactical-area-multitarget` e conclui o bloco **Mapa opcional** do roadmap tático sem remover o modo linear existente.

## Objetivo

Adicionar um modo espacial 2D opcional ao combate tático, preservando compatibilidade com cenários existentes e evitando inferências geométricas falsas quando o cenário não possui informação suficiente.

## Implementação

### 1. Modo linear preservado

`CombatScenario.spatialMode` aceita `linear | map2d` e migrações antigas assumem `linear`. O campo histórico `positionFeet` continua sendo utilizado no modo linear.

### 2. Coordenadas X/Y opcionais

Foram adicionadas posições em pés para personagem e alvos:

- `actorMapPosition`
- `TacticalTarget.mapPosition`

Ao habilitar o mapa em um cenário antigo, as posições lineares existentes são projetadas inicialmente no eixo X, com Y = 0, sem perda dos dados anteriores.

### 3. Diagonal configurável

O cenário suporta três políticas:

- `fiveFeet`: diagonal conta como 5 ft por quadrado equivalente;
- `alternating5_10`: diagonais alternam custo equivalente a 5/10 ft;
- `euclidean`: distância euclidiana em pés.

A mesma política alimenta alcance, adjacência, movimento, ataques de stat block e Cleave.

### 4. Terreno difícil por região

Foram introduzidas `TacticalTerrainRegion` retangulares ou circulares. O custo de deslocamento considera somente os trechos do caminho que atravessam regiões difíceis. O antigo modo global de terreno difícil permanece disponível como opção para todo o campo.

### 5. Cobertura e linha de visão

Cobertura e linha de visão continuam explícitas por alvo. Não há inferência automática a partir de obstáculos porque o mapa ainda não possui um modelo de paredes/obstáculos. Isso evita afirmar cobertura ou bloqueio de visão sem dados suficientes.

### 6. Movimento espacial

Movimento do personagem e dos alvos usa X/Y no modo 2D, incluindo:

- movimento normal;
- terreno difícil regional;
- movimento parcial quando o custo excede o restante;
- oportunidade baseada em distância espacial;
- Push/Repelling Blast;
- Cleave por adjacência espacial.

### 7. Áreas no mapa

A camada espacial pode selecionar automaticamente alvos quando a geometria é segura e suficientemente definida, incluindo casos de:

- sphere;
- cylinder;
- emanation;
- line;
- cone;
- square em contexto suportado.

Formas customizadas, cubos/origens ambíguas e geometrias sem orientação suficiente continuam com seleção manual. O usuário sempre pode ajustar a seleção.

### 8. Persistência

`combatScenarioStore` foi atualizado da versão 4 para 5. A migração preserva cenários antigos e normaliza automaticamente os novos campos espaciais.

## Arquivos principais

- `src/rules-engine/targeting/spatialMap.ts`: cálculo espacial, diagonais, terreno e geometria de área.
- `src/rules-engine/turns/tacticalCombat.ts`: integração do mapa com combate, movimento, forced movement e Cleave.
- `src/rules-engine/turns/turnCycle.ts`: movimento e ações de stat block em 2D.
- `src/rules-engine/turns/analyzeTurn.ts`: preview/análise de movimento espacial.
- `app/characters/[id]/tactical.tsx`: controles de modo, coordenadas, diagonal, terreno e auto seleção de áreas.
- `src/types/index.ts`: tipos espaciais.
- `src/store/combatScenarioStore.ts`: migration v5.
- `src/tests/tacticalSpatialMap.test.ts`: regressões unitárias.
- `scripts/audit-tactical-map.js`: audit runtime + contratos estáticos.

## Validações executadas

`npm run tactical:map:check`:

- Tactical map runtime audit: **PASS — 6/6**
- Tactical map static contracts: **PASS — 11/11**
- TypeScript syntax: **PASS — 435 arquivos**
- Project shape: **PASS**
- Accessibility contracts: **PASS**
- Bundled PHB V2: **PASS — 1.284 itens / 1.284 IDs únicos**
- Release readiness: **PASS**

Também foram executados durante a implementação:

- `npm run tactical:statblock-actions:check`: **PASS**
- `npm run tactical:area-multitarget:check`: **PASS**
- `npm run compendium:import-v2:release-gate`: **PASS**

O `tsc --noEmit` e o Jest completos não puderam ser executados nesta cópia porque o ZIP de baseline não contém `node_modules`. Na instalação local, executar:

```bash
npm run typecheck
npm run test:tactical-map
npm run tactical:map:check
npm test -- --runInBand
```

## Limites deliberados

- O mapa não possui ainda entidades de parede/obstáculo; por isso cobertura/LOS não são inferidas geometricamente.
- O cálculo de terreno usa o segmento direto entre origem e destino; não há pathfinding em grade.
- Geometrias de área ambíguas permanecem manuais em vez de usar aproximações potencialmente incorretas.
- O modo linear permanece totalmente suportado.

## Roadmap

O bloco **Mapa opcional** está concluído. O próximo bloco registrado no roadmap é **Fechamento móvel**:

1. E2E Android do ciclo completo de iniciativa/round;
2. ataque do alvo, Sap e concentração;
3. oportunidade e War Caster;
4. Ready com magia e slot comprometido;
5. TalkBack e fonte ampliada;
6. repetição dos cenários em iOS/VoiceOver;
7. evidência nativa v3 e promoção de candidata beta.
