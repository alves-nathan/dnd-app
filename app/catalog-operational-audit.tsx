import Constants from 'expo-constants';
import * as DocumentPicker from 'expo-document-picker';
import { File } from 'expo-file-system';
import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import { Alert, Share, StyleSheet, Text, View } from 'react-native';
import { Button } from '../src/components/Button';
import { Card } from '../src/components/Card';
import { Field } from '../src/components/Field';
import { Screen } from '../src/components/Screen';
import {
  compareCatalogOperationalAuditPackages,
  createCatalogOperationalAuditPackage,
  evaluateCatalogOperationalAuditRetention,
  verifyCatalogOperationalAuditPackage,
  type CatalogOperationalAuditPackage
} from '../src/catalog/catalogOperationalAudit';
import { sha256Hex } from '../src/catalog/catalogBundleDigest';
import { useCatalogOperationalAuditStore } from '../src/store/catalogOperationalAuditStore';
import { useCatalogOperationalAuthorizationStore } from '../src/store/catalogOperationalAuthorizationStore';
import { useCatalogPublicationStore } from '../src/store/catalogPublicationStore';
import { useCatalogRolloutAggregationStore } from '../src/store/catalogRolloutAggregationStore';
import { useCatalogTrustStore } from '../src/store/catalogTrustStore';

const statusLabel = { approved: 'Aprovado', warning: 'Aprovado com avisos', rejected: 'Rejeitado' } as const;
const comparisonLabel: Record<string, string> = {
  identical: 'Os diários são idênticos.', leftAhead: 'O diário local está à frente.', rightAhead: 'O pacote importado está à frente.', forked: 'Os diários bifurcaram.', unrelated: 'Os pacotes não compartilham uma origem verificável.'
};

export default function CatalogOperationalAuditScreen() {
  const operational = useCatalogOperationalAuthorizationStore();
  const aggregation = useCatalogRolloutAggregationStore();
  const publications = useCatalogPublicationStore((state) => state.publications);
  const cohortId = useCatalogPublicationStore((state) => state.cohortId);
  const registry = useCatalogTrustStore((state) => state.registry);
  const importedAudits = useCatalogOperationalAuditStore((state) => state.importedAudits);
  const importAuditPackage = useCatalogOperationalAuditStore((state) => state.importAuditPackage);
  const importSignedReport = useCatalogOperationalAuditStore((state) => state.importSignedReport);
  const removeImportedAudit = useCatalogOperationalAuditStore((state) => state.removeImportedAudit);
  const [auditJson, setAuditJson] = useState('');
  const [reportJson, setReportJson] = useState('');
  const [selectedRecordId, setSelectedRecordId] = useState<string | undefined>();

  const localPackage = useMemo(() => createCatalogOperationalAuditPackage({
    source: {
      deviceIdHash: sha256Hex(`operational-audit-device:${cohortId}`),
      appVersion: Constants.expoConfig?.version ?? '0.0.0',
      platform: 'react-native',
      label: 'Dispositivo local'
    },
    archives: operational.journalArchives,
    activeJournal: operational.journal,
    receipts: operational.receipts,
    evidence: operational.evidence,
    authorizations: operational.authorizations,
    executorConfirmations: Object.values(operational.confirmations),
    aggregationPolicies: Object.values(aggregation.policies).flat(),
    aggregateReports: aggregation.reports,
    releaseApprovals: Object.values(aggregation.approvals).flat(),
    quorumDecisions: aggregation.decisions,
    publications: Object.values(publications),
    trustRegistry: registry
  }), [aggregation.approvals, aggregation.decisions, aggregation.policies, aggregation.reports, cohortId, operational.authorizations, operational.confirmations, operational.evidence, operational.journal, operational.journalArchives, operational.receipts, publications, registry]);
  const localVerification = useMemo(() => verifyCatalogOperationalAuditPackage(localPackage), [localPackage]);
  const retention = useMemo(() => evaluateCatalogOperationalAuditRetention({ auditPackage: localPackage }), [localPackage]);

  const pickAudit = async () => {
    try {
      const result = await DocumentPicker.getDocumentAsync({ type: ['application/json', 'text/json', 'text/plain', '*/*'], copyToCacheDirectory: true });
      if (result.canceled || !result.assets?.[0]) return;
      setAuditJson(await new File(result.assets[0].uri).text());
    } catch { Alert.alert('Arquivo não lido', 'Não foi possível ler o pacote de auditoria.'); }
  };

  const importAudit = () => {
    const result = importAuditPackage(auditJson, 'Arquivo importado');
    Alert.alert(result.ok ? 'Auditoria importada' : 'Auditoria rejeitada', result.ok ? 'O pacote foi armazenado somente para auditoria e não pode alterar o aplicativo.' : result.issue);
    if (result.ok) { setAuditJson(''); setSelectedRecordId(result.record?.recordId); }
  };

  return (
    <Screen title="Auditoria operacional externa" subtitle="Exportação, verificação independente e comparação somente leitura do diário operacional." onBack={() => router.back()}>
      <Card variant="hero" title={statusLabel[localVerification.status]} subtitle={`${localVerification.counts.totalEntries} entrada(s) · ${localVerification.counts.receipts} recibo(s) · ${localVerification.counts.evidence} evidência(s)`}>
        <Text style={styles.muted}>Head: {localVerification.headHash?.slice(0, 24) ?? 'sem entradas'}…</Text>
        {localVerification.findings.slice(0, 5).map((finding) => <Text key={`${finding.code}-${finding.sequence ?? ''}`} style={finding.severity === 'error' ? styles.error : styles.warning}>{finding.code}: {finding.message}</Text>)}
        <Button testID="operational-audit-export" label="Compartilhar pacote completo" onPress={() => { void Share.share({ title: `${localPackage.packageId}.json`, message: JSON.stringify(localPackage, null, 2) }); }} />
        <Button label="Compartilhar verificação" variant="outlined" onPress={() => { void Share.share({ title: 'Verificação operacional', message: JSON.stringify(localVerification, null, 2) }); }} />
      </Card>

      <Card title="Retenção de longo prazo" subtitle="A política padrão preserva todas as evidências e recomenda apenas arquivamento do diário ativo.">
        <Text style={styles.muted}>Arquivamento recomendado: {retention.archiveRecommended ? `sim, ${retention.recommendedArchiveCount} entrada(s)` : 'não'}.</Text>
        <Text style={styles.muted}>Evidências elegíveis para exclusão automática: {retention.evidenceEligibleForDeletion}.</Text>
      </Card>

      <Card title="Importar para auditoria" subtitle="A importação é somente leitura e não possui ações de execução, configuração ou rollback.">
        <Button testID="operational-audit-import-file" label="Selecionar arquivo" variant="outlined" onPress={() => { void pickAudit(); }} />
        <Field testID="operational-audit-json" label="Pacote JSON" value={auditJson} onChangeText={setAuditJson} multiline style={styles.json} autoCapitalize="none" />
        <Button testID="operational-audit-import" label="Validar e importar" disabled={!auditJson.trim()} onPress={importAudit} />
      </Card>

      {importedAudits.slice().reverse().map((record) => {
        const comparison = compareCatalogOperationalAuditPackages(localPackage, record.auditPackage);
        return (
          <Card key={record.recordId} title={record.sourceLabel ?? record.auditPackage.source.label ?? 'Pacote importado'} subtitle={`${statusLabel[record.verification.status]} · somente leitura`}>
            <Text style={styles.muted}>{comparisonLabel[comparison.status]} Prefixo comum: {comparison.commonEntries} entrada(s).</Text>
            {comparison.issues.map((issue) => <Text key={issue} style={styles.warning}>{issue}</Text>)}
            <Text style={styles.muted}>Relatório assinado: {record.signedReport ? 'validado' : 'não importado'}.</Text>
            <Button label="Selecionar para relatório" variant="outlined" onPress={() => setSelectedRecordId(record.recordId)} />
            <Button label="Remover pacote importado" variant="text" onPress={() => removeImportedAudit(record.recordId)} />
          </Card>
        );
      })}

      <Card title="Relatório de auditoria assinado" subtitle="O relatório precisa corresponder exatamente ao pacote selecionado e ser assinado por uma chave confiável.">
        <Field testID="operational-audit-report-json" label="Relatório JSON" value={reportJson} onChangeText={setReportJson} multiline style={styles.json} autoCapitalize="none" />
        <Button testID="operational-audit-report-import" label="Validar relatório" disabled={!selectedRecordId || !reportJson.trim()} onPress={() => {
          if (!selectedRecordId) return;
          const result = importSignedReport(selectedRecordId, reportJson, registry);
          Alert.alert(result.ok ? 'Relatório aprovado' : 'Relatório rejeitado', result.ok ? 'A assinatura e a correspondência com o pacote foram verificadas.' : result.issue);
          if (result.ok) setReportJson('');
        }} />
      </Card>

      <Card title="Verificador independente" subtitle="O mesmo pacote pode ser verificado fora do aplicativo, sem carregar stores ou executar código React Native.">
        <Text style={styles.code}>node scripts/verify-catalog-operational-audit.js --input pacote.json --output auditoria.json</Text>
        <Button testID="operational-audit-open-federation" label="Abrir federação de auditoria" variant="outlined" onPress={() => router.push('/catalog-operational-federation')} />
        <Button testID="operational-audit-open-journal" label="Voltar ao diário operacional" variant="outlined" onPress={() => router.push('/catalog-operational-journal')} />
      </Card>
    </Screen>
  );
}

const styles = StyleSheet.create({
  json: { minHeight: 110, textAlignVertical: 'top' },
  muted: { opacity: 0.72, marginTop: 4 },
  warning: { color: '#9A6700', marginTop: 4 },
  error: { color: '#B42318', marginTop: 4 },
  code: { fontFamily: 'monospace', opacity: 0.85 }
});
