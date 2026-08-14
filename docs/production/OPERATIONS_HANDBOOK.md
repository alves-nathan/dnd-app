# Manual operacional — D&D Combat

## Escopo

Aplicativo offline-first para criação, evolução e análise de personagens, com catálogo inicial e importação de conteúdo pelo usuário.

## Responsabilidades

- **Responsável pela release:** executa gates, build e submissão.
- **Responsável pela segurança:** revisa segredos, permissões, confiança do catálogo e evidências.
- **Responsável pelo suporte:** recebe diagnósticos sem solicitar conteúdo pessoal desnecessário.
- **Responsável pelo catálogo:** publica bundles, manifestos e controles assinados conforme a cadeia de confiança.

Uma única pessoa pode acumular papéis em uma operação pequena, mas os registros devem indicar qual papel foi exercido em cada ação.

## Rotina de release

1. Congelar alterações funcionais.
2. Executar APP-28 e APP-29.
3. Gerar evidência APP-30 em modo de preparação.
4. Criar build de produção.
5. Verificar checksum, versão, package e perfil.
6. Instalar em aparelho limpo e testar o fluxo principal.
7. Submeter à loja.
8. Registrar o estado real da publicação.
9. Manter observação reforçada durante o início da distribuição.
10. Encerrar somente após reconciliar versão publicada e artefato.

## Sinais operacionais mínimos

- falha de inicialização;
- falha de migração;
- falha de importação ou atualização do catálogo;
- perda de acesso a personagens locais;
- aumento de rollback;
- artefato ou manifesto divergente;
- incompatibilidade de versão.

O aplicativo não deve enviar telemetria automática sem consentimento. Os sinais compartilhados devem seguir os contratos opt-in já implementados.

## Continuidade

Antes de qualquer manutenção crítica:

- exportar backup verificável;
- preservar recibos e diários;
- registrar versão e checksum;
- confirmar disponibilidade do artefato anterior;
- confirmar que o procedimento de rollback está acessível.
