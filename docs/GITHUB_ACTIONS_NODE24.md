# CI: migração do runtime das Actions para Node 24

O aviso observado no run 45707820928 diz respeito ao runtime das próprias Actions, não ao Node da aplicação. Os workflows usam setup-node com node-version 22; manter Node 22 e package.json/lockfile inalterados.

Nos workflows ubuntu-latest, migrar checkout v4→v5, setup-node v4→v5 e upload-artifact v4→v6. Verificado action.yml dos respectivos refs: runs.using node24; upload-artifact v5 ainda usa node20. Referências: https://github.com/actions/checkout/tree/v5 ; https://github.com/actions/setup-node/tree/v5 ; https://github.com/actions/upload-artifact/tree/v6.

Mobile E2E self-hosted foi deliberadamente mantido: confirmar Actions Runner >= 2.327.1 e compatibilidade do host (Android e macOS), então aplicar as mesmas versões, executar o workflow manual de cada plataforma e conferir upload. Maestro Cloud action de terceiros permanece na versão atual; validar sua compatibilidade separadamente, sem mudança de API. Beta e Maestro Cloud não são executados pelo CI normal; validar manualmente quando houver ambiente/credenciais. Não mascarar o aviso com variáveis de bypass. Nenhuma alteração no engine Node do app nesta fase.
