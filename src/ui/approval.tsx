import { Box, Text, useInput } from 'ink';
import React from 'react';
import type { ApprovalDecision, ToolCallInfo } from '../agent/events.js';
import { colors, glyphs } from '../theme.js';

export interface ApprovalRequest {
  call: ToolCallInfo;
  preview: string | null;
  resolve: (decision: ApprovalDecision) => void;
}

const MAX_PREVIEW_DISPLAY_LINES = 24;

function previewColor(line: string): string | undefined {
  if (line.startsWith('+')) {
    return colors.ok;
  }
  if (line.startsWith('-')) {
    return colors.error;
  }
  if (line.startsWith('@')) {
    return colors.accent;
  }
  return colors.dim;
}

export function ApprovalPrompt({ request }: { request: ApprovalRequest }): React.JSX.Element {
  useInput((input, key) => {
    if (input === 'y') {
      request.resolve('allow');
    } else if (input === 'n' || key.escape) {
      request.resolve('deny');
    }
  });

  return (
    <Box flexDirection="column" borderStyle="round" borderColor={colors.tool} paddingX={1}>
      <Text>
        <Text color={colors.tool}>
          {glyphs.tool} {request.call.name}
        </Text>
        <Text> wants to run:</Text>
      </Text>
      <Text>{'  '}{request.call.summary}</Text>
      {request.preview !== null &&
        request.preview
          .split('\n')
          .slice(0, MAX_PREVIEW_DISPLAY_LINES)
          .map((line, index) => (
            <Text key={index} color={previewColor(line)}>
              {line.length > 0 ? line.slice(0, 200) : ' '}
            </Text>
          ))}
      {request.preview !== null && request.preview.split('\n').length > MAX_PREVIEW_DISPLAY_LINES && (
        <Text color={colors.dim}>… (+{request.preview.split('\n').length - MAX_PREVIEW_DISPLAY_LINES} more lines)</Text>
      )}
      <Text color={colors.dim}>
        [y] allow   [n] deny   · /permissions off skips all prompts this session
      </Text>
    </Box>
  );
}
