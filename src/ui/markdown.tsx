import { Box, Text } from 'ink';
import React from 'react';
import { colors, glyphs } from '../theme.js';
import { HighlightedLine } from './highlight.js';

interface MarkdownProps {
  text: string;
}

type Block =
  | { kind: 'prose'; lines: string[] }
  | { kind: 'code'; lang: string; lines: string[] };

/** Lightweight markdown rendering: fenced code, headings, bullets, bold, inline code. */
export function Markdown({ text }: MarkdownProps): React.JSX.Element {
  const blocks = splitBlocks(text);
  return (
    <Box flexDirection="column">
      {blocks.map((block, index) =>
        block.kind === 'code' ? (
          <Box
            key={index}
            flexDirection="column"
            borderStyle="round"
            borderDimColor
            paddingX={1}
            marginY={0}
          >
            {block.lines.map((line, lineIndex) => (
              <HighlightedLine key={lineIndex} line={line} lang={block.lang} />
            ))}
          </Box>
        ) : (
          <Box key={index} flexDirection="column">
            {block.lines.map((line, lineIndex) => (
              <ProseLine key={lineIndex} line={line} />
            ))}
          </Box>
        ),
      )}
    </Box>
  );
}

function ProseLine({ line }: { line: string }): React.JSX.Element {
  const headingMatch = /^(#{1,6})\s+(.*)$/.exec(line);
  if (headingMatch !== null) {
    return (
      <Text bold color={colors.accent}>
        {headingMatch[2]}
      </Text>
    );
  }

  const bulletMatch = /^(\s*)[-*]\s+(.*)$/.exec(line);
  if (bulletMatch !== null) {
    return (
      <Text>
        {bulletMatch[1]}
        <Text color={colors.dim}>{glyphs.bullet} </Text>
        {renderInline(bulletMatch[2])}
      </Text>
    );
  }

  return <Text>{line.length > 0 ? renderInline(line) : ' '}</Text>;
}

function renderInline(line: string): React.ReactNode[] {
  const parts = line.split(/(\*\*[^*]+\*\*|`[^`]+`)/g);
  return parts.map((part, index) => {
    if (part.startsWith('**') && part.endsWith('**')) {
      return (
        <Text key={index} bold>
          {part.slice(2, -2)}
        </Text>
      );
    }
    if (part.startsWith('`') && part.endsWith('`') && part.length > 2) {
      return (
        <Text key={index} color={colors.accent}>
          {part.slice(1, -1)}
        </Text>
      );
    }
    return <Text key={index}>{part}</Text>;
  });
}

function splitBlocks(text: string): Block[] {
  const blocks: Block[] = [];
  let current: Block = { kind: 'prose', lines: [] };

  for (const rawLine of text.split('\n')) {
    const line = rawLine.replace(/\r$/, '');
    const fence = /^\s*```(\w*)\s*$/.exec(line);
    if (fence !== null) {
      pushBlock(blocks, current);
      current =
        current.kind === 'code'
          ? { kind: 'prose', lines: [] }
          : { kind: 'code', lang: fence[1], lines: [] };
      continue;
    }
    current.lines.push(line);
  }
  pushBlock(blocks, current);
  return blocks;
}

function pushBlock(blocks: Block[], block: Block): void {
  while (block.lines.length > 0 && block.lines[block.lines.length - 1].trim() === '') {
    block.lines.pop();
  }
  while (block.lines.length > 0 && block.lines[0].trim() === '') {
    block.lines.shift();
  }
  if (block.lines.length > 0) {
    blocks.push(block);
  }
}
