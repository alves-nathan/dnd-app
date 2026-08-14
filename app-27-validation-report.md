# APP-27 validation report

Status: **PASS_WITH_FULL_SUITE_AND_NATIVE_GATE_BLOCKED_BY_ENVIRONMENT**

## Verificações aprovadas

| Verificação | Resultado |
|---|---:|
| Contratos APP-27 | PASS |
| Parsing TypeScript/TSX | 373/373 |
| Typecheck isolado do núcleo | PASS |
| Typecheck isolado da store | PASS |
| Typecheck isolado do teste | PASS |
| Harness APP-27 | 28/28 |
| Assinatura e verificação CLI | PASS |
| Regressão herdada | 198 PASS |
| Verificações atuais | 4/4 |
| Total acumulado | 202 PASS |
| Fluxos Maestro no gate | 75/75 |
| Material criptográfico privado | Nenhum |

## Consenso validado

- dispositivos distintos: 2;
- testemunhas independentes: 2;
- quorum por pacote: aprovado;
- prefixo comum: 2 entradas;
- head canônico: `7db0e635787de52e72ccd14694bb7e2d4bb3d9e1003d6aa3a795ce836287bfee`.

## Cenários rejeitados corretamente

- testemunho adulterado;
- quorum insuficiente;
- testemunhas não independentes;
- autotestemunho;
- bifurcação do diário;
- testemunho fora da janela temporal;
- dispositivo de origem duplicado;
- checksum do pacote federado alterado.

## Etapas integrais bloqueadas

O `npm ci` falhou porque o registry interno não disponibiliza `zustand@5.0.14`.

Sem `node_modules`:

- o typecheck integral não encontra a base Expo nem os tipos de React, Node e Jest;
- a suíte Jest não encontra o executável `jest`;
- o gate Android não pode executar sem ADB, Maestro e dispositivo conectado.

Todos os arquivos dos 75 fluxos nativos esperados pelo gate foram localizados.

## Etapas restantes

Restam **3 etapas planejadas**: APP-28, APP-29 e APP-30.
