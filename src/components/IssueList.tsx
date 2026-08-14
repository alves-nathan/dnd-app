import { StyleSheet, Text, View } from 'react-native';
import { RuleValidationIssue } from '../types';

export const IssueList = ({ issues }: { issues: RuleValidationIssue[] }) => {
  if (!issues.length) return null;
  return (
    <View style={styles.wrapper}>
      {issues.map((issue, index) => (
        <Text key={`${issue.code}-${index}`} style={styles.issue}>
          {issue.severity.toUpperCase()}: {issue.message}
        </Text>
      ))}
    </View>
  );
};

const styles = StyleSheet.create({
  wrapper: { gap: 6, backgroundColor: '#fff7ed', borderColor: '#fed7aa', borderWidth: 1, borderRadius: 12, padding: 10 },
  issue: { color: '#9a3412', fontSize: 13, lineHeight: 18 }
});
