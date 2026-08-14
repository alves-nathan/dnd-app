import { Text } from 'react-native';
import type { CharacterPendingChoice } from '../types';
import type { CharacterPendingChoiceResolution } from '../catalog/characterDependencyResolver';
import { useAppTheme } from '../theme';
import { Card } from './Card';
import { IssueList } from './IssueList';

interface PendingChoiceContextCardProps {
  pendingChoice?: CharacterPendingChoice;
  resolution?: CharacterPendingChoiceResolution;
}

const modeLabel = (mode: CharacterPendingChoiceResolution['mode']): string => {
  if (mode === 'dependency') return 'grafo de dependências';
  if (mode === 'owner') return 'proprietário canônico';
  if (mode === 'kindFallback') return 'compatibilidade por tipo';
  return 'sem resolução';
};

export function PendingChoiceContextCard({ pendingChoice, resolution }: PendingChoiceContextCardProps) {
  const { colors } = useAppTheme();
  if (!pendingChoice || !resolution) return null;

  return (
    <Card
      variant="hero"
      title={pendingChoice.title}
      subtitle={`${resolution.availableCandidateChoices.length} opção(ões) aplicável(is) · ${resolution.blockedCandidateChoices.length} bloqueada(s) · ${modeLabel(resolution.mode)}`}
    >
      <Text style={{ color: colors.onSurfaceVariant }}>{pendingChoice.description}</Text>
      {resolution.relationTypes.length ? (
        <Text style={{ color: colors.onSurfaceVariant, fontSize: 12 }}>
          Relações: {resolution.relationTypes.join(', ')}
        </Text>
      ) : null}
      {resolution.issues.length ? <IssueList issues={resolution.issues} /> : null}
    </Card>
  );
}
