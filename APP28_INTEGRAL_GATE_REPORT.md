# APP-28 — Fechamento do gate integral

## Objetivo

Substituir a aprovação parcial dos lotes anteriores por uma evidência obrigatória que vincule a codebase, o `package-lock.json`, o typecheck completo, Jest e a execução Android dos fluxos Maestro.

## Implementação

### Instalação determinística

`scripts/install-app28-dependencies.js` aceita registry explícito ou cache npm aquecido, mantém o lockfile intacto, classifica falhas ambientais e não utiliza `--force` ou `--legacy-peer-deps`.

### Evidência do gate

`scripts/run-app28-integral-gate.js` gera `dnd-combat-app28-integral-gate.v1` com:

- fingerprint de 592 arquivos da codebase;
- SHA-256 do `package-lock.json`;
- resultado da instalação e auditoria do lockfile;
- regressão APP-27;
- typecheck completo;
- Jest completo;
- gate Android;
- hashes de JUnit, logcat, screenshot e log Maestro.

### Verificação independente

`scripts/verify-app28-integral-gate.js` recusa evidência:

- bloqueada, falha ou expirada;
- criada para outra codebase ou lockfile;
- sem as seis etapas obrigatórias;
- com menos de 75 fluxos nativos;
- sem versão Android correspondente;
- com artefatos ausentes, adulterados ou JUnit com falhas.

### Build candidate

O build Android beta-candidate preserva a exigência APP-07 e adiciona APP-28. O manifesto do APK registra fingerprint, lockfile, quantidade de fluxos e digest da evidência integral.

## Resultado neste ambiente

A implementação passou em 206 verificações acumuladas, 373 arquivos TypeScript/TSX e 19 asserções do harness.

O gate integral ficou **BLOCKED** porque:

1. o mirror interno não contém os pacotes do lockfile;
2. o registry público não é alcançável de forma estável;
3. `node_modules` está ausente;
4. ADB e Maestro não estão instalados;
5. não há dispositivo ou emulador Android conectado.

O APP-28 não deve ser considerado aprovado até a execução no ambiente proprietário.
