import { readFile, stat } from 'node:fs/promises';
import { isAbsolute, resolve } from 'node:path';
import fg from 'fast-glob';
import type { ToolContext, ToolDefinition } from './types.js';
import { optionalBoolean, optionalString, requireString } from './types.js';
import { isInsideWorkspace } from './workspace.js';

const MAX_MATCHES = 100;
const MAX_FILES = 5000;
const MAX_FILE_SIZE = 1024 * 1024;
const IGNORE = ['**/node_modules/**', '**/.git/**'];

export const grepTool: ToolDefinition = {
  name: 'grep',
  description:
    'Search file contents with a regular expression. Returns "path:line: text" matches. ' +
    'Optionally restrict files with a glob pattern.',
  parameters: {
    type: 'object',
    properties: {
      pattern: { type: 'string', description: 'Regular expression to search for.' },
      glob: { type: 'string', description: 'Glob to restrict which files are searched (default: all files).' },
      ignore_case: { type: 'boolean', description: 'Case-insensitive search.' },
    },
    required: ['pattern'],
  },
  requiresApproval: false,

  summarize(args: Record<string, unknown>): string {
    const pattern = typeof args['pattern'] === 'string' ? args['pattern'] : '(invalid pattern)';
    const glob = typeof args['glob'] === 'string' ? ` in ${args['glob']}` : '';
    return `${pattern}${glob}`;
  },

  async execute(args: Record<string, unknown>, context: ToolContext): Promise<string> {
    const source = requireString(args, 'pattern');
    const flags = (optionalBoolean(args, 'ignore_case') ?? false) ? 'i' : '';
    const regex = new RegExp(source, flags);
    const filePattern = optionalString(args, 'glob') ?? '**/*';
    if (context.sandbox && isAbsolute(filePattern)) {
      throw new Error('absolute glob patterns are not allowed in the sandbox — use paths relative to the workspace');
    }

    let files = await fg(filePattern, {
      cwd: context.cwd,
      dot: true,
      onlyFiles: true,
      ignore: IGNORE,
      suppressErrors: true,
      followSymbolicLinks: false,
    });

    if (context.sandbox) {
      files = files.filter((file) => isInsideWorkspace(context.cwd, resolve(context.cwd, file)));
    }

    const matches: string[] = [];
    for (const file of files.slice(0, MAX_FILES)) {
      if (matches.length >= MAX_MATCHES) {
        break;
      }
      await searchFile(resolve(context.cwd, file), file, regex, matches);
    }

    if (matches.length === 0) {
      return '(no matches)';
    }
    const suffix = matches.length >= MAX_MATCHES ? `\n… [stopped at ${MAX_MATCHES} matches]` : '';
    return matches.join('\n') + suffix;
  },
};

async function searchFile(absolutePath: string, displayPath: string, regex: RegExp, matches: string[]): Promise<void> {
  try {
    const info = await stat(absolutePath);
    if (info.size > MAX_FILE_SIZE) {
      return;
    }
    const text = await readFile(absolutePath, 'utf8');
    if (text.includes('\0')) {
      return;
    }
    const lines = text.split('\n');
    for (let i = 0; i < lines.length && matches.length < MAX_MATCHES; i++) {
      if (regex.test(lines[i])) {
        matches.push(`${displayPath}:${i + 1}: ${lines[i].trim().slice(0, 200)}`);
      }
    }
  } catch {
    // unreadable file — skip
  }
}
