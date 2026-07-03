import { Text } from 'ink';
import React from 'react';
import { colors } from '../theme.js';

const JS_KEYWORDS = new Set([
  'const', 'let', 'var', 'function', 'return', 'if', 'else', 'for', 'while', 'do', 'switch', 'case',
  'break', 'continue', 'class', 'extends', 'new', 'this', 'typeof', 'instanceof', 'import', 'export',
  'from', 'default', 'try', 'catch', 'finally', 'throw', 'async', 'await', 'yield', 'interface',
  'type', 'enum', 'implements', 'public', 'private', 'protected', 'readonly', 'static', 'void',
  'null', 'undefined', 'true', 'false', 'in', 'of', 'as',
]);

const PY_KEYWORDS = new Set([
  'def', 'return', 'if', 'elif', 'else', 'for', 'while', 'break', 'continue', 'class', 'import',
  'from', 'as', 'try', 'except', 'finally', 'raise', 'with', 'lambda', 'yield', 'global', 'nonlocal',
  'pass', 'del', 'assert', 'async', 'await', 'and', 'or', 'not', 'in', 'is', 'None', 'True', 'False', 'self',
]);

const SHELL_KEYWORDS = new Set([
  'if', 'then', 'else', 'elif', 'fi', 'for', 'in', 'do', 'done', 'while', 'case', 'esac', 'function',
  'return', 'local', 'export', 'echo', 'cd', 'set', 'exit', 'foreach', 'param',
]);

const GENERIC_KEYWORDS = new Set([...JS_KEYWORDS, ...PY_KEYWORDS, ...SHELL_KEYWORDS]);

const TOKEN =
  /(\/\/.*$|#.*$|"(?:[^"\\]|\\.)*"?|'(?:[^'\\]|\\.)*'?|`(?:[^`\\]|\\.)*`?|\b\d(?:[\d_.]*\d)?\b|\b[A-Za-z_]\w*\b)/g;

interface TokenStyle {
  color?: string;
  italic?: boolean;
  dimColor?: boolean;
}

/** One line of a code block, tokenized with the calm palette. */
export function HighlightedLine({ line, lang }: { line: string; lang: string }): React.JSX.Element {
  if (line.length === 0) {
    return <Text> </Text>;
  }
  const keywords = keywordsFor(lang);
  const parts = line.split(TOKEN).filter((part) => part !== undefined && part !== '');
  return (
    <Text>
      {parts.map((part, index) => {
        const style = styleFor(part, keywords);
        return (
          <Text key={index} color={style.color} italic={style.italic} dimColor={style.dimColor}>
            {part}
          </Text>
        );
      })}
    </Text>
  );
}

function styleFor(token: string, keywords: ReadonlySet<string>): TokenStyle {
  const first = token[0];
  if (token.startsWith('//') || first === '#') {
    return { color: colors.dim, italic: true };
  }
  if (first === '"' || first === "'" || first === '`') {
    return { color: colors.ok };
  }
  if (/^\d/.test(token)) {
    return { color: colors.tool };
  }
  if (keywords.has(token)) {
    return { color: colors.accent };
  }
  return {};
}

function keywordsFor(lang: string): ReadonlySet<string> {
  switch (lang.toLowerCase()) {
    case 'js':
    case 'jsx':
    case 'ts':
    case 'tsx':
    case 'javascript':
    case 'typescript':
    case 'json':
      return JS_KEYWORDS;
    case 'py':
    case 'python':
      return PY_KEYWORDS;
    case 'sh':
    case 'bash':
    case 'zsh':
    case 'shell':
    case 'powershell':
    case 'ps1':
      return SHELL_KEYWORDS;
    default:
      return GENERIC_KEYWORDS;
  }
}
