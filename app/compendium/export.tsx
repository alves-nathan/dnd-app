import { useEffect, useMemo, useState } from 'react';
import { Alert, Share, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import { Screen } from '../../src/components/Screen';
import { Card } from '../../src/components/Card';
import { Field } from '../../src/components/Field';
import { Button } from '../../src/components/Button';
import { IssueList } from '../../src/components/IssueList';
import { buildCompendiumPackageExport, buildCompendiumPackageExportFileName, summarizeCompendiumPackageExport } from '../../src/compendium/packageExport';
import { useCompendiumStore } from '../../src/store/compendiumStore';
import type { CompendiumItemType, StoredCompendiumItemStatus } from '../../src/compendium/types';

const itemTypes: CompendiumItemType[] = ['class', 'subclass', 'species', 'background', 'feat', 'weapon', 'armor', 'equipment', 'magicItem', 'spell', 'feature', 'condition', 'creatureStatBlock'];
const itemStatuses: StoredCompendiumItemStatus[] = ['draft', 'validated', 'needsReview', 'disabled'];

const parseCsv = (input: string): string[] => input.split(',').map((entry) => entry.trim()).filter(Boolean);

const parseTypes = (input: string): CompendiumItemType[] | undefined => {
  const values = parseCsv(input);
  if (!values.length) return undefined;
  return values.filter((entry): entry is CompendiumItemType => itemTypes.includes(entry as CompendiumItemType));
};

const parseStatuses = (input: string): StoredCompendiumItemStatus[] | undefined => {
  const values = parseCsv(input);
  if (!values.length) return undefined;
  return values.filter((entry): entry is StoredCompendiumItemStatus => itemStatuses.includes(entry as StoredCompendiumItemStatus));
};

export default function CompendiumExportScreen() {
  const [exportName, setExportName] = useState('Compendium export');
  const [packFilter, setPackFilter] = useState('');
  const [sourceFilter, setSourceFilter] = useState('');
  const [typeFilter, setTypeFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('validated');
  const [onlyEnabledSources, setOnlyEnabledSources] = useState(true);
  const [includeDisabledItems, setIncludeDisabledItems] = useState(false);
  const [includeReviewMetadata, setIncludeReviewMetadata] = useState(true);
  const [includeOriginalSourceMetadata, setIncludeOriginalSourceMetadata] = useState(true);
  const [forceNeedsReview, setForceNeedsReview] = useState(false);

  const sources = useCompendiumStore((state) => state.sources);
  const packs = useCompendiumStore((state) => state.packs);
  const items = useCompendiumStore((state) => state.items);
  const enabledSourceIds = useCompendiumStore((state) => state.enabledSourceIds);
  const isHydrated = useCompendiumStore((state) => state.isHydrated);
  const isHydrating = useCompendiumStore((state) => state.isHydrating);
  const hydrate = useCompendiumStore((state) => state.hydrate);
  const getSnapshot = useCompendiumStore((state) => state.getSnapshot);

  useEffect(() => {
    if (!isHydrated && !isHydrating) void hydrate();
  }, [hydrate, isHydrated, isHydrating]);

  const result = useMemo(
    () =>
      buildCompendiumPackageExport(getSnapshot(), {
        exportName,
        packIds: parseCsv(packFilter),
        sourceIds: parseCsv(sourceFilter),
        types: parseTypes(typeFilter),
        statuses: parseStatuses(statusFilter),
        onlyEnabledSources,
        includeDisabledItems,
        includeReviewMetadata,
        includeOriginalSourceMetadata,
        forceNeedsReview
      }),
    [exportName, packFilter, sourceFilter, typeFilter, statusFilter, onlyEnabledSources, includeDisabledItems, includeReviewMetadata, includeOriginalSourceMetadata, forceNeedsReview, getSnapshot, items, sources, packs, enabledSourceIds]
  );

  const fileName = buildCompendiumPackageExportFileName(result);

  const handleShare = async () => {
    if (!result.ok || !result.json) {
      Alert.alert('Exportação inválida', result.issues.map((issue) => issue.message).join('\n') || 'Ajuste os filtros antes de compartilhar.');
      return;
    }
    await Share.share({ title: fileName, message: result.json });
  };

  const handleCopyToImportField = () => {
    Alert.alert('JSON gerado', 'Copie o conteúdo do preview abaixo ou compartilhe pelo botão. O React Native puro não inclui clipboard sem dependência extra neste MVP.');
  };

  return (
    <Screen
      title="Exportar pacote do compêndio"
      subtitle="Gere um JSON dnd-combat-import.v2 canônico, validado por round-trip e reimportável pelo mesmo pipeline do compêndio."
    >
      <Card title="Resumo" subtitle={summarizeCompendiumPackageExport(result)}>
        <Text style={styles.muted}>Arquivo sugerido: {fileName}</Text>
        <Text style={result.ok ? styles.ok : styles.error}>{result.ok ? 'Exportação pronta para compartilhar/reimportar.' : 'A exportação ainda tem erro bloqueante.'}</Text>
        <IssueList issues={result.issues} />
      </Card>

      <Card title="Filtros de exportação" subtitle="Use listas separadas por vírgula. Deixe vazio para incluir tudo dentro do escopo selecionado.">
        <Field label="Nome da exportação" value={exportName} onChangeText={setExportName} />
        <Field label="Pacotes" value={packFilter} onChangeText={setPackFilter} placeholder="pack-a, pack-b" autoCapitalize="none" />
        <Field label="Fontes" value={sourceFilter} onChangeText={setSourceFilter} placeholder="source-a, source-b" autoCapitalize="none" />
        <Field label="Tipos" value={typeFilter} onChangeText={setTypeFilter} placeholder="weapon, spell, feature" autoCapitalize="none" />
        <Field label="Status" value={statusFilter} onChangeText={setStatusFilter} placeholder="validated, needsReview, draft, disabled" autoCapitalize="none" />
      </Card>

      <Card title="Opções de segurança e metadados">
        <Button label={onlyEnabledSources ? 'Somente fontes ativas' : 'Fontes ativas e inativas'} secondary onPress={() => setOnlyEnabledSources((value) => !value)} />
        <Button label={includeDisabledItems ? 'Incluindo itens disabled' : 'Ignorando itens disabled'} secondary onPress={() => setIncludeDisabledItems((value) => !value)} />
        <Button label={includeReviewMetadata ? 'Inclui metadados de revisão' : 'Não inclui metadados de revisão'} secondary onPress={() => setIncludeReviewMetadata((value) => !value)} />
        <Button label={includeOriginalSourceMetadata ? 'Inclui origem de storage no metadata' : 'Não inclui origem de storage no metadata'} secondary onPress={() => setIncludeOriginalSourceMetadata((value) => !value)} />
        <Button label={forceNeedsReview ? 'Reexportar como needsReview' : 'Manter status/confiança da fonte'} secondary onPress={() => setForceNeedsReview((value) => !value)} />
      </Card>

      <Card title="Ajuda rápida" subtitle="IDs disponíveis para filtros">
        <Text style={styles.bold}>Pacotes</Text>
        {packs.length ? packs.map((pack) => <Text key={pack.id} style={styles.muted}>{pack.id} · {pack.name} · {pack.itemCount} itens</Text>) : <Text style={styles.muted}>Nenhum pacote importado.</Text>}
        <View style={styles.separator} />
        <Text style={styles.bold}>Fontes</Text>
        {sources.length ? sources.map((source) => <Text key={source.id} style={styles.muted}>{source.id} · {source.book ?? 'sem livro'} · {enabledSourceIds.includes(source.id) ? 'ativa' : 'inativa'}</Text>) : <Text style={styles.muted}>Nenhuma fonte importada.</Text>}
      </Card>

      <Card title="Preview JSON" subtitle={`${result.summary.exportedItemCount} item(ns) no JSON final.`}>
        <Field label="JSON exportável" value={result.json ?? ''} onChangeText={() => undefined} multiline style={{ minHeight: 260, textAlignVertical: 'top' }} />
        <Button label="Compartilhar JSON" onPress={handleShare} disabled={!result.ok} />
        <Button label="Copiar manualmente do preview" secondary onPress={handleCopyToImportField} />
      </Card>

      <Button label="Voltar" secondary onPress={() => router.back()} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  muted: { color: '#64748b', lineHeight: 19 },
  bold: { fontWeight: '800', color: '#111827' },
  ok: { color: '#047857', fontWeight: '800' },
  error: { color: '#b91c1c', fontWeight: '800' },
  separator: { height: 1, backgroundColor: '#e2e8f0', marginVertical: 8 }
});
