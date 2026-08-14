import { router } from 'expo-router';
import { BottomNavigation } from '../src/components/BottomNavigation';
import { Button } from '../src/components/Button';
import { Card } from '../src/components/Card';
import { Screen } from '../src/components/Screen';

export default function SettingsScreen() {
  return (
    <Screen
      eyebrow="Aplicativo"
      title="Ajustes"
      subtitle="Preferências, segurança dos dados e ferramentas de manutenção."
      onBack={() => router.replace('/')}
      footer={(
        <BottomNavigation
          activeKey="settings"
          items={[
            { key: 'characters', label: 'Personagens', icon: 'people', onPress: () => router.replace('/') },
            { key: 'compendium', label: 'Compêndio', icon: 'library', onPress: () => router.push('/compendium') },
            { key: 'settings', label: 'Ajustes', icon: 'settings', onPress: () => undefined }
          ]}
        />
      )}
    >
      <Card variant="hero" title="Dados locais e offline" subtitle="Fichas e compêndio permanecem neste dispositivo até você criar um backup." />
      <Card variant="outlined" title="Conteúdo e regras" subtitle="Conteúdos são cadastrados ou importados pelo usuário com fonte e página. Regras ambíguas geram avisos em vez de suposições silenciosas.">
        <Button label="Gerenciar compêndio" icon="library-outline" onPress={() => router.push('/compendium')} />
        <Button label="Gerenciar livros e regras" icon="options-outline" variant="outlined" onPress={() => router.push('/content-management')} />
        <Button label="Histórico das regras" icon="time-outline" variant="outlined" onPress={() => router.push('/catalog-history')} />
        <Button label="Atualizar catálogo" icon="cloud-download-outline" variant="outlined" onPress={() => router.push('/catalog-update')} />
        <Button label="Publicadores confiáveis" icon="shield-checkmark-outline" variant="outlined" onPress={() => router.push('/catalog-trust')} />
        <Button label="Transparência e distribuição" icon="git-network-outline" variant="outlined" onPress={() => router.push('/catalog-transparency')} />
        <Button label="Canais e rollout do catálogo" icon="git-branch-outline" variant="outlined" onPress={() => router.push('/catalog-publication')} />
        <Button label="Saúde e promoção do rollout" icon="pulse-outline" variant="outlined" onPress={() => router.push('/catalog-rollout-health')} />
        <Button label="Agregação e decisão em quórum" icon="people-circle-outline" variant="outlined" onPress={() => router.push('/catalog-rollout-aggregation')} />
        <Button label="Autorização operacional" icon="shield-checkmark-outline" variant="outlined" onPress={() => router.push('/catalog-operational-authorization')} />
        <Button label="Diário operacional" icon="document-lock-outline" variant="outlined" onPress={() => router.push('/catalog-operational-journal')} />
        <Button label="Auditoria operacional externa" icon="search-outline" variant="outlined" onPress={() => router.push('/catalog-operational-audit')} />
        <Button label="Federação de auditoria" icon="people-circle-outline" variant="outlined" onPress={() => router.push('/catalog-operational-federation')} />
        <Button label="Distribuição offline do catálogo" icon="download-outline" variant="outlined" onPress={() => router.push('/catalog-distribution')} />
        <Button label="Manifestos por personagem" icon="shield-checkmark-outline" variant="outlined" onPress={() => router.push('/character-compatibility')} />
      </Card>
      <Card variant="outlined" title="Proteção dos dados" subtitle="Crie cópias antes de trocar de dispositivo ou fazer alterações grandes.">
        <Button label="Backup e restauração" icon="cloud-download-outline" variant="outlined" onPress={() => router.push('/backup')} />
        <Button label="Sessão de restauração" icon="sync-outline" variant="outlined" onPress={() => router.push('/restore-session')} />
        <Button label="Central de evidências" icon="document-lock-outline" variant="outlined" onPress={() => router.push('/evidence-center')} />
        <Button label="Recuperação de progressão" icon="refresh-circle-outline" variant="outlined" onPress={() => router.push('/progression-recovery')} />
      </Card>
      <Card variant="filled" title="Ferramentas avançadas">
        <Button label="Diagnóstico global" icon="pulse-outline" variant="text" onPress={() => router.push('/diagnostics')} />
        <Button label="Compatibilidade" icon="shield-checkmark-outline" variant="text" onPress={() => router.push('/hardening')} />
        <Button label="Validação de dados da beta" icon="shield-half-outline" variant="text" onPress={() => router.push('/beta-validation')} />
        <Button label="Feedback local da beta" icon="chatbox-ellipses-outline" variant="text" onPress={() => router.push('/beta-feedback')} />
        <Button label="Fechamento do ciclo beta" icon="checkmark-done-outline" variant="text" onPress={() => router.push('/beta-closure')} />
        <Button label="Identidade da build beta" icon="finger-print-outline" variant="text" onPress={() => router.push('/beta-runtime')} />
        <Button label="Release e dev build" icon="construct-outline" variant="text" onPress={() => router.push('/release')} />
        <Button label="Ensaio do release candidate" icon="shield-checkmark-outline" variant="text" onPress={() => router.push('/release-candidate')} />
        <Button label="Release de produção" icon="rocket-outline" variant="text" onPress={() => router.push('/production-release')} />
      </Card>
    </Screen>
  );
}
