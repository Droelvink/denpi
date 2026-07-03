import { readFile, writeFile } from 'node:fs/promises';
import { diffLines } from './diff.js';
import type { ToolContext, ToolDefinition } from './types.js';
import { optionalBoolean, requireString } from './types.js';
import { resolveWorkspacePath } from './workspace.js';

export const editFileTool: ToolDefinition = {
  name: 'edit_file',
  description:
    'Replace an exact text snippet in a file. old_text must match exactly once ' +
    '(include enough surrounding context to make it unique), or set replace_all to true.',
  parameters: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'File path, absolute or relative to the working directory.' },
      old_text: { type: 'string', description: 'Exact text to find.' },
      new_text: { type: 'string', description: 'Replacement text.' },
      replace_all: { type: 'boolean', description: 'Replace every occurrence instead of requiring uniqueness.' },
    },
    required: ['path', 'old_text', 'new_text'],
  },
  requiresApproval: true,

  summarize(args: Record<string, unknown>): string {
    return typeof args['path'] === 'string' ? args['path'] : '(invalid path)';
  },

  async preview(args: Record<string, unknown>, context: ToolContext): Promise<string | null> {
    const path = resolveWorkspacePath(context, requireString(args, 'path'));
    const oldText = requireString(args, 'old_text');
    const newText = args['new_text'];
    if (typeof newText !== 'string') {
      return null;
    }
    const content = await readFile(path, 'utf8').catch((): null => null);
    if (content === null) {
      return '(file not found — the call will fail)';
    }
    if (!content.includes(oldText)) {
      return '(old_text not found in the file — the call will fail)';
    }
    return diffLines(oldText, newText);
  },

  async execute(args: Record<string, unknown>, context: ToolContext): Promise<string> {
    const path = resolveWorkspacePath(context, requireString(args, 'path'));
    const oldText = requireString(args, 'old_text');
    const newText = args['new_text'];
    if (typeof newText !== 'string') {
      throw new Error('missing required string argument "new_text"');
    }
    const replaceAll = optionalBoolean(args, 'replace_all') ?? false;

    const content = await readFile(path, 'utf8');
    const occurrences = content.split(oldText).length - 1;
    if (occurrences === 0) {
      throw new Error('old_text was not found in the file');
    }
    if (occurrences > 1 && !replaceAll) {
      throw new Error(`old_text matches ${occurrences} times; add more context or set replace_all`);
    }

    const updated = replaceAll
      ? content.split(oldText).join(newText)
      : content.replace(oldText, newText);
    context.recordUndo(path, content);
    await writeFile(path, updated, 'utf8');
    return `replaced ${replaceAll ? occurrences : 1} occurrence(s) in ${path}`;
  },
};
