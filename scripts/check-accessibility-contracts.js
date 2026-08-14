const fs = require('node:fs');
const path = require('node:path');

const checks = [
  ['src/components/Button.tsx', ['accessibilityRole="button"', 'accessibilityLabel=', 'accessibilityHint=', 'focusable=', 'minHeight: 48']],
  ['src/components/BottomNavigation.tsx', ['accessibilityRole="tab"', 'accessibilityLabel=', 'accessibilityHint=', 'focusable', 'minHeight: 58']],
  ['src/components/Card.tsx', ['accessibilityRole="button"', 'accessibilityLabel=', 'accessibilityHint=', 'focusable']],
  ['src/components/Chip.tsx', ['accessibilityRole="button"', 'accessibilityState=', 'accessibilityLabel=', 'focusable=', 'minHeight: 48']],
  ['src/components/Field.tsx', ['accessibilityLabelledBy=', 'accessibilityLiveRegion="polite"', 'minHeight: 52']],
  ['src/components/Screen.tsx', ['onAccessibilityEscape=', 'accessibilityRole="header"', 'keyboardDismissMode="on-drag"']],
  ['src/components/VirtualizedScreen.tsx', ['onAccessibilityEscape=', 'accessibilityRole="header"', 'keyboardDismissMode=', 'removeClippedSubviews']]
];

const errors = [];
for (const [relativePath, requiredSnippets] of checks) {
  const absolutePath = path.join(process.cwd(), relativePath);
  if (!fs.existsSync(absolutePath)) {
    errors.push(`${relativePath}: arquivo ausente`);
    continue;
  }
  const content = fs.readFileSync(absolutePath, 'utf8');
  for (const snippet of requiredSnippets) {
    if (!content.includes(snippet)) errors.push(`${relativePath}: contrato ausente (${snippet})`);
  }
}

if (errors.length) {
  console.error('Falha nos contratos mínimos de acessibilidade:');
  errors.forEach((error) => console.error(`- ${error}`));
  process.exit(1);
}
console.log('Contratos mínimos de acessibilidade: OK');
