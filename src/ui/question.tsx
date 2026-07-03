import { Box, Text, useInput } from 'ink';
import React, { useState } from 'react';
import { colors } from '../theme.js';
import { MultilineInput } from './multiline-input.js';

export interface QuestionRequest {
  question: string;
  options: string[];
  multiSelect: boolean;
  resolve: (answer: string) => void;
}

const noop = (): void => {};

/** Shown when the model asks the user something via the ask_user tool. */
export function QuestionPrompt({ request }: { request: QuestionRequest }): React.JSX.Element {
  const [answer, setAnswer] = useState('');
  const [selected, setSelected] = useState(0);
  const [checked, setChecked] = useState<ReadonlySet<number>>(new Set<number>());
  const optionCount = request.options.length;
  const multiSelect = request.multiSelect && optionCount > 0;

  useInput((_input, key) => {
    if (key.escape) {
      request.resolve('(the user skipped the question)');
    }
  });

  const toggleSelected = (): void => {
    setChecked((previous) => {
      const next = new Set(previous);
      if (next.has(selected)) {
        next.delete(selected);
      } else {
        next.add(selected);
      }
      return next;
    });
  };

  const submit = (value: string): void => {
    const text = value.trim();
    if (multiSelect) {
      const parts = request.options.filter((_, index) => checked.has(index));
      if (text.length > 0) {
        parts.push(text);
      }
      if (parts.length > 0) {
        request.resolve(parts.join(', '));
      }
      return;
    }
    if (text.length > 0) {
      request.resolve(text);
      return;
    }
    if (optionCount > 0) {
      request.resolve(request.options[selected]);
    }
  };

  return (
    <Box flexDirection="column" borderStyle="round" borderColor={colors.accent} paddingX={1}>
      <Text>
        <Text color={colors.accent} bold>
          ?{' '}
        </Text>
        {request.question}
      </Text>
      {request.options.map((option, index) => (
        <Text
          key={index}
          color={index === selected ? colors.accent : checked.has(index) ? undefined : colors.dim}
        >
          {index === selected ? '▸' : ' '} {multiSelect ? (checked.has(index) ? '◈ ' : '◇ ') : ''}
          {option}
        </Text>
      ))}
      <MultilineInput
        value={answer}
        onChange={setAnswer}
        onSubmit={submit}
        placeholder={
          multiSelect
            ? 'space toggles the highlighted option · or type extra detail'
            : optionCount > 0
              ? 'enter picks the highlighted option · or type your own answer'
              : 'type your answer'
        }
        interceptInput={(input, key): boolean => {
          if (multiSelect && input === ' ' && answer.length === 0 && !key.ctrl && !key.meta) {
            toggleSelected();
            return true;
          }
          return false;
        }}
        suggestionsOpen={false}
        onSuggestionTab={noop}
        onSuggestionUp={noop}
        onSuggestionDown={noop}
        onHistoryUp={(): void => {
          if (optionCount > 0) {
            setSelected((index) => (index - 1 + optionCount) % optionCount);
          }
        }}
        onHistoryDown={(): void => {
          if (optionCount > 0) {
            setSelected((index) => (index + 1) % optionCount);
          }
        }}
      />
      <Text color={colors.dim}>
        {multiSelect
          ? 'space toggles · ↑/↓ move · enter sends the selection · esc skips'
          : optionCount > 0
            ? '↑/↓ choose · enter accepts · esc skips'
            : 'enter sends · esc skips'}
      </Text>
    </Box>
  );
}
