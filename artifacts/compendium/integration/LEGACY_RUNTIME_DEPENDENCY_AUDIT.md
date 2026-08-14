# APP-INTEGRATION-05 - Auditoria de dependências legacy residuais

Status: **PASS_WITH_TWO_DEFERRED_MONSTER_BASES**

## Resultado

- Spelljammer: 55 refs PHB 2014 únicas (171 ocorrências) foram reconciliadas para PHB 2024.
- Correções de evidência da fonte: Hunter's Mark em Forge; Psurlon e Astral Elf Commander em Spelljammer.
- Tasha: Zombie, Cat, Giant Spider, Skeleton, Potion of Healing e Exhaustion agora usam entidades PHB 2024 quando disponíveis.
- Dependências residuais runtime-required: **0**.
- Dependências display-only: **22 únicas**; não bloqueiam importação nem exigem delta neste momento.
- Dependências provenance-only: **2 únicas**; preservadas somente como histórico da adaptação.
- XGtE residual: **0**. DMG 2014 delta: **não necessário**. MM 2014 completo: **não necessário**.

## Decisão

Não importar DMG/MM/Xanathar inteiros. **Mage** e **Flumph** agora existem no bundle como um delta mínimo do Monster Manual atual, e as variantes de Light of Xaryxis apontam para esses IDs. As referências MM 2014 restantes são apenas display/contexto, portanto não bloqueiam execução.

## Validação

- IDs OCR/slug malformados remanescentes: 0
- refs PHB 2014 fora de proveniência: 0
- refs XGtE residuais: 0
- runtime-required únicas: 0
- resultado: **PASS**
