import { useMemo, useState } from 'react';
import { Alert, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import { Screen } from '../../src/components/Screen';
import { Card } from '../../src/components/Card';
import { Field } from '../../src/components/Field';
import { Button } from '../../src/components/Button';
import { IssueList } from '../../src/components/IssueList';
import { buildSemiStructuredImportDraft, summarizeSemiStructuredDraft } from '../../src/compendium/semiStructuredImport';
import type { CompendiumItemType } from '../../src/compendium/types';
import { useCompendiumStore } from '../../src/store/compendiumStore';

const sampleText = `## Lâmina de Treino Arcana
Weapon, melee, finesse. Action. Damage: 1d8 + DEX. Mastery: Vex.

## Raio Autoral de Teste
Cantrip spell. Casting Time: Action. Spell attack. Damage: 2d10 fire damage. Range 120 ft.

## Marca de Caçador Autoral
Feature. Bonus Action. Concentration. Once per turn, if the target is marked, deal 1d6 extra damage.`;

const kindOptions: Array<CompendiumItemType | 'auto'> = ['auto', 'class', 'subclass', 'species', 'background', 'feat', 'weapon', 'armor', 'equipment', 'magicItem', 'spell', 'feature', 'condition', 'creatureStatBlock'];

const parseKind = (value: string): CompendiumItemType | 'auto' => {
  const normalized = value.trim() as CompendiumItemType | 'auto';
  return kindOptions.includes(normalized) ? normalized : 'auto';
};

export default function SemiStructuredImportAssistantScreen() {
  const [text, setText] = useState(sampleText);
  const [sourceId, setSourceId] = useState('semi-source');
  const [book, setBook] = useState('Minha fonte própria');
  const [page, setPage] = useState('');
  const [version, setVersion] = useState('2024');
  const [notes, setNotes] = useState('Conteúdo colado de fonte legalmente obtida pelo usuário.');
  const [packId, setPackId] = useState('semi-structured-import');
  const [defaultKind, setDefaultKind] = useState('auto');
  const [editableJson, setEditableJson] = useState('');
  const [lastSavedMessage, setLastSavedMessage] = useState('');

  const saveImportJson = useCompendiumStore((state) => state.saveImportJson);
  const isSaving = useCompendiumStore((state) => state.isSaving);

  const draft = useMemo(
    () =>
      buildSemiStructuredImportDraft(text, {
        packId,
        defaultKind: parseKind(defaultKind),
        source: { id: sourceId, book, page, version, notes },
        maxCandidates: 50
      }),
    [book, defaultKind, notes, packId, page, sourceId, text, version]
  );

  const generatedJson = editableJson || draft.generatedJson;
  const summary = useMemo(() => summarizeSemiStructuredDraft(draft), [draft]);

  const handleUseGeneratedJson = () => setEditableJson(draft.generatedJson);

  const handleSave = async () => {
    const jsonToSave = editableJson || draft.generatedJson;
    const result = await saveImportJson(jsonToSave);
    if (!result.ok) {
      Alert.alert('Rascunho não salvo', result.issues.map((issue) => issue.message).join('\n') || 'Revise o JSON gerado antes de salvar.');
      return;
    }
    setLastSavedMessage(`${result.itemCount} item(ns) salvos como rascunho/revisão no compêndio SQLite.`);
    Alert.alert('Rascunho salvo', `${result.itemCount} item(ns) foram salvos. Abra os detalhes ou o editor de mapeamento para revisar e validar.`);
  };

  return (
    <Screen
      title="Assistente de importação"
      subtitle="Cole texto ou Markdown de uma fonte própria. O app só detecta candidatos e salva como revisão; você precisa mapear/validar antes de usar na engine."
    >
      <Card title="Fonte e pacote" subtitle="Metadados são obrigatórios para auditoria e para evitar regras sem origem rastreável.">
        <Field label="ID da fonte" value={sourceId} onChangeText={setSourceId} autoCapitalize="none" />
        <Field label="Livro/fonte" value={book} onChangeText={setBook} />
        <Field label="Página(s)" value={page} onChangeText={setPage} placeholder="Ex.: 42, 42-43 ou capítulo" />
        <Field label="Versão" value={version} onChangeText={setVersion} placeholder="Ex.: 2024" />
        <Field label="ID do pacote" value={packId} onChangeText={setPackId} autoCapitalize="none" />
        <Field label="Tipo padrão" value={defaultKind} onChangeText={setDefaultKind} autoCapitalize="none" placeholder="auto, spell, weapon, feature..." />
        <Text style={styles.helper}>Tipos aceitos: {kindOptions.join(', ')}</Text>
        <Field label="Notas de origem" value={notes} onChangeText={setNotes} multiline style={styles.textareaSmall} />
      </Card>

      <Card title="Texto / Markdown" subtitle="Use títulos Markdown para separar itens. O detector procura fórmulas, custo de ação, concentração, usos e pistas de tipo.">
        <Field label="Conteúdo colado" value={text} onChangeText={setText} multiline style={styles.textareaLarge} />
      </Card>

      <Card title="Candidatos detectados" subtitle={`${draft.candidates.length} candidato(s) gerado(s). Todos entram como needsReview/importedNeedsReview.`}>
        {draft.candidates.length === 0 ? <Text style={styles.muted}>Nenhum candidato detectado ainda.</Text> : null}
        {draft.candidates.slice(0, 20).map((candidate) => (
          <View key={candidate.id} style={styles.candidateBox}>
            <Text style={styles.candidateTitle}>{candidate.name}</Text>
            <Text style={styles.meta}>{candidate.kind} · {candidate.source.book ?? candidate.source.id}</Text>
            {candidate.summary ? <Text style={styles.summary}>{candidate.summary}</Text> : null}
            {candidate.evidence.length ? <Text style={styles.evidence}>{candidate.evidence.join(' · ')}</Text> : <Text style={styles.muted}>Sem evidência mecânica clara.</Text>}
          </View>
        ))}
        {draft.candidates.length > 20 ? <Text style={styles.muted}>Mostrando 20 de {draft.candidates.length} candidatos.</Text> : null}
      </Card>

      <Card title="Avisos de detecção" subtitle="Avisos são esperados: esta etapa nunca valida regra automaticamente.">
        <IssueList issues={draft.issues} />
        {!draft.issues.length ? <Text style={styles.muted}>Sem avisos além da revisão obrigatória por item.</Text> : null}
      </Card>

      <Card title="Resumo rápido">
        <Field label="Resumo" value={summary || 'Nenhum candidato.'} editable={false} multiline style={styles.textareaSmall} />
      </Card>

      <Card title="JSON gerado" subtitle="Você pode editar antes de salvar. Depois, revise cada item na tela de detalhes/mapeamento.">
        <Button label="Carregar JSON gerado para edição" secondary onPress={handleUseGeneratedJson} />
        <Field label="JSON" value={generatedJson} onChangeText={setEditableJson} multiline style={styles.jsonBox} autoCapitalize="none" />
        <Button label="Salvar rascunho no compêndio" onPress={handleSave} disabled={isSaving || !draft.ok} />
        {lastSavedMessage ? <Text style={styles.success}>{lastSavedMessage}</Text> : null}
      </Card>

      <Card title="Próximo passo" subtitle="Após salvar, abra cada item no compêndio, use o editor visual de mapeamento e valide somente o que estiver correto.">
        <Button label="Ir para compêndio" onPress={() => router.replace('/compendium')} />
        <Button label="Voltar" secondary onPress={() => router.back()} />
      </Card>
    </Screen>
  );
}

const styles = StyleSheet.create({
  helper: { color: '#64748b', fontSize: 12, lineHeight: 17 },
  muted: { color: '#64748b', lineHeight: 19 },
  summary: { color: '#334155', lineHeight: 19 },
  meta: { color: '#64748b', fontSize: 12, fontWeight: '700' },
  evidence: { color: '#0f766e', lineHeight: 19 },
  success: { color: '#047857', fontWeight: '700', lineHeight: 20 },
  candidateBox: { borderWidth: 1, borderColor: '#e2e8f0', borderRadius: 12, padding: 10, gap: 4 },
  candidateTitle: { color: '#111827', fontSize: 16, fontWeight: '800' },
  textareaSmall: { minHeight: 92, textAlignVertical: 'top' },
  textareaLarge: { minHeight: 260, textAlignVertical: 'top' },
  jsonBox: { minHeight: 280, textAlignVertical: 'top', fontSize: 12, lineHeight: 17 }
});
