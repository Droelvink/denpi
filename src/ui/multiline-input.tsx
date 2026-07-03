import type { Key } from 'ink';
import { Box, Text, useInput } from 'ink';
import React, { useEffect, useRef, useState } from 'react';
import { colors, glyphs } from '../theme.js';

interface MultilineInputProps {
  value: string;
  onChange: (value: string) => void;
  onSubmit: (value: string) => void;
  placeholder: string;
  /** While the suggestion list is open, tab/↑/↓ are routed to it instead of the editor. */
  suggestionsOpen: boolean;
  onSuggestionTab: () => void;
  onSuggestionUp: () => void;
  onSuggestionDown: () => void;
  /** Called when ↑ is pressed on the first line / ↓ on the last line. */
  onHistoryUp: () => void;
  onHistoryDown: () => void;
  /** Return true to consume a keypress before the editor handles it. */
  interceptInput?: (input: string, key: Key) => boolean;
}

/**
 * Multi-line prompt editor. Enter submits; shift+enter, alt+enter, ctrl+j, or a
 * trailing "\" before enter insert a newline. Pasted text keeps its newlines.
 */
export function MultilineInput(props: MultilineInputProps): React.JSX.Element {
  const { value, onChange, onSubmit } = props;
  const [cursor, setCursor] = useState(value.length);
  const lastEmitted = useRef(value);

  useEffect(() => {
    if (value !== lastEmitted.current) {
      // External change (history recall, clear after submit): jump to the end.
      lastEmitted.current = value;
      setCursor(value.length);
    }
  }, [value]);

  const update = (next: string, nextCursor: number): void => {
    lastEmitted.current = next;
    setCursor(nextCursor);
    onChange(next);
  };

  const insert = (text: string): void => {
    update(value.slice(0, cursor) + text + value.slice(cursor), cursor + text.length);
  };

  const moveVertical = (delta: -1 | 1): void => {
    const lines = value.split('\n');
    const { row, col } = cursorPosition(lines, cursor);
    const targetRow = row + delta;
    if (targetRow < 0) {
      props.onHistoryUp();
      return;
    }
    if (targetRow >= lines.length) {
      props.onHistoryDown();
      return;
    }
    setCursor(indexAt(lines, targetRow, Math.min(col, lines[targetRow].length)));
  };

  useInput((input, key) => {
    if (props.interceptInput?.(input, key) === true) {
      return;
    }
    if (props.suggestionsOpen && (key.tab || key.upArrow || key.downArrow)) {
      if (key.tab) {
        props.onSuggestionTab();
      } else if (key.upArrow) {
        props.onSuggestionUp();
      } else {
        props.onSuggestionDown();
      }
      return;
    }
    if (key.tab || key.escape || key.pageDown || key.pageUp) {
      return;
    }
    if (key.leftArrow) {
      setCursor((current) => Math.max(0, current - 1));
      return;
    }
    if (key.rightArrow) {
      setCursor((current) => Math.min(value.length, current + 1));
      return;
    }
    if (key.upArrow || key.downArrow) {
      moveVertical(key.upArrow ? -1 : 1);
      return;
    }
    if (key.return) {
      if (key.shift || key.meta) {
        // shift+enter (CSI-u capable terminals) or alt+enter
        insert('\n');
        return;
      }
      if (value.endsWith('\\')) {
        update(`${value.slice(0, -1)}\n`, value.length);
        return;
      }
      onSubmit(value);
      return;
    }
    if (/^\x1b\[13;\d+u$/.test(input)) {
      // CSI-u encoded modified enter that parse-keypress did not recognize
      insert('\n');
      return;
    }
    if (key.backspace || key.delete) {
      if (cursor > 0) {
        update(value.slice(0, cursor - 1) + value.slice(cursor), cursor - 1);
      }
      return;
    }
    if (key.ctrl) {
      return;
    }
    const text = sanitize(input);
    if (text.length > 0) {
      insert(text);
    }
  });

  if (value.length === 0) {
    return (
      <Box>
        <Text color={colors.accent}>{glyphs.prompt} </Text>
        <Text dimColor>
          <Text inverse>{props.placeholder.slice(0, 1)}</Text>
          {props.placeholder.slice(1)}
        </Text>
      </Box>
    );
  }

  const lines = value.split('\n');
  const { row, col } = cursorPosition(lines, cursor);
  return (
    <Box flexDirection="column">
      {lines.map((line, index) => (
        <Box key={index}>
          <Text color={colors.accent}>{index === 0 ? `${glyphs.prompt} ` : '  '}</Text>
          {index === row ? (
            <Text>
              {line.slice(0, col)}
              <Text inverse>{col < line.length ? line[col] : ' '}</Text>
              {col < line.length ? line.slice(col + 1) : ''}
            </Text>
          ) : (
            <Text>{line.length > 0 ? line : ' '}</Text>
          )}
        </Box>
      ))}
    </Box>
  );
}

/** Newline-preserving cleanup for typed and pasted text. */
function sanitize(raw: string): string {
  return raw
    .replace(/\r\n?/g, '\n')
    .replace(/\t/g, '  ')
    // strip ANSI/CSI escape sequences, then any remaining control chars except newline
    .replace(/\x1b\[[0-9;?]*[a-zA-Z~]/g, '')
    .replace(/[\x00-\x09\x0b-\x1f\x7f]/g, '');
}

function cursorPosition(lines: string[], cursor: number): { row: number; col: number } {
  let remaining = cursor;
  for (let row = 0; row < lines.length; row++) {
    if (remaining <= lines[row].length) {
      return { row, col: remaining };
    }
    remaining -= lines[row].length + 1;
  }
  return { row: lines.length - 1, col: lines[lines.length - 1].length };
}

function indexAt(lines: string[], row: number, col: number): number {
  let index = 0;
  for (let i = 0; i < row; i++) {
    index += lines[i].length + 1;
  }
  return index + col;
}
