import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import { Alert, Share, StyleSheet, Text, View } from 'react-native';
import { Button } from '../src/components/Button';
import { Card } from '../src/components/Card';
import { Field } from '../src/components/Field';
import { Screen } from '../src/components/Screen';
import { catalogRolloutAggregateReportChecksum, type CatalogReleaseDecisionAction } from '../src/catalog/catalogRolloutAggregation';
import { useCatalogPublicationStore } from '../src/store/catalogPublicationStore';
import { useCatalogRolloutAggregationStore } from '../src/store/catalogRolloutAggregationStore';
import { useCatalogRolloutHealthStore } from '../src/store/catalogRolloutHealthStore';
import { useCatalogTrustStore } from '../src/store/catalogTrustStore';

const statusLabel = { pending: 'Quórum pendente', approved: 'Quórum aprovado', rejected: 'Quórum rejeitado' } as const;

export default function CatalogRolloutAggregationScreen() {
  const registry = useCatalogTrustStore((state) => state.registry);
  const publications = useCatalogPublicationStore((state) => state.publications);
  const healthEvidence = useCatalogRolloutHealthStore((state) => state.evidence);
  const policies = useCatalogRolloutAggregationStore((state) => state.policies);
  const submissions = useCatalogRolloutAggregationStore((state) => state.submissions);
  const reports = useCatalogRolloutAggregationStore((state) => state.reports);
  const approvals = useCatalogRolloutAggregationStore((state) => state.approvals);
  const decisions = useCatalogRolloutAggregationStore((state) => state.decisions);
  const events = useCatalogRolloutAggregationStore((state) => state.events);
  const createSubmission = useCatalogRolloutAggregationStore((state) => state.createSubmission);
  const importPolicy = useCatalogRolloutAggregationStore((state) => state.importPolicy);
  const importReport = useCatalogRolloutAggregationStore((state) => state.importReport);
  const importApproval = useCatalogRolloutAggregationStore((state) => state.importApproval);
  const evaluateDecision = useCatalogRolloutAggregationStore((state) => state.evaluateDecision);
  const [policyJson, setPolicyJson] = useState('');
  const [reportJson, setReportJson] = useState('');
  const [approvalJson, setApprovalJson] = useState('');

  const publicationList = useMemo(() => Object.values(publications).sort((a, b) => b.issuedAt.localeCompare(a.issuedAt)), [publications]);

  const publicationFromRaw = (raw: string) => {
    const parsed = JSON.parse(raw) as { publicationId?: string };
    return parsed.publicationId ? publications[parsed.publicationId] : undefined;
  };

  const submitPolicy = () => {
    try {
      const publication = publicationFromRaw(policyJson);
      if (!publication) return Alert.alert('Publicação ausente', 'Importe primeiro a publicação assinada correspondente.');
      const result = importPolicy(policyJson, { registry, publication });
      Alert.alert(result.ok ? 'Política validada' : 'Política rejeitada', result.ok ? 'Os limites de anonimato e o quórum foram armazenados.' : result.issue);
      if (result.ok) setPolicyJson('');
    } catch {
      Alert.alert('JSON inválido', 'O documento não contém uma política de agregação válida.');
    }
  };

  const submitReport = () => {
    try {
      const publication = publicationFromRaw(reportJson);
      if (!publication) return Alert.alert('Publicação ausente', 'O relatório precisa corresponder a uma publicação conhecida.');
      const result = importReport(reportJson, { registry, publication });
      Alert.alert(result.ok ? 'Relatório consolidado validado' : 'Relatório rejeitado', result.ok ? 'A assinatura, o anonimato mínimo e a supressão das coortes foram verificados.' : result.issue);
      if (result.ok) setReportJson('');
    } catch {
      Alert.alert('JSON inválido', 'O documento não contém um relatório agregado válido.');
    }
  };

  const submitApproval = () => {
    try {
      const publication = publicationFromRaw(approvalJson);
      if (!publication) return Alert.alert('Publicação ausente', 'A aprovação precisa corresponder a uma publicação conhecida.');
      const result = importApproval(approvalJson, { registry, publication });
      Alert.alert(result.ok ? 'Voto independente validado' : 'Aprovação rejeitada', result.ok ? 'A assinatura e a participação do aprovador no quórum foram verificadas.' : result.issue);
      if (result.ok) setApprovalJson('');
    } catch {
      Alert.alert('JSON inválido', 'O documento não contém uma aprovação válida.');
    }
  };

  const generateSubmission = (evidenceId: string) => {
    const evidence = healthEvidence.find((entry) => entry.evidenceId === evidenceId);
    if (!evidence) return;
    const submission = createSubmission(evidence);
    void Share.share({ title: 'Contribuição anônima de saúde', message: JSON.stringify(submission, null, 2) });
  };

  const decisionAction = (reportId: string): CatalogReleaseDecisionAction => {
    const report = reports.find((entry) => entry.reportId === reportId);
    if (!report) return 'hold';
    return report.recommendation === 'expand' || report.recommendation === 'promote' || report.recommendation === 'pause' || report.recommendation === 'rollback' ? report.recommendation : 'hold';
  };

  const evaluate = (reportId: string) => {
    const report = reports.find((entry) => entry.reportId === reportId);
    if (!report) return;
    const action = decisionAction(reportId);
    try {
      const decision = evaluateDecision({
        reportId,
        registry,
        action,
        ...(action === 'expand' ? { targetRolloutPercent: 100 } : {}),
        ...(action === 'promote' ? { targetChannel: report.channel === 'preview' ? 'beta' : 'stable' } : {})
      });
      Alert.alert(statusLabel[decision.status], `${decision.approvalCount}/${decision.requiredApprovals} aprovação(ões) · ${decision.rejectionCount} rejeição(ões). Nenhuma ação foi executada.`);
    } catch (error) {
      Alert.alert('Quórum não avaliado', error instanceof Error ? error.message : 'Não foi possível avaliar a decisão.');
    }
  };

  return (
    <Screen title="Agregação e decisão em quórum" subtitle="Evidências de múltiplas instalações, anonimato mínimo e aprovações independentes. Nenhuma decisão executa um release automaticamente." onBack={() => router.back()}>
      <Card variant="hero" title="Privacidade por construção" subtitle="Cada publicação usa um token opaco próprio. O relatório consolidado não contém tokens, sinais brutos, personagens ou identificadores pessoais." />

      <Card title="Contribuições locais opt-in" subtitle={`${healthEvidence.length} evidência(s) disponível(is) · ${submissions.length} submissão(ões) criada(s)`}>
        {healthEvidence.slice().reverse().slice(0, 10).map((entry) => (
          <View key={entry.evidenceId} style={styles.row}>
            <Text style={styles.strong}>{entry.catalogVersion} · {entry.status}</Text>
            <Text style={styles.muted}>{entry.channel} · {entry.generatedAt}</Text>
            <Button testID={`rollout-aggregation-submit-${entry.evidenceId}`} label="Gerar contribuição anônima" variant="outlined" onPress={() => generateSubmission(entry.evidenceId)} />
          </View>
        ))}
        {!healthEvidence.length ? <Text style={styles.muted}>Gere primeiro uma evidência opt-in na tela de Saúde do rollout.</Text> : null}
        <Button testID="rollout-aggregation-share-submissions" label="Compartilhar submissões" secondary onPress={() => { void Share.share({ title: 'Submissões anônimas de rollout', message: JSON.stringify(submissions, null, 2) }); }} disabled={!submissions.length} />
      </Card>

      <Card title="Política de agregação assinada" subtitle="Define k-anonimato, supressão por coorte, validade das evidências e aprovadores independentes.">
        <Field testID="rollout-aggregation-policy-json" label="Política JSON" value={policyJson} onChangeText={setPolicyJson} multiline style={styles.json} autoCapitalize="none" />
        <Button testID="rollout-aggregation-policy-import" label="Validar política" onPress={submitPolicy} disabled={!policyJson.trim()} />
      </Card>

      <Card title="Relatório consolidado assinado" subtitle="O relatório precisa provar anonimato mínimo e suprimir coortes pequenas.">
        <Field testID="rollout-aggregation-report-json" label="Relatório JSON" value={reportJson} onChangeText={setReportJson} multiline style={styles.json} autoCapitalize="none" />
        <Button testID="rollout-aggregation-report-import" label="Validar relatório" onPress={submitReport} disabled={!reportJson.trim()} />
      </Card>

      <Card title="Aprovação independente" subtitle="Cada voto é assinado por uma chave distinta autorizada pela política de quórum.">
        <Field testID="rollout-aggregation-approval-json" label="Aprovação JSON" value={approvalJson} onChangeText={setApprovalJson} multiline style={styles.json} autoCapitalize="none" />
        <Button testID="rollout-aggregation-approval-import" label="Validar aprovação" onPress={submitApproval} disabled={!approvalJson.trim()} />
      </Card>

      {reports.slice().reverse().map((report) => {
        const reportChecksum = catalogRolloutAggregateReportChecksum(report);
        const reportApprovals = Object.values(approvals).flat().filter((entry) => entry.aggregateReportChecksum === reportChecksum);
        const decision = decisions.slice().reverse().find((entry) => entry.aggregateReportChecksum === catalogRolloutAggregateReportChecksum(report));
        const policy = (policies[report.publicationId] ?? []).slice().sort((a, b) => b.revision - a.revision)[0];
        return (
          <Card key={report.reportId} title={`${report.catalogVersion} · ${report.status}`} subtitle={`${report.uniqueContributors} contribuidores · recomendação ${report.recommendation}`}>
            <Text style={styles.strong}>Sucesso {(report.metrics.successRate * 100).toFixed(1)}% · falha {(report.metrics.failureRate * 100).toFixed(1)}% · rollback {(report.metrics.rollbackRate * 100).toFixed(1)}%</Text>
            <Text style={styles.muted}>Política: {policy?.aggregationPolicyId ?? 'ausente'} · votos importados: {reportApprovals.length}</Text>
            {report.cohorts.map((cohort) => <Text key={cohort.band} style={styles.muted}>Coorte {cohort.band}: {cohort.contributorCount} contribuidor(es) · {cohort.suppressed ? 'métricas suprimidas' : `sucesso ${((cohort.successRate ?? 0) * 100).toFixed(1)}%`}</Text>)}
            {decision ? <Text testID={`rollout-aggregation-decision-${report.reportId}`} style={decision.status === 'approved' ? styles.success : decision.status === 'rejected' ? styles.error : styles.warning}>{statusLabel[decision.status]} · {decision.approvalCount}/{decision.requiredApprovals}</Text> : null}
            <Button testID={`rollout-aggregation-evaluate-${report.reportId}`} label="Avaliar quórum" onPress={() => evaluate(report.reportId)} disabled={!policy} />
            <Button label="Compartilhar relatório" variant="text" onPress={() => { void Share.share({ title: 'Relatório agregado do rollout', message: JSON.stringify(report, null, 2) }); }} />
          </Card>
        );
      })}

      {!publicationList.length ? <Card title="Nenhuma publicação"><Text style={styles.muted}>Importe uma publicação assinada para usar a agregação verificável.</Text></Card> : null}

      <Button testID="open-operational-authorization" label="Abrir autorizações operacionais" icon="shield-checkmark-outline" onPress={() => router.push('/catalog-operational-authorization')} />

      <Card title="Decisões registradas" subtitle={`${decisions.length} decisão(ões) · execução automática permanentemente desativada`}>
        {decisions.slice().reverse().slice(0, 10).map((entry) => <View key={entry.decisionId} style={styles.row}><Text style={styles.strong}>{entry.action} · {statusLabel[entry.status]}</Text><Text style={styles.muted}>{entry.approvalCount}/{entry.requiredApprovals} aprovações · execução automática: não</Text></View>)}
      </Card>

      <Card title="Auditoria local" subtitle={`${events.length} evento(s)`}>
        {events.slice().reverse().slice(0, 20).map((entry) => <View key={entry.id} style={styles.row}><Text style={styles.strong}>{entry.type}</Text><Text style={styles.muted}>{entry.at}</Text></View>)}
      </Card>
    </Screen>
  );
}

const styles = StyleSheet.create({
  json: { minHeight: 120, textAlignVertical: 'top' },
  row: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: '#77777744', paddingTop: 8, marginTop: 8, gap: 4 },
  strong: { fontWeight: '700', marginTop: 4 },
  muted: { opacity: 0.72, marginTop: 4 },
  success: { color: '#146C43', fontWeight: '700', marginTop: 8 },
  warning: { color: '#A76400', fontWeight: '700', marginTop: 8 },
  error: { color: '#B3261E', fontWeight: '700', marginTop: 8 }
});
