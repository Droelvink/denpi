import { isAbsolute, resolve } from 'node:path';
import fg from 'fast-glob';
import type { ToolContext, ToolDefinition } from './types.js';
import { requireString } from './types.js';
import { isInsideWorkspace } from './workspace.js';

const MAX_RESULTS = 200;
const IGNORE = ['**/node_modules/**', '**/.git/**'];

export const globTool: ToolDefinition = {
  name: 'glob',
  description: 'Find files by glob pattern (e.g. "src/**/*.ts"). Returns matching paths relative to the working directory.',
  parameters: {
    type: 'object',
    properties: {
      pattern: { type: 'string', description: 'Glob pattern to match file paths against.' },
    },
    required: ['pattern'],
  },
  requiresApproval: false,

  summarize(args: Record<string, unknown>): string {
    return typeof args['pattern'] === 'string' ? args['pattern'] : '(invalid pattern)';
  },

  async execute(args: Record<string, unknown>, context: ToolContext): Promise<string> {
    const pattern = requireString(args, 'pattern');
    if (context.sandbox && isAbsolute(pattern)) {
      throw new Error('absolute glob patterns are not allowed in the sandbox — use paths relative to the workspace');
    }
    let matches = await fg(pattern, {
      cwd: context.cwd,
      dot: true,
      onlyFiles: true,
      ignore: IGNORE,
      suppressErrors: true,
      followSymbolicLinks: false,
    });

    if (context.sandbox) {
      matches = matches.filter((match) => isInsideWorkspace(context.cwd, resolve(context.cwd, match)));
    }
    if (matches.length === 0) {
      return '(no files matched)';
    }
    matches.sort();
    const shown = matches.slice(0, MAX_RESULTS);
    const suffix = matches.length > MAX_RESULTS ? `\n… [${matches.length - MAX_RESULTS} more matches]` : '';
    return shown.join('\n') + suffix;
  },
};
