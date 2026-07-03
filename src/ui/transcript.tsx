import { Box, Text } from 'ink';
import React from 'react';
import { colors, glyphs } from '../theme.js';
import { Markdown } from './markdown.js';

export type TranscriptItem =
  | { kind: 'banner'; cwd: string }
  | { kind: 'user'; text: string }
  | { kind: 'assistant'; text: string }
  | { kind: 'tool'; name: string; summary: string; output: string; isError: boolean; durationMs: number }
  | { kind: 'tool-denied'; name: string; summary: string }
  | { kind: 'btw'; text: string }
  | { kind: 'thought'; text: string; durationMs: number }
  | { kind: 'info'; text: string }
  | { kind: 'error'; text: string };

const PREVIEW_LINES = 3;

export function TranscriptLine({ item }: { item: TranscriptItem }): React.JSX.Element {
  switch (item.kind) {
    case 'banner':
      return (
        <Box flexDirection="column" marginBottom={1}>
          <Text>
            <Text color={colors.accent}>▂▃▅▇ </Text>
            <Text bold>denpi</Text>
          </Text>
          <Text color={colors.dim}>a small agent tuned to your llama.cpp · /help for commands</Text>
          <Text color={colors.dim}>workspace: {item.cwd}</Text>
        </Box>
      );

    case 'user':
      return (
        <Box marginTop={1}>
          <Text color={colors.user}>{glyphs.prompt} </Text>
          <Text>{item.text}</Text>
        </Box>
      );

    case 'assistant':
      return (
        <Box marginTop={1} flexDirection="row">
          <Text color={colors.accent}>{glyphs.assistant} </Text>
          <Box flexGrow={1}>
            <Markdown text={item.text} />
          </Box>
        </Box>
      );

    case 'tool':
      return <ToolLine item={item} />;

    case 'tool-denied':
      return (
        <Box marginTop={1}>
          <Text color={colors.dim}>
            {glyphs.tool} {item.name} · {oneLine(item.summary)} — <Text color={colors.error}>denied</Text>
          </Text>
        </Box>
      );

    case 'btw':
      return (
        <Box marginTop={1} flexDirection="row">
          <Text color={colors.dim}>{glyphs.info} </Text>
          <Box flexGrow={1}>
            <Markdown text={item.text} />
          </Box>
        </Box>
      );

    case 'thought':
      return (
        <Box flexDirection="column" marginTop={1}>
          <Text color={colors.dim}>
            {glyphs.info} thought for {(item.durationMs / 1000).toFixed(1)}s
          </Text>
          <Text color={colors.dim} italic>
            {item.text.trim()}
          </Text>
        </Box>
      );

    case 'info':
      return (
        <Box>
          <Text color={colors.dim}>
            {glyphs.info} {item.text}
          </Text>
        </Box>
      );

    case 'error':
      return (
        <Box marginTop={1}>
          <Text color={colors.error}>
            {glyphs.error} {item.text}
          </Text>
        </Box>
      );
  }
}

function ToolLine({ item }: { item: Extract<TranscriptItem, { kind: 'tool' }> }): React.JSX.Element {
  const lines = item.output.split('\n');
  const preview = lines.slice(0, PREVIEW_LINES);
  const hidden = lines.length - preview.length;

  return (
    <Box flexDirection="column" marginTop={1}>
      <Text>
        <Text color={item.isError ? colors.error : colors.tool}>{glyphs.tool} </Text>
        <Text color={colors.tool}>{item.name}</Text>
        <Text color={colors.dim}> · {oneLine(item.summary)}</Text>
        <Text color={colors.dim}> ({formatDuration(item.durationMs)})</Text>
      </Text>
      {preview.map((line, index) => (
        <Text key={index} color={item.isError ? colors.error : colors.dim} dimColor={!item.isError}>
          {'  '}
          {line.slice(0, 200)}
        </Text>
      ))}
      {hidden > 0 && (
        <Text color={colors.dim}>
          {'  '}… +{hidden} more lines
        </Text>
      )}
    </Box>
  );
}

function oneLine(text: string): string {
  const collapsed = text.replace(/\s+/g, ' ').trim();
  return collapsed.length > 80 ? `${collapsed.slice(0, 80)}…` : collapsed;
}

function formatDuration(ms: number): string {
  return ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`;
}
