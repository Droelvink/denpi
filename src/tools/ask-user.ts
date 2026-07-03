import type { ToolContext, ToolDefinition } from './types.js';
import { optionalBoolean, optionalStringArray, requireString } from './types.js';

export const askUserTool: ToolDefinition = {
  name: 'ask_user',
  description:
    'Ask the user a clarifying question and wait for their answer. Use this when requirements are ambiguous, ' +
    'a decision meaningfully affects the approach, or information is missing — instead of guessing. ' +
    'Provide options when there are natural choices; the user can always answer in their own words.',
  parameters: {
    type: 'object',
    properties: {
      question: { type: 'string', description: 'The question to ask the user.' },
      options: {
        type: 'array',
        items: { type: 'string' },
        description: 'Optional suggested answers the user can pick from.',
      },
      multi_select: {
        type: 'boolean',
        description: 'When true, the user can select several of the options (answer is comma-separated).',
      },
    },
    required: ['question'],
  },

  needsApproval(): boolean {
    return false;
  },

  summarize(args: Record<string, unknown>): string {
    return typeof args['question'] === 'string' ? args['question'] : '(invalid question)';
  },

  execute(args: Record<string, unknown>, context: ToolContext): Promise<string> {
    const question = requireString(args, 'question');
    const options = optionalStringArray(args, 'options') ?? [];
    const multiSelect = (optionalBoolean(args, 'multi_select') ?? false) && options.length > 0;
    return context.askUser(question, options, multiSelect);
  },
};
