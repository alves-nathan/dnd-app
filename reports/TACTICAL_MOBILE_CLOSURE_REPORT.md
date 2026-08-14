# TACTICAL MOBILE CLOSURE — PREPARAÇÃO NATIVA

Data: 2026-08-11  
Baseline de entrada: `dnd-combat-math-mvp-tactical-optional-map.zip`  
Status: **PREPARADO / validação nativa real pendente**

## Objetivo

Preparar o fechamento móvel da Central Tática sem declarar como aprovadas etapas que exigem emulador/dispositivo real. Esta entrega cobre fixture determinística, flows Maestro, contratos estáveis de UI, audit local da engine, checklist manual Android/iOS e integração com a pipeline de evidência nativa v3 já existente.

## Implementação

### Fixture E2E dedicada

Novo `src/fixtures/e2eTacticalMobile.ts` cria um personagem e cenário determinísticos para os quatro casos de fechamento:

- Wizard nível 4, 32 PV;
- War Caster;
- Longsword com Sap;
- `E2E Fire Bolt` como cantrip de reação;
- `E2E Arcane Lance` de 1º nível;
- 1 slot de 1º nível disponível;
- concentração pré-existente;
- `E2E Training Orc` a 5 ft com Sap pré-aplicado.

`app/e2e-seed.tsx` agora possui ações próprias para preparar e abrir este cenário.

### Flows Maestro

Foram adicionados:

- `91-tactical-initiative-round.yaml`;
- `92-tactical-sap-concentration.yaml`;
- `93-tactical-opportunity-war-caster.yaml`;
- `94-tactical-ready-spell-slot.yaml`.

Os quatro YAMLs foram parseados com sucesso. A execução Maestro real não foi possível neste ambiente.

### UI e acessibilidade

A Central Tática recebeu test IDs estáveis para round, turno, movimento, ataque do alvo, concentração, reação e Ready. Também ganhou um card persistente de estado com:

- PV;
- concentração ativa;
- slots de magia.

`StatRow` agora aceita `testID` e expõe `accessibilityLabel` com rótulo e valor. Cores cinza hard-coded remanescentes na Central Tática foram trocadas por `colors.onSurfaceVariant`, preservando contraste no tema.

### Audit local da engine

`scripts/audit-tactical-mobile-closure.js` executa quatro cenários diretamente no runtime, sem depender de React Native/Maestro:

1. personagem + alvo encerram os turnos e o round avança para 2;
2. Sap impõe desvantagem, é consumido, 12 de dano reduzem PV 32→20 e falha encerra concentração;
3. movimento para fora do alcance cria oportunidade, War Caster oferece `E2E Fire Bolt`, 7 de dano são aplicados e a reação é consumida;
4. Ready com `E2E Arcane Lance` consome o slot ao preparar, substitui a concentração anterior pelo hold de Ready, dispara como reação, causa 9 de dano e não devolve o slot.

Resultado: **4/4 runtime checks + 13/13 contratos estáticos PASS**.

Foi acrescentado também `src/tests/tacticalMobileClosure.test.ts` para Jest quando as dependências do projeto estiverem instaladas.

### Checklist nativo

Novo `docs/TACTICAL_MOBILE_CLOSURE_NATIVE_CHECKLIST.md` documenta:

- execução dos flows 91–94;
- TalkBack + fonte ampliada no Android;
- VoiceOver + Larger Text no iOS;
- revisão de ordem de foco, labels/hints e truncamento;
- captura/finalização da evidência `dnd-combat-beta-native-evidence.v3`;
- critério explícito para promoção beta.

O README gerado por `beta:session:prepare` agora referencia esse checklist.

## Pendência encontrada na baseline

Durante o release gate foi detectado que o ZIP anterior não continha:

`assets/compendium/phb-2024-full-consolidated-import-pack-v2-canonical.json.sha256`

O JSON canônico e o relatório de migração não tinham drift; apenas o arquivo checksum estava ausente. O checksum foi rematerializado pelo gerador oficial:

`a56009f7b229d37b3d077242ca1a6102ef1d973d68f724901bd0ff490cf67c4c`

Depois disso, `compendium:import-v2:release-gate` passou integralmente.

## Validações executadas

- `tactical:mobile-closure:audit`: **PASS — 4/4 runtime + 13/13 contracts**
- YAML Maestro 91–94: **PASS de parsing**
- `typescript:syntax:check`: **PASS — 437 arquivos**
- `app30:typecheck:isolated`: **PASS**
- `check:shape`: **PASS**
- `check:a11y`: **PASS**
- `compendium:bundled:check`: **PASS — 1.284/1.284**
- `check-release-readiness`: **PASS**
- `tactical:statblock-actions:check`: **PASS**
- `tactical:area-multitarget:check`: **PASS**
- `tactical:map:check`: **PASS**
- `compendium:import-v2:release-gate`: **PASS** após restauração do checksum ausente
- `package-lock.json`: **inalterado** (`4bb7ad77f176b98ba5fd4e7c135c57a1f27d24770f68ee049cb1c77338322d5d`)

## O que não foi executado

### Android nativo

`e2e:doctor:android` está bloqueado porque:

- Maestro CLI não está instalado/disponível;
- `adb` não está instalado/disponível.

Portanto, **não há afirmação de Android E2E aprovado, TalkBack aprovado ou benchmark nativo aprovado** nesta entrega.

### iOS nativo

`e2e:doctor:ios` está bloqueado porque:

- Maestro CLI não está instalado/disponível;
- o host atual é Linux e execução local iOS exige macOS;
- `xcrun` não está disponível.

Portanto, **não há afirmação de iOS/VoiceOver aprovado**.

### Evidência e beta

`beta:evidence:validate` permanece bloqueado porque `artifacts/beta-evidence/android.json` e `artifacts/beta-evidence/ios.json` ainda não existem. A candidata **não foi promovida**.

O EAS project ID está configurado corretamente em `app.json`: `d2e0ddd4-a2f1-4d13-9415-a634c4ac1e94`.

## Roadmap

Os sete itens principais do bloco “Fechamento móvel” continuam desmarcados até a execução nativa real. O roadmap agora distingue explicitamente o que já foi preparado/validado localmente do que ainda depende de Android/iOS.

## Próxima ação operacional

Em uma máquina/dispositivo com Maestro + ADB, executar os flows 91–94 e revisar TalkBack/fonte ampliada; em seguida repetir em macOS/iOS com VoiceOver/Larger Text. Depois preencher os checklists da sessão, finalizar evidência v3 de ambas as plataformas, validar com `beta:evidence:validate` e somente então promover a candidata beta.
