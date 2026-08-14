# Fechamento móvel — Central Tática

Este checklist fecha a validação nativa dos fluxos táticos preparados pelos cenários Maestro 91–94. Os audits Node/Jest comprovam a regra e os contratos estáticos, mas **não substituem** a execução real em Android/iOS, TalkBack/VoiceOver ou fonte ampliada.

## Pré-condições

Use uma build `beta-candidate` com o seed E2E habilitado. Confirme o ambiente antes de capturar evidência:

```bash
npm run e2e:doctor:android
npm run e2e:doctor:ios
npm run tactical:mobile-closure:check
```

A evidência final deve continuar usando `dnd-combat-beta-native-evidence.v3`.

## Cenários funcionais obrigatórios

### 91 — iniciativa e round

Execute `.maestro/flows/91-tactical-initiative-round.yaml` e confirme visualmente que:

- o personagem inicia e encerra o turno;
- o alvo inicia e encerra o turno;
- o round muda de 1 para 2 apenas depois que ambos agem;
- reação e movimento são reinicializados de forma coerente no novo round.

### 92 — ataque do alvo, Sap e concentração

Execute `.maestro/flows/92-tactical-sap-concentration.yaml` e confirme que:

- o próximo ataque do alvo recebe desvantagem por Sap;
- Sap é consumido após o ataque;
- 12 de dano reduzem 32 PV para 20 PV;
- a falha de concentração encerra o efeito ativo;
- a mensagem e o log descrevem o ocorrido sem depender apenas de cor.

### 93 — oportunidade e War Caster

Execute `.maestro/flows/93-tactical-opportunity-war-caster.yaml` e confirme que:

- afastar o alvo de 5 ft para fora do alcance cria uma reação pendente;
- `E2E Fire Bolt` aparece como opção válida por War Caster;
- resolver a reação causa 7 de dano;
- a reação do personagem passa para usada;
- o log identifica a magia e o dano.

### 94 — Ready com magia e slot comprometido

Execute `.maestro/flows/94-tactical-ready-spell-slot.yaml` e confirme que:

- preparar `E2E Arcane Lance` consome o slot de nível 1 imediatamente;
- o estado mostra `Slots: 1º 0/1` antes do gatilho;
- Ready cria a concentração `Ready: E2E Arcane Lance` e substitui concentração anterior;
- ao disparar o gatilho, a mesma magia é resolvida como reação;
- o slot permanece 0/1 depois da resolução;
- a concentração de Ready é encerrada e não existe reembolso do slot.

## Android — TalkBack e fonte ampliada

Com TalkBack ativo, percorra a Central Tática completa pelos controles de acessibilidade. Verifique ordem de foco, nomes/estados de botões e chips, campos de dano/movimento, resumo de PV/concentração/slots, reação pendente e Ready. Nenhuma ação crítica pode exigir interpretação exclusivamente visual.

Repita os quatro cenários com o maior tamanho de fonte suportado pelo dispositivo ou ao menos 200% quando disponível. Verifique especialmente cards de ordem de turno, ações do alvo, reação pendente e Ready: o texto pode crescer verticalmente, mas botões e valores essenciais não podem desaparecer ou ficar inacessíveis.

Registre o checklist manual de acessibilidade com `screenReaderNavigation`, `focusOrder`, `labelsAndHints`, `largeText` e `noCriticalTruncation` todos aprovados antes de finalizar evidência.

## iOS — VoiceOver e Larger Text

Repita os cenários 91–94 em simulador/dispositivo iOS e depois faça a revisão manual com VoiceOver e Larger Text. A validação local automatizada de iOS exige macOS, `xcrun`, simulador iniciado e Maestro.

Confirme a mesma semântica de foco e estado observada no Android, incluindo o anúncio de PV, concentração, slots, round, turno ativo e disponibilidade das ações/reação.

## Captura de artefatos e evidência v3

Fluxo recomendado no Android:

```bash
npm run beta:session:prepare -- android
npm run beta:session:run:android -- --session <diretorio-da-sessao>
npm run beta:session:finalize -- --session <diretorio-da-sessao>
npm run beta:evidence:validate -- android
```

Também é possível executar os artifacts E2E diretamente conforme os scripts de `package.json` e então capturar/finalizar a evidência com os utilitários beta existentes.

No iOS, execute os flows/artifacts em macOS, complete os checklists manuais e finalize a evidência v3 pela pipeline disponível. Só promova a candidata beta quando **Android e iOS** estiverem com evidência v3 válida e todos os checks obrigatórios aprovados.

## Critério de fechamento

O bloco “Fechamento móvel” só pode ser marcado integralmente como concluído depois de execução real dos quatro cenários no Android, auditoria TalkBack/fonte ampliada, repetição no iOS/VoiceOver e validação das evidências nativas v3. Audits locais e YAML válido deixam a candidata **preparada**, não promovida.

## Runner Android focado — flows 91–94

Antes da suíte beta completa, execute apenas o fechamento tático com artefatos dedicados:

```bash
npm run tactical:mobile-closure:native:android
npm run tactical:mobile-closure:status
```

O runner grava cada execução em `artifacts/tactical-mobile-closure/android/<run-id>/` e mantém `artifacts/tactical-mobile-closure/android-latest.json`. Esse resultado comprova somente a automação dos quatro cenários; TalkBack/fonte ampliada e a evidência beta v3 continuam exigindo revisão real.

### Android em host remoto / WSL

Quando o emulador/ADB server estiver no host Windows, configure o socket do ADB e o host do Maestro antes do doctor/runner:

```bash
export ADB_SERVER_SOCKET=tcp:<WINDOWS_IP>:5037
export MAESTRO_HOST=<WINDOWS_IP>
npm run e2e:doctor:android
npm run tactical:mobile-closure:native:android
```

`MAESTRO_PATH` continua disponível para apontar para um binário específico. O resolver também procura automaticamente `~/.maestro/bin/maestro`, que é o diretório padrão do instalador CLI.
