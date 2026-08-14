import { useMemo, useState } from 'react';
import { Alert, Share, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import { Screen } from '../../src/components/Screen';
import { Card } from '../../src/components/Card';
import { Field } from '../../src/components/Field';
import { Button } from '../../src/components/Button';
import { IssueList } from '../../src/components/IssueList';
import {
  buildExtractorPrompt,
  buildStandardImportJsonTemplate,
  buildStandardImportMarkdownTemplate,
  STANDARD_IMPORT_TEMPLATE_VERSION,
  validateStandardImportTemplateJson
} from '../../src/compendium/importTemplate';
import { buildImportSchemaDocumentation, buildImportV2JsonSchemaText } from '../../src/compendium/importV2Documentation';

type OutputMode = 'json' | 'markdown' | 'prompt-json' | 'prompt-markdown' | 'guide' | 'json-schema';

export default function ImportTemplatesScreen() {
  const [packId, setPackId] = useState('player-owned-book-pack');
  const [sourceId, setSourceId] = useState('player-owned-book');
  const [book, setBook] = useState('Nome do livro/fonte legalmente obtida');
  const [page, setPage] = useState('página ou intervalo');
  const [version, setVersion] = useState('2024');
  const [includeAllTypes, setIncludeAllTypes] = useState(true);
  const [mode, setMode] = useState<OutputMode>('json');

  const options = useMemo(
    () => ({ packId, sourceId, book, page, version, includeExamples: true, includeAllTypes }),
    [book, includeAllTypes, packId, page, sourceId, version]
  );

  const output = useMemo(() => {
    if (mode === 'markdown') return buildStandardImportMarkdownTemplate(options);
    if (mode === 'prompt-json') return buildExtractorPrompt({ ...options, outputFormat: 'json', sourceName: book });
    if (mode === 'prompt-markdown') return buildExtractorPrompt({ ...options, outputFormat: 'markdown', sourceName: book });
    if (mode === 'guide') return buildImportSchemaDocumentation({ format: 'markdown', includeEntityDetails: true });
    if (mode === 'json-schema') return buildImportV2JsonSchemaText();
    return buildStandardImportJsonTemplate(options);
  }, [book, mode, options]);

  const preview = useMemo(() => (mode === 'json' ? validateStandardImportTemplateJson(output) : undefined), [mode, output]);

  const shareOutput = async () => {
    try {
      await Share.share({ message: output });
    } catch {
      Alert.alert('Compartilhamento falhou', 'Não foi possível abrir o compartilhamento do sistema.');
    }
  };

  return (
    <Screen
      title="Modelo padrão de importação"
      subtitle="Gere templates V2, prompt de extração, guia canônico e JSON Schema a partir do domínio atual do app."
    >
      <Card title="Princípio de segurança do compêndio" subtitle={`Versão do template: ${STANDARD_IMPORT_TEMPLATE_VERSION}`}>
        <Text style={styles.muted}>
          Todo conteúdo extraído por IA deve entrar como needsReview/importedNeedsReview. Depois, use a fila de revisão, o editor visual e a prontidão pré-engine antes de aplicar à ficha.
        </Text>
      </Card>

      <Card title="Metadados da fonte">
        <Field label="ID do pacote" value={packId} onChangeText={setPackId} autoCapitalize="none" />
        <Field label="ID da fonte" value={sourceId} onChangeText={setSourceId} autoCapitalize="none" />
        <Field label="Livro/fonte" value={book} onChangeText={setBook} />
        <Field label="Página ou intervalo" value={page} onChangeText={setPage} />
        <Field label="Versão" value={version} onChangeText={setVersion} />
        <Button
          label={includeAllTypes ? 'Template completo: todos os tipos' : 'Template mínimo: arma, magia e feature'}
          secondary
          onPress={() => setIncludeAllTypes((value) => !value)}
        />
      </Card>

      <Card title="Formato de saída" subtitle="JSON é o melhor para importação direta. Markdown é útil para revisão humana antes da conversão.">
        <View style={styles.grid}>
          <Button label="JSON" secondary={mode !== 'json'} onPress={() => setMode('json')} />
          <Button label="Markdown" secondary={mode !== 'markdown'} onPress={() => setMode('markdown')} />
          <Button label="Prompt + JSON" secondary={mode !== 'prompt-json'} onPress={() => setMode('prompt-json')} />
          <Button label="Prompt + MD" secondary={mode !== 'prompt-markdown'} onPress={() => setMode('prompt-markdown')} />
          <Button label="Guia V2" secondary={mode !== 'guide'} onPress={() => setMode('guide')} />
          <Button label="JSON Schema" secondary={mode !== 'json-schema'} onPress={() => setMode('json-schema')} />
        </View>
      </Card>

      {preview ? (
        <Card title={preview.ok ? 'Template JSON válido' : 'Template JSON com erro'} subtitle={preview.data ? `${preview.data.items.length} itens de exemplo` : undefined}>
          <IssueList issues={preview.issues} />
          {preview.ok ? <Text style={styles.muted}>Este JSON pode ser colado na tela principal de importação. Os itens entram para revisão por padrão.</Text> : null}
        </Card>
      ) : null}

      <Card title="Saída gerada" subtitle="Copie/compartilhe este conteúdo para usar como padrão de extração.">
        <Field label="Template / prompt" value={output} onChangeText={() => undefined} multiline style={styles.output} />
        <Button label="Compartilhar saída" onPress={shareOutput} />
      </Card>

      <Card title="Fluxo recomendado">
        <Text style={styles.step}>1. Gere o prompt + JSON nesta tela.</Text>
        <Text style={styles.step}>2. Envie para a IA junto com trechos/tabelas extraídos de material que você possui legalmente.</Text>
        <Text style={styles.step}>3. Cole o JSON resultante em Compêndio / Importação.</Text>
        <Text style={styles.step}>4. Use Fila de revisão → Mapear → Prontidão pré-engine.</Text>
        <Text style={styles.step}>5. Só valide itens conferidos manualmente.</Text>
      </Card>

      <Button label="Voltar" secondary onPress={() => router.back()} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  muted: { color: '#64748b', lineHeight: 19 },
  grid: { gap: 8 },
  output: { minHeight: 320, textAlignVertical: 'top', fontSize: 12, lineHeight: 17 },
  step: { color: '#334155', lineHeight: 20 }
});
