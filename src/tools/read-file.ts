import { readFile } from 'node:fs/promises';
import type { ToolContext, ToolDefinition } from './types.js';
import { optionalNumber, requireString } from './types.js';
import { leavesWorkspace, resolveWorkspacePath } from './workspace.js';

const DEFAULT_LIMIT = 500;

export const readFileTool: ToolDefinition = {
  name: 'read_file',
  description:
    'Read a text file. Returns numbered lines. Use offset/limit for large files ' +
    `(default: first ${DEFAULT_LIMIT} lines).`,
  parameters: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'File path, absolute or relative to the working directory.' },
      offset: { type: 'number', description: '1-based line number to start from.' },
      limit: { type: 'number', description: 'Maximum number of lines to return.' },
    },
    required: ['path'],
  },

  needsApproval(args: Record<string, unknown>, context: ToolContext): boolean {
    return typeof args['path'] === 'string' && leavesWorkspace(context, args['path']);
  },

  summarize(args: Record<string, unknown>): string {
    return typeof args['path'] === 'string' ? args['path'] : '(invalid path)';
  },

  async execute(args: Record<string, unknown>, context: ToolContext): Promise<string> {
    const path = resolveWorkspacePath(context, requireString(args, 'path'));
    const offset = optionalNumber(args, 'offset') ?? 1;
    const limit = optionalNumber(args, 'limit') ?? DEFAULT_LIMIT;

    const text = await readFile(path, 'utf8');
    const lines = text.split('\n');
    const start = Math.max(1, Math.floor(offset));
    const slice = lines.slice(start - 1, start - 1 + Math.max(1, Math.floor(limit)));

    if (slice.length === 0) {
      return `(file has ${lines.length} lines; offset ${start} is past the end)`;
    }

    const numbered = slice.map((line, i) => `${String(start + i).padStart(5)}│${line}`).join('\n');
    const remaining = lines.length - (start - 1 + slice.length);
    return remaining > 0 ? `${numbered}\n… [${remaining} more lines]` : numbered;
  },
};
