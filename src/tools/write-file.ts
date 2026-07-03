import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { diffLines, newFilePreview } from './diff.js';
import type { ToolContext, ToolDefinition } from './types.js';
import { requireString } from './types.js';
import { leavesWorkspace, resolveWorkspacePath } from './workspace.js';

export const writeFileTool: ToolDefinition = {
  name: 'write_file',
  description: 'Write content to a file, creating it (and parent directories) or overwriting it entirely.',
  parameters: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'File path, absolute or relative to the working directory.' },
      content: { type: 'string', description: 'Full file content to write.' },
    },
    required: ['path', 'content'],
  },

  needsApproval(args: Record<string, unknown>, context: ToolContext): boolean {
    return typeof args['path'] !== 'string' || leavesWorkspace(context, args['path']);
  },

  summarize(args: Record<string, unknown>): string {
    return typeof args['path'] === 'string' ? args['path'] : '(invalid path)';
  },

  async preview(args: Record<string, unknown>, context: ToolContext): Promise<string | null> {
    const path = resolveWorkspacePath(context, requireString(args, 'path'));
    const content = requireString(args, 'content');
    const previous = await readFile(path, 'utf8').catch((): null => null);
    return previous === null ? newFilePreview(content) : diffLines(previous, content);
  },

  async execute(args: Record<string, unknown>, context: ToolContext): Promise<string> {
    const path = resolveWorkspacePath(context, requireString(args, 'path'));
    const content = requireString(args, 'content');
    context.recordUndo(path, await readFile(path, 'utf8').catch((): null => null));
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, content, 'utf8');
    const lineCount = content.split('\n').length;
    return `wrote ${lineCount} lines to ${path}`;
  },
};
