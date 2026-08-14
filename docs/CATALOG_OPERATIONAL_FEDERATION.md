# Federação de auditoria operacional

O APP-27 permite que múltiplos dispositivos apresentem seus pacotes de auditoria e que testemunhas independentes confirmem criptograficamente o resultado observado.

## Garantias

- cada pacote precisa ser válido no verificador independente do APP-26;
- a política exige pelo menos dois dispositivos distintos;
- cada pacote exige pelo menos duas testemunhas independentes;
- testemunhas não podem compartilhar chave, identidade ou hash de dispositivo;
- a testemunha não pode atestar o próprio dispositivo de origem;
- a autoridade que assina a política não pode atuar como testemunha da mesma federação;
- bifurcação, segmento não relacionado, testemunho expirado ou adulteração bloqueiam o consenso;
- pacotes importados são somente leitura e não habilitam execução ou rollback.

## Fluxo operacional

1. Gere chaves P-256 separadas para a autoridade e cada testemunha.
2. Cadastre as chaves públicas no registro de confiança.
3. Crie e assine uma política de testemunhas.
4. Exporte os pacotes de auditoria dos dispositivos.
5. Cada testemunha verifica o pacote e assina um testemunho independente.
6. Monte o pacote federado com a política, os pacotes e os testemunhos.
7. Verifique o pacote federado pela CLI ou importe-o na tela **Federação de auditoria**.

## Comandos

```bash
npm run catalog:operation:witness:policy:sign -- \
  --input politica.json \
  --private-key autoridade.jwk.json \
  --output politica-assinada.json

npm run catalog:operation:witness:sign -- \
  --input pacote-dispositivo.json \
  --policy politica-assinada.json \
  --private-key testemunha.jwk.json \
  --witness-id witness-a \
  --publisher-id witness-a-publisher \
  --key-id witness-a-key \
  --device-hash HASH_OPACO_DA_TESTEMUNHA \
  --output testemunho.json

npm run catalog:operation:federation:create -- \
  --policy politica-assinada.json \
  --packages dispositivo-a.json,dispositivo-b.json \
  --statements a-wa.json,a-wb.json,b-wa.json,b-wb.json \
  --output federacao.json

npm run catalog:operation:federation:verify -- \
  --input federacao.json \
  --registry confianca.json \
  --output consenso.json
```

## Interpretação do consenso

- `approved`: todos os pacotes são válidos, prefixo/heads são compatíveis e cada pacote atingiu o quórum.
- `warning`: não existem erros bloqueantes, mas pelo menos um pacote possui aviso de auditoria.
- `rejected`: há assinatura inválida, quorum insuficiente, dispositivo duplicado, bifurcação, pacote adulterado ou outro erro bloqueante.

O consenso é uma evidência de auditoria. Ele não altera catálogo, personagens, rollout, autorizações ou sessões operacionais.
