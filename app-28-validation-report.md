# APP-28 validation report

Status: **IMPLEMENTED_GATE_BLOCKED_BY_ENVIRONMENT**

## Implementação aprovada

| Verificação | Resultado |
|---|---:|
| Contratos APP-28 | PASS |
| Regressão linear acumulada | 206/206 |
| Parsing TypeScript/TSX | 373/373 |
| Harness APP-28 | 19/19 |
| Arquivos Maestro encontrados | 82 |
| Fluxos obrigatórios do gate nativo | 75 |
| Scanner de material criptográfico | PASS |

## Gate integral

O relatório `dnd-combat-app28-integral-gate.v1` foi gerado com status **BLOCKED** e digest:

`42247b49bc697cbccc4c9c6de26707fe15cb407f577b5b7eac3331c7529c6ec0`

O build candidate agora exige simultaneamente o gate legado APP-07 e o gate integral APP-28.

## Etapas bloqueadas

- Instalação: **BLOCKED / NPM_CLIENT_FAILURE**.
- Typecheck integral: **BLOCKED**, exit code 2.
- Jest integral: **BLOCKED**, exit code 127.
- Gate Android: **BLOCKED**.

O bloqueio é ambiental. A codebase não foi alterada para reduzir versões, usar `--force` ou ignorar peer dependencies.

## Execução necessária no ambiente proprietário

```bash
npm run app28:dependencies:install
npm run app28:gate
npm run app28:gate:verify
```

A aprovação só ocorrerá com typecheck e Jest completos, versão Android correspondente, 75 fluxos Maestro aprovados e JUnit, logcat, screenshot e log Maestro íntegros.
