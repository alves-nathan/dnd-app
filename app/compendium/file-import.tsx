import { useMemo, useState } from 'react';
import { Alert, ScrollView, Share, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import { File } from 'expo-file-system';
import { Screen } from '../../src/components/Screen';
import { Card } from '../../src/components/Card';
import { Field } from '../../src/components/Field';
import { Button } from '../../src/components/Button';
import { IssueList } from '../../src/components/IssueList';
import { parseLocalCompendiumFileContent, type LocalImportFileKind } from '../../src/compendium/fileImport';
import type { CompendiumItemType } from '../../src/compendium/types';
import { useCompendiumStore } from '../../src/store/compendiumStore';

const kindOptions: Array<CompendiumItemType | 'auto'> = ['auto', 'class', 'subclass', 'species', 'background', 'feat', 'weapon', 'armor', 'equipment', 'magicItem', 'spell', 'feature', 'condition', 'creatureStatBlock'];
const forceKindOptions: Array<LocalImportFileKind | 'auto'> = ['auto', 'json', 'markdown', 'text', 'unknown'];

const LARGE_IMPORT_TEXT_THRESHOLD = 250_000;
const IMPORT_PREVIEW_CHAR_LIMIT = 12_000;

const buildImportTextPreview = (value: string): string => {
  if (value.length <= IMPORT_PREVIEW_CHAR_LIMIT) return value;

  return [
    value.slice(0, IMPORT_PREVIEW_CHAR_LIMIT),
    '',
    `… preview limitado aos primeiros ${IMPORT_PREVIEW_CHAR_LIMIT.toLocaleString('pt-BR')} caracteres.`,
    `O conteúdo completo possui ${value.length.toLocaleString('pt-BR')} caracteres e continua disponível para validação e salvamento.`
  ].join('\n');
};


const parseDefaultKind = (value: string): CompendiumItemType | 'auto' => {
  const normalized = value.trim() as CompendiumItemType | 'auto';
  return kindOptions.includes(normalized) ? normalized : 'auto';
};

const parseForceKind = (value: string): LocalImportFileKind | 'auto' => {
  const normalized = value.trim() as LocalImportFileKind | 'auto';
  return forceKindOptions.includes(normalized) ? normalized : 'auto';
};

export default function LocalFileImportScreen() {
  const [fileName, setFileName] = useState('');
  const [fileMimeType, setFileMimeType] = useState<string | undefined>();
  const [fileSize, setFileSize] = useState<number | undefined>();
  const [fileText, setFileText] = useState('');
  const [editableJson, setEditableJson] = useState('');
  const [sourceId, setSourceId] = useState('local-file-source');
  const [book, setBook] = useState('Fonte própria importada por arquivo');
  const [page, setPage] = useState('');
  const [version, setVersion] = useState('2024');
  const [notes, setNotes] = useState('Arquivo local selecionado pelo usuário. Conteúdo exige revisão manual antes de uso automático.');
  const [packId, setPackId] = useState('local-file-import');
  const [defaultKind, setDefaultKind] = useState('auto');
  const [forceKind, setForceKind] = useState('auto');
  const [lastSavedMessage, setLastSavedMessage] = useState('');

  const saveImportJson = useCompendiumStore((state) => state.saveImportJson);
  const isSaving = useCompendiumStore((state) => state.isSaving);
  const existingItems = useCompendiumStore((state) => state.items);

  const parsed = useMemo(() => {
    if (!fileName || !fileText) return undefined;
    return parseLocalCompendiumFileContent(
      { name: fileName, mimeType: fileMimeType, size: fileSize },
      fileText,
      {
        packId,
        defaultKind: parseDefaultKind(defaultKind),
        forceKind: parseForceKind(forceKind),
        source: { id: sourceId, book, page, version, notes },
        maxCandidates: 100,
        existingItems
      }
    );
  }, [book, defaultKind, existingItems, fileMimeType, fileName, fileSize, fileText, forceKind, notes, packId, page, sourceId, version]);

  const outputJson = editableJson || parsed?.generatedJson || '';

  const isLargeFileText =
    fileText.length > LARGE_IMPORT_TEXT_THRESHOLD;

  const isLargeOutputJson =
    outputJson.length > LARGE_IMPORT_TEXT_THRESHOLD;

  const fileTextPreview = useMemo(
    () => buildImportTextPreview(fileText),
    [fileText]
  );

  const outputJsonPreview = useMemo(
    () => buildImportTextPreview(outputJson),
    [outputJson]
  );


  const handlePickFile = async () => {
    try {
      /*
       * Usa o picker do próprio expo-file-system para manter a URI
       * e a permissão de leitura concedida pelo Android.
       */
      const result = await File.pickFileAsync({
        multipleFiles: false,
        mimeTypes: '*/*'
      });

      if (result.canceled || !result.result) return;

      const file = result.result;

      console.log('Arquivo selecionado pelo FileSystem picker:', {
        name: file.name,
        uri: file.uri,
        type: file.type,
        size: file.size,
        exists: file.exists
      });

      const text = await file.text();

      if (!text.trim()) {
        throw new Error('O arquivo selecionado está vazio.');
      }

      setFileName(file.name || 'arquivo-importado');
      setFileMimeType(file.type || undefined);
      setFileSize(file.size || undefined);
      setFileText(text);
      setEditableJson('');
      setLastSavedMessage('');
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : String(error);

      console.error(
        'Falha ao selecionar ou ler arquivo local:',
        error
      );

      Alert.alert(
        'Arquivo não lido',
        `Não foi possível ler o arquivo selecionado.\n\nDetalhes: ${message}`
      );
    }
  };

  const handleUseGeneratedJson = () => {
    const generatedJson = parsed?.generatedJson ?? '';

    if (generatedJson.length > LARGE_IMPORT_TEXT_THRESHOLD) {
      Alert.alert(
        'JSON grande demais para edição interna',
        'Para evitar o fechamento do app, arquivos grandes são validados e salvos sem carregar todo o conteúdo em um editor de texto. O JSON original permanece íntegro.'
      );
      return;
    }

    setEditableJson(generatedJson);
  };

  const handleSave = async () => {
    if (!outputJson.trim()) {
      Alert.alert('Nada para salvar', 'Selecione um arquivo ou cole um JSON gerado antes de salvar.');
      return;
    }
    const result = await saveImportJson(outputJson);

    if (!result.ok) {
      console.error(
        'Resultado da persistência do compêndio:',
        result
      );

      const details = result.issues
        .map(
          (issue) =>
            `${issue.code ?? 'ERRO'}: ${issue.message}`
        )
        .join('\n\n');

      Alert.alert(
        'Arquivo não importado',
        details ||
          'Revise o JSON gerado antes de salvar.'
      );

      return;
    }
    setLastSavedMessage(`${result.itemCount} item(ns) importados de ${fileName || 'arquivo local'} para o SQLite.`);
    Alert.alert('Importação salva', `${result.itemCount} item(ns) persistidos. Use a fila de revisão antes de validar.`);
  };

  const shareGeneratedJson = async () => {
    try {
      await Share.share({ message: outputJson });
    } catch {
      Alert.alert('Compartilhamento falhou', 'Não foi possível abrir o compartilhamento do sistema.');
    }
  };

  return (
    <Screen
      title="Importar arquivo local"
      subtitle="Selecione JSON, Markdown, TXT ou CSV do dispositivo. JSON estruturado é validado diretamente; Markdown/TXT vira rascunho de revisão."
    >
      <Card title="Selecionar arquivo" subtitle="Use arquivos gerados pelo template padrão ou texto/Markdown extraído de fonte que você possui legalmente.">
        <Button label="Selecionar arquivo" onPress={handlePickFile} disabled={isSaving} />
        {fileName ? (
          <View style={styles.fileBox}>
            <Text style={styles.bold}>{fileName}</Text>
            <Text style={styles.muted}>{fileMimeType ?? 'mime desconhecido'} · {fileSize ? `${fileSize} bytes` : 'tamanho desconhecido'}</Text>
          </View>
        ) : (
          <Text style={styles.muted}>Nenhum arquivo selecionado ainda.</Text>
        )}
      </Card>

      <Card title="Metadados da importação" subtitle="Para Markdown/TXT, estes metadados são aplicados ao pacote gerado. Para JSON, valem os metadados já presentes no arquivo.">
        <Field label="ID da fonte" value={sourceId} onChangeText={setSourceId} autoCapitalize="none" />
        <Field label="Livro/fonte" value={book} onChangeText={setBook} />
        <Field label="Página(s)" value={page} onChangeText={setPage} placeholder="Ex.: 42, 42-43 ou capítulo" />
        <Field label="Versão" value={version} onChangeText={setVersion} placeholder="Ex.: 2024" />
        <Field label="ID do pacote" value={packId} onChangeText={setPackId} autoCapitalize="none" />
        <Field label="Tipo padrão para texto" value={defaultKind} onChangeText={setDefaultKind} autoCapitalize="none" placeholder="auto, spell, weapon, feature..." />
        <Text style={styles.helper}>Tipos aceitos: {kindOptions.join(', ')}</Text>
        <Field label="Forçar leitura como" value={forceKind} onChangeText={setForceKind} autoCapitalize="none" placeholder="auto, json, markdown, text" />
        <Text style={styles.helper}>Normalmente deixe como auto. Use json/markdown/text só quando a extensão do arquivo estiver errada.</Text>
        <Field label="Notas de origem" value={notes} onChangeText={setNotes} multiline style={styles.textareaSmall} />
      </Card>

      {parsed ? (
        <Card title={parsed.ok ? 'Preview importável' : 'Preview com bloqueios'} subtitle={`${parsed.kind} · ${parsed.detectedItemCount} item(ns)/candidato(s)`}>
          <Text style={styles.muted}>{parsed.summary}</Text>
          {parsed.issues.length ? (
            <ScrollView
              style={styles.issueViewport}
              contentContainerStyle={styles.issueViewportContent}
              nestedScrollEnabled
              showsVerticalScrollIndicator
            >
              <IssueList issues={parsed.issues} />
            </ScrollView>
          ) : null}
        </Card>
      ) : null}

      {parsed?.semiStructuredDraft ? (
        <Card title="Candidatos de Markdown/TXT" subtitle="Todos entram como needsReview até revisão manual.">
          {parsed.semiStructuredDraft.candidates.slice(0, 25).map((candidate) => (
            <View key={candidate.id} style={styles.candidateBox}>
              <Text style={styles.bold}>{candidate.name}</Text>
              <Text style={styles.muted}>{candidate.kind} · {candidate.source.book ?? candidate.source.id}</Text>
              {candidate.evidence.length ? <Text style={styles.evidence}>{candidate.evidence.join(' · ')}</Text> : <Text style={styles.muted}>Sem evidência mecânica clara.</Text>}
            </View>
          ))}
          {parsed.semiStructuredDraft.candidates.length > 25 ? <Text style={styles.muted}>Mostrando 25 de {parsed.semiStructuredDraft.candidates.length} candidatos.</Text> : null}
        </Card>
      ) : null}

      <Card
        title="Conteúdo lido"
        subtitle="O arquivo completo continua sendo usado na validação; arquivos grandes exibem somente uma amostra."
      >
        {isLargeFileText ? (
          <>
            <Text style={styles.largeFileNotice}>
              Arquivo grande detectado: {fileText.length.toLocaleString('pt-BR')} caracteres.
              A renderização integral foi desativada para preservar memória.
            </Text>

            <ScrollView
              style={styles.largePreviewViewport}
              contentContainerStyle={styles.largePreviewContent}
              nestedScrollEnabled
              showsVerticalScrollIndicator
            >
              <Text style={styles.codePreview}>
                {fileTextPreview}
              </Text>
            </ScrollView>
          </>
        ) : (
          <Field
            label="Texto do arquivo"
            value={fileText}
            onChangeText={setFileText}
            multiline
            scrollEnabled
            style={styles.textareaLarge}
          />
        )}
      </Card>

      <Card
        title="JSON final"
        subtitle="Arquivos pequenos podem ser editados. Arquivos grandes são salvos diretamente sem renderização integral."
      >
        <Button
          label="Carregar JSON gerado para edição"
          secondary
          onPress={handleUseGeneratedJson}
          disabled={!parsed || isLargeOutputJson}
        />

        {isLargeOutputJson ? (
          <>
            <Text style={styles.largeFileNotice}>
              JSON grande: {outputJson.length.toLocaleString('pt-BR')} caracteres.
              A edição interna e o compartilhamento como texto foram desativados para evitar falta de memória.
            </Text>

            <ScrollView
              style={styles.largePreviewViewport}
              contentContainerStyle={styles.largePreviewContent}
              nestedScrollEnabled
              showsVerticalScrollIndicator
            >
              <Text style={styles.codePreview}>
                {outputJsonPreview}
              </Text>
            </ScrollView>
          </>
        ) : (
          <Field
            label="JSON"
            value={outputJson}
            onChangeText={setEditableJson}
            multiline
            scrollEnabled
            autoCapitalize="none"
            autoCorrect={false}
            style={styles.jsonBox}
          />
        )}

        <Button
          label="Salvar arquivo no compêndio"
          onPress={handleSave}
          disabled={
            isSaving ||
            !outputJson.trim() ||
            Boolean(parsed && !parsed.ok)
          }
        />

        <Button
          label="Compartilhar JSON final"
          secondary
          onPress={shareGeneratedJson}
          disabled={
            !outputJson.trim() ||
            isLargeOutputJson
          }
        />

        {lastSavedMessage ? (
          <Text style={styles.success}>
            {lastSavedMessage}
          </Text>
        ) : null}
      </Card>

      <Card title="Próximo passo">
        <Text style={styles.muted}>Depois de salvar, use a fila de revisão e a prontidão pré-engine. Conteúdo vindo de Markdown/TXT nunca é validado automaticamente.</Text>
        <Button label="Abrir fila de revisão" onPress={() => router.push('/compendium/review-queue')} />
        <Button label="Voltar ao compêndio" secondary onPress={() => router.replace('/compendium')} />
      </Card>
    </Screen>
  );
}

const styles = StyleSheet.create({
  fileBox: { borderWidth: 1, borderColor: '#e2e8f0', borderRadius: 12, padding: 10, gap: 3 },
  candidateBox: { borderWidth: 1, borderColor: '#e2e8f0', borderRadius: 12, padding: 10, gap: 4 },
  bold: { color: '#111827', fontWeight: '800' },
  muted: { color: '#64748b', lineHeight: 19 },
  helper: { color: '#64748b', fontSize: 12, lineHeight: 17 },
  evidence: { color: '#0f766e', lineHeight: 19 },
  success: { color: '#047857', fontWeight: '700', lineHeight: 20 },
  textareaSmall: { minHeight: 92, textAlignVertical: 'top' },
  textareaLarge: { height: 220, maxHeight: 220, textAlignVertical: 'top', fontSize: 12, lineHeight: 17 },
  issueViewport: {
    maxHeight: 260,
    borderWidth: 1,
    borderColor: '#fecaca',
    borderRadius: 12,
    overflow: 'hidden'
  },
  issueViewportContent: {
    padding: 8
  },
  largeFileNotice: {
    color: '#92400e',
    backgroundColor: '#fffbeb',
    borderWidth: 1,
    borderColor: '#fde68a',
    borderRadius: 10,
    padding: 10,
    lineHeight: 18
  },
  largePreviewViewport: {
    height: 220,
    maxHeight: 220,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    borderRadius: 12,
    backgroundColor: '#f8fafc',
    overflow: 'hidden'
  },
  largePreviewContent: {
    padding: 12
  },
  codePreview: {
    color: '#334155',
    fontFamily: 'monospace',
    fontSize: 11,
    lineHeight: 16
  },
  jsonBox: {
    height: 320,
    maxHeight: 320,
    textAlignVertical: 'top',
    fontSize: 12,
    lineHeight: 17
  }
});
