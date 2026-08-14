import * as fs from 'fs';
import * as path from 'path';

const projectRoot = path.resolve(__dirname, '../..');
const roots = [path.join(projectRoot, 'app'), path.join(projectRoot, 'src', 'components')];
const interactiveChildPattern = /<(?:Button|Chip|Pressable|Field|TextInput|Switch|Touchable\w*)\b/;

type OpenCard = {
  contentStart: number;
  hasOnPress: boolean;
  line: number;
};

const sourceFiles = (directory: string): string[] => fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
  const entryPath = path.join(directory, entry.name);
  if (entry.isDirectory()) return sourceFiles(entryPath);
  return /\.tsx?$/.test(entry.name) ? [entryPath] : [];
});

const findOpeningTagEnd = (source: string, start: number): number => {
  let quote: '"' | "'" | '`' | undefined;
  let escaped = false;
  let braceDepth = 0;

  for (let index = start; index < source.length; index += 1) {
    const character = source[index];
    if (quote) {
      if (escaped) escaped = false;
      else if (character === '\\') escaped = true;
      else if (character === quote) quote = undefined;
      continue;
    }
    if (character === '"' || character === "'" || character === '`') {
      quote = character;
      continue;
    }
    if (character === '{') braceDepth += 1;
    else if (character === '}') braceDepth = Math.max(0, braceDepth - 1);
    else if (character === '>' && braceDepth === 0) return index;
  }

  return -1;
};

const findViolations = (source: string): number[] => {
  const violations: number[] = [];
  const stack: OpenCard[] = [];
  const cardTag = /<Card\b|<\/Card\s*>/g;
  let match: RegExpExecArray | null;

  while ((match = cardTag.exec(source))) {
    if (match[0].startsWith('</')) {
      const openCard = stack.pop();
      if (openCard?.hasOnPress) {
        const content = source.slice(openCard.contentStart, match.index);
        if (interactiveChildPattern.test(content)) violations.push(openCard.line);
      }
      continue;
    }

    const openingEnd = findOpeningTagEnd(source, match.index);
    if (openingEnd < 0) break;
    const openingTag = source.slice(match.index, openingEnd + 1);
    const selfClosing = /\/\s*>$/.test(openingTag);
    if (!selfClosing) {
      stack.push({
        contentStart: openingEnd + 1,
        hasOnPress: /\bonPress\s*=/.test(openingTag),
        line: source.slice(0, match.index).split('\n').length
      });
    }
    cardTag.lastIndex = openingEnd + 1;
  }

  return violations;
};

describe('interactive Card DOM contract', () => {
  it('does not place controls inside a Card that is itself clickable', () => {
    const violations = roots.flatMap(sourceFiles).flatMap((filePath) =>
      findViolations(fs.readFileSync(filePath, 'utf8')).map((line) => `${path.relative(projectRoot, filePath)}:${line}`)
    );

    expect(violations).toEqual([]);
  });
});
