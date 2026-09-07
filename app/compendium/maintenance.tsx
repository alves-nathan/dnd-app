import { router } from 'expo-router';
import { BottomNavigation } from '../../src/components/BottomNavigation';
import { Button } from '../../src/components/Button';
import { Card } from '../../src/components/Card';
import { Screen } from '../../src/components/Screen';
import { useCatalogDistributionStore } from '../../src/store/catalogDistributionStore';
import { useCatalogPublicationStore } from '../../src/store/catalogPublicationStore';
import { useCatalogRolloutAggregationStore } from '../../src/store/catalogRolloutAggregationStore';
import { useCatalogRolloutHealthStore } from '../../src/store/catalogRolloutHealthStore';
import { useCatalogTransparencyStore } from '../../src/store/catalogTransparencyStore';
import { useCatalogUpdateSessionStore } from '../../src/store/catalogUpdateSessionStore';

export default function CompendiumMaintenanceScreen() {
  const catalogUpdateSession = useCatalogUpdateSessionStore((state) => state.activeSession);
  const remoteCatalogManifests = useCatalogTransparencyStore((state) => state.remoteManifests);
  const remoteCatalogUpdates = Object.values(remoteCatalogManifests).filter((entry) => entry.status === 'updateAvailable').length;
  const eligibleCatalogPublications = useCatalogPublicationStore((state) => state.eligibilityEvidence.filter((entry) => entry.eligible).length);
  const selectedCatalogChannel = useCatalogPublicationStore((state) => state.selectedChannel);
  const rolloutHealthAttention = useCatalogRolloutHealthStore((state) => state.evidence.filter((entry) => entry.status === 'unhealthy' || entry.status === 'watch').length);
  const rolloutQuorumAttention = useCatalogRolloutAggregationStore((state) => state.decisions.filter((entry) => entry.status === 'pending' || entry.status === 'rejected').length);
  const cachedCatalogBundles = useCatalogDistributionStore((state) => Object.keys(state.cachedBundles).length);
  const interruptedCatalogDownloads = useCatalogDistributionStore((state) => Object.values(state.sessions).filter((entry) => ['paused', 'failed'].includes(entry.status)).length);

  return (
    <Screen
      eyebrow="Compêndio"
      title="Manutenção de regras e catálogo"
      subtitle="Revisão editorial, compatibilidade, atualização e operações do catálogo ficam concentradas aqui e não interrompem a criação ou o uso das fichas."
      onBack={() => router.replace('/compendium')}
      footer={(
        <BottomNavigation
          activeKey="compendium"
          items={[
            { key: 'characters', label: 'Personagens', icon: 'people', onPress: () => router.replace('/') },
            { key: 'compendium', label: 'Compêndio', icon: 'library', onPress: () => router.replace('/compendium') },
            { key: 'settings', label: 'Ajustes', icon: 'settings', onPress: () => router.push('/settings') }
          ]}
        />
      )}
    >
      {remoteCatalogUpdates ? (
        <Card variant="filled" title={`${remoteCatalogUpdates} atualização(ões) assinada(s) anunciada(s)`} subtitle="O manifesto remoto foi verificado, mas nenhum catálogo foi baixado ou aplicado automaticamente.">
          <Button testID="open-catalog-transparency" label="Revisar transparência" icon="git-network-outline" onPress={() => router.push('/catalog-transparency')} />
        </Card>
      ) : null}

      {eligibleCatalogPublications ? (
        <Card variant="filled" title={`${eligibleCatalogPublications} publicação(ões) elegível(is) no canal ${selectedCatalogChannel}`} subtitle="A elegibilidade foi assinada e avaliada localmente. Nenhum download ou aplicação ocorre automaticamente.">
          <Button testID="open-catalog-publication" label="Revisar canais e rollout" icon="git-branch-outline" onPress={() => router.push('/catalog-publication')} />
        </Card>
      ) : null}

      {rolloutHealthAttention ? (
        <Card variant="filled" title={`${rolloutHealthAttention} avaliação(ões) de rollout exigem revisão`} subtitle="A recomendação é local e não pausa, reduz ou reverte publicações automaticamente.">
          <Button testID="open-rollout-health-attention" label="Revisar saúde do rollout" icon="pulse-outline" onPress={() => router.push('/catalog-rollout-health')} />
        </Card>
      ) : null}

      {rolloutQuorumAttention ? (
        <Card variant="filled" title={`${rolloutQuorumAttention} decisão(ões) de release aguardam revisão`} subtitle="Relatórios agregados e votos independentes nunca executam uma mudança automaticamente.">
          <Button testID="open-rollout-quorum-attention" label="Revisar agregação e quórum" icon="people-circle-outline" onPress={() => router.push('/catalog-rollout-aggregation')} />
        </Card>
      ) : null}

      {cachedCatalogBundles || interruptedCatalogDownloads ? (
        <Card variant="filled" title={interruptedCatalogDownloads ? `${interruptedCatalogDownloads} download(s) de catálogo aguardando retomada` : `${cachedCatalogBundles} bundle(s) de catálogo disponível(is) offline`} subtitle="O cache foi verificado e nenhuma atualização é aplicada sem abrir o preview transacional.">
          <Button testID="open-catalog-distribution" label="Abrir distribuição offline" icon="download-outline" onPress={() => router.push('/catalog-distribution')} />
        </Card>
      ) : null}

      {catalogUpdateSession && !['rolledBack', 'failed'].includes(catalogUpdateSession.status) ? (
        <Card
          variant="filled"
          title={`Atualização do catálogo: ${catalogUpdateSession.status}`}
          subtitle={catalogUpdateSession.status === 'interrupted' ? 'A troca de versão foi interrompida e precisa ser retomada.' : `${catalogUpdateSession.diff.fromVersion} → ${catalogUpdateSession.diff.toVersion}`}
        >
          <Button testID="open-catalog-update-session" label="Revisar atualização do catálogo" icon="cloud-download-outline" onPress={() => router.push('/catalog-update')} />
        </Card>
      ) : null}

      <Card variant="outlined" title="Conteúdo e compatibilidade" subtitle="Gerencie livros, entidades, histórico de regras e manifestos sem inserir telas de manutenção no fluxo da ficha.">
        <Button label="Gerenciar livros e regras" icon="options-outline" onPress={() => router.push('/content-management')} />
        <Button label="Histórico das regras" icon="time-outline" variant="outlined" onPress={() => router.push('/catalog-history')} />
        <Button label="Manifestos por personagem" icon="shield-checkmark-outline" variant="outlined" onPress={() => router.push('/character-compatibility')} />
      </Card>

      <Card variant="outlined" title="Atualização, confiança e distribuição" subtitle="Verifique candidatos e sua proveniência antes de alterar o catálogo ativo.">
        <Button label="Atualizar catálogo" icon="cloud-download-outline" onPress={() => router.push('/catalog-update')} />
        <Button label="Publicadores confiáveis" icon="shield-checkmark-outline" variant="outlined" onPress={() => router.push('/catalog-trust')} />
        <Button label="Transparência" icon="git-network-outline" variant="outlined" onPress={() => router.push('/catalog-transparency')} />
        <Button label="Distribuição offline" icon="download-outline" variant="outlined" onPress={() => router.push('/catalog-distribution')} />
      </Card>

      <Card variant="outlined" title="Publicação e rollout" subtitle="Canais, saúde e decisões de promoção permanecem explicitamente manuais.">
        <Button label="Canais e rollout do catálogo" icon="git-branch-outline" onPress={() => router.push('/catalog-publication')} />
        <Button label="Saúde e promoção do rollout" icon="pulse-outline" variant="outlined" onPress={() => router.push('/catalog-rollout-health')} />
        <Button label="Agregação e decisão em quórum" icon="people-circle-outline" variant="outlined" onPress={() => router.push('/catalog-rollout-aggregation')} />
      </Card>

      <Card variant="outlined" title="Operação e auditoria" subtitle="Ferramentas avançadas para autorização, rastreabilidade e auditoria independente.">
        <Button label="Autorização operacional" icon="shield-checkmark-outline" onPress={() => router.push('/catalog-operational-authorization')} />
        <Button label="Diário operacional" icon="document-lock-outline" variant="outlined" onPress={() => router.push('/catalog-operational-journal')} />
        <Button label="Auditoria operacional externa" icon="search-outline" variant="outlined" onPress={() => router.push('/catalog-operational-audit')} />
        <Button label="Federação de auditoria" icon="people-circle-outline" variant="outlined" onPress={() => router.push('/catalog-operational-federation')} />
      </Card>
    </Screen>
  );
}
